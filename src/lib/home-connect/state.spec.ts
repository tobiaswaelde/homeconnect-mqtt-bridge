import { clearStateCategory, createApplianceState, updateStateFromCategory, updateStateFromEvent } from './state';

describe('Home Connect appliance state', () => {
  it('merges initial categories into one appliance state', () => {
    const state = createApplianceState();

    updateStateFromCategory(state, 'status', {
      items: [{ key: 'BSH.Common.Status.OperationState', value: 'BSH.Common.EnumType.OperationState.Run' }],
    });
    updateStateFromCategory(state, 'programs/active', {
      key: 'Dishcare.Dishwasher.Program.Eco50',
      options: [{ key: 'Dishcare.Dishwasher.Option.HygienePlus', value: true }],
    });

    expect(state.operationState).toEqual({
      human: 'Run',
      unit: null,
      value: 'BSH.Common.EnumType.OperationState.Run',
    });
    expect(state.program.active).toEqual({
      key: 'Dishcare.Dishwasher.Program.Eco50',
      options: [{ key: 'Dishcare.Dishwasher.Option.HygienePlus', value: true }],
    });
  });

  it('uses event values to keep the remaining time and the last appliance event current', () => {
    const state = createApplianceState();

    updateStateFromEvent(state, {
      items: [
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
    expect(state.lastEvent).toEqual({
      handling: 'none',
      key: 'BSH.Common.Event.ProgramFinished',
      level: 'hint',
      timestamp: 1479994109,
      value: 'BSH.Common.EnumType.EventPresentState.Present',
    });
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
