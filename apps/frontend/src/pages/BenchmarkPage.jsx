import { useEffect, useState } from 'react';
import { fetchBenchmarkResults } from '../api/client';
import PageHeader from '../components/PageHeader';
import { GroupedBarChart, GroupedColumnChart, HeatmapTable, Legend } from '../components/BenchmarkCharts';
import { pct } from '../utils/format';

/**
 * Benchmark: how REGEX, AI and HYBRID detection compare on the labelled
 * dataset (eval/data/dataset.jsonl), as measured by eval/run_benchmark.py.
 */

// Fixed mode order → fixed colour slot (colour follows the mode, never its rank)
const SERIES = [
  { key: 'REGEX',  label: 'Regex',  color: 'var(--series-1)' },
  { key: 'AI',     label: 'AI',     color: 'var(--series-2)' },
  { key: 'HYBRID', label: 'Hybrid', color: 'var(--series-3)' },
];

const KIND_LABELS = {
  order_id  : 'Order / tracking IDs',
  bad_card  : 'Luhn-invalid invoices',
  timestamp : 'Epoch timestamps',
  git_sha   : 'Git commit SHAs',
  version   : 'Version strings',
  ticket    : 'SSN-shaped tickets',
  sku       : 'Phone-shaped SKUs',
  txn       : 'Transaction IDs',
};

const sectionLabel = {
  fontSize      : 11,
  fontWeight    : 700,
  color         : 'var(--color-muted)',
  textTransform : 'uppercase',
  letterSpacing : '0.5px',
  marginBottom  : 4,
};

const cell = { padding: '7px 10px', borderBottom: '1px solid var(--color-border)', fontSize: 12 };
const num  = { ...cell, textAlign: 'right', fontFamily: 'var(--font-mono)' };

// ── Pieces ────────────────────────────────────────────────────────────────────

function Card({ title, subtitle, legend, children }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 2 }}>{subtitle}</div>}
        </div>
        {legend}
      </div>
      {children}
    </div>
  );
}

function StatTile({ label, value, delta, deltaGood }) {
  return (
    <div style={{
      background   : 'var(--color-surface)',
      border       : '1px solid var(--color-border)',
      borderRadius : 'var(--radius)',
      padding      : '12px 14px',
    }}>
      <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.3 }}>{value}</div>
      {delta && (
        <div style={{ fontSize: 12, fontWeight: 600, color: deltaGood ? 'var(--color-success)' : 'var(--color-danger)' }}>
          {deltaGood ? '▲' : '▼'} {delta}
        </div>
      )}
    </div>
  );
}

function TableView({ children }) {
  return (
    <details style={{ marginTop: 10 }}>
      <summary style={{ fontSize: 12, color: 'var(--color-primary)', cursor: 'pointer', fontWeight: 600 }}>
        Show as table
      </summary>
      <div style={{ overflowX: 'auto', marginTop: 8 }}>{children}</div>
    </details>
  );
}

