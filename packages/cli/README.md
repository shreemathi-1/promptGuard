# promptguard CLI

Scan files for secrets and PII with PromptGuard, and block git commits that contain them.
No dependencies: Node 20+ only.

```bash
# from the repo root
npm run scan                       # scan the whole project
npm run scan -- src/ config/.env   # scan specific paths
npm run hook:install               # block commits with findings

# or link it once to get a global `promptguard` command
npm link ./packages/cli
promptguard scan --staged
```

The CLI sends files to a running PromptGuard backend (`POST /api/scan/batch`),
so it uses the same rules, AI detection and audit log as the web app.

## Commands

| Command | What it does |
|---|---|
| `promptguard scan [paths…]` | Scan files and directories (default `.`) |
| `promptguard scan --staged` | Scan exactly what the next commit contains (the git index, not the working tree) |
| `promptguard hook install` | Install a git pre-commit hook that runs `scan --staged` |
| `promptguard hook uninstall` | Remove the hook (restores a hook it replaced) |

## Options

| Option | Default | |
|---|---|---|
| `--fail-on <level>` | `HIGH` | `LOW` · `MEDIUM` · `HIGH` · `CRITICAL`. Findings below it are shown as warnings |
| `--mode <mode>` | server setting | `REGEX` · `AI` · `HYBRID`. Hybrid drops look-alikes such as git SHAs and order IDs |
| `--api <url>` | `$PROMPTGUARD_API` or `http://localhost:4000` | |
| `--exclude <glob>` | | Repeatable; adds to `.promptguardignore` and the defaults |
| `--offline allow\|block` | `block` | What to do when the API is unreachable |
| `--include-test-values` | off | Also report documented example values (see below) |
| `--json` | | Machine-readable output for CI |
| `--force` | | `hook install`: replace an existing hook, keeping a backup |

Exit codes: `0` clean · `1` findings at or above `--fail-on` · `2` usage error · `3` API unavailable.

## The pre-commit hook

- Runs for every commit: terminal, VS Code's Source Control panel, or any other git client.
- Skip it once with `git commit --no-verify`.
- If the backend isn't running, the hook warns and lets the commit through.
  Set `PROMPTGUARD_STRICT=1` to block instead.
- It won't overwrite a pre-commit hook it didn't install unless you pass `--force`
  (the old hook is backed up and restored on uninstall).

## What gets skipped

- **Defaults:** `node_modules/`, `.git/`, virtualenvs, `dist/`, `build/`, lockfiles,
  minified files, source maps, images and other binaries, and files over 1 MB.
- **`.promptguardignore`** in the scan root: gitignore-style globs, one per line.
- **Inline:** add `promptguard:ignore` in a comment on the line, or
  `promptguard:ignore-next-line` on the line above.
- **Documented test values**, which appear in tests and docs everywhere and are never real
  secrets: AWS's example key `AKIAIOSFODNN7EXAMPLE`, payment test cards such as
  `4111 1111 1111 1111` and `4242 4242 4242 4242`, and example IBANs.

## Safe output

Findings are printed as masked previews (`AKIA************NW3T`), never the value
itself, so CI logs don't leak what the scan found. The backend's audit log also stores
only masked previews for batch scans.

## Tests

```bash
npm run test:cli    # node:test, no dependencies
```

The tests include real `git commit` runs in temporary repositories against a fake API.
