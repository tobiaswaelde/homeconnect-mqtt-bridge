import {
  applianceStateTopic,
  parseProgramCommandTopic,
  programCommandSchema,
  publishApplianceInfo,
  publishCategory,
} from './mqtt-contract';

describe('Home Connect MQTT contract', () => {
  it('accepts only the documented fixed program paths', () => {
    expect(
      parseProgramCommandTopic(
        'home/home-connect/appliances/appliance-id/commands/programs-active/set/json',
        'home/home-connect',
      ),
    ).toEqual({ applianceId: 'appliance-id', operation: 'programs-active', path: 'programs/active' });
    expect(
      parseProgramCommandTopic(
        'home/home-connect/appliances/appliance-id/commands/settings/set/json',
        'home/home-connect',
      ),
    ).toBeUndefined();
  });

  it('rejects generic API paths and unexpected program payload keys', () => {
    expect(() => programCommandSchema.parse({ key: 'program', path: '/settings' })).toThrow();
    expect(() => programCommandSchema.parse({ options: [] })).toThrow();
  });

  it('provides a dedicated topic for a consolidated appliance state', () => {
    expect(applianceStateTopic('home/home-connect', 'appliance-id')).toBe(
      'home/home-connect/appliances/appliance-id/state/json',
    );
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
      'home/home-connect/appliances/appliance-id/status/features/BSH.Common.Status.OperationState/value',
      'BSH.Common.EnumType.OperationState.Run',
    );
    expect(publish).toHaveBeenCalledWith(
      'home/home-connect/appliances/appliance-id/status/features/BSH.Common.Status.OperationState/value_human',
      'Run',
    );
    expect(publish.mock.calls.map(([topic]) => topic).join('\n')).not.toContain('/items/0/');
  });

  it('publishes appliance metadata below a dedicated info branch', () => {
    const publish = jest.fn();
    publishApplianceInfo(publish, 'home/home-connect', 'appliance-id', { haId: 'appliance-id', name: 'Coffee maker' });

    expect(publish).toHaveBeenCalledWith(
      'home/home-connect/appliances/appliance-id/info/json',
      JSON.stringify({ haId: 'appliance-id', name: 'Coffee maker' }),
    );
    expect(publish).toHaveBeenCalledWith('home/home-connect/appliances/appliance-id/info/name', 'Coffee maker');
  });
});
