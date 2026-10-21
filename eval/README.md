# Evaluation benchmark

Measures how well PromptGuard's three detection modes (Regex, AI, Hybrid) find
sensitive data, how often they flag harmless look-alikes, and how well the
prompt-injection check separates attacks from normal requests.

```bash
npm run eval:dataset     # rebuild data/dataset.jsonl (needs Faker; see the note below)
npm run eval:benchmark   # backend + ML service must be running; ~1 minute
```

`run_benchmark.py` uses only the Python standard library. It writes
`results/latest.json`, which the app's **Benchmark** page reads, and
`results/latest.md`, a table you can paste into the README.

## Dataset (`data/dataset.jsonl`)

454 synthetic prompts with exact character spans for each sensitive value,
generated from templates with Faker (seed 42):

| Group | Count | What it tests |
|---|---|---|
| `pii` | 259 | names, places, organisations, emails, phones, cards, Aadhaar, PAN, SSN, IBAN/accounts, IFSC, API keys, IPs, dates of birth, medical conditions |
| `hard_negative` | 70 | look-alikes that are **not** sensitive: order IDs that fail the Aadhaar checksum, Luhn-invalid invoices, timestamps, git SHAs, version strings, SSN-shaped tickets, phone-shaped SKUs |
| `clean` | 20 | ordinary prompts |
| `injection` | 74 | jailbreak / instruction-override attempts, some mixed with PII |
| `benign` | 30 | normal requests with trigger words ("ignore the typos", "act as a translator") |

The generator has its own Luhn, Verhoeff and IBAN code (independent of the app's
validators). About 30% of medical terms and some phone and API-key formats are
deliberately outside the detectors' lists, so the scores reflect generalisation.

**Regenerating.** The seed fixes everything except dates of birth: Faker picks those
relative to today's date, so a rebuild changes about 26 of the 454 records. Treat the
committed `dataset.jsonl` as the reference; rebuild only when you mean to change it.

**Escaped token prefixes.** The dataset and `results/latest.json` contain made-up AWS and
GitHub tokens. Secret scanners (GitHub push protection) read the raw file and would flag
them, so `hide_tokens.py` writes the first letter of the prefix as a JSON escape
(`A\u004bIA…`, `g\u0068p_…`). Any JSON parser reads back the same text, so scores are unaffected.

## Metrics

- **Precision / recall / F1** at span level, micro-averaged. *Lenient*: same
  category and overlapping span. *Strict*: exact boundaries.
- **Hard-negative false-positive rate**: share of look-alike prompts with any detection.
- **Injection**: accuracy, precision, recall, F1 and ROC AUC of the injection score
  (all non-attack prompts count as negatives).
- **Latency**: client-side p50 / p95 per request. Detection runs with the injection
  check off; injection is scored in a separate pass.

The benchmark calls `POST /api/eval/scan`, which is the same pipeline as
`/api/scan` but writes no audit-log rows.

## Caveats

- The data is synthetic and template-based, so absolute scores are optimistic
  compared with real prompts. The comparison between modes is the useful part.
- The phone-regex, de-duplication and negative-context fixes made on 2026-10-07 were
  found with this benchmark and measured on the same data. They are bug fixes, not
  tuned thresholds, but a held-out set would give an unbiased number.
