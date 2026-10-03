# KIFF plugins for Claude Code

[KIFF](https://kiff.dev) gives each AI agent a **Card**: which actions it may
take, how much per call and per day, and what happens to a call outside it (it
waits for the owner, or it is refused). KIFF checks every call against the Card
before it runs. The owner changes or revokes the Card without changing the
agent.

This repository is a Claude Code plugin marketplace with one plugin, `kiff`.

## What the `kiff` plugin adds

- **The KIFF MCP gateway** as an MCP server named `kiff`
  (`https://mcp.kiff.dev/mcp`), using the gateway key you enter when you enable
  the plugin. Tools your account connected to KIFF show up
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

Claude Code asks for the **KIFF gateway key** when you enable the plugin and
stores it in its secure storage. Get it in [KIFF Cloud](https://app.kiff.dev):
open the agent, go to its **Tools** tab and choose **Connect to the KIFF
gateway**. KIFF shows the key once.

The key is bound to one agent and can only ask: it cannot connect tools, issue
Cards or answer approvals. Never enter an owner or admin key. Leave it empty
and the skills still work; the `kiff` MCP server just does not connect.

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

## Data and services

- **The `kiff` MCP server** sends each tool call the agent makes through it to
  `https://mcp.kiff.dev/mcp`, with this agent's gateway key. KIFF checks it
  against the agent's Card and forwards allowed calls to the tool the account
  connected.
- **The `kiff` skill** may also show or run one request to KIFF's decision API,
  `https://api.kiff.dev/v1/proposals/decide`, with a KIFF API key you supply, for
  agents that call KIFF from their own code. It uses no other service.
- **What KIFF keeps.** KIFF stores each decision, its parameters and the Card's
  statement as audit data for the account, for the life of the account, and
  deletes it when the account is deleted. Parameters are stored as sent, without
  automatic redaction. Details: [kiff.dev/privacy](https://kiff.dev/privacy).

## Other agents

Codex, Cursor, Gemini CLI and others can install the same skill as a file:
[kiff.dev/docs/agent-skill](https://kiff.dev/docs/agent-skill).

## Source of truth

The skills are published at [kiff.dev/skills/kiff.md](https://kiff.dev/skills/kiff.md)
and [kiff.dev/skills/kiff-domains.md](https://kiff.dev/skills/kiff-domains.md).
The copies here are exactly what kiff.dev serves (byte for byte, after the
site's typography pass), so to update one, download it from that URL. The
`skills-in-sync` workflow checks them on every change and weekly, and fails
when they drift or when a skill is not published.

## License

MIT.
