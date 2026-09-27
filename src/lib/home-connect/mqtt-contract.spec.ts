import {
  applianceStateTopic,
  parseProgramCommandTopic,
  programCommandSchema,
  programCommandTopics,
  publishApplianceInfo,
  publishCategory,
  stopProgramCommandSchema,
} from './mqtt-contract';

describe('Home Connect MQTT contract', () => {
  it('accepts only the documented fixed program paths', () => {
    expect(
      parseProgramCommandTopic(
        'home/home-connect/appliances/appliance-id/commands/programs-active/set/json',
        'home/home-connect',
      ),
    ).toEqual({
      applianceId: 'appliance-id',
      method: 'put',
      operation: 'programs-active',
      path: 'programs/active',
    });
    expect(
      parseProgramCommandTopic(
        'home/home-connect/appliances/appliance-id/commands/settings/set/json',
        'home/home-connect',
      ),
    ).toBeUndefined();
  });

  it('accepts only an empty payload on the explicit stop topic', () => {
    expect(
      parseProgramCommandTopic(
        'home/home-connect/appliances/appliance-id/commands/programs-active-stop/set/json',
        'home/home-connect',
      ),
    ).toEqual({
      applianceId: 'appliance-id',
      method: 'delete',
      operation: 'programs-active-stop',
      path: 'programs/active',
    });
    expect(stopProgramCommandSchema.parse({})).toEqual({});
    expect(() => stopProgramCommandSchema.parse({ key: 'unexpected' })).toThrow();
    expect(programCommandTopics('home/home-connect')).toContain(
      'home/home-connect/appliances/+/commands/programs-active-stop/set/json',
    );
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
      status: [
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
    expect(publish.mock.calls.map(([topic]) => topic).join('\n')).not.toContain('/status/0/');
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
