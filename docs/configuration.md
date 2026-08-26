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
    topic: home/home-connect/kitchen
    clientId: your-client-id
    clientSecret: your-client-secret
    redirectUri: http://localhost:3003/home-connect/callback
    updateInterval: 60000
```

Do not commit passwords, API usernames, or generated `*.auth.json` files.
