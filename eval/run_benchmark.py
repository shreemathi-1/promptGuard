"""
Benchmarks PromptGuard's detection modes on the labelled dataset.

For each mode (REGEX, AI, HYBRID) every prompt goes through the backend's
detection pipeline (POST /api/eval/scan — the same code as /api/scan, without
audit logging) and the detections are compared with the gold spans.

Metrics
  Span-level precision / recall / F1, micro-averaged, per category and overall:
    lenient — same category and overlapping span (standard "partial" NER match)
    strict  — same category and exact start / end
  Hard-negative false-positive rate — share of look-alike prompts (order IDs,
    timestamps, git SHAs …) where anything at all was flagged
  Prompt injection — accuracy, precision, recall, F1 and ROC AUC of the
    injection score, measured in a separate pass so detection latency isn't
    inflated by the injection model
  Latency — p50 / p95 per request, as seen by the client

Detection runs with the injection check off; the injection pass runs once.

Output: eval/results/latest.json (read by the Benchmark page) and latest.md.

Usage (backend + ML service running; standard library only):
    python3 eval/run_benchmark.py [--api http://localhost:4000] [--modes REGEX,AI,HYBRID] [--limit 50]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from hide_tokens import hide_prefixes

HERE = Path(__file__).parent
DATASET = HERE / "data" / "dataset.jsonl"
RESULTS = HERE / "results"
MODES = ["REGEX", "AI", "HYBRID"]
ERROR_SAMPLES = 10


# ── HTTP ─────────────────────────────────────────────────────────────────────

def call(api: str, method: str, path: str, body: dict | None = None, timeout: float = 60) -> dict:
    req = urllib.request.Request(
        api.rstrip("/") + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read())["data"]


# ── Matching ─────────────────────────────────────────────────────────────────

def match_spans(preds: list[dict], golds: list[dict], strict: bool) -> tuple[list[tuple[int, int]], list[int], list[int]]:
    """Greedy one-to-one matching → (matched pairs, unmatched pred idx, unmatched gold idx)."""
    candidates = []
    for pi, p in enumerate(preds):
        for gi, g in enumerate(golds):
            if p["category"] != g["category"]:
                continue
            if strict:
                if p["start"] == g["start"] and p["end"] == g["end"]:
                    candidates.append((g["end"] - g["start"], pi, gi))
            else:
                overlap = min(p["end"], g["end"]) - max(p["start"], g["start"])
                if overlap > 0:
                    candidates.append((overlap, pi, gi))
    candidates.sort(reverse=True)
    used_p, used_g, pairs = set(), set(), []
    for _, pi, gi in candidates:
        if pi not in used_p and gi not in used_g:
            used_p.add(pi)
            used_g.add(gi)
            pairs.append((pi, gi))
    return (pairs,
            [i for i in range(len(preds)) if i not in used_p],
            [i for i in range(len(golds)) if i not in used_g])


def prf(tp: int, fp: int, fn: int) -> dict:
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"precision": round(precision, 4), "recall": round(recall, 4), "f1": round(f1, 4), "tp": tp, "fp": fp, "fn": fn}


def percentile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    k = (len(ordered) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(ordered) - 1)
    return round(ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo), 1)


def roc_auc(scores: list[float], labels: list[bool]) -> float | None:
    """Probability a random positive outscores a random negative (ties count half)."""
    pos = [s for s, y in zip(scores, labels) if y]
    neg = [s for s, y in zip(scores, labels) if not y]
    if not pos or not neg:
        return None
    wins = sum((p > n) + 0.5 * (p == n) for p in pos for n in neg)
    return round(wins / (len(pos) * len(neg)), 4)


# ── Evaluation ───────────────────────────────────────────────────────────────

def snippet(text: str, start: int, end: int, radius: int = 40) -> str:
    a, b = max(0, start - radius), min(len(text), end + radius)
    return ("…" if a else "") + text[a:start] + "⟦" + text[start:end] + "⟧" + text[end:b] + ("…" if b < len(text) else "")


def evaluate_mode(api: str, mode: str, records: list[dict], allow_fallback: bool) -> dict:
    lenient: dict[str, list[int]] = {}
    strict: dict[str, list[int]] = {}
    support: dict[str, int] = {}
    latencies, server_ms = [], []
    fallbacks = 0
    hard_flags: dict[str, list[int]] = {}
    clean_flagged = clean_total = 0
    fns, fps = [], []

    for n, r in enumerate(records, 1):
        t0 = time.perf_counter()
        result = call(api, "POST", "/api/eval/scan", {"text": r["text"], "mode": mode, "injectionCheck": False})
        latencies.append((time.perf_counter() - t0) * 1000)
        server_ms.append(result["durationMs"])
        if result["effectiveMode"] != mode:
            fallbacks += 1
            if not allow_fallback:
                sys.exit(f"\n{mode}: the backend fell back to {result['effectiveMode']} on {r['id']} — "
                         "is the ML service up? (use --allow-fallback to continue anyway)")

        preds = [{"category": d["category"], "start": d["start"], "end": d["end"]} for d in result["detections"]]
        golds = r["entities"]
        for g in golds:
            support[g["category"]] = support.get(g["category"], 0) + 1

        for table, is_strict in ((lenient, False), (strict, True)):
            pairs, bad_p, bad_g = match_spans(preds, golds, is_strict)
            for _, gi in pairs:
                table.setdefault(golds[gi]["category"], [0, 0, 0])[0] += 1
            for pi in bad_p:
                table.setdefault(preds[pi]["category"], [0, 0, 0])[1] += 1
            for gi in bad_g:
                table.setdefault(golds[gi]["category"], [0, 0, 0])[2] += 1
            if not is_strict:
                for pi in bad_p:
                    p = preds[pi]
                    fps.append({"id": r["id"], "category": p["category"], "text": snippet(r["text"], p["start"], p["end"])})
                for gi in bad_g:
                    g = golds[gi]
                    fns.append({"id": r["id"], "category": g["category"], "text": snippet(r["text"], g["start"], g["end"])})

        group = r["tags"][0]
        if group == "hard_negative":
            kind = r["tags"][1]
            hard_flags.setdefault(kind, [0, 0])
            hard_flags[kind][0] += bool(preds)
            hard_flags[kind][1] += 1
        elif group in ("clean", "benign"):
            clean_flagged += bool(preds)
            clean_total += 1

        print(f"\r  {mode:<6} {n:>4}/{len(records)}", end="", flush=True)
    print()

    def summarise(table: dict[str, list[int]]) -> dict:
        tp = sum(v[0] for v in table.values())
        fp = sum(v[1] for v in table.values())
        fn = sum(v[2] for v in table.values())
        return prf(tp, fp, fn)

    by_category = {}
    for cat in sorted(set(lenient) | set(support)):
        tp, fp, fn = lenient.get(cat, [0, 0, 0])
        by_category[cat] = {**prf(tp, fp, fn), "support": support.get(cat, 0)}
    gold_cats = [c for c in by_category if by_category[c]["support"]]

    flagged = sum(v[0] for v in hard_flags.values())
    total = sum(v[1] for v in hard_flags.values())

    return {
        "lenient": summarise(lenient),
        "strict": summarise(strict),
        "macroF1": round(statistics.mean(by_category[c]["f1"] for c in gold_cats), 4) if gold_cats else 0.0,
        "byCategory": by_category,
        "hardNegatives": {
            "fpRate": round(flagged / total, 4) if total else 0.0, "flagged": flagged, "total": total,
            "byKind": {k: {"flagged": f, "total": t} for k, (f, t) in sorted(hard_flags.items())},
        },
        "cleanFpRate": round(clean_flagged / clean_total, 4) if clean_total else 0.0,
        "latencyMs": {
            "p50": percentile(latencies, 0.5), "p95": percentile(latencies, 0.95),
            "mean": round(statistics.mean(latencies), 1), "serverP50": percentile(server_ms, 0.5),
        },
        "fallbacks": fallbacks,
        "errors": {"falseNegatives": fns[:ERROR_SAMPLES], "falsePositives": fps[:ERROR_SAMPLES],
                   "falseNegativeCount": len(fns), "falsePositiveCount": len(fps)},
    }


def evaluate_injection(api: str, records: list[dict]) -> dict:
    scores, labels, flagged, latencies, model = [], [], [], [], None
    trigger_flags = trigger_total = 0
    for n, r in enumerate(records, 1):
        t0 = time.perf_counter()
        result = call(api, "POST", "/api/eval/scan", {"text": r["text"], "mode": "REGEX", "injectionCheck": True})
        latencies.append((time.perf_counter() - t0) * 1000)
        inj = result.get("injection")
        if inj is None:
            sys.exit(f"\nInjection check returned nothing for {r['id']} — is the ML service up?")
        model = inj["model"]
        scores.append(inj["score"])
        labels.append(r["injection"])
        flagged.append(inj["isInjection"])
        if r["tags"][0] == "benign":
            trigger_total += 1
            trigger_flags += inj["isInjection"]
        print(f"\r  INJECT {n:>4}/{len(records)}", end="", flush=True)
    print()

    tp = sum(f and y for f, y in zip(flagged, labels))
    fp = sum(f and not y for f, y in zip(flagged, labels))
    fn = sum(not f and y for f, y in zip(flagged, labels))
    tn = len(labels) - tp - fp - fn
    stats = prf(tp, fp, fn)
    return {
        "accuracy": round((tp + tn) / len(labels), 4),
        "precision": stats["precision"], "recall": stats["recall"], "f1": stats["f1"],
        "auc": roc_auc(scores, labels),
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "positives": sum(labels), "negatives": len(labels) - sum(labels),
        "benignTriggerFpRate": round(trigger_flags / trigger_total, 4) if trigger_total else 0.0,
        "model": model,
        "latencyMs": {"p50": percentile(latencies, 0.5), "p95": percentile(latencies, 0.95)},
    }


# ── Report ───────────────────────────────────────────────────────────────────

def pct(x: float) -> str:
    return f"{x * 100:.1f}%"


def highlights(modes: dict) -> dict:
    if "REGEX" not in modes or "HYBRID" not in modes:
        return {}
    r, h = modes["REGEX"], modes["HYBRID"]
    fp_r, fp_h = r["hardNegatives"]["fpRate"], h["hardNegatives"]["fpRate"]
    return {
        "f1": {"regex": r["lenient"]["f1"], "hybrid": h["lenient"]["f1"],
               "delta": round(h["lenient"]["f1"] - r["lenient"]["f1"], 4)},
        "recall": {"regex": r["lenient"]["recall"], "hybrid": h["lenient"]["recall"]},
        "precision": {"regex": r["lenient"]["precision"], "hybrid": h["lenient"]["precision"]},
        "hardNegativeFpReduction": round((fp_r - fp_h) / fp_r, 4) if fp_r else None,
        "falsePositives": {"regex": r["lenient"]["fp"], "hybrid": h["lenient"]["fp"]},
    }


def markdown(report: dict) -> str:
    modes = report["modes"]
    lines = [
        f"### Detection benchmark ({report['dataset']['records']} prompts, {report['dataset']['entities']} labelled entities)",
        "",
        "| Mode | Precision | Recall | F1 | Strict F1 | Hard-negative FP rate | p50 / p95 latency |",
        "|---|---|---|---|---|---|---|",
    ]
    for name, m in modes.items():
        lines.append(f"| {name} | {pct(m['lenient']['precision'])} | {pct(m['lenient']['recall'])} | "
                     f"**{pct(m['lenient']['f1'])}** | {pct(m['strict']['f1'])} | {pct(m['hardNegatives']['fpRate'])} | "
                     f"{m['latencyMs']['p50']:.0f} / {m['latencyMs']['p95']:.0f} ms |")

    cats = sorted({c for m in modes.values() for c, v in m["byCategory"].items() if v["support"]})
    lines += ["", "| Category (support) | " + " | ".join(f"{n} F1" for n in modes) + " |",
              "|---|" + "---|" * len(modes)]
    for c in cats:
        support = next(m["byCategory"][c]["support"] for m in modes.values() if c in m["byCategory"])
        cells = [pct(m["byCategory"].get(c, {"f1": 0})["f1"]) for m in modes.values()]
        lines.append(f"| {c} ({support}) | " + " | ".join(cells) + " |")

    inj = report.get("injection")
    if inj:
        lines += ["", f"**Prompt injection** ({inj['positives']} attacks, {inj['negatives']} benign; model `{inj['model']}`): "
                  f"accuracy {pct(inj['accuracy'])}, precision {pct(inj['precision'])}, recall {pct(inj['recall'])}, "
                  f"ROC AUC {inj['auc']}, false alarms on benign prompts with trigger words {pct(inj['benignTriggerFpRate'])}."]
    hl = report.get("highlights")
    if hl:
        red = hl["hardNegativeFpReduction"]
        lines += ["", f"Hybrid vs regex-only: F1 {pct(hl['f1']['regex'])} → {pct(hl['f1']['hybrid'])}, "
                  f"recall {pct(hl['recall']['regex'])} → {pct(hl['recall']['hybrid'])}"
                  + (f", hard-negative false positives cut by {pct(red)}." if red is not None else ".")]
    lines += ["", f"_Generated {report['generatedAt']} by `eval/run_benchmark.py`._"]
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark PromptGuard detection modes")
    parser.add_argument("--api", default="http://localhost:4000")
    parser.add_argument("--dataset", type=Path, default=DATASET)
    parser.add_argument("--modes", default=",".join(MODES))
    parser.add_argument("--limit", type=int, help="only the first N records (smoke test)")
    parser.add_argument("--skip-injection", action="store_true")
    parser.add_argument("--allow-fallback", action="store_true", help="don't stop when the ML service is unavailable")
    parser.add_argument("--out-dir", type=Path, default=RESULTS)
    args = parser.parse_args()

    modes = [m.strip().upper() for m in args.modes.split(",") if m.strip()]
    raw = args.dataset.read_bytes()
    records = [json.loads(line) for line in raw.decode("utf-8").splitlines() if line.strip()]
    if args.limit:
        records = records[:args.limit]

    try:
        health = call(args.api, "GET", "/api/health", timeout=10)
        settings = {s["key"]: s["value"] for s in call(args.api, "GET", "/api/settings")["settings"]}
    except (urllib.error.URLError, OSError) as exc:
        sys.exit(f"Backend not reachable at {args.api}: {exc}")
    if health.get("ml") != "ok" and modes != ["REGEX"] and not args.allow_fallback:
        sys.exit(f"ML service is not available (health: ml={health.get('ml')}); start it or use --modes REGEX")

    print(f"Benchmarking {len(records)} prompts × {modes} against {args.api}")
    started = time.perf_counter()
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "dataset": {
            "path": str(args.dataset.relative_to(HERE.parent)) if args.dataset.is_relative_to(HERE.parent) else str(args.dataset),
            "records": len(records),
            "entities": sum(len(r["entities"]) for r in records),
            "sha256": hashlib.sha256(raw).hexdigest()[:12],
            "groups": {g: sum(r["tags"][0] == g for r in records) for g in dict.fromkeys(r["tags"][0] for r in records)},
            "partial": bool(args.limit),
        },
        "config": {
            "api": args.api,
            "aiConfidenceThreshold": float(settings.get("ai_confidence_threshold", "0.6")),
            "models": health.get("ml_models"),
            "modes": modes,
        },
        "modes": {m: evaluate_mode(args.api, m, records, args.allow_fallback) for m in modes},
    }
    if not args.skip_injection:
        report["injection"] = evaluate_injection(args.api, records)
    report["highlights"] = highlights(report["modes"])
    report["durationSeconds"] = round(time.perf_counter() - started, 1)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "latest.json").write_text(hide_prefixes(json.dumps(report, indent=2, ensure_ascii=False)) + "\n", encoding="utf-8")
    md = markdown(report)
    (args.out_dir / "latest.md").write_text(md, encoding="utf-8")
    print()
    print(md)
    print(f"Wrote {args.out_dir / 'latest.json'} and latest.md in {report['durationSeconds']}s")


if __name__ == "__main__":
    main()
