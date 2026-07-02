# Security Policy

## Supported Versions

Covalo is currently pre-1.0. Security fixes are provided for the latest published version and the current default branch when practical.

| Version | Supported |
| --- | --- |
| latest npm release | Yes |
| default branch | Best effort |
| older releases | No guaranteed support |

## Reporting a Vulnerability

Please report security vulnerabilities privately. Do not open a public GitHub issue for exploitable security problems.

Use one of these channels:

1. GitHub Security Advisories for this repository, if available.
2. A private email to the maintainer listed on the GitHub profile.

Include:

- affected version or commit
- operating system and shell
- reproduction steps
- expected impact
- whether credentials, files, shell execution, or network access are involved
- any suggested mitigation, if known

## Security-Sensitive Areas

Covalo is a local agent runtime that can read files, edit files, run commands, call tools, and connect to external services. The following areas are considered security-sensitive:

- shell execution and command policy bypasses
- arbitrary file read/write outside the intended workspace
- stale-read or snapshot rollback bypasses
- path traversal
- unsafe symlink handling
- SSRF and unsafe web request behavior
- credential leakage through logs, sessions, prompts, or tool output
- API key persistence or masking failures
- MCP tool invocation boundaries
- plugin or content-pack hook execution
- memory persistence and retrieval of sensitive data
- workflow escalation or sub-agent permission bypasses

## Public Issue Guidance

Public issues are appropriate for:

- documentation bugs
- installation failures
- provider configuration problems
- non-sensitive crashes
- UI defects
- feature requests

Public issues are not appropriate for vulnerabilities that enable command execution, file exfiltration, credential leakage, permission bypass, or unsafe remote access.

## Security Expectations

Covalo is not a sandbox. It is a powerful local development assistant. Users should run it only in repositories where they are prepared to review generated changes and command execution requests.

Recommended usage:

- review file edits before committing
- avoid running with unnecessary secrets in the environment
- avoid using production credentials for routine development
- keep `.env`, `api-key`, `.covalo/`, and session files out of Git
- run risky experiments in disposable repositories or containers
