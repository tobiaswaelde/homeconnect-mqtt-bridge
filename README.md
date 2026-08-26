# Home Connect MQTT Bridge

[![CI](https://img.shields.io/github/actions/workflow/status/tobiaswaelde/homeconnect-mqtt-bridge/ci.yml?style=for-the-badge&label=CI)](https://github.com/tobiaswaelde/homeconnect-mqtt-bridge/actions/workflows/ci.yml) [![Docs](https://img.shields.io/github/actions/workflow/status/tobiaswaelde/homeconnect-mqtt-bridge/docs.yml?style=for-the-badge&label=Docs)](https://github.com/tobiaswaelde/homeconnect-mqtt-bridge/actions/workflows/docs.yml) [![Deploy](https://img.shields.io/github/actions/workflow/status/tobiaswaelde/homeconnect-mqtt-bridge/deploy.yml?style=for-the-badge&label=Deploy)](https://github.com/tobiaswaelde/homeconnect-mqtt-bridge/actions/workflows/deploy.yml)

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
instances:
  - id: kitchen
    topic: home/home-connect/kitchen
    clientId: your-client-id
    clientSecret: your-client-secret
    redirectUri: https://bridge.example.net/home-connect/callback
    updateInterval: 60000
```

`mqtt.clientId` may be empty; the bridge then generates a UUID for the running process.

Example command:

```bash
mosquitto_pub -h mqtt.example.net -t 'home/home-connect/kitchen/appliances/BOSCH-HA-ID/programs/active/set/json' -m '{"key":"ConsumerProducts.CoffeeMaker.Program.Beverage.Espresso"}'
```

Discover `BOSCH-HA-ID` after authentication with:

```bash
mosquitto_sub -h mqtt.example.net -t 'home/home-connect/kitchen/appliances/json' -C 1
```

## Documentation

- [Documentation home](https://tobiaswaelde.github.io/homeconnect-mqtt-bridge/)
- [Configuration](https://tobiaswaelde.github.io/homeconnect-mqtt-bridge/configuration)
- [Authentication](https://tobiaswaelde.github.io/homeconnect-mqtt-bridge/authentication)
- [MQTT contract](https://tobiaswaelde.github.io/homeconnect-mqtt-bridge/mqtt)
- [Docker deployment](https://tobiaswaelde.github.io/homeconnect-mqtt-bridge/deployment)
- [WLED MQTT Bridge for local LED controllers](https://tobiaswaelde.github.io/wled-mqtt-bridge/)
