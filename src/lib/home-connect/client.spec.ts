import type { ActiveHomeConnectConfig } from '~/types/config/home-connect';
import { consumeSseBuffer, HomeConnectClient } from './client';

describe('Home Connect SSE parser', () => {
  it('handles CRLF, metadata, comments, and multiple data lines', () => {
    const parsed = consumeSseBuffer(
      ': keepalive\r\nid: 7\r\nevent: NOTIFY\r\ndata: {"first":1}\r\ndata: {"second":2}\r\n\r\n',
    );
    expect(parsed.events).toEqual(['{"first":1}\n{"second":2}']);
    expect(parsed.remaining).toBe('');
  });

  it('retains a fragmented event until its terminating blank line arrives', () => {
    const first = consumeSseBuffer('event: NOTIFY\ndata: {"value":');
    expect(first.events).toEqual([]);
    const second = consumeSseBuffer(first.remaining + '42}\n\n');
    expect(second.events).toEqual(['{"value":42}']);
    expect(second.remaining).toBe('');
  });
});

describe('Home Connect rate limiting', () => {
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
    updateInterval: 600_000,
  };

  afterEach(() => jest.useRealTimers());

  it('waits for Retry-After, retries automatically, and clears the published retry time', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-30T12:00:00.000Z') });
    const publishRetryTime = jest.fn();
    const client = new HomeConnectClient(cfg, publishRetryTime) as unknown as TestableClient;
    const rateLimitError = Object.assign(new Error('Too many requests'), {
      isAxiosError: true,
      response: { headers: { 'retry-after': '30' }, status: 429 },
    });
    client.api.get = jest
      .fn()
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValue({ data: { data: { homeappliances: [] } } });

    const request = client.getAppliances('access-token', new AbortController().signal);
    await jest.advanceTimersByTimeAsync(0);

    expect(publishRetryTime).toHaveBeenCalledWith(Date.parse('2026-08-30T12:00:30.000Z'));
    expect(client.api.get).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(30_000);
    await expect(request).resolves.toEqual([]);
    expect(client.api.get).toHaveBeenCalledTimes(2);
    expect(publishRetryTime).toHaveBeenLastCalledWith();
  });

  it('uses a ten-minute delay when a 429 response omits Retry-After', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-30T12:00:00.000Z') });
    const publishRetryTime = jest.fn();
    const client = new HomeConnectClient(cfg, publishRetryTime) as unknown as TestableClient;
    const controller = new AbortController();
    const rateLimitError = Object.assign(new Error('Too many requests'), {
      isAxiosError: true,
      response: { headers: {}, status: 429 },
    });
    client.api.get = jest.fn().mockRejectedValue(rateLimitError);

    const request = client.getAppliances('access-token', controller.signal);
    await jest.advanceTimersByTimeAsync(0);

    expect(publishRetryTime).toHaveBeenCalledWith(Date.parse('2026-08-30T12:10:00.000Z'));

    controller.abort();
    await expect(request).rejects.toThrow('aborted');
    client.destroy();
  });
});

type TestableClient = {
  api: { get: jest.Mock };
  destroy(): void;
  getAppliances(accessToken: string, signal: AbortSignal): Promise<unknown>;
};
