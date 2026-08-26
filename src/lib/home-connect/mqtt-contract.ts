import { z } from 'zod';
import type { HomeConnectCommandOperation, HomeConnectCommandPath, MqttScalar } from './types';

/** API categories that are polled and published for each discovered appliance. */
export const applianceCategories = ['status', 'settings', 'programs/active', 'programs/selected'] as const;

const programOperations: Record<HomeConnectCommandOperation, HomeConnectCommandPath> = {
  'programs-active': 'programs/active',
  'programs-selected': 'programs/selected',
};

/** Program payload accepted on an appliance program command topic. */
export const programCommandSchema = z
  .object({
    key: z.string().min(1),
    options: z.array(z.object({ key: z.string().min(1), value: z.unknown() }).passthrough()).optional(),
  })
  .strict();

/** Decodes only the two explicit command operations supported by this bridge. */
export function parseProgramCommandTopic(topic: string, rootTopic: string) {
  const prefix = `${rootTopic}/appliances/`;
  const suffix = '/set/json';
  if (!topic.startsWith(prefix) || !topic.endsWith(suffix)) return;

  const remainder = topic.slice(prefix.length, -suffix.length);
  const separator = remainder.indexOf('/');
  if (separator <= 0) return;

  const applianceId = remainder.slice(0, separator);
  const command = remainder.slice(separator + 1);
  if (!command.startsWith('commands/')) return;

  const operation = command.slice('commands/'.length);
  const path = programOperations[operation as HomeConnectCommandOperation];
  if (applianceId.includes('/') || !path) return;
  return { applianceId, operation: operation as HomeConnectCommandOperation, path };
}

/** Lists the stable topics that accept validated program commands. */
export function programCommandTopics(rootTopic: string) {
  return (Object.keys(programOperations) as HomeConnectCommandOperation[]).map(
    (operation) => `${rootTopic}/appliances/+/commands/${operation}/set/json`,
  );
}

/** Produces a bridge-level topic. */
export function bridgeTopic(rootTopic: string, name: string) {
  return `${rootTopic}/bridge/${name}`;
}

/** Produces a per-appliance topic without incorporating API array positions. */
export function applianceTopic(rootTopic: string, applianceId: string) {
  return `${rootTopic}/appliances/${applianceId}`;
}

/** Returns the per-appliance success topic for a command. */
export function commandResultTopic(rootTopic: string, applianceId: string, operation: HomeConnectCommandOperation) {
  return `${applianceTopic(rootTopic, applianceId)}/commands/${operation}/result/json`;
}

/** Returns the per-appliance error topic for a command. */
export function commandErrorTopic(rootTopic: string, applianceId?: string, operation?: HomeConnectCommandOperation) {
  return applianceId && operation
    ? `${applianceTopic(rootTopic, applianceId)}/commands/${operation}/error/json`
    : `${bridgeTopic(rootTopic, 'commands/error/json')}`;
}

/** Publishes appliance metadata without recursively flattening API data. */
export function publishApplianceInfo(
  publish: (topic: string, payload: string | number | boolean | null) => void,
  rootTopic: string,
  applianceId: string,
  appliance: unknown,
) {
  const root = `${applianceTopic(rootTopic, applianceId)}/info`;
  publish(`${root}/json`, JSON.stringify(appliance));
  const record = asRecord(appliance);
  if (!record) return;

  for (const [key, value] of Object.entries(record))
    if (isMqttScalar(value)) publish(`${root}/${encodeURIComponent(key)}`, value);
}

/** Publishes a category as JSON and only stable key/value/unit feature topics. */
export function publishCategory(
  publish: (topic: string, payload: string | number | boolean | null) => void,
  rootTopic: string,
  applianceId: string,
  category: string,
  data: unknown,
  jsonPayload = JSON.stringify(data),
) {
  const root = `${applianceTopic(rootTopic, applianceId)}/${category}`;
  publish(`${root}/json`, jsonPayload);
  const record = asRecord(data);
  if (!record) return;

  publishFeature(publish, root, record);
  for (const feature of [...records(record.items), ...records(record.options)]) publishFeature(publish, root, feature);
}

/** Publishes an enum display value plus its API value and optional unit. */
function publishFeature(
  publish: (topic: string, payload: string | number | boolean | null) => void,
  root: string,
  feature: Record<string, unknown>,
) {
  if (typeof feature.key !== 'string' || !isMqttScalar(feature.value)) return;
  const topic = `${root}/features/${encodeURIComponent(feature.key)}`;
  publish(`${topic}/value`, feature.value);
  if (isEnumValue(feature.value)) publish(`${topic}/value_human`, formatEnumValue(feature.value));
  if (isMqttScalar(feature.unit)) publish(`${topic}/unit`, feature.unit);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function records(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => !!item)
    : [];
}

function isMqttScalar(value: unknown): value is MqttScalar {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isEnumValue(value: MqttScalar): value is string {
  return typeof value === 'string' && value.includes('.EnumType.');
}

function formatEnumValue(value: MqttScalar) {
  return isEnumValue(value) ? value.slice(value.lastIndexOf('.') + 1) : value;
}
