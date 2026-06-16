# Roadmap

DeepReef is pre-1.0. This roadmap describes the current maintenance direction, not a compatibility guarantee.

## v0.1.x - Public CLI hardening

Goal: make the repository and npm package easy to evaluate, install, and contribute to.

- Rewrite the English README around the current Supervisor / Worker positioning.
- Keep Chinese and English installation instructions consistent.
- Verify `@deepreef/cli` package metadata and npm package contents.
- Add CI checks for build output and package dry-runs.
- Document project status and reporting channels.
- Add contribution and issue templates.

## v0.2.x - Workflow reliability

Goal: make Supervisor / Worker mode predictable enough for routine engineering tasks.

- Stabilize workflow state transitions.
- Improve Worker report format and evidence bundles.
- Add bounded retries and clearer stop conditions.
- Make human escalation clearer in the TUI.
- Add workflow resume tests.
- Add end-to-end fixtures for common engineering tasks.
- Document workflow configuration and expected behavior.

## v0.3.x - Weak and local model optimization

Goal: make low-cost and local models materially more useful.

- Document recommended local OpenAI-compatible deployments.
- Add local model presets and capability profiles.
- Tune harness levels for weak models.
- Improve context compression and repair behavior.
- Build a benchmark matrix for Worker model reliability.
- Publish reproducible workflow reliability reports.

## v0.4.x - Provider and ecosystem expansion

Goal: make DeepReef easier to extend without modifying core runtime code.

- Formalize provider adapter boundaries.
- Document MCP integration examples.
- Improve plugin and content-pack authoring docs.
- Add skills packaging guidance.
- Add example projects and sample workflows.
- Improve memory configuration documentation.

## v0.5.x - UX and operational polish

Goal: improve day-to-day usability.

- Improve Windows terminal behavior.
- Polish model picker and provider configuration.
- Improve TUI workflow visualization.
- Add clearer session restore UX.
- Improve error messages and remediation hints.
- Add package install smoke tests across operating systems.

## Non-goals for now

- Replacing all strong-model usage.
- Claiming complete isolation for arbitrary local commands.
- Locking a stable public API before 1.0.
- Supporting every provider as a first-party integration.
- Optimizing for hosted multi-tenant deployments before local development workflows are reliable.
