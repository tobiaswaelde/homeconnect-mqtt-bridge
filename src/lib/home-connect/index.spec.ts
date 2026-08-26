import type { MqttBridgeClient } from '~/modules/mqtt/mqtt.service';
import type { ActiveHomeConnectConfig } from '~/types/config/home-connect';
import { HomeConnect } from './index';

describe('HomeConnect', () => {
  const cfg: ActiveHomeConnectConfig = {
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

  function createBridge() {
    const mqtt = { publish: jest.fn(), subscribe: jest.fn(() => jest.fn()) } as unknown as MqttBridgeClient;
    const bridge = new HomeConnect(cfg, mqtt);
    return { bridge, mqtt, instance: bridge as unknown as TestableBridge };
  }

  it('subscribes only to explicit appliance program command topics', () => {
    const { instance, mqtt } = createBridge();
    instance.subscribeCommands();

    expect(mqtt.subscribe).toHaveBeenCalledWith(
      'home/home-connect/appliances/+/programs/active/set/json',
      expect.any(Function),
    );
    expect(mqtt.subscribe).toHaveBeenCalledWith(
      'home/home-connect/appliances/+/programs/selected/set/json',
      expect.any(Function),
    );
    expect(mqtt.subscribe).not.toHaveBeenCalledWith('home/home-connect/set/json', expect.any(Function));
  });

  it('rejects commands for an unknown appliance and clears their input topic', () => {
    const { instance, mqtt } = createBridge();
    const topic = 'home/home-connect/appliances/unknown/programs/active/set/json';
    instance.startProgram(topic, JSON.stringify({ key: 'ConsumerProducts.CoffeeMaker.Program.Beverage.Espresso' }));

    expect(mqtt.publish).toHaveBeenCalledWith(
      'home/home-connect/appliances/unknown/commands/error/json',
      expect.stringContaining('not currently discovered'),
    );
    expect(mqtt.publish).toHaveBeenCalledWith(topic, null);
  });

  it('rejects invalid program payloads without invoking the API', () => {
    const { instance, mqtt } = createBridge();
    instance.discoveredApplianceIds.add('appliance-id');
    instance.executeCommand = jest.fn();
    const topic = 'home/home-connect/appliances/appliance-id/programs/active/set/json';
    instance.startProgram(topic, JSON.stringify({ path: '/anything' }));

    expect(instance.executeCommand).not.toHaveBeenCalled();
    expect(mqtt.publish).toHaveBeenCalledWith(
      'home/home-connect/appliances/appliance-id/commands/error/json',
      expect.stringContaining('key'),
    );
    expect(mqtt.publish).toHaveBeenCalledWith(topic, null);
  });

  it('executes a validated command only for a discovered appliance', () => {
    const { instance, mqtt } = createBridge();
    instance.discoveredApplianceIds.add('appliance-id');
    instance.executeCommand = jest.fn();
    const topic = 'home/home-connect/appliances/appliance-id/programs/selected/set/json';
    instance.startProgram(topic, JSON.stringify({ key: 'ConsumerProducts.CoffeeMaker.Program.Beverage.Espresso' }));

    expect(instance.executeCommand).toHaveBeenCalledWith({
      applianceId: 'appliance-id',
      body: { data: { key: 'ConsumerProducts.CoffeeMaker.Program.Beverage.Espresso' } },
      path: 'programs/selected',
    });
    expect(mqtt.publish).toHaveBeenCalledWith(topic, null);
  });

  it('publishes a result topic for a successful command', async () => {
    const { instance, mqtt } = createBridge();
    instance.auth.ensureToken = jest.fn().mockResolvedValue(true);
    instance.auth.token = { access_token: 'access-token', expires_in: 600 };
    instance.client.executeCommand = jest.fn().mockResolvedValue(undefined);
    instance.refreshAppliance = jest.fn().mockResolvedValue(undefined);

    await instance.executeCommand({
      applianceId: 'appliance-id',
      body: { data: { key: 'ConsumerProducts.CoffeeMaker.Program.Beverage.Espresso' } },
      path: 'programs/active',
    });

    expect(instance.client.executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'programs/active' }),
      'access-token',
      expect.any(AbortSignal),
    );
    expect(mqtt.publish).toHaveBeenCalledWith(
      'home/home-connect/appliances/appliance-id/commands/result/json',
      expect.stringContaining('"status":"success"'),
    );
  });

  it('publishes a command error and switches offline after persistent API failures', async () => {
    const { instance, mqtt } = createBridge();
    instance.auth.ensureToken = jest.fn().mockResolvedValue(true);
    instance.auth.token = { access_token: 'access-token', expires_in: 600 };
    instance.client.executeCommand = jest.fn().mockRejectedValue(new Error('API unavailable'));
    const command = {
      applianceId: 'appliance-id',
      body: { data: { key: 'ConsumerProducts.CoffeeMaker.Program.Beverage.Espresso' } },
      path: 'programs/active' as const,
    };

    await instance.executeCommand(command);
    await instance.executeCommand(command);
    await instance.executeCommand(command);

    expect(mqtt.publish).toHaveBeenCalledWith(
      'home/home-connect/appliances/appliance-id/commands/error/json',
      expect.stringContaining('API unavailable'),
    );
    expect(mqtt.publish).toHaveBeenCalledWith('home/home-connect/connected', false);
  });

  it('switches offline after persistent authentication failures', async () => {
    const { instance, mqtt } = createBridge();
    instance.auth.ensureToken = jest.fn().mockResolvedValue(false);

    await instance.getAppliances();
    await instance.getAppliances();
    await instance.getAppliances();

    expect(mqtt.publish).toHaveBeenCalledWith('home/home-connect/connected', false);
  });

  it('keeps a single active SSE stream per appliance', async () => {
    const { instance } = createBridge();
    instance.auth.ensureToken = jest.fn().mockResolvedValue(true);
    instance.auth.token = { access_token: 'access-token', expires_in: 600 };
    instance.client.consumeEventStream = jest.fn(() => new Promise<void>(() => undefined));

    instance.connectEvents('appliance-id');
    await new Promise(setImmediate);
    instance.connectEvents('appliance-id');

    expect(instance.client.consumeEventStream).toHaveBeenCalledTimes(1);
    instance.destroy();
  });
});

type TestableBridge = {
  auth: { ensureToken: jest.Mock; token?: { access_token: string; expires_in: number } };
  client: { consumeEventStream: jest.Mock; executeCommand: jest.Mock };
  connectEvents(id: string): void;
  destroy(): void;
  discoveredApplianceIds: Set<string>;
  executeCommand(command: unknown): Promise<void>;
  getAppliances(): Promise<unknown>;
  refreshAppliance(id: string): Promise<void>;
  startProgram(topic: string, payload: string): void;
  subscribeCommands(): void;
};
