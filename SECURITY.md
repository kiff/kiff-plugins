# Security Policy

## Supported versions

This project is currently maintained in its main branch and receives updates as needed for documentation, packaging, and plugin metadata. We welcome reports for issues that affect the repository as published.

## Reporting a vulnerability

Please report vulnerabilities privately and responsibly.

- Use GitHub's private security reporting for this repository when available.
- If a report cannot be sent privately, contact the maintainers through the repository's preferred secure channel and avoid public disclosure before a fix is available.
- Do not open a public issue for a security vulnerability.

## What to include in a report

When reporting a security issue, include:

- the affected file or plugin path
- a clear description of the issue and impact
- reproduction steps or a proof of concept when possible
- the expected behavior and the vulnerable behavior
- any relevant environment details

## Sensitive data handling

This project may handle or reference:

- KIFF gateway keys
- KIFF API keys
- bearer tokens
- customer account data examples

These values must never be committed to source control, published in pull requests, or shared in issue comments.

## Safety expectations

The project deals with delegated AI authority and tool access. Security-sensitive changes should preserve the following:

- Cards remain the policy boundary for tool access
- approvals are not bypassed or auto-approved by the agent
- direct calls around the KIFF gateway are not encouraged or documented as a normal path
- secrets are kept out of repository files and examples

## Disclosure timeline

We aim to acknowledge reports promptly and work toward a fix as quickly as practical. Once a fix is available, we will coordinate disclosure with the reporter and update the project changelog or release notes as needed.
