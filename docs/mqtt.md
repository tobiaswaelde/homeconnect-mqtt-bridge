# MQTT contract

All topics are below the configured instance topic. The bridge does not recursively flatten Home Connect API responses, so array positions never become MQTT topic segments.

## Bridge discovery and availability

```text
<topic>/bridge/connected
<topic>/bridge/appliances/json
<topic>/bridge/next-retry-at
```

`connected` is `false` at startup and shutdown, and after three consecutive failed appliance-discovery cycles. A successful discovery publishes `true`. `appliances/json` contains the complete appliance-list response and provides the appliance IDs used below.

When Home Connect returns HTTP 429, `next-retry-at` contains the ISO 8601 time at which the bridge will retry the request. It is cleared after that time. The bridge waits for `Retry-After` before retrying; if Home Connect omits the header, it waits ten minutes.

## Appliance data

```text
<topic>/appliances/<appliance-id>/info/json
<topic>/appliances/<appliance-id>/info/<scalar-field>

<topic>/appliances/<appliance-id>/status/json
<topic>/appliances/<appliance-id>/settings/json
<topic>/appliances/<appliance-id>/programs/active/json
<topic>/appliances/<appliance-id>/programs/selected/json
<topic>/appliances/<appliance-id>/events/json
<topic>/appliances/<appliance-id>/state/json
```

Feature records with a Home Connect `key`, `value`, and optional `unit` are additionally published below the category:

```text
<topic>/appliances/<appliance-id>/<category>/features/<url-encoded-key>/value
<topic>/appliances/<appliance-id>/<category>/features/<url-encoded-key>/value_human
<topic>/appliances/<appliance-id>/<category>/features/<url-encoded-key>/unit
```

`value` always contains the unchanged Home Connect value. `value_human` is published for enum values and contains its final enum segment, for example `Run`. `unit` is published when Home Connect supplied one. SSE payloads are published unchanged at `events/json` and also receive feature topics when they are valid JSON.

`state/json` is a retained, consolidated snapshot for consumers that need one current appliance value instead of merging the raw Home Connect categories and event stream themselves. It is published after the initial synchronization and after every valid event update. The raw topics above remain the unmodified Home Connect responses.

```json
{
  "updatedAt": "2026-08-31T12:30:00.000Z",
  "connected": true,
  "operationState": {
    "value": "BSH.Common.EnumType.OperationState.Run",
    "human": "Run",
    "unit": null
  },
  "program": {
    "active": { "key": "Dishcare.Dishwasher.Program.Eco50" },
    "selected": null
  },
  "remainingProgramTime": { "value": 4620, "human": null, "unit": "seconds" },
  "lastEvent": {
    "key": "BSH.Common.Event.ProgramFinished",
    "value": "BSH.Common.EnumType.EventPresentState.Present",
    "level": "hint",
    "handling": "none",
    "timestamp": 1479994109
  }
}
```

`lastEvent` retains the most recent present Home Connect event, including program completion and appliance-specific warnings. Refer to the [Home Connect event reference](https://api-docs.home-connect.com/events/) for available event keys and their payloads. Fields that the appliance has not reported are `null`.

## Commands

Commands are limited to appliances discovered during the most recent refresh. Publish a non-retained JSON payload. The bridge never publishes to command input topics, so a subscribed MQTT client cannot receive its own command back as a new command. The corresponding result or error topic is authoritative for the asynchronous API operation.

Start the active program:

```text
<topic>/appliances/<appliance-id>/commands/programs-active/set/json
```

```json
{ "key": "ConsumerProducts.CoffeeMaker.Program.Beverage.Espresso" }
```

Select a program without starting it:

```text
<topic>/appliances/<appliance-id>/commands/programs-selected/set/json
```

```json
{ "key": "Dishcare.Dishwasher.Program.Eco50" }
```

Optional `options` are an array of Home Connect option objects with `key` and `value`.

### Dishwasher: Eco 50 with HygienePlus

HygienePlus is an option, not a standalone program. Start Eco 50 with HygienePlus by publishing this non-retained payload to the `programs-active` topic above:

```json
{
  "key": "Dishcare.Dishwasher.Program.Eco50",
  "options": [{ "key": "Dishcare.Dishwasher.Option.HygienePlus", "value": true }]
}
```

Home Connect exposes options only when they are supported by the appliance and selected program. A successful `programs-active/result/json` response confirms the request was accepted.

Each command operation has separate result topics. A `success` result means that Home Connect accepted the API request and the bridge completed its immediate state refresh; use the published status and event topics to confirm the appliance's resulting operation state.

```text
<topic>/appliances/<appliance-id>/commands/programs-active/result/json
<topic>/appliances/<appliance-id>/commands/programs-active/error/json
<topic>/appliances/<appliance-id>/commands/programs-selected/result/json
<topic>/appliances/<appliance-id>/commands/programs-selected/error/json
```

The bridge subscribes only to the command topics listed above; all other MQTT topics are ignored.

Home Connect requires remote control and remote start to be enabled on the appliance before a program can start. Commands should originate from an informed user action; Home Connect can reject a command when the appliance is locally controlled or not ready.
