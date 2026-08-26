import { parseProgramCommandTopic, programCommandSchema, publishCategory } from './mqtt-contract';

describe('Home Connect MQTT contract', () => {
  it('accepts only the documented fixed program paths', () => {
    expect(
      parseProgramCommandTopic(
        'home/home-connect/appliances/appliance-id/programs/active/set/json',
        'home/home-connect',
      ),
    ).toEqual({ applianceId: 'appliance-id', path: 'programs/active' });
    expect(
      parseProgramCommandTopic('home/home-connect/appliances/appliance-id/settings/set/json', 'home/home-connect'),
    ).toBeUndefined();
  });

  it('rejects generic API paths and unexpected program payload keys', () => {
    expect(() => programCommandSchema.parse({ key: 'program', path: '/settings' })).toThrow();
    expect(() => programCommandSchema.parse({ options: [] })).toThrow();
  });

  it('publishes category JSON and stable feature topics without array indexes', () => {
    const publish = jest.fn();
    publishCategory(publish, 'home/home-connect', 'appliance-id', 'status', {
      items: [
        {
          key: 'BSH.Common.Status.OperationState',
          unit: 'seconds',
          value: 'BSH.Common.EnumType.OperationState.Run',
        },
      ],
    });

    expect(publish).toHaveBeenCalledWith(
      'home/home-connect/appliances/appliance-id/status/json',
      expect.stringContaining('OperationState'),
    );
    expect(publish).toHaveBeenCalledWith(
      'home/home-connect/appliances/appliance-id/status/BSH.Common.Status.OperationState',
      'Run',
    );
    expect(publish).toHaveBeenCalledWith(
      'home/home-connect/appliances/appliance-id/status/BSH.Common.Status.OperationState/raw',
      'BSH.Common.EnumType.OperationState.Run',
    );
    expect(publish.mock.calls.map(([topic]) => topic).join('\n')).not.toContain('/items/0/');
  });
});
