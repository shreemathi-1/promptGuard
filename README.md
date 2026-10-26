# PromptGuard

**Find and mask secrets and personal data before they reach an AI chatbot or a git commit.**

People paste real data into chatbots all the time: a support ticket with a customer's
card number, a stack trace with an API key, a patient note with a name and a diagnosis.
Regex-only DLP tools catch the structured part of that and miss the rest, and they
flag harmless look-alikes (order IDs, git SHAs) as secrets until people stop trusting
them. PromptGuard combines regex rules with local AI models (Microsoft Presidio, a
HuggingFace NER model and a prompt-injection classifier) to fix both problems. It works
in a web app, a CLI with a git pre-commit hook, and a VS Code extension. Everything
runs locally: no paid APIs, and no prompt leaves your machine.

[![CI](https://github.com/shreemathi-1/promptGuard/actions/workflows/ci.yml/badge.svg)](https://github.com/shreemathi-1/promptGuard/actions/workflows/ci.yml)

![Scanning a prompt: a name, a city and an Aadhaar number found, plus a prompt-injection warning](docs/screenshots/scan.png)

## Results

Measured on a labelled set of 454 synthetic prompts with 658 sensitive values, plus
70 look-alikes that are *not* sensitive (order IDs that fail the Aadhaar checksum,
Luhn-invalid invoice numbers, git SHAs, timestamps). See [eval/](eval/README.md).

| Detection mode | Precision | Recall | F1 | Look-alikes flagged | p95 latency |
|---|---|---|---|---|---|
| Regex rules only | 78.8% | 42.2% | 55.0% | 100% | 1 ms |
| AI models only | 85.8% | 75.5% | 80.4% | 30% | 32 ms |
| **Hybrid** (rules verified by ML, plus AI entities) | **91.7%** | **95.4%** | **93.5%** | **15.7%** | **31 ms** |

Why Hybrid wins: rules alone find structured values but not names, places or health
data (recall 42%) and flag every look-alike. AI alone finds the unstructured entities
but misses formats such as PAN, IFSC and API keys. Hybrid lets each cover the other's
gap: rules propose, checksums and context verify, and NER adds what rules cannot see.

**Prompt-injection detection** (74 attacks, 380 normal prompts): catches all 74 attacks
and falsely flags 26 of the 380 normal prompts (precision 74%, ROC AUC 0.996). That
"all 74" is a measurement on this dataset, not a guarantee. The false alarms are mostly
prompts that merely *contain* trigger words or token-like strings ("forget the earlier
example", `Authorization: Bearer …`), and 10 of 30 deliberately tricky benign prompts are
flagged. The classifier rates almost everything near 1.0, so a model-only score is damped
(`MODEL_ONLY_CAP` = 0.6 in `apps/ml-service/app/injection.py`, so the model alone counts
above about 0.83), while phrase heuristics ("ignore previous instructions") are trusted
fully. Stricter settings were measured and rejected: flagging only at 0.99 removes just
3 false alarms and leaves almost no margin below the weakest known attack, and 0.999
halves the false alarms but misses one attack. The cap favours catching attacks; a
better-calibrated or fine-tuned model is the real fix.

The data is synthetic and template-based, so absolute scores are optimistic. The
comparison between modes is the meaningful part.

## What it does

- **Hybrid detection.** Regex rules find candidates; an ML validator checks them with
  checksums (Luhn, Verhoeff for Aadhaar, IBAN mod-97) and nearby words, and drops
  look-alikes. NER adds what rules can't find: names, places, organisations, dates of
  birth, medical conditions. Each finding shows its source, confidence and the reason
  it was flagged.
- **Prompt-injection warning** for jailbreak and instruction-override attempts.
- **Masking** in three styles: `[CREDIT_CARD REDACTED]`, partial (`****1111`) or tokens.
- **Smart Rewrite.** Swaps real values for realistic fakes with valid checksums
  ("Priya Sharma" → "Qabil Gara", a Luhn-valid card number), so a chatbot can still
  answer properly; then puts the real values back into its reply. The mapping lives
  in memory only, expires after an hour, and is never written to the database.
- **"Why is this risky?"** explanations for every finding, with an optional version
  written by a local LLM (Ollama). The LLM never sees the sensitive values.
- **AI rule generator.** Describe a value and give examples; a local LLM writes a
  regex, and PromptGuard tests it against your examples in Python and in JavaScript
  before you save it.
- **CLI and pre-commit hook.** `promptguard scan --staged` checks exactly what you're
  about to commit and blocks the commit when it finds secrets.
- **VS Code extension.** Problems on save, quick fixes (mask, move to `.env`, ignore),
  Copy Masked, Scan Staged Files, and an `@promptguard` chat participant that masks
  your prompt before the model sees it.
- **Dashboard, health page, benchmark page and audit log** with CSV/JSON export. The audit
  log can be switched to not store raw input text, and a sensitivity setting hides
  low-severity findings on the Scan page (Mask and Rewrite always cover everything).

<table>
<tr>
<td><img src="docs/screenshots/rewrite.png" alt="Smart Rewrite: original prompt, rewritten prompt with fakes, mapping table, and the restored reply"></td>
<td><img src="docs/screenshots/benchmark.png" alt="Benchmark page comparing Regex, AI and Hybrid modes"></td>
</tr>
<tr>
<td align="center">Smart Rewrite</td>
<td align="center">Benchmark</td>
</tr>
</table>

## Architecture

```mermaid
flowchart LR
  subgraph Clients
    W[React web app]
    V[VS Code extension]
    C[CLI / pre-commit hook]
  end
  subgraph Backend["Express API (Node.js)"]
    P[Detection pipeline]
    R[(Regex rules)]
  end
  subgraph ML["ML service (Python, FastAPI)"]
    D[Presidio + HuggingFace NER]
    X[Checksum and context validator]
    I[Prompt-injection classifier]
    S[Pseudonymizer]
  end
  O[Ollama: local LLM, optional]
  DB[(PostgreSQL: rules, settings, audit log)]

  W --> P
  V --> P
  C --> P
  P --> R
  P --> X
  P --> D
  P --> I
  P --> S
  P --> DB
  ML -.-> O
```

Every client talks to the same Express API, so the web app, the editor and the
pre-commit hook share one rule set, one set of AI models and one audit log. The
Python service is separate because the ML libraries live in Python; Node stays the
product API and owns the database.

**How a Hybrid scan works**

1. Regex rules find candidates in the text.
2. The ML validator scores each candidate (checksums, nearby words) and drops those
   below the confidence threshold (default 0.6).
3. The NER model adds entities rules can't find (names, places, health data).
4. Overlapping findings are merged: rule matches beat AI guesses, then longer spans,
   then higher severity.
5. The injection classifier scores the prompt, and the risk score (0–100) combines
   severity, category, confidence, repetition and injection.

If the ML service is down, every scan falls back to regex rules and says so
(`aiAvailable: false`). A circuit breaker keeps a stopped ML service from slowing every
request.

## Getting started

### Docker

```bash
cp .env.example .env
docker compose up --build            # add --profile llm for Ollama
```

| Service | URL |
|---|---|
| Web app | http://localhost:5173 |
| API | http://localhost:4000/api/health |
| ML service | http://localhost:8000/health |

The ML image downloads its models at build time (about 2 GB). While they load,
scans run with regex rules only.

### Run locally

Requires Node.js 20+, PostgreSQL 14+ and Python 3.11.

```bash
# Database
createdb dlp_db
psql -d dlp_db -f apps/backend/src/db/schema.sql

# Install
npm run install:all
cp apps/backend/.env.example apps/backend/.env       # your DB credentials
npm run migrate && npm run seed

# ML service (optional; without it scans use regex rules only)
cd apps/ml-service && python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m spacy download en_core_web_sm
cd ../..

# Run each in its own terminal
npm run dev:ml
npm run dev:backend
npm run dev:frontend
npm run dev:ollama        # optional: rule generator and LLM explanations
```

The rule generator and LLM explanations need [Ollama](https://ollama.com) with a model
pulled (for example `ollama pull qwen2.5-coder:3b`). Everything else works without it.

### CLI and pre-commit hook

```bash
npm run scan                    # scan the project
npm run hook:install            # block commits that contain secrets
git commit --no-verify          # skip the check once
```

Mark a false positive with a `promptguard:ignore` comment, or list paths in
`.promptguardignore`. Findings are printed as masked previews, never the value.
Details: [packages/cli](packages/cli/README.md).

### VS Code extension

Open `apps/vscode-extension` in VS Code and press F5, or install a build:

```bash
npm run package:extension
code --install-extension apps/vscode-extension/dist/promptguard-1.0.0.vsix
```

The extension needs the backend running (default `http://localhost:4000`, setting
`promptguard.apiUrl`). Details: [apps/vscode-extension](apps/vscode-extension/README.md).

## Testing

| Suite | Tests | Command |
|---|---|---|
| Backend: pipeline, routes, batch scans, scanner | 40 | `npm run test:backend` |
| ML service: validators, detector, pseudonymizer, rule generator | 219 | `npm run test:ml` |
| CLI, including real `git commit`s through the hook | 26 | `npm run test:cli` |
| VS Code extension (mocked VS Code API) | 14 | `npm run test:extension` |
| VS Code extension inside a real VS Code | 5 | `npm run test:extension:integration` |
| End-to-end: Postgres → backend → benchmark → CLI → hook | 1 script | `scripts/e2e-smoke.sh` |
| Detection benchmark | 454 prompts | `npm run eval:benchmark` |

GitHub Actions runs everything except the VS Code integration suite on every push and
pull request. That includes frontend lint and build, packaging the extension, and an
end-to-end job that scans this repository with PromptGuard itself. The ML tests run
without torch, using spaCy's small model, so CI stays fast.

`node scripts/capture-screenshots.js` regenerates the screenshots above by driving
headless Chrome through the running app.

## Project structure

```text
promptGuard/
├── apps/
│   ├── backend/            Express API: detection pipeline, routes, PostgreSQL
│   ├── frontend/           React (Vite) web app
│   ├── ml-service/         FastAPI: Presidio/NER, validators, injection, pseudonymizer,
│   │                       rule generator, explainer
│   └── vscode-extension/   VS Code extension (plain JavaScript, no build step)
├── packages/cli/           promptguard CLI and pre-commit hook (no dependencies)
├── eval/                   labelled dataset, benchmark script, results
├── scripts/                end-to-end smoke test, screenshot capture
├── .github/workflows/      CI
└── docker-compose.yml
```

## Tech stack

**Frontend** React 19, Vite · **Backend** Node.js, Express 5, PostgreSQL ·
**ML** Python, FastAPI, Microsoft Presidio, spaCy, HuggingFace Transformers
(`dslim/bert-base-NER`, `protectai/deberta-v3-base-prompt-injection-v2`), Faker ·
**LLM** Ollama (optional) · **Tooling** VS Code Extension API, Node test runner, pytest,
GitHub Actions, Docker Compose

## Design decisions

- **Rules propose, ML verifies.** Keeping the regex rules as the source of truth means
  users can still add their own rules; the ML layer only scores and filters them.
- **Local models only.** Sensitive text never goes to a third-party API, which is the
  point of a DLP tool. The cost is a ~2 GB model download and CPU-speed inference.
- **Fail soft on AI, fail closed on the guard.** If the ML service is down, scans fall
  back to regex and say so. The `@promptguard` chat participant and the strict hook
  mode do the opposite: they refuse to continue when they can't check.
- **Safe output.** The CLI and extension show masked previews, and batch scans store
  only masked previews in the audit log, so the tool does not become a second copy of
  the secrets it finds.
- **Zero-dependency clients.** The CLI and extension are plain JavaScript with no
  runtime dependencies, so the hook starts fast and installs anywhere Node runs.

## Limitations

- The benchmark data is synthetic; expect lower numbers on real prompts.
- Name, place and organisation detection is the weakest part (organisation F1 65%);
  the NER model occasionally tags acronyms such as KYC or NEFT as organisations.
- Prompt-injection detection trades precision for recall (see Results).
- Detection targets English text and India/US/EU identifier formats.
- Smart Rewrite mappings are in memory in a single ML-service process, so they do not
  survive a restart or work across multiple replicas.
- The backend has no authentication; run it on localhost or behind your own proxy.
- The Docker setup is provided but has not been exercised on every platform; CI covers
  the non-Docker path.

## Highlights

- Raised detection F1 from **55.0% to 93.5%** over regex-only scanning by verifying rule
  matches with checksums and context, and adding NER for unstructured PII. False
  positives on look-alike data fell by **84%**, at **31 ms p95** latency.
- Built a labelled evaluation set (454 prompts, exact spans, hard negatives) and a
  benchmark that found and fixed real bugs: overlapping-match priority, an unmatchable
  phone regex, and overly broad negative context.
- Designed a format-preserving pseudonymizer: fakes keep valid Luhn, Verhoeff and IBAN
  checksums, stay consistent across a conversation, and are restored in chatbot replies,
  including a fake first name used on its own or a number written without spaces.
- Made a 4B-parameter local LLM produce reliable regex rules by pairing it with
  structure inference from examples and testing every candidate in both regex engines.
- Shipped PromptGuard where developers work: a dependency-free CLI, a git pre-commit hook,
  and a VS Code extension with quick fixes and a chat participant.
