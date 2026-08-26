import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ENV } from '~/config/env';
import type { ActiveHomeConnectConfig } from '~/types/config/home-connect';
import { HomeConnectClient } from './client';
import type { HomeConnectAuthentication, OAuthToken } from './types';

/** Handles Home Connect OAuth grants and strictly local token persistence. */
export class HomeConnectAuth {
  private static readonly authorizationStateDuration = 10 * 60_000;
  private authorizationCode?: string;
  private authorizationState?: { expiresAt: number; value: string };
  private token?: OAuthToken;
  private tokenExpiresAt = 0;
  private tokenRequest?: Promise<boolean>;
  private tokenController?: AbortController;

  /**
   * Creates the class instance.
   * @param {ActiveHomeConnectConfig} cfg The active bridge configuration.
   * @param {HomeConnectClient} client The API client.
   * @param {(message: string, error: unknown) => void} onError The bridge error logger.
   */
  constructor(
    private readonly cfg: ActiveHomeConnectConfig,
    private readonly client: HomeConnectClient,
    private readonly onError: (message: string, error: unknown) => void,
  ) {
    this.authorizationCode = cfg.authorizationCode;
  }

  /** Restores the persisted token before the bridge starts network work. */
  async load() {
    try {
      const authentication = JSON.parse(await readFile(this.authenticationFile, 'utf8')) as unknown;
      if (!isAuthentication(authentication))
        throw new Error('Authentication file does not contain a valid OAuth token.');
      this.token = authentication.token;
      this.tokenExpiresAt = authentication.expiresAt;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        this.onError('Could not load the Home Connect authentication file.', error);
    }
  }

  /** Creates a short-lived, state-bound browser authorization URL. */
  createAuthorizationUrl() {
    if (!this.cfg.redirectUri) throw new Error('A redirectUri is required for browser authorization.');
    const state = randomBytes(32).toString('base64url');
    this.authorizationState = { expiresAt: Date.now() + HomeConnectAuth.authorizationStateDuration, value: state };
    const url = new URL('/security/oauth/authorize', this.cfg.apiBaseUrl);
    url.searchParams.set('client_id', this.cfg.clientId);
    url.searchParams.set('redirect_uri', this.cfg.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    return url.toString();
  }

  /** Checks whether the supplied state belongs to an unexpired browser authorization request. */
  hasAuthorizationState(state: string) {
    const authorizationState = this.authorizationState;
    if (!authorizationState || authorizationState.expiresAt < Date.now()) {
      this.authorizationState = undefined;
      return false;
    }
    return authorizationState.value === state;
  }

  /** Validates a callback state and exchanges its authorization code. */
  async completeAuthorization(state: string, code: string) {
    if (!this.hasAuthorizationState(state)) return false;
    this.authorizationState = undefined;
    this.authorizationCode = code;
    this.token = undefined;
    this.tokenExpiresAt = 0;
    return this.ensureToken();
  }

  /** Returns a usable access token, refreshing it only once for concurrent callers. */
  async ensureToken() {
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return true;
    if (!this.token?.refresh_token && !this.cfg.refreshToken && !this.authorizationCode) return false;
    if (!this.tokenRequest) {
      this.tokenController = new AbortController();
      this.tokenRequest = this.requestToken(this.tokenController.signal).finally(() => {
        this.tokenRequest = undefined;
        this.tokenController = undefined;
      });
    }
    return this.tokenRequest;
  }

  /** Returns the current token only after a successful `ensureToken` call. */
  get accessToken() {
    return this.token?.access_token;
  }

  /** Aborts a token refresh during bridge cleanup. */
  destroy() {
    this.tokenController?.abort();
  }

  private async requestToken(signal: AbortSignal) {
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
      const token = await this.client.requestToken(params, signal);
      this.token = {
        ...token,
        refresh_token: token.refresh_token ?? this.token?.refresh_token ?? this.cfg.refreshToken,
      };
      this.tokenExpiresAt = Date.now() + this.token.expires_in * 1_000;
      await this.persist();
      this.authorizationCode = undefined;
      return true;
    } catch (error) {
      if (!signal.aborted) this.onError('Home Connect authentication failed.', error);
      return false;
    }
  }

  private get authenticationFile() {
    const topicHash = createHash('sha256').update(this.cfg.topic).digest('hex').slice(0, 12);
    const file = this.cfg.authFile ?? `.home-connect-${topicHash}.auth.json`;
    return path.isAbsolute(file) ? file : path.resolve(ENV.CONFIG_PATH, file);
  }

  private async persist() {
    if (!this.token?.refresh_token) return;
    const file = this.authenticationFile;
    const temporaryFile = `${file}.${process.pid}.tmp`;
    const authentication: HomeConnectAuthentication = { expiresAt: this.tokenExpiresAt, token: this.token };
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(temporaryFile, JSON.stringify(authentication), { encoding: 'utf8', mode: 0o600 });
      await rename(temporaryFile, file);
      await chmod(file, 0o600);
    } catch (error) {
      this.onError('Could not store the Home Connect authentication file.', error);
    }
  }
}

function isAuthentication(value: unknown): value is HomeConnectAuthentication {
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
