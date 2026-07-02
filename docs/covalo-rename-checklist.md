# Covalo rename checklist

This note records the minimum post-rename checks for the `bzcsk2/covalo` repository.

## Package and install command

The publishable root package is `covalo` and exposes the `covalo` binary.

```bash
npm install -g covalo
covalo --help
```

The `looprig` binary is kept as a compatibility alias for users who installed or scripted against the previous project name.

## Local clone remote

Existing local clones may still point to the old repository path. Update the remote explicitly instead of relying on GitHub redirects:

```bash
git remote set-url origin git@github.com:bzcsk2/covalo.git
```

For HTTPS remotes:

```bash
git remote set-url origin https://github.com/bzcsk2/covalo.git
```

## Publish verification

Before publishing, run:

```bash
bun run typecheck
bun test
bun run build
npm pack --dry-run
```

During `npm pack --dry-run`, verify that:

- the package name is `covalo`
- the primary binary is `covalo`
- the compatibility binary `looprig` is included
- `resources/eval-assets` is included
- `README.md`, `README.zh.md`, `LICENSE`, and `CHANGELOG.md` are included
