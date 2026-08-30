# Authentication

1. Create an application in the [Home Connect Developer Portal](https://developer.home-connect.com/).
2. Register the exact public callback URL from `instances[].redirectUri`, for example `https://bridge.example.net/home-connect/callback`. A callback must be externally reachable by the browser and may be reverse-proxied to this container; `localhost` is correct only when the browser and bridge run on the same host.
3. Assign your Home Connect/SingleKey user as an allowed test user while the client has a limited user list. An `unauthorized_client` callback with a limited user list means that this assignment is missing.
4. Start the bridge and open `https://bridge.example.net/home-connect/authorize?instance=kitchen` in a regular browser. Do not automate, intercept, or modify the consent screen.
5. Complete the consent flow. The callback stores only the refreshable OAuth session in `authFile` (or the default `.home-connect-<hash>.auth.json`) with mode `0600`.

The bridge restores this session after a reboot from the mounted configuration directory. Do not delete `authFile`; browser authorization is only needed again when the session can no longer be refreshed.

Remote Control and Remote Start must be enabled on the appliance before a program can start.

## Token migration

Existing deployments using `refreshToken` can keep it temporarily: on the first successful refresh, the bridge writes the resulting refreshable session to `authFile`. Back up that file, remove `refreshToken` from `config.yml`, then restart and verify a token refresh. Never copy browser authorization codes, access tokens, or auth files into Git.
