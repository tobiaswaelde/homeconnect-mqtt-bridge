import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ENV } from '~/config/env';
import { HttpMqttBridge } from '~/lib/http-mqtt-bridge';
import type { MqttBridgeClient } from '~/modules/mqtt/mqtt.service';
import { HomeConnectConfig } from '~/types/config/home-connect';
import { objectToMap } from '~/util/object';

interface OAuthToken {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

interface HomeConnectAuthentication {
  expiresAt: number;
  token: OAuthToken;
}

interface Appliance {
  haId: string;
}

interface HomeAppliancesResponse {
  data: {
    homeappliances: Appliance[];
  };
}

interface HomeConnectCommand {
  applianceId: string;
  body?: unknown;
  method?: 'DELETE' | 'PUT';
  path: string;
}

interface HomeConnectProgram {
  key: string;
  options?: unknown[];
}

type MqttScalar = string | number | boolean;

/** Bridges Home Connect appliance state and event streams to MQTT.
 */
export class HomeConnect extends HttpMqttBridge<HomeConnectConfig> {
  private static readonly authorizationStateDuration = 10 * 60_000;

  private authorizationCode = this.cfg.authorizationCode;
  private authorizationState?: { expiresAt: number; value: string };
  private destroyed = false;
  private readonly activeEventStreams = new Set<string>();
  private readonly eventReconnectTimers = new Map<string, NodeJS.Timeout>();
  private tokenExpiresAt = 0;
  private tokenRequest?: Promise<boolean>;
  private token?: OAuthToken;

  /**
   * Creates the class instance.
   * @param cfg - Value of type `{ id: string; enabled: boolean; topic: string; apiBaseUrl: string; clientId: string; clientSecret: string; eventReconnectInterval: number; redirectUri: string | undefined; updateInterval: number; authFile?: string | undefined; authorizationCode?: string | undefined; refreshToken?: string | undefined; }`.
   * @param mqtt - Value of type `MqttBridgeClient`.
   */
  constructor(cfg: HomeConnectConfig, mqtt: MqttBridgeClient) {
    super(cfg, mqtt, `HOME_CONNECT@${cfg.topic}`, cfg.apiBaseUrl);
  }

  /**
   * Executes `topic`.
   * @returns Result of type `string`.
   */
  public get topic() {
    return this.cfg.topic;
  }

  /**
   * Executes `id`.
   * @returns Result of type `string`.
   */
  public get id() {
    return this.cfg.id;
  }

  /**
   * Executes `setup`.
   * @returns Result of type `void`.
   */
  public setup() {
    this.mqtt.publish(`${this.cfg.topic}/connected`, false);
    this.subscribeCommands();
    void this.initialize();
    this.poll('appliances', this.cfg.updateInterval, () => this.refreshAppliances());
  }

  /**
   * Executes `destroy`.
   * @returns Result of type `void`.
   */
  public override destroy() {
    if (this.destroyed) return;

    this.destroyed = true;
    for (const timer of this.eventReconnectTimers.values()) clearTimeout(timer);
    this.eventReconnectTimers.clear();
    this.mqtt.publish(`${this.cfg.topic}/connected`, false);
    super.destroy();
  }

