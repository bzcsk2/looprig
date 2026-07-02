# Contributing to Covalo

Thanks for considering a contribution. Covalo is a pre-1.0 project, so the most valuable contributions are those that improve reliability, installation quality, documentation, safety, and weak/local model behavior.

## Good Contribution Areas

- local model presets and capability profiles
- workflow reliability tests
- harness tuning for weak models
- provider configuration UX
- MCP examples
- TUI polish
- Windows terminal compatibility
- documentation and examples
- security hardening
- package and release automation

## Development Setup

```bash
git clone https://github.com/bzcsk2/Covalo.git
cd Covalo
bun install
bun run typecheck
bun test
bun run build
npm pack --dry-run
```

## Pull Request Expectations

Before opening a pull request:

1. Keep changes focused. Avoid mixing runtime logic, docs, and formatting unless the PR is explicitly a maintenance PR.
2. Add or update tests for behavior changes.
3. Run `bun run typecheck`.
4. Run the relevant test command.
5. Run `bun run build` for CLI or package changes.
6. Update documentation when changing commands, config, provider behavior, workflow behavior, or public-facing UX.
7. Avoid committing local secrets, generated sessions, `.env`, `api-key`, `.covalo/`, `dist/`, or logs.

## Commit Style

Use concise conventional-style commit prefixes when practical:

- `feat:` user-facing capability
- `fix:` bug fix
- `docs:` documentation-only change
- `test:` tests
- `refactor:` internal restructuring without intended behavior change
- `chore:` repository maintenance
- `ci:` CI or release automation

## Issue Reports

When filing a bug, include:

- Covalo version or commit
- OS and terminal
- Node and Bun versions
- command used
- expected behavior
- actual behavior
- minimal reproduction steps
- relevant logs with secrets removed

## Provider Issues

For provider or model routing issues, include:

- provider name
- model name
- whether the endpoint is official, gateway, or OpenAI-compatible
- whether the API key is from environment, project file, or interactive setup
- redacted error output

## Security Issues

Do not file public issues for sensitive reports. See [SECURITY.md](./SECURITY.md).
