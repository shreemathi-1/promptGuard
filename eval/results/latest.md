### Detection benchmark (454 prompts, 658 labelled entities)

| Mode | Precision | Recall | F1 | Strict F1 | Hard-negative FP rate | p50 / p95 latency |
|---|---|---|---|---|---|---|
| REGEX | 78.8% | 42.2% | **55.0%** | 55.0% | 100.0% | 1 / 1 ms |
| AI | 85.8% | 75.5% | **80.4%** | 78.7% | 30.0% | 29 / 32 ms |
| HYBRID | 91.7% | 95.4% | **93.5%** | 92.0% | 15.7% | 29 / 31 ms |

| Category (support) | REGEX F1 | AI F1 | HYBRID F1 |
|---|---|---|---|
| AADHAAR (31) | 76.5% | 0.0% | 95.4% |
| API_KEY (26) | 63.8% | 0.0% | 73.2% |
| BANK_ACCOUNT (36) | 79.5% | 71.4% | 98.6% |
| CREDIT_CARD (30) | 80.0% | 98.4% | 100.0% |
| DATE_OF_BIRTH (26) | 0.0% | 100.0% | 100.0% |
| EMAIL (49) | 100.0% | 100.0% | 100.0% |
| IFSC (18) | 100.0% | 0.0% | 100.0% |
| IP_ADDRESS (34) | 85.0% | 85.0% | 100.0% |
| LOCATION (74) | 0.0% | 92.4% | 92.4% |
| MEDICAL (35) | 0.0% | 88.9% | 88.9% |
| ORGANIZATION (42) | 0.0% | 57.8% | 65.0% |
| PAN (17) | 100.0% | 0.0% | 100.0% |
| PERSON (187) | 0.0% | 97.0% | 97.0% |
| PHONE (44) | 93.6% | 34.0% | 100.0% |
| SSN (9) | 75.0% | 100.0% | 100.0% |

**Prompt injection** (74 attacks, 380 benign; model `protectai/deberta-v3-base-prompt-injection-v2`): accuracy 94.3%, precision 74.0%, recall 100.0%, ROC AUC 0.9958, false alarms on benign prompts with trigger words 33.3%.

Hybrid vs regex-only: F1 55.0% → 93.5%, recall 42.2% → 95.4%, hard-negative false positives cut by 84.3%.

_Generated 2026-10-21T17:39:05+00:00 by `eval/run_benchmark.py`._
