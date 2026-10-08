# AGENTS.md

This repository packages the KIFF plugin for Claude Code: the KIFF MCP gateway
and two skills that let an agent connect a tool through KIFF, propose a Card
for an admin to issue, and handle a held call.

## Layout

- `.claude-plugin/marketplace.json`: the marketplace entry that
  `/plugin marketplace add kiff/kiff-plugins` reads.
- `plugins/kiff-cards/.claude-plugin/plugin.json`: plugin metadata and icon.
- `plugins/kiff-cards/.mcp.json`: the `kiff` MCP server
  (`https://mcp.kiff.dev/mcp`).
- `plugins/kiff-cards/skills/kiff/SKILL.md` and
  `plugins/kiff-cards/skills/kiff-domains/SKILL.md`: the skills.
- `plugins/kiff/`: the optional plugin that shows the Card and held calls
  (status line, held call notice, the owner's answer, `/kiff` pane). A hooks
  module in `hooks/`, its session-state contract in `types/index.d.ts`,
  tests in `hooks/*.test.ts`. Named `kiff-cards-ui` until 0.2.0.
- `.github/workflows/skills-in-sync.yml`: the CI check described below.

## Skills are copies: do not edit them here

Each `SKILL.md` is a byte copy of the file kiff.dev serves
(`kiff.dev/skills/kiff.md`, `kiff.dev/skills/kiff-domains.md`). The
`skills-in-sync` workflow runs on every push and pull request, and weekly, and
it fails when a copy differs. To change a skill, change it on kiff.dev first,
then download the published file into this repo.

## Rules when changing this repo

- Keep edits small, and use the README's product language.
- Never add a path that approves a held call, issues a Card, or reaches a tool
  around the KIFF gateway.
- Never commit gateway keys, owner or admin keys, API tokens, or customer data.
  The gateway key is entered by the user in Claude Code at install time; it
  never belongs in `.mcp.json` or any file here.

## Checking a change

- `skills-in-sync` must pass.
- For packaging changes, check that `marketplace.json`, `plugin.json` and
  `.mcp.json` agree (name, version, server URL) and that the README install
  steps still work.

## Releasing

`main` is the release branch. Claude's plugin directory tracks `main`
(folder `plugins/kiff-cards`): each new commit there is validated and
security-scanned again, and a version that passes goes live once it is
published. A version that is held or fails leaves the last published
version live.

- In every change to `plugins/kiff-cards/`, raise `version` in both
  `plugins/kiff-cards/.claude-plugin/plugin.json` and
  `.claude-plugin/marketplace.json`, to the same value.
- Run `claude plugin validate ./plugins/kiff-cards` and
  `claude plugin validate .` before opening the PR.
- The same for `plugins/kiff/`: raise its `version` in its `plugin.json`
  and in `marketplace.json`, and run `claude plugin validate ./plugins/kiff`
  and `claude plugin test ./plugins/kiff`. It calls no KIFF tool but the
  read-only `kiff_card`, and never answers, retries or rewrites a KIFF call.
  The one thing it may do beyond showing is start one turn per held call,
  once the owner answered, in its own fixed words (the tool's name and the
  agent's own operation id, never text a tool or page wrote); the agent
  decides whether to call again.
- Merging to `main` is the release. Do not merge a change that is not ready
  to ship.

See also `CONTRIBUTING.md` and `SECURITY.md`.