function ErrorList({ title, items, total }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={sectionLabel}>{title} ({total})</div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>None 🎉</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map((e, i) => {
            const [before, rest] = e.text.split('⟦');
            const [hit, after] = (rest ?? '').split('⟧');
            return (
              <li key={`${e.id}-${i}`} style={{ fontSize: 12, lineHeight: 1.6 }}>
                <span className="tag" style={{ background: 'var(--color-surface-alt)', color: 'var(--color-text-dim)', marginRight: 6 }}>
                  {e.category}
                </span>
                <span className="mono" style={{ color: 'var(--color-text-dim)' }}>
                  {before}
                  <mark style={{ background: '#fdf3e1', color: 'var(--color-text)', borderRadius: 3, padding: '0 2px', fontWeight: 700 }}>
                    {hit}
                  </mark>
                  {after}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {total > items.length && (
        <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 6 }}>
          Showing {items.length} of {total} — the full list is in eval/results/latest.json
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BenchmarkPage() {
  const [report,    setReport]    = useState(null);
  const [error,     setError]     = useState(null);
  const [errorMode, setErrorMode] = useState('HYBRID');

  useEffect(() => {
    let cancelled = false;
    fetchBenchmarkResults()
      .then(data => { if (!cancelled) setReport(data); })
      .catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div>
        <PageHeader title="Benchmark" />
        <div className="card" style={{ fontSize: 13, color: 'var(--color-text-dim)' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>No benchmark results to show</div>
          <div style={{ marginBottom: 10 }}>{error}</div>
          <code className="mono" style={{ fontSize: 12, background: 'var(--color-bg)', padding: '6px 10px', borderRadius: 4, display: 'inline-block' }}>
            python3 eval/run_benchmark.py
          </code>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div>
        <PageHeader title="Benchmark" />
        <div style={{ color: 'var(--color-muted)', fontSize: 13 }}>Loading results…</div>
      </div>
    );
  }

  const modes = SERIES.filter(s => report.modes[s.key]);
  const m = report.modes;
  const hl = report.highlights ?? {};
  const inj = report.injection;
  const hybrid = m.HYBRID;

  const metricGroups = [
    { key: 'precision', label: 'Precision' },
    { key: 'recall',    label: 'Recall' },
    { key: 'f1',        label: 'F1' },
  ].map(g => ({ ...g, values: Object.fromEntries(modes.map(s => [s.key, m[s.key].lenient[g.key]])) }));

  const kinds = Object.keys(modes.length ? m[modes[0].key].hardNegatives.byKind : {});
  const hardRows = kinds.map(kind => ({
    key    : kind,
    label  : KIND_LABELS[kind] ?? kind,
    values : Object.fromEntries(modes.map(s => {
      const { flagged, total } = m[s.key].hardNegatives.byKind[kind];
      return [s.key, { flagged, total, rate: total ? flagged / total : 0 }];
    })),
  }));

  const categories = [...new Set(modes.flatMap(s => Object.keys(m[s.key].byCategory)))]
    .map(cat => {
      const support = Math.max(...modes.map(s => m[s.key].byCategory[cat]?.support ?? 0));
      return { key: cat, label: cat, support, cells: Object.fromEntries(modes.map(s => [s.key, m[s.key].byCategory[cat]])) };
    })
    .filter(r => r.support > 0)
    .sort((a, b) => b.support - a.support);

  const errors = m[errorMode]?.errors;

  return (
    <div>
      <PageHeader
        title="Benchmark"
        subtitle={`${report.dataset.records} synthetic prompts · ${report.dataset.entities} labelled values · run ${new Date(report.generatedAt).toLocaleString()}`}
      />

      {report.dataset.partial && (
        <div style={{ background: '#fdf3e1', border: '1px solid var(--color-warning)', borderRadius: 'var(--radius)', padding: '8px 12px', fontSize: 12, color: 'var(--color-warning)', marginBottom: 16 }}>
          ⚠ This run used only part of the dataset (--limit), so the numbers are a smoke test, not the full benchmark.
        </div>
      )}

      {/* ── Headline ── */}
      {hybrid && (
        <div className="card" style={{ marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, alignItems: 'stretch' }}>
          <div style={{ padding: '4px 6px' }}>
            <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>Hybrid detection F1</div>
            <div style={{ fontSize: 48, fontWeight: 700, color: 'var(--color-text)', lineHeight: 1.1 }}>{pct(hybrid.lenient.f1)}</div>
            {hl.f1 && (
              <div style={{ fontSize: 12, color: 'var(--color-text-dim)' }}>
                vs {pct(hl.f1.regex)} with regex rules alone
              </div>
            )}
          </div>
          {hl.f1 && (
            <StatTile label="F1 gain over regex-only" value={`+${(hl.f1.delta * 100).toFixed(1)} pts`} />
          )}
          {hl.hardNegativeFpReduction != null && (
            <StatTile
              label="Look-alike false positives"
              value={pct(hybrid.hardNegatives.fpRate, 0)}
              delta={`${pct(hl.hardNegativeFpReduction, 0)} fewer than regex-only`}
              deltaGood
            />
          )}
          {inj?.auc != null && <StatTile label="Injection ROC AUC" value={inj.auc.toFixed(3)} />}
          <StatTile label="Hybrid latency p50 / p95" value={`${Math.round(hybrid.latencyMs.p50)} / ${Math.round(hybrid.latencyMs.p95)} ms`} />
        </div>
      )}

      {/* ── P / R / F1 ── */}
      <Card
        title="Detection quality by mode"
        subtitle="Span-level, micro-averaged over all categories (a detection counts if it overlaps a labelled value of the same category)"
        legend={<Legend series={modes} />}
      >
        <GroupedColumnChart groups={metricGroups} series={modes} labelGroup="f1" />
        <TableView>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Mode', 'Precision', 'Recall', 'F1', 'Strict F1', 'Macro F1', 'Found', 'Missed', 'False', 'Look-alike FP', 'p50', 'p95'].map((h, i) => (
                  <th key={h} style={{ ...cell, textAlign: i ? 'right' : 'left', color: 'var(--color-muted)', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modes.map(s => {
                const r = m[s.key];
                return (
                  <tr key={s.key}>
                    <td style={cell}>{s.label}</td>
                    <td style={num}>{pct(r.lenient.precision)}</td>
                    <td style={num}>{pct(r.lenient.recall)}</td>
                    <td style={{ ...num, fontWeight: 700 }}>{pct(r.lenient.f1)}</td>
                    <td style={num}>{pct(r.strict.f1)}</td>
                    <td style={num}>{pct(r.macroF1)}</td>
                    <td style={num}>{r.lenient.tp}</td>
                    <td style={num}>{r.lenient.fn}</td>
                    <td style={num}>{r.lenient.fp}</td>
                    <td style={num}>{pct(r.hardNegatives.fpRate, 0)}</td>
                    <td style={num}>{Math.round(r.latencyMs.p50)} ms</td>
                    <td style={num}>{Math.round(r.latencyMs.p95)} ms</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableView>
      </Card>

      {/* ── Hard negatives ── */}
      {hardRows.length > 0 && (
        <Card
          title="False positives on look-alike data"
          subtitle="Share of prompts flagged that contain nothing sensitive, only values shaped like card numbers, Aadhaar, phones or keys"
          legend={<Legend series={modes} />}
        >
          <GroupedBarChart rows={hardRows} series={modes} />
          <TableView>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...cell, textAlign: 'left', color: 'var(--color-muted)', fontWeight: 600 }}>Look-alike</th>
                  {modes.map(s => <th key={s.key} style={{ ...cell, textAlign: 'right', color: 'var(--color-muted)', fontWeight: 600 }}>{s.label} flagged</th>)}
                </tr>
              </thead>
              <tbody>
                {hardRows.map(r => (
                  <tr key={r.key}>
                    <td style={cell}>{r.label}</td>
                    {modes.map(s => <td key={s.key} style={num}>{r.values[s.key].flagged} / {r.values[s.key].total}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableView>
        </Card>
      )}

      {/* ── Per category ── */}
      <Card title="F1 by category" subtitle="Darker is better. Hover a cell for precision, recall and counts.">
        <HeatmapTable rows={categories} series={modes} />
      </Card>

      {/* ── Injection ── */}
      {inj && (
        <Card
          title="Prompt-injection detection"
          subtitle={`${inj.positives} attacks vs ${inj.negatives} non-attacks · ${inj.model}`}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 12 }}>
            <StatTile label="Accuracy"  value={pct(inj.accuracy)} />
            <StatTile label="Precision" value={pct(inj.precision)} />
            <StatTile label="Recall"    value={pct(inj.recall)} />
            <StatTile label="ROC AUC"   value={inj.auc != null ? inj.auc.toFixed(3) : '—'} />
            <StatTile label="False alarms on tricky benign prompts" value={pct(inj.benignTriggerFpRate, 0)} />
          </div>
          <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={cell} />
                <th style={{ ...cell, color: 'var(--color-muted)', fontWeight: 600 }}>Flagged</th>
                <th style={{ ...cell, color: 'var(--color-muted)', fontWeight: 600 }}>Not flagged</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th style={{ ...cell, textAlign: 'left', color: 'var(--color-muted)', fontWeight: 600 }}>Attack</th>
                <td style={num}>{inj.tp}</td>
                <td style={num}>{inj.fn}</td>
              </tr>
              <tr>
                <th style={{ ...cell, textAlign: 'left', color: 'var(--color-muted)', fontWeight: 600 }}>Not an attack</th>
                <td style={num}>{inj.fp}</td>
                <td style={num}>{inj.tn}</td>
              </tr>
            </tbody>
          </table>
          {inj.auc > 0.95 && inj.recall < 0.8 && (
            <p style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 10, marginBottom: 0 }}>
              A high AUC with lower recall means the scores rank attacks well, but the decision rule flags only the
              most certain ones: scores from the model alone are capped unless a keyword heuristic agrees, which
              trades missed attacks for fewer false alarms.
            </p>
          )}
        </Card>
      )}

      {/* ── Errors ── */}
      {errors && (
        <Card
          title="Where each mode goes wrong"
          subtitle="Sample misses and false alarms; the flagged or missed value is highlighted"
          legend={
            <div style={{ display: 'flex', gap: 4 }}>
              {modes.map(s => (
                <button
                  key={s.key}
                  className="btn btn-ghost"
                  onClick={() => setErrorMode(s.key)}
                  style={{
                    fontSize    : 12,
                    padding     : '4px 12px',
                    background  : errorMode === s.key ? 'var(--color-primary-dim)' : 'transparent',
                    borderColor : errorMode === s.key ? 'var(--color-primary)' : 'var(--color-border)',
                    fontWeight  : errorMode === s.key ? 700 : 500,
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          }
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
            <ErrorList title="Missed" items={errors.falseNegatives} total={errors.falseNegativeCount} />
            <ErrorList title="False alarms" items={errors.falsePositives} total={errors.falsePositiveCount} />
          </div>
        </Card>
      )}

      <p style={{ fontSize: 12, color: 'var(--color-muted)' }}>
        Re-run with <code className="mono">python3 eval/run_benchmark.py</code> (dataset sha {report.dataset.sha256},
        AI confidence threshold {report.config.aiConfidenceThreshold}, {report.durationSeconds}s).
      </p>
    </div>
  );
}
