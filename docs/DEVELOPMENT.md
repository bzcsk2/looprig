# Looprig Bug Fix Specification

**Date**: 2026-07-01  
**Audience**: agents assigned to fix Looprig bugs  
**Scope**: `packages/core`, `packages/tools`, `packages/memory`, `packages/tui`, `packages/security`, `packages/cli`, `packages/core/src/sandbox`

This document is a repair specification, not a raw audit report. It keeps only findings that were verified against the current tree or are still plausible enough to investigate. Items known to be false or stale are listed in "Do Not Fix".

## Agent Rules

1. Use the code-review graph before text search when exploring this repository.
2. Fix one repair pack at a time. Keep patches small and scoped.
3. Do not touch unrelated formatting, generated files, or broad refactors.
4. Add or update focused tests for every behavior change unless the item is documentation-only.
5. Before finishing a repair pack, run the narrowest relevant test command and record what passed or why it could not run.
6. If code differs from this spec, trust the current code after re-verifying and update this document rather than forcing an obsolete fix.

## Priority Order

1. Tools edit safety: fuzzy edit ambiguity, `old_hash`, shell command security, background escalation.
2. File tool security consistency: sensitive paths, stale writes, path containment.
3. TUI correctness: stale React closures and workflow loop guard.
4. CLI and sandbox safety: editor command injection and soft workspace boundaries.
5. Memory persistence/path correctness.
6. Lower-risk cleanup and portability.

## Repair Pack A: Tools Edit Safety

### A1. Fuzzy edit must reject ambiguous fallback matches

**Status: ✅ Already fixed in current code by previous agent session**

All passes in `fuzzyReplaceOnce` (`fuzzy-edit.ts` lines 7–77) use `findAllOccurrences` or candidate-collection with strict singleton checks. No pass silently picks the first of multiple matches.

- Pass 1 (exact): `findAllOccurrences`, rejects 0 or ≥2
- Pass 2 (trimmed full & right-trimmed): `findAllOccurrences`, rejects 0 or ≥2
- Pass 3 (trimmedBoundary): `findAllOccurrences`, rejects ≠1
- Pass 4 (blockAnchor): candidate collection, `candidates.length !== 1` → null
- Pass 5 (contextAware): same pattern as blockAnchor
- Pass 6 (escapeNormalized): `findAllOccurrences`, rejects ≠1
- Pass 7 (flexible_whitespace): regex, rejects `allMatches.length !== 1`

Tests in `edit.test.ts` lines 93–130 cover all ambiguity-rejection paths.

### A2. `edit` must honor `old_hash`

**Status: ✅ Already fixed in current code**

`edit.ts` line 83 extracts `oldHash`, and line 123 validates `sha256(normalizedOld) !== oldHash` before replacement. On mismatch, an error is returned and the file is unchanged (line 124).

`hashAnchoredReplaceOnce` (`hash-edit.ts`) is a separate stream-based implementation used only in tests. It is not imported in production code, so there is no dead import to remove.

Tests in `edit.test.ts` lines 300–341 cover correct/incorrect/missing `old_hash` and CRLF preservation with hash checks.

## Repair Pack B: Shell Security and Background Escalation

### B1. Tighten shell deny patterns

**Status: ✅ Already fixed in current code**

`POSIX_DENY_PATTERNS` (`shell-security.ts` lines 21–28) uses precise patterns only:
- `rm -rf /` and `rm -r /*` (recursive root deletion)
- `sudo` (privileged escalation)
- `mkfs`, `fdisk` (disk formatting)
- `dd if=` (raw block-device overwrite; standalone `dd` allowed)
- `chmod -R 777 /`

`git push` and `git commit` are NOT in the deny list (handled by approval tier). Each pattern has an explanatory comment.

Tests in `shell-security.test.ts` cover all acceptance criteria.

### B2. Sensitive path detection must catch dotfiles

**Status: ✅ Already fixed in current code**

