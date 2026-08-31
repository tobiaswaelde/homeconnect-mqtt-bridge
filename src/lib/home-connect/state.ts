import type { HomeConnectProgram, MqttScalar } from './types';

const activeProgramKey = 'BSH.Common.Root.ActiveProgram';
const applianceConnectedKey = 'BSH.Common.Appliance.Connected';
const applianceDisconnectedKey = 'BSH.Common.Appliance.Disconnected';
const operationStateKey = 'BSH.Common.Status.OperationState';
const remainingProgramTimeKey = 'BSH.Common.Option.RemainingProgramTime';
const selectedProgramKey = 'BSH.Common.Root.SelectedProgram';

/** The stable, cross-appliance state projection published by the MQTT bridge. */
export interface ApplianceState {
  connected: boolean | null;
  lastEvent: HomeConnectEvent | null;
  operationState: HomeConnectStateValue | null;
  program: {
    active: HomeConnectProgram | null;
    selected: HomeConnectProgram | null;
  };
  remainingProgramTime: HomeConnectStateValue | null;
  updatedAt: string;
}

/** The unmodified Home Connect metadata for the most recent appliance event. */
export interface HomeConnectEvent {
  handling: string | null;
  key: string;
  level: string | null;
  timestamp: number | null;
  value: MqttScalar;
}

/** A scalar Home Connect state value and its optional unit. */
export interface HomeConnectStateValue {
  human: string | null;
  unit: string | null;
  value: MqttScalar;
}

/** Creates an empty state projection for a newly discovered appliance. */
export function createApplianceState(): ApplianceState {
  return {
    connected: null,
    lastEvent: null,
    operationState: null,
    program: { active: null, selected: null },
    remainingProgramTime: null,
    updatedAt: new Date(0).toISOString(),
  };
}

/** Merges one category response from the initial appliance synchronization. */
export function updateStateFromCategory(state: ApplianceState, category: string, data: unknown) {
  if (category === 'programs/active') {
    state.program.active = program(data);
    return;
  }
  if (category === 'programs/selected') {
    state.program.selected = program(data);
    return;
  }
  for (const feature of features(data)) updateStateFromFeature(state, feature);
}

/** Clears an unavailable program category in the consolidated state. */
export function clearStateCategory(state: ApplianceState, category: 'programs/active' | 'programs/selected') {
  if (category === 'programs/active') state.program.active = null;
  else state.program.selected = null;
}

/** Merges all recognized feature updates from one Server-Sent Event payload. */
export function updateStateFromEvent(state: ApplianceState, data: unknown) {
  for (const feature of features(data)) updateStateFromFeature(state, feature);
}

/** Sets the latest inventory connection status when Home Connect provided one. */
export function updateStateConnection(state: ApplianceState, connected: boolean | undefined) {
  if (typeof connected === 'boolean') state.connected = connected;
}

/** Timestamps the state just before it is published. */
export function timestampState(state: ApplianceState) {
  state.updatedAt = new Date().toISOString();
  return state;
}

function updateStateFromFeature(state: ApplianceState, feature: Record<string, unknown>) {
  const key = feature.key;
  if (typeof key !== 'string' || !isScalar(feature.value)) return;

  if (key === applianceConnectedKey) state.connected = true;
  else if (key === applianceDisconnectedKey) state.connected = false;
  else if (key === operationStateKey) state.operationState = stateValue(feature);
  else if (key === remainingProgramTimeKey) state.remainingProgramTime = stateValue(feature);
  else if (key === activeProgramKey && typeof feature.value === 'string') state.program.active = { key: feature.value };
  else if (key === selectedProgramKey && typeof feature.value === 'string')
    state.program.selected = { key: feature.value };

  if (
    (key.includes('.Event.') || key === applianceConnectedKey || key === applianceDisconnectedKey) &&
    eventIsPresent(feature.value)
  )
    state.lastEvent = {
      handling: typeof feature.handling === 'string' ? feature.handling : null,
      key,
      level: typeof feature.level === 'string' ? feature.level : null,
      timestamp: typeof feature.timestamp === 'number' ? feature.timestamp : null,
      value: feature.value,
    };
}

function program(value: unknown): HomeConnectProgram | null {
  const record = asRecord(value);
  if (!record || typeof record.key !== 'string') return null;
  return Array.isArray(record.options) ? { key: record.key, options: record.options } : { key: record.key };
}

function stateValue(feature: Record<string, unknown>): HomeConnectStateValue {
  const value = feature.value as MqttScalar;
  return {
    human: isEnumValue(value) ? value.slice(value.lastIndexOf('.') + 1) : null,
    unit: typeof feature.unit === 'string' ? feature.unit : null,
    value,
  };
}

function features(value: unknown) {
  const record = asRecord(value);
  if (!record) return [];
  return [record, ...records(record.items), ...records(record.options)];
}

function records(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => !!item)
    : [];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function isScalar(value: unknown): value is MqttScalar {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isEnumValue(value: MqttScalar): value is string {
  return typeof value === 'string' && value.includes('.EnumType.');
}

function eventIsPresent(value: MqttScalar) {
  return typeof value !== 'string' || !value.endsWith('.Off');
}
