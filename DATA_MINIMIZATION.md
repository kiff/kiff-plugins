# Data minimization

What data this plugin handles, what KIFF keeps, and for how long. KIFF keeps
only what it needs to enforce a Card and to audit the decision.

## Read and write

This plugin **reads and writes**.

- **The `kiff` MCP server** exposes the tools your company connected to KIFF.
  Those tools can change things (issue a refund, grant a credit, update an
  account). KIFF checks each call against the agent's Card. If the Card
  allows the call, KIFF forwards it to the tool. If not, the call waits for
  an approver or is refused. The tool owner marks each tool as read-only or
  not when connecting it.
- **The `kiff` skill** drafts Card terms for an admin to issue. It sends
  nothing to KIFF itself: for agents that call KIFF from their own code, it
  explains the decision API (`POST https://api.kiff.dev/v1/proposals/decide`),
  and that code reads its own agent-bound key. The skill never handles a KIFF
  key, never issues or changes a Card, and never answers a held call.
- **The `kiff-domains` skill** reads and writes `kiff.yaml` files in your
  working directory when you ask it to. It sends nothing to KIFF.
- **The optional `kiff-cards-ui` plugin** only reads. It reads the answers
  the gateway already returned to the agent, and calls the gateway's
  read-only `kiff_card` tool (which draws nothing from the Card and is not
  recorded as a call). It keeps the session's KIFF calls in memory for the
  session only and writes nothing to disk.

## What leaves your machine

Only through the `kiff` MCP server, to `https://mcp.kiff.dev/mcp`:

- the agent's gateway key, as a bearer token;
- the tool name and the arguments of each call the agent makes through it.

With `kiff-cards-ui` installed, also: a `kiff_card` read through the same
server, when a session starts, after each KIFF call and on `/kiff`. It sends
no arguments.

The skills never read credentials, keys or environment variables from your
machine, and the plugin sends no telemetry.

## What KIFF keeps

| Data | Kept | Why |
|---|---|---|
| Agent, key id, tool, outcome, reasons, Card in force, timestamps | For the life of the account | The decision record and its signed receipt: who allowed what |
| The amount, when the Card counts one | For the life of the account | Per-call and per-period limits |
| Hash of the call's arguments | For the life of the account | Tells a retry apart from a different request; the arguments cannot be recovered from it |
| The call's arguments | Until the call is sent, refused or fails | A held call is sent only after the owner allows it, so KIFF needs the arguments until then. After that they are deleted |
| The tool's result | 24 hours after the call | So a retry gets the same answer instead of running the action twice. After that it is deleted; a retry is told the call was sent and is never resent |
| Other arguments, in the decision record | Never | Only the amount reaches KIFF's decision service |
| A sign-in connection: agent, app name, who allowed it, when, last use | While it is live, then 30 days after it ends (still shown for that time), then deleted with its tokens and key | So the Connections view shows who connected what, and each can be revoked |

If you call the decision API directly, KIFF keeps the numeric parameters a
limit may count, a hash of the full request, and the agent's free-text
`reasoning_summary` as written. Do not put personal data in the reason.

All of it is deleted when the account is deleted. Details:
[kiff.dev/security](https://kiff.dev/security#data-kept) and
[kiff.dev/privacy](https://kiff.dev/privacy).

## What KIFF never asks for

- An owner or admin key. The gateway key is bound to one agent and can only
  ask.
- The connected tool's own credentials, in this plugin. The account owner
  enters those once in KIFF Cloud, where they are stored encrypted.