`matchSensitivePathInCommand` (`shell-security.ts` lines 61–70) uses tokenization (split on `[\s"'|&;<>()`$]+`) instead of word-boundary regex, supporting leading dots. Paths are resolved against `cwd` before `isSensitive` check in `validateShellCommand` (line 101).

Token split on `$` characters may cause issues with shell variable expansion (e.g., `cat $HOME/.env` would split on `$`). However, `isSensitive` patterns use `/(^|\/|\\)/` anchors that match mid-string, so `HOME/.env` still matches `.env$` pattern. This is acceptable for a best-effort check.

Tests in `shell-security.test.ts` lines 44–73 cover `.env`, `.env.local`, `.npmrc`, `.aws/credentials`, `.ssh/id_rsa`, and `foo/.env`.

### B3. Make soft-timeout escalation atomic enough

**Status: ✅ Already fixed in current code**

`runForegroundShell` (`bash-dual-track.ts` lines 438–481):
1. Calls `bgManager.adopt()` BEFORE removing foreground listeners (line 449).
2. `adopt()` internally checks capacity and attaches background handlers via `attachChildHandlers` before returning (line 200 of `background-task-manager.ts`).
3. If `adopt` fails (capacity full), returns the error and execution continues with foreground listeners + hard timer intact (line 458–460).
4. Only on success are foreground listeners removed (lines 466–469), after `escalated = true` is set.

Tests in `shell-dual-track.test.ts`:
- Line 30: Successful adopt returns taskId, later completes.
- Line 55: Incremental cursor works.
- Line 203: When bg full, soft timeout does NOT escalate and command completes in foreground.
- Line 242: `background:false` prevents escalation.

## Repair Pack C: File Tool Security Consistency

### C1. Add sensitive path coverage to read-like discovery tools

**Status: ✅ Already fixed in current code**

All three tools already filter sensitive paths:

- **`list-dir.ts`** (lines 37–39, 52): denies listing a sensitive directory (`isSensitive(dir) || isSensitive(dir + "/")`); skips sensitive children (`isSensitive(full) || isSensitive(full + "/")`).
- **`grep.ts`** (lines 48–50, 61–64): denies searching a sensitive path directly; filters results by checking each matched file path against `isSensitive`.
- **`glob.ts`** (line 51): filters each result through `isSensitive(resolve(searchPath, f))`. Uses `dot: true` so hidden files are included in raw results but filtered out before return.

Tests exist in `glob-read-file.test.ts` (lines 287–359) and `list-dir.test.ts` (lines 80–105) covering `.env`, `.npmrc`, `.ssh/id_rsa` denial and non-sensitive dot-file discoverability.

### C2. Add path containment and stale-write consistency

**Status: ✅ Already fixed in current code**

`resolvePath` (`resolve-path.ts`) provides realpath-based containment for all file tools: if the target (or its nearest existing parent) symlinks outside `cwd`, it throws `PathContainmentError`.

Used by: `edit.ts`, `write-file.ts`, `list-dir.ts`, `grep.ts`, `glob.ts`, `file-ops.ts` — each tool catches `PathContainmentError` and returns a clear error.

`checkStale` (`stale-read.ts`) is called by both `edit.ts` (line 102) and `write-file.ts` (line 59) before overwriting existing files.

## Repair Pack D: TUI Correctness

### D1. Fix stale state usage in `DeepiPromptInput`

**Files**

- `packages/tui/src/DeepiPromptInput.tsx`
- Existing prompt input tests, or new focused tests if none exist.

**Verified problem**

The component already has `inputRef`, `cursorRef`, and `pastePartsRef`, so the old claim that it uses no refs is false. However, many `useInput` branches still directly read `input`, `cursor`, `pasteParts`, and `draftBeforeHistory`, which can be stale during fast input or async clipboard flows.

**Required fix**

- Use current refs or functional state updates in all key handling branches that combine current text, cursor, and paste parts.
- Keep refs synchronized when state is set imperatively.
- Reorder `Ctrl+Left` and `Ctrl+Right` handling before plain arrow handling; the current plain arrow checks make the word-jump branches unreachable.
- Preserve paste marker semantics.

**Tests**

- Rapid character insertion at cursor preserves order.
- Backspace/delete around paste markers removes the intended content.
- `Ctrl+Left` and `Ctrl+Right` move by word.
- History up/down preserves the draft accurately.

**Acceptance**

Keyboard operations must use the latest input state and must not make word-jump shortcuts unreachable.

### D2. Complete `handleSubmit` dependencies or move state reads to refs

**Files**

- `packages/tui/src/App.tsx`

**Verified problem**

`handleSubmit` reads many values but its dependency list is short. This can make slash commands and workflow/eval routing use stale values after settings change.

**Required fix**

- Either include all referenced values in the dependency list or move intentionally mutable values to refs and document that choice.
- Be careful with values that change identity every render. If adding them creates churn, stabilize the source or use refs deliberately.
- Keep behavior of slash commands unchanged.

**Tests**

- Changing harness strictness then running `/harness status` reports the new value.
- Changing worker/supervisor models then running eval uses the new role config.
- Switching workflow mode and active role before submit routes to the expected mode/role.

**Acceptance**

Submissions and slash commands must observe current UI state.

### D3. Add a TUI-level workflow continuation guard

**Files**

- `packages/tui/src/bridge.tsx`
- Workflow tests if available.

**Verified problem**

`driveWorkflow` has `while (runAgain)` with no local cap. `WorkflowCoordinator` has its own `maxRounds`, but the TUI bridge should still have a defensive guard in case coordinator state fails to advance.

**Required fix**

- Add a conservative maximum number of bridge-driven continuation cycles.
- Detect no-progress loops if possible, for example same workflow id, phase, iteration, and active goal status repeated.
- On guard trip, set bridge loading false and emit a clear warning/error instead of hanging.

**Tests**

- A mocked coordinator that repeatedly requests continuation eventually stops with a warning.
- A normal workflow still proceeds through expected phases.

**Acceptance**

The TUI must not spin forever if workflow continuation state is inconsistent.

## Repair Pack E: CLI and Sandbox Safety

### E1. Remove editor command injection

**Files**

- `packages/cli/src/commands/config.ts`
- TUI `/config open` path in `packages/tui/src/App.tsx` also contains the same pattern and should be considered in this pack.

**Verified problem**

`configEdit` runs `execSync(`${editor} "${targetPath}"`)`. A malicious or accidental `EDITOR` value can inject shell commands.

**Required fix**

- Use `spawn`/`spawnSync` with an executable and argument array.
- Decide how to support editor commands with arguments. If supported, parse shell-like editor strings safely or document that only executable paths are supported.
- Apply the same fix to TUI `/config open` if it remains shell-based.

**Tests**

- `EDITOR=vim` opens with target path as an argument.
- `EDITOR` containing shell metacharacters does not execute injected commands.
- Missing editor produces a clear error.

**Acceptance**

Opening config files must not execute shell-injected commands.

### E2. Either implement or remove `--force` for config init

**Files**

- `packages/cli/src/commands/config.ts`

**Verified problem**

`config init` tells users to use `--force`, but the option parser ignores it.

**Required fix**

- Implement `--force` overwrite behavior, or change the error/help text to remove `--force`.
- If implementing overwrite, make it explicit and test both user and project config paths.

**Tests**

- Existing config without `--force` is not overwritten.
- Existing config with `--force` is overwritten only when requested.

**Acceptance**

CLI help and behavior must agree.

### E3. Clarify and constrain `SoftWorkspaceProvider`

**Files**

- `packages/core/src/sandbox/soft-workspace.ts`
- Sandbox tests.

**Verified problem**

`SoftWorkspaceProvider` executes `input.command` directly with `execSync`. It is not a security sandbox.

**Required fix**

- Keep the provider clearly marked as diagnostic/non-secure.
- Enforce at least cwd containment and optional read/write root checks if this provider is used for eval isolation.
- Avoid implying OS-level isolation.
- Consider replacing `execSync` with an async process runner in a separate change if needed.

**Tests**

- Commands run in the requested workspace.
- Attempts to run with cwd outside allowed roots are rejected.
- Metadata still marks the provider as non-official/diagnostic.

**Acceptance**

The soft provider must not be mistaken for a secure sandbox and must enforce basic workspace boundaries.

## Repair Pack F: Memory Correctness — ✅ Fixed

### F1. Make memory store keys path-safe

`validatePathComponent` (`memory-store.ts` lines 28–32) rejects keys/scopes containing `/`, `\\`, or `..`. Called at the start of every public method (`get`, `set`, `delete`, `update`, `list`) before any try/catch, so validation errors propagate to the caller.

Tests: `__tests__/memory-fixes.test.ts` — 8 tests covering path traversal rejection and normal key acceptance.

### F2. Validate vector base64 byte length

`base64ToFloat32` (`vector-index.ts` lines 15–22) now checks `buf.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0` and throws a descriptive error. `deserialize` wraps the call in try/catch so one corrupt vector is skipped without crashing the restore.

Tests: `__tests__/memory-fixes.test.ts` — 3 tests: valid round-trip, invalid byte length skipped, corrupt entry isolated.

### F3. Reject unknown KV update operation types

`StateKV.update` (`kv.ts` lines 14–22) now validates `o.type` against `"set"`, `"delete"`, `"append"` and throws `Unknown KV operation type: "${o.type}"` for anything else.

Tests: `__tests__/memory-fixes.test.ts` — 4 tests: set, delete, append succeed; unknown type rejects.

### F4. Make in-memory KV persistence explicit and safer

`InMemoryKV` (`in-memory-kv.ts`):
- `set` and `delete` call `this.persist()` automatically after mutation.
- `persist()` writes through a temp file (`path + .covalo_tmp_${uuid}`) then `renameSync` for atomicity.
- `getLastPersistError()` surfaces the last error string for diagnostics.

Tests: `__tests__/memory-fixes.test.ts` — 6 tests: auto-persist after set/delete, load on construction, no persist without path, error reporting, temp file cleanup.

### F5. Fix Windows path project derivation

`deriveProject` (`jsonl-parser.ts` lines 28–31) normalizes `\\` to `/` before splitting, so Windows paths like `C:\work\repo` correctly yield `"repo"`.

Tests: `__tests__/memory-fixes.test.ts` — 3 tests: POSIX path, Windows backslash path, empty path.

## Repair Pack G: Lower-Risk Cleanup — ✅ Fixed

These items are lower priority. Fix only after higher-priority packs unless they are touched naturally by a related repair.

- `packages/tui/src/components/workflow/WorkflowStatusBar copy.tsx`: **Removed.** Confirmed stale duplicate (not imported anywhere; real file is `WorkflowStatusBar.tsx` with i18n).
- `packages/memory/src/hooks/`: `isSdkChildContext` is duplicated in many standalone hook scripts. These scripts intentionally inline code to avoid bundle chunk churn, so do not refactor unless build output and hook deployment are understood. **(Skipped per guidance.)**
- `packages/memory/src/state/reranker.ts`: **Fixed.** Added `resetRerankerCache()` that resets `pipeline`, `pipelineLoading`, and `pipelineUnavailable`.
- `packages/core/src/sandbox/bwrap.ts`: uses synchronous process calls in several places. **(Skipped per guidance — only if measurable.)**
- `packages/security/src/permission.ts`: **Fixed.** Added optional `id` field to `DenyRule`/`AllowRule` interfaces; added `removeDenyRuleById(id)` and `removeAllowRuleById(id)` for targeting RegExp rules by identifier.

## Eval Assets (Self-Contained NPM)

Covalo now ships eval benchmark assets inside the npm package. No external bundle downloads or manual `.pt` file placement needed.

### Directory Structure

```
resources/eval-assets/
├── assets.lock.json            # Integrity manifest (sha256 for all assets)
├── category-map.json            # Category/suite metadata
├── swe-bench/
│   ├── lock.json                # SWE-bench instance metadata
│   └── snapshots/               # baseCommit snapshots (tar.gz, no git history)
│       └── <safeRepoName>/
│           └── <baseCommit>.tar.gz
└── terminal-bench/
    ├── lock.json                # Terminal-Bench instance metadata
    ├── tasks/                   # Task directories (copied from curated)
    │   └── <taskId>/
    └── assets/                  # Optional small generated assets
