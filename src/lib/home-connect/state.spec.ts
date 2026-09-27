import { clearStateCategory, createApplianceState, updateStateFromCategory, updateStateFromEvent } from './state';

describe('Home Connect appliance state', () => {
  it('merges initial categories into one appliance state', () => {
    const state = createApplianceState();

    updateStateFromCategory(state, 'status', {
      status: [
        { key: 'BSH.Common.Status.OperationState', value: 'BSH.Common.EnumType.OperationState.Run' },
        { key: 'BSH.Common.Status.DoorState', value: 'BSH.Common.EnumType.DoorState.Closed' },
        { key: 'BSH.Common.Status.RemoteControlActive', value: true },
        { key: 'BSH.Common.Status.RemoteControlStartAllowed', value: true },
        { key: 'BSH.Common.Status.LocalControlActive', value: false },
      ],
    });
    updateStateFromCategory(state, 'settings', {
      settings: [{ key: 'BSH.Common.Setting.PowerState', value: 'BSH.Common.EnumType.PowerState.On' }],
    });
    updateStateFromCategory(state, 'programs/active', {
      key: 'Dishcare.Dishwasher.Program.Eco50',
      options: [
        { key: 'Dishcare.Dishwasher.Option.HygienePlus', value: true },
        { key: 'BSH.Common.Option.ProgramProgress', unit: '%', value: 24 },
      ],
    });

    expect(state.operationState).toEqual({
      human: 'Run',
      unit: null,
      value: 'BSH.Common.EnumType.OperationState.Run',
    });
    expect(state.program.active).toEqual({
      key: 'Dishcare.Dishwasher.Program.Eco50',
      options: [
        { key: 'Dishcare.Dishwasher.Option.HygienePlus', value: true },
        { key: 'BSH.Common.Option.ProgramProgress', unit: '%', value: 24 },
      ],
    });
    expect(state.doorState?.human).toBe('Closed');
    expect(state.powerState?.human).toBe('On');
    expect(state.remoteControl).toEqual({ active: true, localActive: false, startAllowed: true });
    expect(state.programProgress?.value).toBe(24);
  });

  it('uses event values to keep the remaining time and the last appliance event current', () => {
    const state = createApplianceState();

    updateStateFromEvent(state, {
      items: [
        { key: 'BSH.Common.Option.ProgramProgress', unit: '%', value: 42 },
        { key: 'BSH.Common.Option.RemainingProgramTime', unit: 'seconds', value: 4620 },
        {
          handling: 'none',
          key: 'BSH.Common.Event.ProgramFinished',
          level: 'hint',
          timestamp: 1479994109,
          value: 'BSH.Common.EnumType.EventPresentState.Present',
        },
      ],
    });

    expect(state.remainingProgramTime).toEqual({ human: null, unit: 'seconds', value: 4620 });
    expect(state.programProgress).toEqual({ human: null, unit: '%', value: 42 });
    expect(state.lastEvent).toEqual({
      handling: 'none',
      key: 'BSH.Common.Event.ProgramFinished',
      level: 'hint',
      timestamp: 1479994109,
      value: 'BSH.Common.EnumType.EventPresentState.Present',
    });
  });

  it('tracks active appliance events until Home Connect reports them off or confirmed', () => {
    const state = createApplianceState();
    const key = 'Dishcare.Dishwasher.Event.RinseAidLack';

    updateStateFromEvent(state, {
      items: [{ key, level: 'hint', value: 'BSH.Common.EnumType.EventPresentState.Present' }],
    });
    expect(state.activeEvents).toEqual([
      expect.objectContaining({ key, value: 'BSH.Common.EnumType.EventPresentState.Present' }),
    ]);

    updateStateFromEvent(state, {
      items: [{ key, level: 'hint', value: 'BSH.Common.EnumType.EventPresentState.Confirmed' }],
    });
    expect(state.activeEvents).toEqual([]);
  });

  it('uses appliance connection events to keep the snapshot availability current', () => {
    const state = createApplianceState();

    updateStateFromEvent(state, {
      items: [{ key: 'BSH.Common.Appliance.Disconnected', value: 'BSH.Common.EnumType.EventPresentState.Present' }],
    });

    expect(state.connected).toBe(false);
    expect(state.lastEvent?.key).toBe('BSH.Common.Appliance.Disconnected');
  });

  it('clears program state when Home Connect reports no selected or active program', () => {
    const state = createApplianceState();
    state.program.active = { key: 'Dishcare.Dishwasher.Program.Eco50' };
    state.program.selected = { key: 'Dishcare.Dishwasher.Program.Eco50' };

    clearStateCategory(state, 'programs/active');
    clearStateCategory(state, 'programs/selected');

    expect(state.program).toEqual({ active: null, selected: null });
  });
});
