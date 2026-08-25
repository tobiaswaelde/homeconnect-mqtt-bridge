---
layout: home

hero:
  name: Home Connect MQTT Bridge
  text: Bring Home Connect appliances to MQTT
  tagline: OAuth-aware appliance control, state updates, and a documented MQTT contract in one Docker-ready bridge.
  image:
    src: /logo.svg
    alt: Home Connect MQTT Bridge logo
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Authentication
      link: /authentication

features:
  - title: OAuth lifecycle
    details: Start consent in the browser and retain only the local session data needed to refresh access.
  - title: Appliance control
    details: Publish supported appliance commands through explicit, documented MQTT topics.
  - title: Operable deployment
    details: Configure multiple appliances in YAML and run the bridge with Docker.
---

Every installation is defined in `config/config.yml`. Continue with [configuration](/configuration), [authentication](/authentication), or the [MQTT contract](/mqtt).

For local WLED controllers, see the companion [WLED MQTT Bridge documentation](https://tobiaswaelde.github.io/wled-mqtt-bridge/).
