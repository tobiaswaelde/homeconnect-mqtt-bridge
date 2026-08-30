# Configuration

All bridges use the same top-level shape:

```yaml
mqtt:
  host: mqtt.example.net
  clientId: homeconnect-mqtt-bridge
instances:
  - id: unique-instance-name
    enabled: true
    topic: home/example
    # device-specific fields
```

- `mqtt` configures the single shared broker connection.
- `mqtt.clientId` may be empty; the bridge generates a UUID for the running process.
- HTTP settings are environment variables: `HOST` defaults to `0.0.0.0`, `PORT` defaults to `3003`, and `CORS_ORIGIN` defaults to `*`. Dotenv loads `.env` from the working directory; Docker Compose environment values take precedence.
- Every `instances[].id` and `instances[].topic` must be unique.

## Home Connect MQTT Bridge example

```yaml
mqtt:
  host: mqtt.example.net
  clientId: homeconnect-mqtt-bridge
  username: mqtt-user
  password: change-me
instances:
  - id: kitchen
    enabled: true
    topic: home/home-connect/kitchen
    clientId: your-client-id
    clientSecret: your-client-secret
    # This must be the externally reachable, registered callback URL.
    redirectUri: https://bridge.example.net/home-connect/callback
    authFile: kitchen.auth.json
    apiBaseUrl: https://api.home-connect.com
    eventReconnectInterval: 30000
    # Inventory reconciliation interval; status changes arrive through SSE.
    updateInterval: 600000
```

- `clientId` and `clientSecret` are mandatory for every enabled account. Disabled, prepared placeholders may omit both fields.
- `authFile` is optional. If omitted, the bridge creates a topic-specific `.home-connect-<hash>.auth.json` file in the directory holding `config.yml`; all such files are written with mode `0600`.
- `apiBaseUrl` defaults to `https://api.home-connect.com`. Use another value only for an official Home Connect test environment.
- `eventReconnectInterval` is the SSE reconnect delay in milliseconds and defaults to `30000`. `updateInterval` controls appliance-inventory reconciliation and defaults to `600000` (10 minutes). The bridge loads full state after boot and for newly discovered appliances; ongoing state changes arrive through SSE.

Do not commit passwords, API usernames, `config.yml`, or generated `*.auth.json` files.
