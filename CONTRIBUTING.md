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
5. If the change touches `plugins/kiff-cards/`, raise `version` in
   `plugin.json` and `marketplace.json` to the same value, and run both
   `claude plugin validate ./plugins/kiff-cards` and
   `claude plugin validate .`.
6. If the change touches `plugins/kiff-cards-ui/`, raise its `version` the
   same way and run `claude plugin validate ./plugins/kiff-cards-ui` and
   `claude plugin test ./plugins/kiff-cards-ui`.

## Releases

Merging to `main` releases the plugin. Claude's plugin directory picks up
each new commit on `main`, checks it again, and publishes it when it passes.
Until then the listing keeps the last published version.
