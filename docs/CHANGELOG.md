# Changelog

All notable changes to DeepReef should be documented in this file.

This project follows a pragmatic pre-1.0 changelog style. Public APIs and configuration formats may change until a stable 1.0 release.

## Unreleased

### Documentation

- Consolidated the `docs/` tree into a smaller current documentation set: index, architecture, operations, development, roadmap, and changelog.
- Merged project design and status notes into `ARCHITECTURE.md`.
- Merged operations, configuration, model-provider, logging, diagnostics, and safety guidance into `OPERATIONS.md`.
- Merged active TODO and roadmap notes into `ROADMAP.md`.
- Removed obsolete historical DONE/TODO/archive-style docs from the current documentation set.
- Rewrote the English README to match the current Supervisor / Worker loop positioning.
- Refreshed the Chinese README and fixed the global install command to use `@deepreef/cli`.
- Added this changelog.
- Added a public roadmap.
- Added contribution guidance.
- Replaced the default security policy template with DeepReef-specific reporting guidance.

### Maintenance

- Added npm package metadata for repository, homepage, bugs, keywords, and description.
- Added package dry-run and CLI smoke scripts.
- Added GitHub issue and pull request templates.
- Added a manual release workflow template.
- Extended CI with build and package validation checks.

## 0.1.1

### Maintenance

- Prepared npm publishing as `@deepreef/cli`.
- Added bundled CLI output with a Node shebang.

## 0.1.0

### Initial public development release

- Published early DeepReef CLI, TUI, core runtime, tools, security, memory, plugin, skills, MCP, and workflow foundations.
