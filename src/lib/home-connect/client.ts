import axios from 'axios';
import type { ActiveHomeConnectConfig } from '~/types/config/home-connect';
import type { HomeAppliancesResponse, HomeConnectCommand, OAuthToken } from './types';

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

  /**
   * Creates the class instance.
   * @param {ActiveHomeConnectConfig} cfg The active bridge configuration.
   */
  constructor(private readonly cfg: ActiveHomeConnectConfig) {
    this.api = axios.create({ baseURL: cfg.apiBaseUrl });
  }

  /** Exchanges an OAuth grant for an access and refresh token. */
  async requestToken(params: URLSearchParams, signal: AbortSignal) {
    const response = await this.api.post<OAuthToken>('/security/oauth/token', params, {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal,
    });
    return response.data;
  }

  /** Lists the appliances available to the authenticated account. */
  async getAppliances(accessToken: string, signal: AbortSignal) {
    const response = await this.api.get<HomeAppliancesResponse>('/api/homeappliances', {
      headers: authorizationHeaders(accessToken),
      signal,
    });
    const appliances = response.data.data?.homeappliances;
    if (!Array.isArray(appliances)) throw new Error('Home Connect appliance response does not contain homeappliances.');
    return appliances;
  }

  /** Loads one supported category for one appliance. */
  async getCategory(applianceId: string, category: string, accessToken: string, signal: AbortSignal) {
    const response = await this.api.get<{ data: unknown }>(
      `/api/homeappliances/${encodeURIComponent(applianceId)}/${category}`,
      { headers: authorizationHeaders(accessToken), signal },
    );
    return response.data.data;
  }

  /** Executes a previously validated, fixed-path appliance command. */
  async executeCommand(command: HomeConnectCommand, accessToken: string, signal: AbortSignal) {
    await this.api.put(`/api/homeappliances/${encodeURIComponent(command.applianceId)}/${command.path}`, command.body, {
      headers: {
        ...authorizationHeaders(accessToken),
        'content-type': 'application/vnd.bsh.sdk.v1+json',
      },
      signal,
    });
  }

  /** Reads one SSE stream and forwards parsed data payloads to the caller. */
  async consumeEventStream(
    applianceId: string,
    accessToken: string,
    signal: AbortSignal,
    onEvent: (data: string) => void,
  ) {
    const response = await fetch(
      `${this.cfg.apiBaseUrl}/api/homeappliances/${encodeURIComponent(applianceId)}/events`,
      {
        headers: { Accept: 'text/event-stream', ...authorizationHeaders(accessToken) },
        signal,
      },
    );
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
}

function authorizationHeaders(accessToken: string) {
  return { authorization: `Bearer ${accessToken}` };
}
