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

See also `CONTRIBUTING.md` and `SECURITY.md`.
