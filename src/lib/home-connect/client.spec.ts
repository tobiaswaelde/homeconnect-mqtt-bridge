import { consumeSseBuffer } from './client';

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
