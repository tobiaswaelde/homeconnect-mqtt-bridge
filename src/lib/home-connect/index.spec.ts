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
      'home/home-connect/appliances/+/commands/programs-active/set/json',
      expect.any(Function),
    );
    expect(mqtt.subscribe).toHaveBeenCalledWith(
      'home/home-connect/appliances/+/commands/programs-selected/set/json',
      expect.any(Function),
    );
    expect(mqtt.subscribe).not.toHaveBeenCalledWith('home/home-connect/set/json', expect.any(Function));
  });

  it('rejects commands for an unknown appliance and clears their input topic', () => {
    const { instance, mqtt } = createBridge();
    const topic = 'home/home-connect/appliances/unknown/commands/programs-active/set/json';
    instance.startProgram(topic, JSON.stringify({ key: 'ConsumerProducts.CoffeeMaker.Program.Beverage.Espresso' }));

    expect(mqtt.publish).toHaveBeenCalledWith(
      'home/home-connect/appliances/unknown/commands/programs-active/error/json',
      expect.stringContaining('not currently discovered'),
    );
    expect(mqtt.publish).toHaveBeenCalledWith(topic, null);
  });

  it('rejects invalid program payloads without invoking the API', () => {
    const { instance, mqtt } = createBridge();
    instance.discoveredApplianceIds.add('appliance-id');
    instance.executeCommand = jest.fn();
    const topic = 'home/home-connect/appliances/appliance-id/commands/programs-active/set/json';
    instance.startProgram(topic, JSON.stringify({ path: '/anything' }));

    expect(instance.executeCommand).not.toHaveBeenCalled();
    expect(mqtt.publish).toHaveBeenCalledWith(
      'home/home-connect/appliances/appliance-id/commands/programs-active/error/json',
      expect.stringContaining('key'),
    );
    expect(mqtt.publish).toHaveBeenCalledWith(topic, null);
  });

  it('executes a validated command only for a discovered appliance', () => {
    const { instance, mqtt } = createBridge();
    instance.discoveredApplianceIds.add('appliance-id');
    instance.executeCommand = jest.fn();
    const topic = 'home/home-connect/appliances/appliance-id/commands/programs-selected/set/json';
    instance.startProgram(topic, JSON.stringify({ key: 'ConsumerProducts.CoffeeMaker.Program.Beverage.Espresso' }));

    expect(instance.executeCommand).toHaveBeenCalledWith({
      applianceId: 'appliance-id',
      body: { data: { key: 'ConsumerProducts.CoffeeMaker.Program.Beverage.Espresso' } },
      operation: 'programs-selected',
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
      operation: 'programs-active',
      path: 'programs/active',
    });

    expect(instance.client.executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'programs/active' }),
      'access-token',
      expect.any(AbortSignal),
    );
    expect(mqtt.publish).toHaveBeenCalledWith(
      'home/home-connect/appliances/appliance-id/commands/programs-active/result/json',
      expect.stringContaining('"status":"success"'),
    );
    const publish = mqtt.publish as jest.Mock;
    expect(instance.refreshAppliance.mock.invocationCallOrder[0]).toBeLessThan(
      publish.mock.invocationCallOrder.at(-1)!,
    );
  });

  it('does not publish an error for a superseded command request', async () => {
    const { instance, mqtt } = createBridge();
    instance.auth.ensureToken = jest.fn().mockResolvedValue(true);
    instance.auth.token = { access_token: 'access-token', expires_in: 600 };
    instance.refreshAppliance = jest.fn().mockResolvedValue(undefined);
    let calls = 0;
    let signalFirstRequest: () => void;
    const firstRequestStarted = new Promise<void>((resolve) => {
      signalFirstRequest = resolve;
    });
    instance.client.executeCommand = jest.fn((_: unknown, __: unknown, signal: AbortSignal) => {
      calls += 1;
      if (calls > 1) return Promise.resolve();

      signalFirstRequest();
      return new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    });
    const command = {
      applianceId: 'appliance-id',
      body: { data: { key: 'ConsumerProducts.CoffeeMaker.Program.Beverage.Espresso' } },
      operation: 'programs-active' as const,
      path: 'programs/active' as const,
    };

    const first = instance.executeCommand(command);
    await firstRequestStarted;
    await instance.executeCommand(command);
    await first;

    expect(mqtt.publish).not.toHaveBeenCalledWith(
      'home/home-connect/appliances/appliance-id/commands/programs-active/error/json',
      expect.stringContaining('aborted'),
    );
  });

  it('publishes command errors without changing bridge availability', async () => {
    const { instance, mqtt } = createBridge();
    instance.auth.ensureToken = jest.fn().mockResolvedValue(true);
    instance.auth.token = { access_token: 'access-token', expires_in: 600 };
    instance.client.executeCommand = jest.fn().mockRejectedValue(new Error('API unavailable'));
    const command = {
      applianceId: 'appliance-id',
      body: { data: { key: 'ConsumerProducts.CoffeeMaker.Program.Beverage.Espresso' } },
      operation: 'programs-active' as const,
      path: 'programs/active' as const,
    };

    await instance.executeCommand(command);

    expect(mqtt.publish).toHaveBeenCalledWith(
      'home/home-connect/appliances/appliance-id/commands/programs-active/error/json',
      expect.stringContaining('API unavailable'),
    );
    expect(mqtt.publish).not.toHaveBeenCalledWith('home/home-connect/bridge/connected', false);
  });

  it('switches offline after persistent authentication failures', async () => {
    const { instance, mqtt } = createBridge();
    instance.auth.ensureToken = jest.fn().mockResolvedValue(false);

    await instance.getAppliances();
    await instance.getAppliances();
    await instance.getAppliances();

    expect(mqtt.publish).toHaveBeenCalledWith('home/home-connect/bridge/connected', false);
  });

  it('switches offline after three failed appliance discovery cycles', async () => {
    const { instance, mqtt } = createBridge();
    instance.auth.ensureToken = jest.fn().mockResolvedValue(true);
    instance.auth.token = { access_token: 'access-token', expires_in: 600 };
    instance.client.getAppliances = jest.fn().mockRejectedValue(new Error('API unavailable'));

    await instance.getAppliances();
    await instance.getAppliances();
    await instance.getAppliances();

    expect(mqtt.publish).toHaveBeenCalledWith('home/home-connect/bridge/connected', false);
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

  it('loads persisted authentication before one complete reboot synchronization', async () => {
    const { instance } = createBridge();
    instance.auth.load = jest.fn().mockResolvedValue(undefined);
    instance.refreshAppliances = jest.fn().mockResolvedValue(undefined);

    instance.setup();
    await new Promise(setImmediate);

    expect(instance.auth.load).toHaveBeenCalledTimes(1);
    expect(instance.refreshAppliances).toHaveBeenCalledWith(true);

    const firstPollTime = Date.now();
    instance.loop(firstPollTime);
    expect(instance.refreshAppliances).toHaveBeenCalledTimes(1);

    instance.loop(firstPollTime + cfg.updateInterval);
    expect(instance.refreshAppliances).toHaveBeenLastCalledWith();
  });

  it('loads full state only for newly discovered appliances during inventory reconciliation', async () => {
    const { instance } = createBridge();
    instance.auth.ensureToken = jest.fn().mockResolvedValue(true);
    instance.auth.token = { access_token: 'access-token', expires_in: 600 };
    instance.discoveredApplianceIds.add('known-appliance');
    instance.client.getAppliances = jest
      .fn()
      .mockResolvedValue([{ haId: 'known-appliance' }, { haId: 'new-appliance' }]);
    instance.refreshAppliance = jest.fn().mockResolvedValue(undefined);
    instance.client.consumeEventStream = jest.fn(() => new Promise<void>(() => undefined));

    await instance.refreshAppliances();

    expect(instance.refreshAppliance).toHaveBeenCalledTimes(1);
    expect(instance.refreshAppliance).toHaveBeenCalledWith('new-appliance');
  });
});

type TestableBridge = {
  auth: { ensureToken: jest.Mock; load: jest.Mock; token?: { access_token: string; expires_in: number } };
  client: { consumeEventStream: jest.Mock; executeCommand: jest.Mock; getAppliances: jest.Mock };
  connectEvents(id: string): void;
  destroy(): void;
  discoveredApplianceIds: Set<string>;
  executeCommand(command: unknown): Promise<void>;
  getAppliances(): Promise<unknown>;
  loop(time: number): void;
  refreshAppliance: jest.Mock;
  refreshAppliances(includeKnownApplianceState?: boolean): Promise<void>;
  setup(): void;
  startProgram(topic: string, payload: string): void;
  subscribeCommands(): void;
};
