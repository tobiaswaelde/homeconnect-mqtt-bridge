# Authentication

1. Create an application in the [Home Connect Developer Portal](https://developer.home-connect.com/).
2. Add the exact `redirectUri` from `config.yml`, and assign your Home Connect/SingleKey user as an allowed test user while the client has a limited user list.
3. Start the container and open `http://localhost:${PORT:-3003}/home-connect/authorize?instance=kitchen` in a regular browser.
4. Complete the unmodified Home Connect consent page. The callback stores a per-instance refresh token in `.home-connect-<hash>.auth.json` with mode `0600`.

Remote Control and Remote Start must be enabled on the appliance before a program can start.
