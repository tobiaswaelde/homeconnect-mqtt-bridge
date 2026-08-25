# Home Connect MQTT Bridge

[![CI](https://github.com/tobiaswaelde/homeconnect-mqtt-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/tobiaswaelde/homeconnect-mqtt-bridge/actions/workflows/ci.yml) [![Docs](https://github.com/tobiaswaelde/homeconnect-mqtt-bridge/actions/workflows/pages.yml/badge.svg)](https://tobiaswaelde.github.io/homeconnect-mqtt-bridge/) [![Deploy](https://github.com/tobiaswaelde/homeconnect-mqtt-bridge/actions/workflows/deploy.yml/badge.svg)](https://github.com/tobiaswaelde/homeconnect-mqtt-bridge/actions/workflows/deploy.yml)

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-tobiaswaelde-FFDD00?style=for-the-badge&logo=buymeacoffee)](https://www.buymeacoffee.com/tobiaswaelde)

NestJS bridge between Home Connect appliances and MQTT. Full documentation: [tobiaswaelde.github.io/homeconnect-mqtt-bridge](https://tobiaswaelde.github.io/homeconnect-mqtt-bridge/).

## Quick start

```bash
cp config/config.example.yml config/config.yml
# edit config/config.yml
docker compose up -d
```

Minimal configuration:

```yaml
mqtt:
  host: mqtt.example.net
  clientId: homeconnect-mqtt-bridge
  username: mqtt-user
  password: change-me
http:
  port: 3000
logging:
  level: log
instances:
  - id: kitchen
    topic: home/home-connect/kitchen
    clientId: your-client-id
    clientSecret: your-client-secret
    redirectUri: http://localhost:3000/home-connect/callback
    updateInterval: 60000
```

`mqtt.clientId` may be empty; the bridge then generates a UUID for the running process.

Example command:

```bash
mosquitto_pub -h mqtt.example.net -t 'home/home-connect/kitchen/appliances/BOSCH-HA-ID/programs/active/set/json' -m '{"key":"ConsumerProducts.CoffeeMaker.Program.Beverage.Espresso"}'
```

See the [configuration](https://tobiaswaelde.github.io/homeconnect-mqtt-bridge/configuration), [MQTT contract](https://tobiaswaelde.github.io/homeconnect-mqtt-bridge/mqtt), [authentication](https://tobiaswaelde.github.io/homeconnect-mqtt-bridge/authentication), and [deployment guide](https://tobiaswaelde.github.io/homeconnect-mqtt-bridge/deployment).
