# Contributing

Thanks for your interest in improving KIFF plugins for Claude Code.

## Ways to contribute

We welcome:

- README and documentation improvements
- plugin packaging updates
- skill improvements and clarifications
- bug reports and fixes
- security reports through the private reporting flow

## Before you start

Please read the repository overview in `README.md` and the agent guidance in `AGENTS.md`.

This repository is intentionally small and focused. Changes should stay aligned with the KIFF product model and the published skills hosted at `kiff.dev`.

## Development workflow

1. Fork the repository or create a feature branch.
2. Make focused, reviewable changes.
3. Keep documentation and metadata consistent with the package structure.
4. Avoid introducing secrets, keys, or sample sensitive data.
5. Submit a pull request with a clear description of the change and why it matters.

## Files to review for packaging changes

When changing plugin behavior or metadata, check these files:

- `README.md`
- `plugins/kiff-cards/.claude-plugin/plugin.json`
- `plugins/kiff-cards/.mcp.json`
- `plugins/kiff-cards/skills/**`

## Documentation standards

- Prefer clear, operational language.
- Do not claim capabilities that the repository does not implement.
- Use the same terminology as the KIFF product documentation where possible.
- When editing the README, keep the product and install story easy to follow for both developers and non-developers.

## Code of conduct

Please keep discussions respectful, constructive, and focused on improving the project and the safety of AI agent integrations.

## Questions

Open an issue if you need clarification about the repository goals, plugin packaging, or expected behavior.
