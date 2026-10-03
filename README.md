# KIFF for Claude Code

**Limits and approvals for the AI agents your company runs.**

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
those agents to clients. You need a KIFF Cloud account for your company
([kiff.dev](https://kiff.dev)).

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
