# Habitat Deployment Notes

## Deployed Commit

- Deployed Git commit hash: `3d1fc62101c590f1246a3e4dd9189743f6eab8bc`
- Short hash seen during server-side verification: `3d1fc62`

## Verification Summary

- The API worked locally on the LXC once the manual server was started: the backend listened on port `8787` and a local `curl` to `/registration` returned the existing Habitat registration envelope instead of `null`.
- The laptop CLI reached the LXC through Tailscale: running `habitat status` on the laptop reported the same Habitat identity and status that were present on the LXC.
- The connection failure after stopping the manual server was: `Unable to connect. Is the computer able to access the url?`

## OpenClaw Server Request Logs

- The laptop `habitat status` flow hit the OpenClaw backend registration endpoint.
- The route-level log line for that request was:

```text
[habitat-api] GET /registration -> registered habitat "Kepler Frontier"
```

## Why `0.0.0.0` Is Required

`0.0.0.0` binds the server to all network interfaces inside the LXC. That is required for remote access over Tailscale, because binding only to `localhost` or `127.0.0.1` would make the API reachable only from inside the container itself.

## Why `.env` and Habitat State Stay in the Checkout but Are Ignored

`.env` and the Habitat state database stay in the checkout because the running CLI and API need local configuration and local state files in predictable repository-relative locations. They are ignored by Git so machine-specific configuration, secrets, and mutable runtime state do not get committed into source control.

In this repository, the ignored Habitat state database is stored at `.habitat/state.sqlite`.
