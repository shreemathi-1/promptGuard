import { useState } from 'react';
import useElementWidth from '../hooks/useElementWidth';
import { pct } from '../utils/format';

/**
 * Small SVG charts for the Benchmark page.
 *
 * Conventions (dataviz method): one axis, thin marks (≤ 24px bars, 4px rounded
 * data-end, square at the baseline), 2px surface gap between touching bars,
 * hairline recessive grid, legend for ≥ 2 series, sparing direct labels, text in
 * text tokens (never the series colour), and a hover tooltip on every mark.
 * Series colours come from --series-1..3 in index.css, in fixed mode order.
 */

const FONT = 'var(--font-sans)';

// ── Tooltip ───────────────────────────────────────────────────────────────────

function useTooltip() {
  const [tip, setTip] = useState(null);   // { x, y, title, rows: [[label, value]] }
  const show = (event, title, rows) => setTip({ x: event.clientX, y: event.clientY, title, rows });
  const hide = () => setTip(null);
  return { tip, show, hide };
}

function Tooltip({ tip }) {
  if (!tip) return null;
  return (
    <div
      role="tooltip"
      style={{
        position      : 'fixed',
        left          : Math.min(tip.x + 14, window.innerWidth - 220),
        top           : tip.y + 14,
        zIndex        : 50,
        pointerEvents : 'none',
        background    : 'var(--color-surface)',
        border        : '1px solid var(--color-border)',
        borderRadius  : 6,
        boxShadow     : '0 4px 14px rgba(0,0,0,0.12)',
        padding       : '8px 10px',
        fontSize      : 12,
        minWidth      : 150,
      }}
    >
      <div style={{ fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>{tip.title}</div>
      {tip.rows.map(([label, value]) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, color: 'var(--color-text-dim)' }}>
          <span>{label}</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text)' }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────

export function Legend({ series }) {
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: 'var(--color-text-dim)' }}>
      {series.map(s => (
        <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** Path for a bar with a 4px rounded data-end and a square baseline end. */
function barPath(x, y, w, h, direction) {
  const r = Math.min(4, w / 2, h);
  if (h <= 0 || w <= 0) return '';
  if (direction === 'up') {
    // baseline at y + h
    return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
  }
  // 'right': baseline at x, data-end at x + w
  return `M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x} Z`;
}

// ── Grouped column chart (0–100%) ─────────────────────────────────────────────

/**
 * Props:
 *   groups      — [{ key, label, values: { [seriesKey]: 0..1 } }]
 *   series      — [{ key, label, color }]
 *   labelGroup  — group key whose columns get direct value labels
 *   height      — plot height in px
 */
export function GroupedColumnChart({ groups, series, labelGroup, height = 220 }) {
  const [ref, width] = useElementWidth();
  const { tip, show, hide } = useTooltip();

  const margin = { top: 22, right: 8, bottom: 28, left: 40 };
  const plotW = Math.max(0, width - margin.left - margin.right);
  const plotH = height;
  const band = groups.length ? plotW / groups.length : 0;
  const barW = Math.min(24, Math.max(6, (band * 0.6 - 2 * (series.length - 1)) / series.length));
  const clusterW = barW * series.length + 2 * (series.length - 1);
  const y = v => plotH - v * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div ref={ref} style={{ width: '100%' }}>
      {width > 0 && (
        <svg width={width} height={plotH + margin.top + margin.bottom} role="img"
             aria-label="Precision, recall and F1 by detection mode" style={{ fontFamily: FONT, display: 'block' }}>
          <g transform={`translate(${margin.left},${margin.top})`}>
            {ticks.map(t => (
              <g key={t}>
                <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
                <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-muted)">
                  {Math.round(t * 100)}%
                </text>
              </g>
            ))}

            {groups.map((g, gi) => {
              const x0 = gi * band + (band - clusterW) / 2;
              return (
                <g key={g.key}>
                  {series.map((s, si) => {
                    const v = g.values[s.key] ?? 0;
                    const x = x0 + si * (barW + 2);
                    return (
                      <g key={s.key}>
                        <path d={barPath(x, y(v), barW, plotH - y(v), 'up')} fill={s.color} />
                        {/* Hit target taller than the mark */}
                        <rect
                          x={x - 1} y={0} width={barW + 2} height={plotH} fill="transparent"
                          onMouseMove={e => show(e, `${s.label} · ${g.label}`, [[g.label, pct(v)]])}
                          onMouseLeave={hide}
                        />
                        {g.key === labelGroup && (
                          <text x={x + barW / 2} y={y(v) - 6} textAnchor="middle" fontSize={11}
                                fontWeight={700} fill="var(--color-text)">
                            {Math.round(v * 100)}
                          </text>
                        )}
                      </g>
                    );
                  })}
                  <text x={gi * band + band / 2} y={plotH + 18} textAnchor="middle" fontSize={12} fill="var(--color-text-dim)">
                    {g.label}
                  </text>
                </g>
              );
            })}
            <line x1={0} x2={plotW} y1={plotH} y2={plotH} stroke="var(--color-border)" strokeWidth={1} />
          </g>
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

// ── Grouped horizontal bars (0–100%) ──────────────────────────────────────────

/**
 * Props:
 *   rows    — [{ key, label, values: { [seriesKey]: { rate, flagged, total } } }]
 *   series  — [{ key, label, color }]
 */
export function GroupedBarChart({ rows, series }) {
  const [ref, width] = useElementWidth();
  const { tip, show, hide } = useTooltip();

  const labelW = Math.min(150, Math.max(90, width * 0.28));
  const valueW = 12;
  const plotW = Math.max(0, width - labelW - valueW);
  const barH = 8;
  const rowH = series.length * barH + (series.length - 1) * 2 + 14;
  const height = rows.length * rowH + 20;
  const x = v => v * plotW;

  return (
    <div ref={ref} style={{ width: '100%' }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="False-positive rate on look-alike prompts"
             style={{ fontFamily: FONT, display: 'block' }}>
          <g transform={`translate(${labelW},0)`}>
            {[0, 0.5, 1].map(t => (
              <g key={t}>
                <line x1={x(t)} x2={x(t)} y1={0} y2={rows.length * rowH} stroke="var(--chart-grid)" strokeWidth={1} />
                <text x={x(t)} y={rows.length * rowH + 14} textAnchor="middle" fontSize={11} fill="var(--color-muted)">
                  {Math.round(t * 100)}%
                </text>
              </g>
            ))}
          </g>

          {rows.map((row, ri) => {
            const top = ri * rowH + 7;
            return (
              <g key={row.key}>
                <text x={labelW - 10} y={top + (rowH - 14) / 2} dy="0.32em" textAnchor="end" fontSize={12} fill="var(--color-text-dim)">
                  {row.label}
                </text>
                {series.map((s, si) => {
                  const cell = row.values[s.key];
                  if (!cell) return null;
                  const yy = top + si * (barH + 2);
                  return (
                    <g key={s.key}>
                      {cell.rate > 0
                        ? <path d={barPath(labelW, yy, x(cell.rate), barH, 'right')} fill={s.color} />
                        : <rect x={labelW} y={yy} width={2} height={barH} fill={s.color} />}
                      <rect
                        x={labelW} y={yy - 1} width={plotW + valueW} height={barH + 2} fill="transparent"
                        onMouseMove={e => show(e, `${s.label} · ${row.label}`, [
                          ['Flagged', `${cell.flagged} of ${cell.total}`],
                          ['False-positive rate', pct(cell.rate, 0)],
                        ])}
                        onMouseLeave={hide}
                      />
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

// ── Heatmap table (per-category F1) ───────────────────────────────────────────

const SEQ_STEPS = [
  { min: 0.95, bg: 'var(--seq-600)', ink: '#ffffff' },
  { min: 0.85, bg: 'var(--seq-500)', ink: '#ffffff' },
  { min: 0.70, bg: 'var(--seq-400)', ink: '#ffffff' },
  { min: 0.50, bg: 'var(--seq-300)', ink: 'var(--color-text)' },
  { min: 0.25, bg: 'var(--seq-200)', ink: 'var(--color-text)' },
  { min: 0.0001, bg: 'var(--seq-100)', ink: 'var(--color-text)' },
];

function seqStep(value) {
  return SEQ_STEPS.find(s => value >= s.min) ?? { bg: 'var(--color-surface-alt)', ink: 'var(--color-muted)' };
}

/**
 * Props:
 *   rows    — [{ key, label, support, cells: { [seriesKey]: { f1, precision, recall, tp, fp, fn } } }]
 *   series  — [{ key, label, color }]
 */
export function HeatmapTable({ rows, series }) {
  const { tip, show, hide } = useTooltip();

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 2, fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--color-muted)', fontWeight: 600 }}>Category</th>
            <th style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--color-muted)', fontWeight: 600 }}>Labelled</th>
            {series.map(s => (
              <th key={s.key} style={{ padding: '4px 8px', color: 'var(--color-muted)', fontWeight: 600 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
                  {s.label} F1
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.key}>
              <td style={{ padding: '6px 8px', color: 'var(--color-text)', whiteSpace: 'nowrap' }}>{row.label}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
                {row.support}
              </td>
              {series.map(s => {
                const c = row.cells[s.key];
                const step = seqStep(c?.f1 ?? 0);
                return (
                  <td
                    key={s.key}
                    onMouseMove={e => c && show(e, `${row.label} · ${s.label}`, [
                      ['F1', pct(c.f1)], ['Precision', pct(c.precision)], ['Recall', pct(c.recall)],
                      ['Found / missed / false', `${c.tp} / ${c.fn} / ${c.fp}`],
                    ])}
                    onMouseLeave={hide}
                    style={{
                      background   : step.bg,
                      color        : step.ink,
                      textAlign    : 'center',
                      padding      : '6px 8px',
                      borderRadius : 4,
                      fontFamily   : 'var(--font-mono)',
                      fontWeight   : 600,
                      minWidth     : 70,
                      cursor       : 'default',
                    }}
                  >
                    {c ? pct(c.f1, 0) : '—'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <Tooltip tip={tip} />
    </div>
  );
}