```

### Key Changes

1. **No more git bundles**: SWE-bench materializer uses `baseCommit` snapshots (`tar.gz`) instead of full git history bundles. Repos are checked out at the base commit, `.git` removed, and packed reproducibly.
2. **No PyTorch large-weight tasks**: `pytorch-model-recovery` and `pytorch-model-cli` removed from packaged lock. They required ~10MB `.pt`/`.pth` files. If re-added, they must use small generated assets (`< 2MB`).
3. **Asset resolver**: `getEvalAssetsRoot()` searches `COVALO_EVAL_ASSETS_DIR` → npm package root → repo root → dev fallback (`curated/`).
4. **Safe extraction**: `extractSafeTarGz()` validates all tar entries for path traversal before extracting.

### Build Commands

```bash
# Build SWE-bench snapshots from upstream repos (requires network)
bun run eval:assets:build

# Verify asset integrity
bun run eval:assets:verify

# Check asset size budgets (target: 35MB, max: 45MB)
bun run eval:assets:size
```

### Asset Integrity

All assets in `assets.lock.json` are tracked by sha256. The verify script checks:
- Every file exists at its declared path
- sha256 matches the lock
- No `*.bundle`, `*.pack`, `*.idx`, or `.git/` files
- No PyTorch large-weight tasks in lock
- Every SWE-bench lock instance has a corresponding snapshot
- Every Terminal-Bench lock task has a task directory

### Adding a New SWE-bench Snapshot

```bash
# The build script handles this automatically:
bun run eval:assets:build
# It deduplicates by repo+baseCommit, caches repos locally,
# and updates assets.lock.json with sha256 and size.
```

### Removing a Case

1. Remove the instance from `swe-bench/lock.json` or `terminal-bench/lock.json`
2. Delete the snapshot/task directory if applicable
3. Update `assets.lock.json` to remove the asset entry
4. Run `bun run eval:assets:verify` to confirm integrity

## Do Not Fix Without New Evidence

These previous audit claims were checked against the current tree and are false, stale, or not actionable as written.

- `packages/memory/src/migrate.ts` double-encodes scope directory names. Current code does not call `encodeURIComponent`; it copies `scopeDir.name` as-is.
- `packages/tui/src/store/transcript-store.ts` lacks a `break` in `trimToLimitInternal`. Current code already breaks after the target size is reached.
- `packages/memory/src/hooks/pre-tool-use.ts` is a live P1 because `III_REST_PORT` can become a bare URL. The code issue exists, but the file is marked dead code and replaced by `DeepreefMemoryBridge`; do not prioritize unless the standalone hook is re-enabled.
- `packages/core/src/loop.ts` has no first-event timeout for non-zen providers. `DeepSeekClient` has a default first-event timeout; only fallback model behavior is zen-specific.
- `reasoning_content` is stored for non-tool replies but not sent to the API. Current code stores `reasoning_content` on tool-call assistant messages and sends it with those tool calls; plain non-tool replies are not appended with reasoning content.
- `packages/memory/src/auth.ts` needs a persistent HMAC key for cross-process authentication. The random key is used only to make local timing-safe comparisons length-safe; it is not the shared auth secret.
- `packages/tui/src/DeepiMessages.tsx` has unstable React keys. Current main render uses `item.id`; provide a concrete failing case before changing.
- `packages/tui/src/StatusBar.tsx` Windows `cwd.split('/')` is currently not user-visible because `cwdShort` is not rendered. Remove dead variable or fix only if cwd display is restored.
- `packages/tui/src/bridge.tsx` `submitInternal` definitely leaves `running=true` on exceptions. Current code has a `finally` that resets `running`; investigate only with a reproducible failing path.
- `packages/core/src/engine.ts` `submit()` is missing `async`. It is `async *submit`.
- `repairToolArguments` partial storm repairs execute tools. Current `parseToolCallArgs` rejects partial repairs.
- `executeToolCall` must handle `"invalid"` from permission evaluation as a current P1. With parsed args passed into permission evaluation, the `"invalid"` path is currently unreachable. A defensive branch is acceptable but low priority.

## Suggested Verification Commands

Use the commands that match the changed package. Prefer narrower tests when available.

```bash
pnpm --filter @covalo/tools test
pnpm --filter @covalo/core test
pnpm --filter @covalo/tui test
pnpm --filter @covalo/memory test
pnpm --filter @covalo/cli test
pnpm test
```

If package scripts differ, inspect `package.json` and run the closest package-level test target.