  /** Starts a browser authorization flow and returns the Home Connect login URL.
   * @returns Result of type `string`.
   */
  public createAuthorizationUrl() {
    if (!this.cfg.redirectUri) throw new Error('A redirectUri is required for browser authorization.');

    const state = randomBytes(32).toString('base64url');
    this.authorizationState = { expiresAt: Date.now() + HomeConnect.authorizationStateDuration, value: state };
    const url = new URL('/security/oauth/authorize', this.cfg.apiBaseUrl);
    url.searchParams.set('client_id', this.cfg.clientId);
    url.searchParams.set('redirect_uri', this.cfg.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    return url.toString();
  }

  /** Verifies a browser callback's state and exchanges its authorization code for OAuth tokens.
   * @param state - Value of type `string`.
   * @param code - Value of type `string`.
   * @returns Result of type `Promise<boolean>`.
   */
  public async completeAuthorization(state: string, code: string) {
    if (!this.hasAuthorizationState(state)) return false;

    this.authorizationState = undefined;
    this.authorizationCode = code;
    this.token = undefined;
    this.tokenExpiresAt = 0;
    if (!(await this.ensureToken())) return false;

    await this.refreshAppliances();
    return true;
  }

  /** Checks whether this bridge owns an active authorization request.
   * @param state - Value of type `string`.
   * @returns Result of type `boolean`.
   */
  public hasAuthorizationState(state: string) {
    const authorizationState = this.authorizationState;
    if (!authorizationState || authorizationState.expiresAt < Date.now()) {
      this.authorizationState = undefined;
      return false;
    }
    return authorizationState.value === state;
  }

  /**
   * Executes `initialize`.
   * @returns Result of type `Promise<void>`.
   */
  private async initialize() {
    await this.loadAuthentication();
    if (!(await this.ensureToken())) return;
    await this.refreshAppliances();
  }

  /**
   * Executes `refreshAppliances`.
   * @returns Result of type `Promise<void>`.
   */
  private async refreshAppliances() {
    const appliances = await this.getAppliances();
    if (!appliances || this.destroyed) return;

    this.mqtt.publish(`${this.cfg.topic}/connected`, true);
    await Promise.all(appliances.map((appliance) => this.refreshAppliance(appliance.haId)));
    for (const appliance of appliances) this.connectEvents(appliance.haId);
  }

  /**
   * Executes `getAppliances`.
   * @returns Result of type `Promise<Appliance[] | undefined>`.
   */
  private async getAppliances() {
    const controller = this.startRequest('appliances');
    try {
      if (!(await this.ensureToken())) return;
      const response = await this.api.get<HomeAppliancesResponse>('/api/homeappliances', {
        headers: this.authorizationHeaders(),
        signal: controller.signal,
      });
      const appliances = response.data.data?.homeappliances;
      if (!Array.isArray(appliances)) {
        throw new Error('Home Connect appliance response does not contain homeappliances.');
      }
      return appliances;
    } catch (error) {
      this.logError('Failed to load Home Connect appliances.', error, controller.signal);
      return;
    } finally {
      this.finishRequest('appliances', controller);
    }
  }

  /**
   * Executes `refreshAppliance`.
   * @param id - Value of type `string`.
   * @returns Result of type `Promise<void>`.
   */
  private async refreshAppliance(id: string) {
    await Promise.all(
      ['status', 'settings', 'programs/active', 'programs/selected'].map((path) => this.getApplianceData(id, path)),
    );
  }

  /**
   * Executes `getApplianceData`.
   * @param id - Value of type `string`.
   * @param path - Value of type `string`.
   * @returns Result of type `Promise<void>`.
   */
  private async getApplianceData(id: string, path: string) {
    const key = `appliance:${id}:${path}`;
    const controller = this.startRequest(key);
    try {
      if (!(await this.ensureToken())) return;
      const response = await this.api.get<{ data: unknown }>(`/api/homeappliances/${encodeURIComponent(id)}/${path}`, {
        headers: this.authorizationHeaders(),
        signal: controller.signal,
      });
      this.publishData(id, path, response.data.data);
    } catch (error) {
      this.logError(`Failed to load Home Connect ${path} for ${id}.`, error, controller.signal);
    } finally {
      this.finishRequest(key, controller);
    }
  }

  /**
   * Executes `connectEvents`.
   * @param id - Value of type `string`.
   * @returns Result of type `void`.
   */
  private connectEvents(id: string) {
    const key = `events:${id}`;
    if (this.destroyed || this.activeEventStreams.has(id) || this.eventReconnectTimers.has(id)) return;

    this.activeEventStreams.add(id);
    const controller = this.startRequest(key);
    void (async () => {
      try {
        if (!(await this.ensureToken())) return;
        const response = await fetch(`${this.cfg.apiBaseUrl}/api/homeappliances/${encodeURIComponent(id)}/events`, {
          headers: { Accept: 'text/event-stream', ...this.authorizationHeaders() },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error(`Event stream returned HTTP ${response.status}.`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!controller.signal.aborted) {
          const result = await reader.read();
          if (result.done) break;
          buffer += decoder.decode(result.value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() ?? '';
          for (const event of events) this.handleEvent(id, event);
        }
      } catch (error) {
        this.logError(`Home Connect event stream for ${id} closed.`, error, controller.signal);
      } finally {
        this.activeEventStreams.delete(id);
        this.finishRequest(key, controller);
        if (!this.destroyed && !controller.signal.aborted) this.scheduleEventReconnect(id);
      }
    })();
  }

  /**
   * Executes `handleEvent`.
   * @param id - Value of type `string`.
   * @param event - Value of type `string`.
   * @returns Result of type `void`.
   */
  private handleEvent(id: string, event: string) {
    const dataLine = event.split('\n').find((line) => line.startsWith('data:'));
    if (!dataLine) return;

    const payload = dataLine.slice(5).trim();
    if (!payload) return;
    this.mqtt.publish(`${this.applianceTopic(id)}/events/json`, payload);
    try {
      this.publishData(id, 'events', JSON.parse(payload));
    } catch {
      this.logger.warn(`Received invalid Home Connect event JSON for ${id}.`);
    }
  }

  /**
   * Executes `scheduleEventReconnect`.
   * @param id - Value of type `string`.
   * @returns Result of type `void`.
   */
  private scheduleEventReconnect(id: string) {
    const timer = setTimeout(() => {
      this.eventReconnectTimers.delete(id);
      this.connectEvents(id);
    }, this.cfg.eventReconnectInterval);
    this.eventReconnectTimers.set(id, timer);
  }

  /**
   * Executes `subscribeCommands`.
   * @returns Result of type `void`.
   */
  private subscribeCommands() {
    const commandTopic = `${this.cfg.topic}/set/json`;
    this.subscribe(commandTopic, (_, payload) => {
      if (!payload) return;
      try {
        const command = JSON.parse(payload) as HomeConnectCommand;
        if (
          !command.applianceId ||
          !/^\/[a-zA-Z0-9_./-]+$/.test(command.path) ||
          (command.method && command.method !== 'DELETE' && command.method !== 'PUT')
        ) {
          throw new Error('Invalid command.');
        }
        void this.executeCommand(command);
        this.mqtt.publish(commandTopic, null);
      } catch (error) {
        this.logError(`Invalid Home Connect command on ${commandTopic}.`, error);
      }
    });

    const programTopic = `${this.cfg.topic}/appliances/+/programs/active/set/json`;
    this.subscribe(programTopic, (topic, payload) => this.startProgram(topic, payload));
  }

  /** Starts an appliance program from its MQTT program topic.
   * @param topic - Value of type `string`.
   * @param payload - Value of type `string`.
   * @returns Result of type `void`.
   */
  private startProgram(topic: string, payload: string) {
    if (!payload) return;
    try {
      const applianceId = this.applianceIdFromProgramTopic(topic);
      const program = JSON.parse(payload) as HomeConnectProgram;
      if (!applianceId || !this.isProgram(program)) throw new Error('Invalid program command.');

      void this.executeCommand({
        applianceId,
        body: { data: program },
        path: '/programs/active',
      });
      this.mqtt.publish(topic, null);
    } catch (error) {
      this.logError(`Invalid Home Connect program command on ${topic}.`, error);
    }
  }

  /**
   * Executes `applianceIdFromProgramTopic`.
   * @param topic - Value of type `string`.
   * @returns Result of type `string | undefined`.
   */
  private applianceIdFromProgramTopic(topic: string) {
    const prefix = `${this.cfg.topic}/appliances/`;
    const suffix = '/programs/active/set/json';
    if (!topic.startsWith(prefix) || !topic.endsWith(suffix)) return;

    const applianceId = topic.slice(prefix.length, -suffix.length);
    return applianceId && !applianceId.includes('/') ? applianceId : undefined;
  }

  /**
   * Executes `isProgram`.
   * @param program - Value of type `HomeConnectProgram`.
   * @returns Result of type `boolean`.
   */
  private isProgram(program: HomeConnectProgram): program is HomeConnectProgram {
    return (
      typeof program?.key === 'string' &&
      program.key.length > 0 &&
      (program.options === undefined || Array.isArray(program.options))
    );
  }

  /**
   * Executes `executeCommand`.
   * @param command - Value of type `HomeConnectCommand`.
   * @returns Result of type `Promise<void>`.
   */
  private async executeCommand(command: HomeConnectCommand) {
    const controller = this.startRequest(`command:${command.applianceId}`);
    try {
      if (!(await this.ensureToken())) return;
      const endpoint = `/api/homeappliances/${encodeURIComponent(command.applianceId)}${command.path}`;
      await this.api.request({
        data: command.body,
        headers: {
          ...this.authorizationHeaders(),
          'content-type': 'application/vnd.bsh.sdk.v1+json',
        },
        method: command.method ?? 'PUT',
        signal: controller.signal,
        url: endpoint,
      });
      await this.refreshAppliance(command.applianceId);
    } catch (error) {
      this.logError(`Failed to execute Home Connect command for ${command.applianceId}.`, error, controller.signal);
    } finally {
      this.finishRequest(`command:${command.applianceId}`, controller);
    }
  }

  /**
   * Executes `ensureToken`.
   * @returns Result of type `Promise<boolean>`.
   */
  private async ensureToken() {
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return true;
    if (!this.token?.refresh_token && !this.cfg.refreshToken && !this.authorizationCode) return false;

    if (!this.tokenRequest) {
      const controller = this.startRequest('token');
      this.tokenRequest = this.requestToken(controller).finally(() => {
        this.finishRequest('token', controller);
        this.tokenRequest = undefined;
      });
    }
    return this.tokenRequest;
  }

  /**
   * Executes `requestToken`.
   * @param controller - Value of type `AbortController`.
   * @returns Result of type `Promise<boolean>`.
   */
  private async requestToken(controller: AbortController) {
    try {
      const params = new URLSearchParams({ client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret });
      if (this.token?.refresh_token ?? this.cfg.refreshToken) {
        params.set('grant_type', 'refresh_token');
        params.set('refresh_token', this.token?.refresh_token ?? this.cfg.refreshToken!);
      } else if (this.authorizationCode && this.cfg.redirectUri) {
        params.set('grant_type', 'authorization_code');
        params.set('code', this.authorizationCode);
        params.set('redirect_uri', this.cfg.redirectUri);
      } else {
        throw new Error('No saved token, refresh token, or authorization code is available.');
      }
      const response = await this.api.post<OAuthToken>('/security/oauth/token', params, {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        signal: controller.signal,
      });
      this.token = {
        ...response.data,
        refresh_token: response.data.refresh_token ?? this.token?.refresh_token ?? this.cfg.refreshToken,
      };
      this.tokenExpiresAt = Date.now() + this.token.expires_in * 1_000;
      await this.persistAuthentication();
      this.authorizationCode = undefined;
      return true;
    } catch (error) {
      this.logError('Home Connect authentication failed.', error, controller.signal);
      return false;
    }
  }

  /**
   * Executes `authorizationHeaders`.
   * @returns Result of type `{ authorization: string; }`.
   */
  private authorizationHeaders() {
    if (!this.token) throw new Error('Home Connect access token is unavailable.');
    return { authorization: `Bearer ${this.token.access_token}` };
  }

  /** Builds the local path used exclusively for OAuth authentication.
   * @returns Result of type `string`.
   */
  private get authenticationFile() {
    const topicHash = createHash('sha256').update(this.cfg.topic).digest('hex').slice(0, 12);
    const file = this.cfg.authFile ?? `.home-connect-${topicHash}.auth.json`;
    return path.isAbsolute(file) ? file : path.resolve(ENV.CONFIG_PATH, file);
  }

  /** Restores the most recently acquired OAuth token and its refresh token, if available.
   * @returns Result of type `Promise<void>`.
   */
  private async loadAuthentication() {
    try {
      const authentication = JSON.parse(await readFile(this.authenticationFile, 'utf8')) as unknown;
      if (!this.isAuthentication(authentication)) {
        throw new Error('Authentication file does not contain a valid OAuth token.');
      }
      this.token = authentication.token;
      this.tokenExpiresAt = authentication.expiresAt;
      this.logger.debug('Loaded Home Connect authentication from the local session file.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      this.logger.warn(
        `Could not load the Home Connect authentication file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Atomically stores only OAuth credentials with owner-only file permissions.
   * @returns Result of type `Promise<void>`.
   */
  private async persistAuthentication() {
    if (!this.token?.refresh_token) return;

    const file = this.authenticationFile;
    const temporaryFile = `${file}.${process.pid}.tmp`;
    const authentication: HomeConnectAuthentication = { expiresAt: this.tokenExpiresAt, token: this.token };
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(temporaryFile, JSON.stringify(authentication), { encoding: 'utf8', mode: 0o600 });
      await rename(temporaryFile, file);
      await chmod(file, 0o600);
      this.logger.debug('Stored Home Connect authentication in the local session file.');
    } catch (error) {
      this.logError('Could not store the Home Connect authentication file.', error);
    }
  }

  /**
   * Executes `isAuthentication`.
   * @param value - Value of type `unknown`.
   * @returns Result of type `boolean`.
   */
  private isAuthentication(value: unknown): value is HomeConnectAuthentication {
    if (!value || typeof value !== 'object') return false;
    const authentication = value as Partial<HomeConnectAuthentication>;
    const token = authentication.token;
    return (
      typeof authentication.expiresAt === 'number' &&
      Number.isFinite(authentication.expiresAt) &&
      !!token &&
      typeof token.access_token === 'string' &&
      token.access_token.length > 0 &&
      typeof token.expires_in === 'number' &&
      Number.isFinite(token.expires_in) &&
      typeof token.refresh_token === 'string' &&
      token.refresh_token.length > 0
    );
  }

  /**
   * Executes `publishData`.
   * @param id - Value of type `string`.
   * @param category - Value of type `string`.
   * @param data - Value of type `unknown`.
   * @returns Result of type `void`.
   */
  private publishData(id: string, category: string, data: unknown) {
    if (!data || typeof data !== 'object') return;

    const record = this.asRecord(data);
    if (record) {
      this.publishFeature(id, category, record);
      for (const item of [...this.asRecords(record.items), ...this.asRecords(record.options)]) {
        this.publishFeature(id, category, item);
      }
    }
    for (const [path, value] of objectToMap(data)) {
      this.mqtt.publish(`${this.applianceTopic(id)}/${category}/${path}`, value);
    }
  }

  /** Publishes Home Connect key/value/unit records below their feature key rather than an array index.
   * @param id - Value of type `string`.
   * @param category - Value of type `string`.
   * @param feature - Value of type `Record<string, unknown>`.
   * @returns Result of type `void`.
   */
  private publishFeature(id: string, category: string, feature: Record<string, unknown>) {
    if (typeof feature.key !== 'string' || !this.isMqttScalar(feature.value)) return;

    const topic = `${this.applianceTopic(id)}/${category}/${encodeURIComponent(feature.key)}`;
    this.mqtt.publish(topic, this.formatEnumValue(feature.value));
    if (this.isEnumValue(feature.value)) this.mqtt.publish(`${topic}/raw`, feature.value);
    if (this.isMqttScalar(feature.unit)) this.mqtt.publish(`${topic}/unit`, feature.unit);
  }

  /**
   * Executes `asRecord`.
   * @param value - Value of type `unknown`.
   * @returns Result of type `Record<string, unknown> | undefined`.
   */
  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  }

  /**
   * Executes `asRecords`.
   * @param value - Value of type `unknown`.
   * @returns Result of type `Record<string, unknown>[]`.
   */
  private asRecords(value: unknown) {
    return Array.isArray(value)
      ? value.map((item) => this.asRecord(item)).filter((item): item is Record<string, unknown> => !!item)
      : [];
  }

  /**
   * Executes `isMqttScalar`.
   * @param value - Value of type `unknown`.
   * @returns Result of type `boolean`.
   */
  private isMqttScalar(value: unknown): value is MqttScalar {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
  }

  /**
   * Executes `isEnumValue`.
   * @param value - Value of type `MqttScalar`.
   * @returns Result of type `boolean`.
   */
  private isEnumValue(value: MqttScalar): value is string {
    return typeof value === 'string' && value.includes('.EnumType.');
  }

  /**
   * Executes `formatEnumValue`.
   * @param value - Value of type `MqttScalar`.
   * @returns Result of type `string | number | boolean`.
   */
  private formatEnumValue(value: MqttScalar) {
    return this.isEnumValue(value) ? value.slice(value.lastIndexOf('.') + 1) : value;
  }

  /**
   * Executes `applianceTopic`.
   * @param id - Value of type `string`.
   * @returns Result of type `string`.
   */
  private applianceTopic(id: string) {
    return `${this.cfg.topic}/appliances/${id}`;
  }

  /**
   * Executes `logError`.
   * @param message - Value of type `string`.
   * @param error - Value of type `unknown`.
   * @param signal - Value of type `AbortSignal | undefined`.
   * @returns Result of type `void`.
   */
  private logError(message: string, error: unknown, signal?: AbortSignal) {
    if (signal?.aborted || this.destroyed) return;
    this.logger.error(`${message} ${error instanceof Error ? error.message : String(error)}`);
  }
}
