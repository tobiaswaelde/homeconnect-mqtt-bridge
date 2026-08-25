# MQTT contract

Every configured account publishes availability at `<topic>/connected`. Appliance data is published below `<topic>/appliances/<appliance-id>/status|settings|programs/... `.

Start a program by publishing JSON to `<topic>/appliances/<appliance-id>/programs/active/set/json`:

```json
{ "key": "ConsumerProducts.CoffeeMaker.Program.Beverage.Espresso" }
```

Advanced Home Connect `PUT` and `DELETE` requests use `<topic>/set/json` and are passed through with the Home Connect `data` envelope.

All command publications must be non-retained. The bridge clears a successfully received command topic with an empty payload.
