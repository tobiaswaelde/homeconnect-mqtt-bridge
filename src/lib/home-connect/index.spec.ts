import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { MqttBridgeClient } from '~/modules/mqtt/mqtt.service';
import type { HomeConnectConfig } from '~/types/config/home-connect';
import { HomeConnect } from './index';

describe('HomeConnect', () => {
  const cfg: HomeConnectConfig = {
    apiBaseUrl: 'https://api.home-connect.com',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    enabled: true,
    id: 'test',
    eventReconnectInterval: 30_000,
    redirectUri: undefined,
    refreshToken: 'refresh-token',
    topic: 'home/home-connect',
    updateInterval: 60_000,
  };

  it('keeps only one active event stream per appliance', async () => {
    const fetchMock = jest.fn(() => new Promise<Response>(() => undefined));
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    const mqtt = { publish: jest.fn(), subscribe: jest.fn(() => jest.fn()) } as unknown as MqttBridgeClient;
    const bridge = new HomeConnect(cfg, mqtt);
    const instance = bridge as unknown as {
      connectEvents(id: string): void;
      token: { access_token: string; expires_in: number };
      tokenExpiresAt: number;
    };
    instance.token = { access_token: 'access-token', expires_in: 600 };
    instance.tokenExpiresAt = Date.now() + 600_000;

    instance.connectEvents('appliance-id');
    await Promise.resolve();
    instance.connectEvents('appliance-id');

    expect(fetchMock).toHaveBeenCalledTimes(1);

    bridge.destroy();
    global.fetch = originalFetch;
  });

  it('stores and restores OAuth authentication with owner-only permissions', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mqtt-bridges-home-connect-'));
    const authFile = path.join(directory, 'auth.json');
    const mqtt = { publish: jest.fn(), subscribe: jest.fn(() => jest.fn()) } as unknown as MqttBridgeClient;
    const bridge = new HomeConnect({ ...cfg, authFile }, mqtt);
    const instance = bridge as unknown as {
      loadAuthentication(): Promise<void>;
      persistAuthentication(): Promise<void>;
      token: { access_token: string; expires_in: number; refresh_token: string };
      tokenExpiresAt: number;
    };

    try {
      instance.token = { access_token: 'access-token', expires_in: 600, refresh_token: 'refresh-token' };
      instance.tokenExpiresAt = 1_800_000_000_000;
      await instance.persistAuthentication();

      expect((await stat(authFile)).mode & 0o777).toBe(0o600);
      expect(JSON.parse(await readFile(authFile, 'utf8'))).toEqual({
        expiresAt: 1_800_000_000_000,
        token: { access_token: 'access-token', expires_in: 600, refresh_token: 'refresh-token' },
      });

      const restored = new HomeConnect({ ...cfg, authFile }, mqtt) as unknown as {
        loadAuthentication(): Promise<void>;
        token: { access_token: string; expires_in: number; refresh_token: string };
        tokenExpiresAt: number;
      };
      await restored.loadAuthentication();
      expect(restored.token).toEqual(instance.token);
      expect(restored.tokenExpiresAt).toBe(instance.tokenExpiresAt);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('creates and validates a short-lived browser authorization state', async () => {
    const mqtt = { publish: jest.fn(), subscribe: jest.fn(() => jest.fn()) } as unknown as MqttBridgeClient;
    const bridge = new HomeConnect({ ...cfg, redirectUri: 'http://localhost:3003/home-connect/callback' }, mqtt);

    const url = new URL(bridge.createAuthorizationUrl());

    expect(url.origin).toBe('https://api.home-connect.com');
    expect(url.pathname).toBe('/security/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe(cfg.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3003/home-connect/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(bridge.hasAuthorizationState(url.searchParams.get('state')!)).toBe(true);
    expect(bridge.hasAuthorizationState('wrong-state')).toBe(false);
  });

  it('reads appliances from Home Connects documented response envelope', async () => {
    const mqtt = { publish: jest.fn(), subscribe: jest.fn(() => jest.fn()) } as unknown as MqttBridgeClient;
    const bridge = new HomeConnect(cfg, mqtt);
    const instance = bridge as unknown as {
      api: { get: jest.Mock };
      getAppliances(): Promise<{ haId: string }[] | undefined>;
      token: { access_token: string; expires_in: number };
      tokenExpiresAt: number;
    };
    instance.token = { access_token: 'access-token', expires_in: 600 };
    instance.tokenExpiresAt = Date.now() + 600_000;
    instance.api.get = jest.fn().mockResolvedValue({ data: { data: { homeappliances: [{ haId: 'appliance-id' }] } } });

    await expect(instance.getAppliances()).resolves.toEqual([{ haId: 'appliance-id' }]);
  });

  it('publishes Home Connect values below their feature keys and preserves units', () => {
    const mqtt = { publish: jest.fn(), subscribe: jest.fn(() => jest.fn()) } as unknown as MqttBridgeClient;
    const bridge = new HomeConnect(cfg, mqtt);
    const instance = bridge as unknown as {
      publishData(id: string, category: string, data: unknown): void;
    };

    instance.publishData('appliance-id', 'status', {
      items: [
        {
          key: 'BSH.Common.Status.OperationState',
          unit: 'seconds',
          value: 'BSH.Common.EnumType.OperationState.Run',
        },
      ],
    });

    expect(mqtt.publish).toHaveBeenCalledWith(
      'home/home-connect/appliances/appliance-id/status/BSH.Common.Status.OperationState',
      'Run',
    );
    expect(mqtt.publish).toHaveBeenCalledWith(
      'home/home-connect/appliances/appliance-id/status/BSH.Common.Status.OperationState/raw',
      'BSH.Common.EnumType.OperationState.Run',
    );
    expect(mqtt.publish).toHaveBeenCalledWith(
      'home/home-connect/appliances/appliance-id/status/BSH.Common.Status.OperationState/unit',
      'seconds',
    );
  });

  it('uses the Home Connect media type when starting a program', async () => {
    const mqtt = { publish: jest.fn(), subscribe: jest.fn(() => jest.fn()) } as unknown as MqttBridgeClient;
    const bridge = new HomeConnect(cfg, mqtt);
    const instance = bridge as unknown as {
      api: { request: jest.Mock };
      executeCommand(command: { applianceId: string; body: unknown; path: string }): Promise<void>;
      refreshAppliance(id: string): Promise<void>;
      token: { access_token: string; expires_in: number };
      tokenExpiresAt: number;
    };
    instance.token = { access_token: 'access-token', expires_in: 600 };
    instance.tokenExpiresAt = Date.now() + 600_000;
    instance.api.request = jest.fn().mockResolvedValue(undefined);
    instance.refreshAppliance = jest.fn().mockResolvedValue(undefined);

    await instance.executeCommand({
      applianceId: 'appliance-id',
      body: { data: { key: 'ConsumerProducts.CoffeeMaker.Program.Beverage.Espresso' } },
      path: '/programs/active',
    });

    expect(instance.api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer access-token',
          'content-type': 'application/vnd.bsh.sdk.v1+json',
        }),
      }),
    );
  });

  it('starts a program from its appliance-specific MQTT topic', () => {
    const mqtt = { publish: jest.fn(), subscribe: jest.fn(() => jest.fn()) } as unknown as MqttBridgeClient;
    const bridge = new HomeConnect(cfg, mqtt);
    const instance = bridge as unknown as {
      executeCommand(command: unknown): Promise<void>;
      startProgram(topic: string, payload: string): void;
    };
    instance.executeCommand = jest.fn().mockResolvedValue(undefined);

    instance.startProgram(
      'home/home-connect/appliances/appliance-id/programs/active/set/json',
      JSON.stringify({ key: 'ConsumerProducts.CoffeeMaker.Program.Beverage.Espresso' }),
    );

    expect(instance.executeCommand).toHaveBeenCalledWith({
      applianceId: 'appliance-id',
      body: { data: { key: 'ConsumerProducts.CoffeeMaker.Program.Beverage.Espresso' } },
      path: '/programs/active',
    });
    expect(mqtt.publish).toHaveBeenCalledWith(
      'home/home-connect/appliances/appliance-id/programs/active/set/json',
      null,
    );
  });

  it('subscribes to an appliance-specific program start topic', () => {
    const mqtt = { publish: jest.fn(), subscribe: jest.fn(() => jest.fn()) } as unknown as MqttBridgeClient;
    const bridge = new HomeConnect(cfg, mqtt);
    const instance = bridge as unknown as { subscribeCommands(): void };

    instance.subscribeCommands();

    expect(mqtt.subscribe).toHaveBeenCalledWith(
      'home/home-connect/appliances/+/programs/active/set/json',
      expect.any(Function),
    );
  });
});
