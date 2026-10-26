# PromptGuard for VS Code

Find and mask secrets and personal data in your code and prompts before they
reach an AI chatbot or a git commit.

Every scan goes through your PromptGuard backend, so the editor, the CLI and the
pre-commit hook use the same rules, the same AI detection and the same audit log.

## Features

- **Problems on save.** Keys, card numbers, Aadhaar/PAN, emails, phone numbers,
  names and more are underlined when you save, with a masked preview
  (`AKIA************NW3T`), never the value itself.
- **Quick fixes** (lightbulb or <kbd>Cmd/Ctrl</kbd>+<kbd>.</kbd>):
  - **Mask this value**: replace it with `[API_KEY REDACTED]`
  - **Move to .env**: put the value in `.env`, read it with `process.env.NAME`
    (or the equivalent in Python, Go, Java, Ruby, C#, PHP, Rust, shell), and add
    `.env` to `.gitignore`
  - **Ignore on this line**: add a `promptguard:ignore` comment for a false positive
- **Copy Masked** (<kbd>Cmd/Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd>): copy the selection,
  or the whole file, with sensitive values masked, ready to paste into a chatbot.
- **Smart Rewrite Selection**: copy a version with realistic fakes ("Priya Sharma" →
  "Ananya Rao"); after the chatbot answers, **Restore Chatbot Reply** puts the real
  values back.
- **Scan Staged Files**: a shield button in the Source Control title bar checks
  exactly what you're about to commit.
- **Install Pre-commit Hook**: block commits with findings at or above
  `promptguard.hookFailOn`, from the terminal or the Source Control panel.
- **Generate Rule from Selection**: describe a value you selected; the local LLM writes
  a regex, PromptGuard tests it, and you save it as a rule.
- **@promptguard in Chat**: masks your prompt and checks it for prompt injection
  before the model sees it. If the backend is unreachable, nothing is sent.
- **PromptGuard Findings** view in the Explorer, and a status bar item showing
  backend/AI status and the number of high-severity findings.

## Requirements

A running PromptGuard backend (`npm run dev:backend` in the PromptGuard repo).
AI detection needs its ML service (`npm run dev:ml`); without it, scans fall back to
regex rules. Rule generation needs Ollama (`npm run dev:ollama`).

## Settings

| Setting | Default | |
|---|---|---|
| `promptguard.apiUrl` | `http://localhost:4000` | Backend URL |
| `promptguard.detectionMode` | server setting | `REGEX`, `AI` or `HYBRID` |
| `promptguard.scanOnSave` | `true` | Scan files when saved |
| `promptguard.minimumSeverity` | `MEDIUM` | Hide findings below this |
| `promptguard.maskStyle` | `REDACT` | `REDACT`, `PARTIAL` or `TOKENIZE` |
| `promptguard.hookFailOn` | `HIGH` | What the pre-commit hook blocks |
| `promptguard.chat.blockInjection` | `true` | @promptguard refuses injection attempts |

Skipped automatically: `.promptguardignore` paths, `node_modules`, lockfiles, binaries,
files over 1 MB, lines marked `promptguard:ignore`, and documented test values such as
AWS's `AKIAIOSFODNN7EXAMPLE` or the test card `4111 1111 1111 1111`.

## Development

Plain JavaScript, no build step and no npm dependencies.

```bash
# Run: open apps/vscode-extension in VS Code and press F5
npm test                  # unit tests (node:test, with a mocked vscode API)
npm run test:integration  # runs the suite inside your installed VS Code
npm run package           # builds dist/promptguard-<version>.vsix (no vsce needed)
code --install-extension dist/promptguard-1.0.0.vsix
```

After updating the extension, run **Install Pre-commit Hook** again: the hook points
at the CLI bundled inside the installed extension's folder.
