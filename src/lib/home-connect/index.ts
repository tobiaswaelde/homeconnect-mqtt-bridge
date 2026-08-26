import { HttpMqttBridge } from '~/lib/http-mqtt-bridge';
import type { MqttBridgeClient } from '~/modules/mqtt/mqtt.service';
import type { ActiveHomeConnectConfig } from '~/types/config/home-connect';
import { HomeConnectAuth } from './auth';
import { HomeConnectClient } from './client';
import {
  applianceCategories,
  applianceTopic,
  bridgeTopic,
  commandErrorTopic,
  commandResultTopic,
  parseProgramCommandTopic,
  programCommandSchema,
  programCommandTopics,
  publishApplianceInfo,
  publishCategory,
} from './mqtt-contract';
import type { HomeConnectCommand, HomeConnectCommandOperation } from './types';

/** Bridges discovered Home Connect appliances, state categories, and validated program commands to MQTT. */
export class HomeConnect extends HttpMqttBridge<ActiveHomeConnectConfig> {
  private readonly activeEventStreams = new Set<string>();
  private readonly auth: HomeConnectAuth;
  private readonly client: HomeConnectClient;
  private connected = false;
  private consecutiveFailures = 0;
  private readonly discoveredApplianceIds = new Set<string>();
  private destroyed = false;
  private readonly eventReconnectTimers = new Map<string, NodeJS.Timeout>();

  /**
   * Creates the class instance.
   * @param {ActiveHomeConnectConfig} cfg The active bridge configuration.
   * @param {MqttBridgeClient} mqtt The shared MQTT client.
   */
  constructor(cfg: ActiveHomeConnectConfig, mqtt: MqttBridgeClient) {
    super(cfg, mqtt, `HOME_CONNECT@${cfg.topic}`, cfg.apiBaseUrl);
    this.client = new HomeConnectClient(cfg);
    this.auth = new HomeConnectAuth(cfg, this.client, (message, error) => this.logError(message, error));
  }

  /** Returns the configured instance topic. */
  get topic() {
    return this.cfg.topic;
  }

  /** Returns the configured instance ID. */
  get id() {
    return this.cfg.id;
  }

  /** Sets up command routing and starts the first appliance discovery. */
  setup() {
    this.publishAvailability(false);
    this.subscribeCommands();
    void this.initialize();
    this.poll('appliances', this.cfg.updateInterval, () => this.refreshAppliances());
  }

