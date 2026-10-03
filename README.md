# KIFF plugins for Claude Code

[KIFF](https://kiff.dev) gives each AI agent a **Card**: which actions it may
take, how much per call and per day, and what happens to a call outside it (it
waits for the owner, or it is refused). KIFF checks every call against the Card
before it runs. The owner changes or revokes the Card without changing the
agent.

This repository is a Claude Code plugin marketplace with one plugin, `kiff`.

## What the `kiff` plugin adds

- **The KIFF MCP gateway** as an MCP server named `kiff`
  (`https://mcp.kiff.dev/mcp`). Tools your account connected to KIFF show up
  here, and every call is checked against this agent's Card first.
- **The `kiff` skill**: connect an agent or a remote MCP tool to KIFF, draft a
  Card for the owner to issue, and handle a held call correctly: tell you it is
  waiting, retry the identical call with the same `kiff_operation_id`, and never
  make the same change another way.
- **The `kiff-domains` skill**: author and extend `kiff.yaml` domains.

## Install

In Claude Code:

```text
/plugin marketplace add kiff/kiff-plugins
/plugin install kiff@kiff
```

Then give the gateway this agent's key. In [KIFF Cloud](https://app.kiff.dev),
open the agent, go to its **Tools** tab and choose **Connect to the KIFF
gateway**. KIFF shows the key once. Put it in your environment before starting
Claude Code:

```bash
export KIFF_GATEWAY_KEY=...   # this agent's gateway key, never an owner or admin key
```

The key is bound to one agent and can only ask: it cannot connect tools, issue
Cards or answer approvals. Without the variable, the skills still work and the
`kiff` MCP server does not connect.

New to KIFF? Install the plugin and ask: *"Connect my refund tool to KIFF and
give this agent a Card."* The skill walks you through it.

## What it will not do

- Issue or change a Card. It drafts the terms; the owner issues them.
- Answer a held call. Only a person on the account who may approve, signed in at
  `app.kiff.dev`, can.
- Ask for an owner or admin credential.
- Make a held or refused change another way (a direct API call, a shell, a
  browser).

KIFF governs only the calls that go through it. If the agent can still reach the
same service directly, that path is outside the Card; the skill says so.

## Other agents

Codex, Cursor, Gemini CLI and others can install the same skill as a file:
[kiff.dev/docs/agent-skill](https://kiff.dev/docs/agent-skill).

## Source of truth

The skills are published at [kiff.dev/skills/kiff.md](https://kiff.dev/skills/kiff.md)
and [kiff.dev/skills/kiff-domains.md](https://kiff.dev/skills/kiff-domains.md).
The copies here must match; the `skills-in-sync` workflow checks them on every
change and weekly, and fails when they drift.

## License

MIT.
