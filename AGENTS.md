# AGENTS.md

This repository contains the KIFF plugin package for Claude Code and related agent skills.

## Purpose

The repository packages a KIFF MCP gateway and skill definitions that allow an AI agent to:

- connect a tool through KIFF
- propose a Card with suitable limits and approval rules
- handle a held call according to KIFF policy

## Repository layout

- `README.md` — project introduction, installation instructions, and product overview
- `plugins/kiff-cards/.claude-plugin/` — Claude plugin metadata and packaging
- `plugins/kiff-cards/.mcp.json` — MCP gateway configuration for the KIFF server
- `plugins/kiff-cards/skills/` — skill definitions for the agent
  - `kiff/` — main skill for connecting tools and handling approvals
  - `kiff-domains/` — domain-specific business rule definitions and `kiff.yaml`

## Contribution guidance for agents

When modifying this repository:

1. Prefer small, targeted edits.
2. Preserve the product language used in the KIFF docs and README.
3. Do not invent approval paths or bypass KIFF's review model.
4. Keep skill behavior aligned with the published source of truth at `kiff.dev`.
5. Do not add owner/admin credentials or secret values to source files.
6. Treat gateway keys, API keys, and bearer tokens as sensitive material.

## Sensitive info

Never commit:

- gateway keys
- administrator or owner keys
- API tokens
- customer data or sample records that include live identifiers

## Safety expectations

This project is about agent authority and controlled operations. When changing behavior, make sure the code or instructions still:

- enforce approval boundaries
- keep policy checks in the KIFF gateway
- avoid silent bypasses or direct calls around a refusal

## Validation

There are no application tests in this repository by default. For documentation and packaging changes, review the following before submitting:

- README wording and installation instructions
- `plugin.json` metadata for the Claude plugin
- MCP configuration in `.mcp.json`
- any referenced skill files in `plugins/kiff-cards/skills/`

## Related files

- `CONTRIBUTING.md`
- `SECURITY.md`
