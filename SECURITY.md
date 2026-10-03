# Security Policy

## Reporting a vulnerability

Email **security@kiff.dev**. Do not open a public issue or pull request for a
vulnerability. KIFF's security policy is at
[kiff.dev/security](https://kiff.dev/security).

Include the affected file or path, what an attacker can do, and steps to
reproduce.

Only the `main` branch is supported.

## In scope

- The plugin packaging in this repo (`marketplace.json`, `plugin.json`,
  `.mcp.json`).
- The skills, where their instructions would lead an agent to approve its own
  call, issue a Card, ask for an owner or admin credential, or reach a tool
  around the KIFF gateway.

Issues in the KIFF gateway or KIFF Cloud themselves go to the same address.

## Secrets

Never put a KIFF gateway key, API key, owner or admin key, bearer token, or
customer data in this repo, in an issue, or in a pull request. If you exposed a
gateway key, revoke it in KIFF Cloud at app.kiff.dev and connect the agent
again to get a new one.
