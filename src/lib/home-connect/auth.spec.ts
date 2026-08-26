import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ActiveHomeConnectConfig } from '~/types/config/home-connect';
import { HomeConnectAuth } from './auth';
import type { HomeConnectClient } from './client';

describe('HomeConnectAuth', () => {
  const cfg: ActiveHomeConnectConfig = {
    apiBaseUrl: 'https://api.home-connect.com',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    enabled: true,
    id: 'test',
    eventReconnectInterval: 30_000,
    redirectUri: 'https://bridge.example.net/home-connect/callback',
    topic: 'home/home-connect',
    updateInterval: 60_000,
  };

  it('stores and restores OAuth authentication with owner-only permissions', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mqtt-bridges-home-connect-'));
    const authFile = path.join(directory, 'auth.json');
    const client = { requestToken: jest.fn() } as unknown as HomeConnectClient;
    const auth = new HomeConnectAuth({ ...cfg, authFile }, client, jest.fn());
    const instance = auth as unknown as {
      persist(): Promise<void>;
      token: { access_token: string; expires_in: number; refresh_token: string };
      tokenExpiresAt: number;
    };

    try {
      instance.token = { access_token: 'access-token', expires_in: 600, refresh_token: 'refresh-token' };
      instance.tokenExpiresAt = 1_800_000_000_000;
      await instance.persist();

      expect((await stat(authFile)).mode & 0o777).toBe(0o600);
      expect(JSON.parse(await readFile(authFile, 'utf8'))).toEqual({
        expiresAt: 1_800_000_000_000,
        token: instance.token,
      });

      const restored = new HomeConnectAuth({ ...cfg, authFile }, client, jest.fn());
      await restored.load();
      expect(restored.accessToken).toBe('access-token');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('creates and validates a short-lived authorization state with the configured external callback', () => {
    const auth = new HomeConnectAuth(cfg, { requestToken: jest.fn() } as unknown as HomeConnectClient, jest.fn());
    const url = new URL(auth.createAuthorizationUrl());
    expect(url.searchParams.get('redirect_uri')).toBe('https://bridge.example.net/home-connect/callback');
    expect(auth.hasAuthorizationState(url.searchParams.get('state')!)).toBe(true);
    expect(auth.hasAuthorizationState('wrong-state')).toBe(false);
  });
});
