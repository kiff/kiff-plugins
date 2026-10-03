# Contributing

This repository is small: plugin packaging for Claude Code plus two skills
copied from kiff.dev. Read `README.md` and `AGENTS.md` first.

## What to send here

- README and documentation fixes.
- Packaging changes (`marketplace.json`, `plugin.json`, `.mcp.json`).
- Bug reports about installing or running the plugin.

## What not to send here

- **Skill edits.** The files under `plugins/kiff-cards/skills/` are copies of
  `kiff.dev/skills/*.md`, and the `skills-in-sync` check fails if they differ.
  Open an issue that describes the change; it is made on kiff.dev and then
  copied here.
- **Security reports.** See `SECURITY.md`. Do not open a public issue.

## Pull requests

1. Branch from `main` and keep the change focused.
2. Do not include keys, tokens or customer data, even as examples.
3. Say what changed and why. Do not describe behavior the plugin does not have.
4. `skills-in-sync` must pass.
