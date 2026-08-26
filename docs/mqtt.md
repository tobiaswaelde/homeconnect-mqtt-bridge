# MQTT contract

Every enabled account publishes availability at `<topic>/connected`. It is set to `false` at startup, shutdown, and after three consecutive authentication/API failures. Discovery publishes the complete appliance list to `<topic>/appliances/json`; subscribe to that topic after authentication to obtain each `<appliance-id>`.

## Published appliance data

For every discovered appliance, the bridge publishes these categories:

- `<topic>/appliances/<appliance-id>/status/json`
- `<topic>/appliances/<appliance-id>/settings/json`
- `<topic>/appliances/<appliance-id>/programs/active/json`
- `<topic>/appliances/<appliance-id>/programs/selected/json`
- `<topic>/appliances/<appliance-id>/events/json`

The JSON topics retain the category response in its API shape. Feature records containing `key`, `value`, and optionally `unit` additionally publish scalar topics at `<category>/<url-encoded-key>`. Enum values publish a display value there and the unchanged API enum at `<category>/<url-encoded-key>/raw`; units use `/unit`. No array-index topics are published.

Home Connect SSE messages are published unchanged at `events/json` and, when valid JSON, receive the same stable feature topics under `events/`.

## Commands

Commands are intentionally limited to discovered appliances and the two documented program paths. Publish non-retained JSON and the bridge clears the input topic after processing.

Start the active program:

```json
{ "key": "ConsumerProducts.CoffeeMaker.Program.Beverage.Espresso" }
```

```text
<topic>/appliances/<appliance-id>/programs/active/set/json
```

Select a program without starting it:

```json
{ "key": "ConsumerProducts.Dishwasher.Program.Eco50" }
```

```text
<topic>/appliances/<appliance-id>/programs/selected/set/json
```

Optional `options` are an array of Home Connect option objects with a `key` and `value`. Arbitrary paths, HTTP methods, appliance IDs, and the former `<topic>/set/json` passthrough are not accepted.

Successful commands publish `{ "status": "success", ... }` to `<topic>/appliances/<appliance-id>/commands/result/json`. Validation errors and failed API calls publish `{ "status": "error", ... }` to `<topic>/appliances/<appliance-id>/commands/error/json`; malformed topics that do not identify an appliance use `<topic>/commands/error/json`.
