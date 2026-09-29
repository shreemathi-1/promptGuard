import { useState, useEffect } from 'react';
import { fetchRiskSummary }    from '../api/client';
import RiskScore               from './RiskScore';

/**
 * Standalone card that fetches and displays aggregate risk analytics.
 * Used on the Health page and any future dashboard.
 *
 * Props:
 *   defaultDays — number (default 7)
 */

const WINDOW_OPTIONS = [
  { value: 1,  label: '24h'    },
  { value: 7,  label: '7 days' },
  { value: 30, label: '30 days'},
];

const CATEGORY_ICONS = {
  CREDIT_CARD  : '💳',
  SSN          : '🪪',
  PHONE        : '📞',
  EMAIL        : '📧',
  BANK_ACCOUNT : '🏦',
  PASSPORT     : '🛂',
  API_KEY      : '🔑',
  CUSTOM       : '⚙️',
};

const RISK_LEVEL_COLORS = {
  CRITICAL : 'var(--color-danger)',
  HIGH     : '#f97316',
  MEDIUM   : 'var(--color-warning)',
  LOW      : 'var(--color-success)',
  NONE     : 'var(--color-muted)',
};

// ── Mini bar chart for daily trend ───────────────────────────────────────────

function TrendBar({ trend }) {
  if (!trend || trend.length === 0) return null;

  const maxScans = Math.max(...trend.map(d => d.scanCount), 1);
  const maxRisk  = Math.max(...trend.map(d => d.avgRisk),   1);

  return (
    <div>
      <div style={{
        fontSize      : 11,
        fontWeight    : 700,
        color         : 'var(--color-muted)',
        textTransform : 'uppercase',
        letterSpacing : '0.5px',
        marginBottom  : 10,
      }}>
        Daily Trend
      </div>
      <div style={{
        display    : 'flex',
        alignItems : 'flex-end',
        gap        : 3,
        height     : 48,
      }}>
        {trend.map((day, i) => {
          const scanH = day.scanCount > 0
            ? Math.max(4, (day.scanCount / maxScans) * 40)
            : 0;
          const riskColor = day.avgRisk >= 80 ? 'var(--color-danger)'
            : day.avgRisk >= 50 ? '#f97316'
            : day.avgRisk >= 20 ? 'var(--color-warning)'
            : day.avgRisk  > 0  ? 'var(--color-success)'
            : 'var(--color-border)';

          return (
            <div
              key={day.date}
              title={`${day.date}: ${day.scanCount} scans, avg risk ${day.avgRisk}`}
              style={{
                flex        : 1,
                height      : `${scanH}px`,
                background  : riskColor,
                borderRadius: '2px 2px 0 0',
                minHeight   : day.scanCount > 0 ? 4 : 0,
                opacity     : 0.85,
                transition  : 'opacity 0.2s',
                cursor      : 'default',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '0.85')}
            />
          );
        })}
      </div>
      {/* Date labels — show first and last */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{ fontSize: 10, color: 'var(--color-muted)' }}>
          {trend[0]?.date?.slice(5)}
        </span>
        <span style={{ fontSize: 10, color: 'var(--color-muted)' }}>
          {trend[trend.length - 1]?.date?.slice(5)}
        </span>
      </div>
    </div>
  );
}

// ── Risk distribution pills ───────────────────────────────────────────────────

