# KIFF Plugins

**Beta.** The plugin and its setup steps may change between versions. Report
problems in [issues](https://github.com/kiff/kiff-plugins/issues).

This repository holds the **KIFF Cards** plugin for Claude Code: delegated
authority for the AI agents your company runs. The Cards themselves live in
KIFF Cloud.

**The plugin is not the security boundary.** Its skills are instructions to
Claude. The KIFF MCP gateway (`mcp.kiff.dev`) enforces each agent's Card on
KIFF's servers, for every call that goes through it, whatever the
instructions say. See [What enforces the Card](#what-enforces-the-card).

It works with a KIFF Cloud account. Create one at [kiff.dev](https://kiff.dev);
sign-up is open.

Your agents can issue refunds, grant credits, change plans or update customer
accounts. KIFF lets you decide how far each one may go, and checks every call
before it runs.

Each agent gets a **Card**:

- **which actions** it may take (refund an order, not cancel a subscription);
- **how much**: the most per action and a total per day;
- **what happens over the limit**: the call waits for someone on your team to
  approve it, or it is refused.

You change or revoke a Card at any time, without redeploying the agent. Every
decision is recorded with a signed receipt, so you can show who allowed what.

## Who it is for

Engineering and operations teams at companies that let AI agents act on their
own money or customer accounts, and the agencies and builders who deliver
those agents to clients.

## What your team does with it

1. **Connect a tool.** Put the tool your agent uses, for example a refund tool,
   behind KIFF. The agent can now reach it only through its Card.
2. **Set the Card.** Ask Claude to propose limits for the agent. An admin on
   your team reviews them and issues the Card in KIFF Cloud.
3. **Run the agent.** Calls inside the Card go through. Calls over it wait:
   your approver is told in KIFF Cloud, by email and in Claude Code, answers
   in KIFF Cloud, and the call is refused if no one answers in time.

Try asking Claude:

```text
Connect our refund tool to KIFF and give the support agent a Card.
What limits should this agent have? It refunds about 30 euros, around ten times a day.
KIFF held my last call. What happens now?
```

## What is in the plugin

- **The KIFF MCP gateway** (`https://mcp.kiff.dev/mcp`): the tools your company
  connected to KIFF, each call checked against this agent's Card.
- **The `kiff` skill**: connects a tool, drafts a Card for an admin to issue,
  and handles a held call correctly. It never approves its own call or works
  around a refusal.
- **The `kiff-domains` skill**: defines the business rules a Card builds on, in
  a `kiff.yaml` file.

**This plugin connects Claude Code to KIFF's hosted gateway.** It is not
local-only. Tool calls made through the gateway can perform the actions the
account connected, including changes to customer accounts or money. KIFF
checks each call against the agent's Card before forwarding it.

## What enforces the Card

**KIFF's servers enforce it, not this plugin.**

- The gateway at `mcp.kiff.dev` checks every call against the agent's Card
  and decides whether it is forwarded, held or refused.
- The agent's gateway key can only ask. It cannot approve a held call, issue or
  change a Card, mint keys or manage the account. The gateway refuses any key
  that is not bound to one agent.
- A held call is answered by the account's people in KIFF Cloud, never by the
  agent.

**The skills are guidance.** They tell Claude how to connect a tool, draft a
Card, and handle `held`, `refused` and `unknown` results, and never to route
around a Card. They do not enforce anything. If Claude ignored them, or a
prompt injection told it to, the outcome would be the same: instructions cannot
grant authority the key does not have.

The threats, mitigations and residual risks are in
[THREAT_MODEL.md](THREAT_MODEL.md).

## Install

In Claude Code:

```text
/plugin marketplace add kiff/kiff-plugins
/plugin install kiff-cards@kiff
```

Claude Code asks for the **KIFF gateway key** when you enable the plugin and
stores it in its secure storage. Get it in [KIFF Cloud](https://app.kiff.dev):
open the agent, go to its **Tools** tab and choose **Connect to the KIFF
gateway**. KIFF shows the key once.

The key is bound to one agent and can only ask: it cannot connect tools, issue
Cards or answer approvals. Never enter an owner or admin key. Leave it empty
and the skills still work; the `kiff` MCP server just does not connect.

### Or connect an agent with a sign-in, no key

In KIFF Cloud, open the agent, go to its **Tools** tab and choose **Create a
connect link**. KIFF shows a URL that names that agent. In Claude Code:

```text
claude mcp add --transport http kiff <the link URL>
```

The first time Claude Code uses it, a browser opens on `app.kiff.dev`, an
admin or editor of the account signs in, and the page asks one question:
allow Claude Code to act as that agent. No key is pasted anywhere. A CLI on a
machine with no browser shows a code instead; the admin or editor enters it
at `app.kiff.dev/oauth/device`.

The link URL is not a secret: it only says which agent. Every connection,
sign-in or key, is listed and can be revoked on **Connections** in KIFF Cloud.
Revoking the link ends every connection made through it.

## Optional: see the Card in Claude Code

`kiff-cards-ui` is a second, optional plugin. It needs `kiff-cards` connected
to the gateway, and a Claude Code version that runs plugin hooks modules.

```text
/plugin install kiff-cards-ui@kiff
```

- **Status line:** what is left on the agent's Card, for example
  `KIFF · 320 of 500 amount left today · 1 waiting for approval`.
- **A notice when KIFF holds a call:** what was held, that nothing was sent,
  and the link where a person answers it in KIFF Cloud.
- **`/kiff`:** a pane with this session's KIFF calls and what KIFF answered:
  allowed, waiting for approval, refused, or outcome unknown.

It only displays. It reads what the gateway already answered and the
gateway's read-only `kiff_card` tool. It never answers, retries or changes a
call, so a held call keeps waiting for a person in KIFF Cloud, and only the
agent's own retry of the same call gets their answer. If it fails, calls go
on as they would without it: the gateway enforces the Card either way.

The amount it shows is a guess: the first argument whose name contains
"amount". Links in a notice or the pane open only `https://app.kiff.dev`.

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
- **The `kiff` skill** sends nothing itself. For agents that call KIFF from
  their own code, it explains KIFF's decision API
  (`https://api.kiff.dev/v1/proposals/decide`); that code reads its own
  agent-bound key from its configuration. The skill never asks for, reads,
  stores or sends a KIFF key.
- **What KIFF keeps.** The decision record (agent, tool, outcome, Card,
  amount) and a hash of the arguments, for the life of the account. A call's
  arguments are deleted once it is sent or refused, and the tool's result
  after 24 hours. The plugin reads and writes: the tools it reaches can change
  things, inside the agent's Card. Details:
  [DATA_MINIMIZATION.md](DATA_MINIMIZATION.md).

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

MIT. To contribute, see [CONTRIBUTING.md](CONTRIBUTING.md). To report a
vulnerability, see [SECURITY.md](SECURITY.md). The threat model is in
[THREAT_MODEL.md](THREAT_MODEL.md).
