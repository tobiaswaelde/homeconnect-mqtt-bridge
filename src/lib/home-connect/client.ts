import axios from 'axios';
import type { ActiveHomeConnectConfig } from '~/types/config/home-connect';
import type { HomeAppliancesResponse, HomeConnectCommand, OAuthToken } from './types';

const fallbackRetryDelay = 10 * 60_000;

/** Represents a non-Axios HTTP response so rate limiting applies equally to SSE connections. */
class HomeConnectHttpError extends Error {
  /**
   * Creates the error instance.
   * @param {number} status The HTTP status code.
   * @param {string | null} retryAfter The Retry-After header value.
   */
  constructor(
    readonly status: number,
    readonly retryAfter: string | null,
  ) {
    super(`Home Connect request returned HTTP ${status}.`);
  }
}

/** Parses complete Server-Sent Events and retains an incomplete trailing event. */
export function consumeSseBuffer(buffer: string) {
  const events: string[] = [];
  let remaining = buffer;
  const separator = /\r?\n\r?\n/;
  let match: RegExpExecArray | null;
  while ((match = separator.exec(remaining))) {
    const event = remaining.slice(0, match.index);
    remaining = remaining.slice(match.index + match[0].length);
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (data) events.push(data);
  }
  return { events, remaining };
}

/** Owns Home Connect HTTP and event-stream requests. */
export class HomeConnectClient {
  private readonly api;
  private nextRetryAt?: number;
  private retryTimer?: NodeJS.Timeout;

  /**
   * Creates the class instance.
   * @param {ActiveHomeConnectConfig} cfg The active bridge configuration.
   */
  constructor(
    private readonly cfg: ActiveHomeConnectConfig,
    private readonly onNextRetryAtChange: (nextRetryAt?: number) => void = () => undefined,
  ) {
    this.api = axios.create({ baseURL: cfg.apiBaseUrl });
  }

  /** Clears the rate-limit timer during bridge cleanup. */
  destroy() {
    const hadNextRetryAt = !!this.nextRetryAt;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.nextRetryAt = undefined;
    if (hadNextRetryAt) this.onNextRetryAtChange();
  }

  /** Exchanges an OAuth grant for an access and refresh token. */
  async requestToken(params: URLSearchParams, signal: AbortSignal) {
    const response = await this.request(signal, () =>
      this.api.post<OAuthToken>('/security/oauth/token', params, {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        signal,
      }),
    );
    return response.data;
  }

  /** Lists the appliances available to the authenticated account. */
  async getAppliances(accessToken: string, signal: AbortSignal) {
    const response = await this.request(signal, () =>
      this.api.get<HomeAppliancesResponse>('/api/homeappliances', {
        headers: authorizationHeaders(accessToken),
        signal,
      }),
    );
    const appliances = response.data.data?.homeappliances;
    if (!Array.isArray(appliances)) throw new Error('Home Connect appliance response does not contain homeappliances.');
    return appliances;
  }

  /** Loads one supported category for one appliance. */
  async getCategory(applianceId: string, category: string, accessToken: string, signal: AbortSignal) {
    const response = await this.request(signal, () =>
      this.api.get<{ data: unknown }>(`/api/homeappliances/${encodeURIComponent(applianceId)}/${category}`, {
        headers: authorizationHeaders(accessToken),
        signal,
      }),
    );
    return response.data.data;
  }

  /** Executes a previously validated, fixed-path appliance command. */
  async executeCommand(command: HomeConnectCommand, accessToken: string, signal: AbortSignal) {
    await this.request(signal, () =>
      this.api.put(`/api/homeappliances/${encodeURIComponent(command.applianceId)}/${command.path}`, command.body, {
        headers: {
          ...authorizationHeaders(accessToken),
          'content-type': 'application/vnd.bsh.sdk.v1+json',
        },
        signal,
      }),
    );
  }

  /** Reads one SSE stream and forwards parsed data payloads to the caller. */
  async consumeEventStream(
    applianceId: string,
    accessToken: string,
    signal: AbortSignal,
    onEvent: (data: string) => void,
  ) {
    const response = await this.request(signal, async () => {
      const response = await fetch(
        `${this.cfg.apiBaseUrl}/api/homeappliances/${encodeURIComponent(applianceId)}/events`,
        {
          headers: { Accept: 'text/event-stream', ...authorizationHeaders(accessToken) },
          signal,
        },
      );
      if (response.status === 429) throw new HomeConnectHttpError(response.status, response.headers.get('retry-after'));
      return response;
    });
    if (!response.ok || !response.body) throw new Error(`Event stream returned HTTP ${response.status}.`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!signal.aborted) {
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      const parsed = consumeSseBuffer(buffer);
      buffer = parsed.remaining;
      parsed.events.forEach(onEvent);
    }
    buffer += decoder.decode();
    consumeSseBuffer(`${buffer}\n\n`).events.forEach(onEvent);
  }

  private async request<T>(signal: AbortSignal, operation: () => Promise<T>) {
    while (true) {
      await this.waitForRetry(signal);
      try {
        return await operation();
      } catch (error) {
        const retryAt = getRetryAt(error);
        if (!retryAt) throw error;
        this.setNextRetryAt(retryAt);
      }
    }
  }

  private async waitForRetry(signal: AbortSignal) {
    const retryAt = this.nextRetryAt;
    if (!retryAt || retryAt <= Date.now()) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(done, retryAt - Date.now());
      const abort = () => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        reject(signal.reason ?? new Error('Home Connect request was aborted.'));
      };
      function done() {
        signal.removeEventListener('abort', abort);
        resolve();
      }
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    });
  }

  private setNextRetryAt(retryAt: number) {
    if (this.nextRetryAt && this.nextRetryAt >= retryAt) return;
    this.nextRetryAt = retryAt;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.nextRetryAt = undefined;
      this.onNextRetryAtChange();
    }, retryAt - Date.now());
    this.onNextRetryAtChange(retryAt);
  }
}

function getRetryAt(error: unknown) {
  if (error instanceof HomeConnectHttpError)
    return error.status === 429 ? retryAtFromHeader(error.retryAfter) : undefined;
  if (!axios.isAxiosError(error) || error.response?.status !== 429) return;
  const headers = error.response.headers;
  const retryAfter = typeof headers.get === 'function' ? headers.get('retry-after') : headers['retry-after'];
  return retryAtFromHeader(typeof retryAfter === 'string' ? retryAfter : undefined);
}

function retryAtFromHeader(retryAfter: string | null | undefined) {
  if (!retryAfter) return Date.now() + fallbackRetryDelay;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Date.now() + seconds * 1_000;
  const date = Date.parse(retryAfter);
  return Number.isFinite(date) && date > Date.now() ? date : Date.now() + fallbackRetryDelay;
}

function authorizationHeaders(accessToken: string) {
  return { authorization: `Bearer ${accessToken}` };
}
