# Getting started

1. Copy `config/config.example.yml` to `config/config.yml`.
2. Enter the broker and device/account data.
3. Register the exact public `redirectUri` in the Home Connect Developer Portal and assign the Home Connect/SingleKey user as a test user.
4. Start the service with `docker compose up -d`.
5. Open `<redirectUri-origin>/home-connect/authorize?instance=<instance.id>` in a browser and complete the consent flow.
6. Discover appliance IDs with `mosquitto_sub -t '<instance.topic>/bridge/appliances/json' -C 1`, then watch `<instance.topic>/#` with Mosquitto.

The container exposes `GET /health` on the configured HTTP port. It only needs a host port mapping when a health probe or browser authentication must reach it.