function DistributionBar({ distribution, total }) {
  if (!total) return null;

  const entries = Object.entries(distribution)
    .map(([level, count]) => ({ level, count }))
    .filter(e => e.count > 0);

  return (
    <div>
      <div style={{
        fontSize      : 11,
        fontWeight    : 700,
        color         : 'var(--color-muted)',
        textTransform : 'uppercase',
        letterSpacing : '0.5px',
        marginBottom  : 8,
      }}>
        Risk Distribution
      </div>
      {/* Stacked bar */}
      <div style={{
        display      : 'flex',
        height       : 8,
        borderRadius : 4,
        overflow     : 'hidden',
        marginBottom : 8,
        gap          : 1,
      }}>
        {entries.map(({ level, count }) => (
          <div
            key={level}
            title={`${level}: ${count}`}
            style={{
              flex       : count,
              background : RISK_LEVEL_COLORS[level] ?? 'var(--color-border)',
            }}
          />
        ))}
      </div>
      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
        {entries.map(({ level, count }) => (
          <span key={level} style={{ fontSize: 11, color: 'var(--color-muted)' }}>
            <span style={{ color: RISK_LEVEL_COLORS[level], fontWeight: 700 }}>●</span>
            {' '}{level} ({count})
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Main card ─────────────────────────────────────────────────────────────────

export default function RiskSummaryCard({ defaultDays = 7 }) {
  const [days,    setDays]    = useState(defaultDays);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchRiskSummary(days);
        setSummary(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [days]);

  return (
    <div className="card">
      {/* Card header */}
      <div style={{
        display        : 'flex',
        justifyContent : 'space-between',
        alignItems     : 'center',
        marginBottom   : 20,
        flexWrap       : 'wrap',
        gap            : 8,
      }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Risk Analytics</div>

        {/* Window selector */}
        <div style={{
          display      : 'flex',
          background   : 'var(--color-bg)',
          border       : '1px solid var(--color-border)',
          borderRadius : 6,
          overflow     : 'hidden',
        }}>
          {WINDOW_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setDays(opt.value)}
              style={{
                background   : days === opt.value ? 'var(--color-primary-dim)' : 'transparent',
                color        : days === opt.value ? 'var(--color-primary)' : 'var(--color-muted)',
                border       : 'none',
                borderRight  : '1px solid var(--color-border)',
                padding      : '5px 12px',
                fontSize     : 12,
                fontWeight   : days === opt.value ? 700 : 500,
                cursor       : 'pointer',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {loading && !summary && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--color-muted)', fontSize: 13 }}>
          Loading analytics…
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--color-danger)', fontSize: 13 }}>⚠ {error}</div>
      )}

      {summary && (
        <div style={{ opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s' }}>

          {/* Top stat row */}
          <div style={{
            display             : 'grid',
            gridTemplateColumns : 'repeat(auto-fit, minmax(100px, 1fr))',
            gap                 : 10,
            marginBottom        : 20,
          }}>
            {[
              { label: 'Scans',      value: summary.totals.scans,      color: 'var(--color-primary)' },
              { label: 'Detections', value: summary.totals.detections, color: '#f97316'              },
              { label: 'Mask Ops',   value: summary.totals.maskedOps,  color: 'var(--color-text-dim)'},
              { label: 'Avg Risk',   value: summary.averageRisk,       color: summary.averageRisk >= 50 ? 'var(--color-danger)' : summary.averageRisk >= 20 ? 'var(--color-warning)' : 'var(--color-success)' },
            ].map(s => (
              <div key={s.label} style={{
                background   : 'var(--color-bg)',
                border       : '1px solid var(--color-border)',
                borderRadius : 6,
                padding      : '10px 12px',
                textAlign    : 'center',
              }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1 }}>
                  {s.value}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          {/* Daily trend chart */}
          <div style={{ marginBottom: 20 }}>
            <TrendBar trend={summary.dailyTrend} />
          </div>

          <hr className="divider" />

          {/* Risk distribution */}
          <div style={{ marginBottom: 20 }}>
            <DistributionBar
              distribution={summary.riskDistribution}
              total={summary.totals.scans}
            />
          </div>

          {/* Top categories */}
          {summary.topCategories.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{
                fontSize      : 11,
                fontWeight    : 700,
                color         : 'var(--color-muted)',
                textTransform : 'uppercase',
                letterSpacing : '0.5px',
                marginBottom  : 8,
              }}>
                Top Categories
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {summary.topCategories.map(cat => (
                  <div key={cat.category} style={{
                    display        : 'flex',
                    alignItems     : 'center',
                    gap            : 8,
                  }}>
                    <span style={{ fontSize: 14, flexShrink: 0 }}>
                      {CATEGORY_ICONS[cat.category] ?? '🔍'}
                    </span>
                    <span style={{ fontSize: 12, flex: 1 }}>{cat.category}</span>
                    {/* Bar */}
                    <div style={{
                      width        : 80,
                      height       : 5,
                      background   : 'var(--color-border)',
                      borderRadius : 3,
                      overflow     : 'hidden',
                    }}>
                      <div style={{
                        width      : `${cat.percentage}%`,
                        height     : '100%',
                        background : 'var(--color-primary)',
                        borderRadius: 3,
                      }} />
                    </div>
                    <span style={{
                      fontSize   : 11,
                      color      : 'var(--color-muted)',
                      fontFamily : 'var(--font-mono)',
                      minWidth   : 28,
                      textAlign  : 'right',
                    }}>
                      {cat.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No data state */}
          {summary.totals.scans === 0 && (
            <div style={{
              textAlign : 'center',
              padding   : '20px 0',
              color     : 'var(--color-muted)',
              fontSize  : 13,
            }}>
              No events in the last {days} day{days > 1 ? 's' : ''}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}