  /** Stops requests, subscriptions, timers, OAuth refreshes, and event streams. */
  override destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.auth.destroy();
    for (const timer of this.eventReconnectTimers.values()) clearTimeout(timer);
    this.eventReconnectTimers.clear();
    this.publishAvailability(false);
    super.destroy();
  }

  /** Starts browser OAuth authorization and returns the unmodified Home Connect authorization URL. */
  createAuthorizationUrl() {
    return this.auth.createAuthorizationUrl();
  }

  /** Completes an OAuth callback, then discovers and publishes appliances. */
  async completeAuthorization(state: string, code: string) {
    if (!(await this.auth.completeAuthorization(state, code))) {
      this.recordDiscoveryFailure();
      return false;
    }
    await this.refreshAppliances();
    return true;
  }

  /** Checks whether this instance owns the given short-lived OAuth state. */
  hasAuthorizationState(state: string) {
    return this.auth.hasAuthorizationState(state);
  }

  private async initialize() {
    await this.auth.load();
    await this.refreshAppliances();
  }

  private async refreshAppliances() {
    const appliances = await this.getAppliances();
    if (!appliances || this.destroyed) return;

    this.discoveredApplianceIds.clear();
    appliances.forEach((appliance) => this.discoveredApplianceIds.add(appliance.haId));
    this.mqtt.publish(bridgeTopic(this.cfg.topic, 'appliances/json'), JSON.stringify(appliances));
    appliances.forEach((appliance) =>
      publishApplianceInfo(this.mqtt.publish.bind(this.mqtt), this.cfg.topic, appliance.haId, appliance),
    );
    this.recordSuccess();
    await Promise.all(appliances.map((appliance) => this.refreshAppliance(appliance.haId)));
    appliances.forEach((appliance) => this.connectEvents(appliance.haId));
  }

  private async getAppliances() {
    const controller = this.startRequest('appliances');
    try {
      const accessToken = await this.accessToken();
      if (!accessToken) {
        this.recordDiscoveryFailure();
        return;
      }
      return await this.client.getAppliances(accessToken, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) this.recordDiscoveryFailure();
      this.logError('Failed to load Home Connect appliances.', error, controller.signal);
      return;
    } finally {
      this.finishRequest('appliances', controller);
    }
  }

  private async refreshAppliance(applianceId: string) {
    await Promise.all(applianceCategories.map((category) => this.getApplianceCategory(applianceId, category)));
  }

  private async getApplianceCategory(applianceId: string, category: string) {
    const key = `appliance:${applianceId}:${category}`;
    const controller = this.startRequest(key);
    try {
      const accessToken = await this.accessToken();
      if (!accessToken) return;
      const data = await this.client.getCategory(applianceId, category, accessToken, controller.signal);
      publishCategory(this.mqtt.publish.bind(this.mqtt), this.cfg.topic, applianceId, category, data);
    } catch (error) {
      this.logError(`Failed to load Home Connect ${category} for ${applianceId}.`, error, controller.signal);
    } finally {
      this.finishRequest(key, controller);
    }
  }

  private connectEvents(applianceId: string) {
    const key = `events:${applianceId}`;
    if (this.destroyed || this.activeEventStreams.has(applianceId) || this.eventReconnectTimers.has(applianceId))
      return;
    this.activeEventStreams.add(applianceId);
    const controller = this.startRequest(key);
    void (async () => {
      try {
        const accessToken = await this.accessToken();
        if (!accessToken) return;
        await this.client.consumeEventStream(applianceId, accessToken, controller.signal, (payload) => {
          this.publishEvent(applianceId, payload);
        });
      } catch (error) {
        this.logError(`Home Connect event stream for ${applianceId} closed.`, error, controller.signal);
      } finally {
        this.activeEventStreams.delete(applianceId);
        this.finishRequest(key, controller);
        if (!this.destroyed && !controller.signal.aborted) this.scheduleEventReconnect(applianceId);
      }
    })();
  }

  private publishEvent(applianceId: string, payload: string) {
    try {
      publishCategory(
        this.mqtt.publish.bind(this.mqtt),
        this.cfg.topic,
        applianceId,
        'events',
        JSON.parse(payload),
        payload,
      );
    } catch {
      this.mqtt.publish(`${applianceTopic(this.cfg.topic, applianceId)}/events/json`, payload);
      this.logger.warn(`Received invalid Home Connect event JSON for ${applianceId}.`);
    }
  }

  private scheduleEventReconnect(applianceId: string) {
    const timer = setTimeout(() => {
      this.eventReconnectTimers.delete(applianceId);
      this.connectEvents(applianceId);
    }, this.cfg.eventReconnectInterval);
    this.eventReconnectTimers.set(applianceId, timer);
  }

  private subscribeCommands() {
    for (const topic of programCommandTopics(this.cfg.topic))
      this.subscribe(topic, (commandTopic, payload) => this.startProgram(commandTopic, payload));
  }

  private startProgram(commandTopic: string, payload: string) {
    const details = parseProgramCommandTopic(commandTopic, this.cfg.topic);
    try {
      if (!details) throw new Error('Command topic does not name an allowed Home Connect operation.');
      if (!this.discoveredApplianceIds.has(details.applianceId))
        throw new Error('Appliance is not currently discovered.');
      const program = programCommandSchema.parse(JSON.parse(payload));
      void this.executeCommand({
        applianceId: details.applianceId,
        body: { data: program },
        operation: details.operation,
        path: details.path,
      });
    } catch (error) {
      this.publishCommandError(details?.applianceId, details?.operation, error);
    } finally {
      this.mqtt.publish(commandTopic, null);
    }
  }

  private async executeCommand(command: HomeConnectCommand) {
    const key = `command:${command.applianceId}`;
    const controller = this.startRequest(key);
    try {
      const accessToken = await this.accessToken();
      if (!accessToken) {
        this.publishCommandError(
          command.applianceId,
          command.operation,
          new Error('Home Connect authentication is unavailable.'),
        );
        return;
      }
      await this.client.executeCommand(command, accessToken, controller.signal);
      if (controller.signal.aborted) return;

      await this.refreshAppliance(command.applianceId);
      if (controller.signal.aborted) return;

      this.mqtt.publish(
        commandResultTopic(this.cfg.topic, command.applianceId, command.operation),
        JSON.stringify({ applianceId: command.applianceId, operation: command.operation, status: 'success' }),
      );
    } catch (error) {
      if (controller.signal.aborted) return;

      this.publishCommandError(command.applianceId, command.operation, error);
      this.logError(`Failed to execute Home Connect command for ${command.applianceId}.`, error, controller.signal);
    } finally {
      this.finishRequest(key, controller);
    }
  }

  private publishCommandError(
    applianceId: string | undefined,
    operation: HomeConnectCommandOperation | undefined,
    error: unknown,
  ) {
    this.mqtt.publish(
      commandErrorTopic(this.cfg.topic, applianceId, operation),
      JSON.stringify({
        applianceId: applianceId ?? null,
        operation: operation ?? null,
        reason: error instanceof Error ? error.message : String(error),
        status: 'error',
      }),
    );
  }

  private async accessToken() {
    if (await this.auth.ensureToken()) return this.auth.accessToken;
    return undefined;
  }

  private recordSuccess() {
    this.consecutiveFailures = 0;
    this.publishAvailability(true);
  }

  private recordDiscoveryFailure() {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= 3) this.publishAvailability(false);
  }

  private publishAvailability(connected: boolean) {
    if (this.connected === connected && this.connected) return;
    this.connected = connected;
    this.mqtt.publish(bridgeTopic(this.cfg.topic, 'connected'), connected);
  }

  private logError(message: string, error: unknown, signal?: AbortSignal) {
    if (signal?.aborted || this.destroyed) return;
    this.logger.error(`${message} ${error instanceof Error ? error.message : String(error)}`);
  }
}
