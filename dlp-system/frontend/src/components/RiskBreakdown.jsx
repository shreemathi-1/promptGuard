import SeverityTag from './SeverityTag';

/**
 * Visual breakdown of a ScoreResult from the risk scorer.
 *
 * Props:
 *   scoreResult — { score, level, color, breakdown }
 *   compact     — bool (default false) — smaller layout for inline use
 */

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

const SEVERITY_COLORS = {
  CRITICAL : 'var(--color-danger)',
  HIGH     : '#f97316',
  MEDIUM   : 'var(--color-warning)',
  LOW      : 'var(--color-success)',
  NONE     : 'var(--color-muted)',
};

// ── Donut ring (SVG) ──────────────────────────────────────────────────────────

function ScoreDonut({ score, color, level }) {
  const SIZE   = 88;
  const STROKE = 8;
  const R      = (SIZE - STROKE) / 2;
  const CIRC   = 2 * Math.PI * R;
  const offset = CIRC - (score / 100) * CIRC;

  return (
    <div style={{ position: 'relative', width: SIZE, height: SIZE, flexShrink: 0 }}>
      <svg width={SIZE} height={SIZE} style={{ transform: 'rotate(-90deg)' }}>
        {/* Track */}
        <circle
          cx={SIZE / 2} cy={SIZE / 2} r={R}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={STROKE}
        />
        {/* Fill */}
        <circle
          cx={SIZE / 2} cy={SIZE / 2} r={R}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      {/* Label inside */}
      <div style={{
        position  : 'absolute',
        inset     : 0,
        display   : 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <span style={{
          fontSize   : 20,
          fontWeight : 900,
          color,
          lineHeight : 1,
          fontFamily : 'var(--font-mono)',
        }}>
          {score}
        </span>
        <span style={{ fontSize: 9, color: 'var(--color-muted)', marginTop: 2, fontWeight: 600 }}>
          {level}
        </span>
      </div>
    </div>
  );
}

// ── Category bar row ──────────────────────────────────────────────────────────

function CategoryRow({ item, maxContribution }) {
  const pct = maxContribution > 0
    ? Math.round((item.contribution / maxContribution) * 100)
    : 0;

  const color = SEVERITY_COLORS[item.topSeverity] ?? 'var(--color-primary)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      {/* Icon + name */}
      <span style={{ fontSize: 14, flexShrink: 0 }}>
        {CATEGORY_ICONS[item.category] ?? '🔍'}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display        : 'flex',
          justifyContent : 'space-between',
          alignItems     : 'center',
          marginBottom   : 3,
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>
            {item.category}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
              ×{item.count}
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color, fontFamily: 'var(--font-mono)' }}>
              +{item.contribution}
            </span>
          </div>
        </div>
        {/* Bar */}
        <div style={{
          height       : 5,
          background   : 'var(--color-border)',
          borderRadius : 3,
          overflow     : 'hidden',
        }}>
          <div style={{
            width        : `${pct}%`,
            height       : '100%',
            background   : color,
            borderRadius : 3,
            transition   : 'width 0.4s ease',
          }} />
        </div>
      </div>
    </div>
  );
}

// ── Severity pill row ─────────────────────────────────────────────────────────

function SeverityRow({ item }) {
  return (
    <div style={{
      display        : 'flex',
      justifyContent : 'space-between',
      alignItems     : 'center',
      padding        : '5px 0',
      borderBottom   : '1px solid var(--color-border)',
    }}>
      <SeverityTag severity={item.severity} />
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--color-text-dim)' }}>
        <span>{item.count} detection{item.count !== 1 ? 's' : ''}</span>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-muted)' }}>
          {item.basePoints} base pts
        </span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RiskBreakdown({ scoreResult, compact = false }) {
  if (!scoreResult) return null;

  const { score, level, color, breakdown } = scoreResult;
  const { byCategory, bySeverity, totalDetections } = breakdown;

  const maxContribution = byCategory.length > 0
    ? byCategory[0].contribution   // already sorted desc
    : 0;

  if (compact) {
    // ── Compact inline mode ───────────────────────────────────────────────
    return (
      <div style={{
        display    : 'flex',
        alignItems : 'center',
        gap        : 16,
        padding    : '12px 16px',
        background : 'var(--color-bg)',
        border     : `1px solid ${color}44`,
        borderRadius: 'var(--radius)',
      }}>
        <ScoreDonut score={score} color={color} level={level} />

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
            Risk Score:{' '}
            <span style={{ color }}>{score}/100 — {level}</span>
          </div>
          <div style={{
            display  : 'flex',
            flexWrap : 'wrap',
            gap      : 6,
          }}>
            {byCategory.slice(0, 4).map(item => (
              <span key={item.category} style={{
                fontSize     : 11,
                background   : 'var(--color-surface)',
                border       : '1px solid var(--color-border)',
                borderRadius : 4,
                padding      : '2px 7px',
                color        : 'var(--color-text-dim)',
              }}>
                {CATEGORY_ICONS[item.category] ?? '🔍'} {item.category} ×{item.count}
              </span>
            ))}
            {byCategory.length > 4 && (
              <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>
                +{byCategory.length - 4} more
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Full mode ─────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Score header */}
      <div style={{
        display    : 'flex',
        alignItems : 'center',
        gap        : 20,
        padding    : '16px 0',
        marginBottom: 16,
        borderBottom: '1px solid var(--color-border)',
      }}>
        <ScoreDonut score={score} color={color} level={level} />

        <div>
          <div style={{ fontSize: 22, fontWeight: 900, color, marginBottom: 2 }}>
            {score} / 100
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-dim)', marginBottom: 6 }}>
            Risk Level: <strong style={{ color }}>{level}</strong>
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>
            {totalDetections} detection{totalDetections !== 1 ? 's' : ''} across{' '}
            {byCategory.length} categor{byCategory.length !== 1 ? 'ies' : 'y'}
          </div>
        </div>
      </div>

      {/* Category breakdown */}
      {byCategory.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{
            fontSize      : 11,
            fontWeight    : 700,
            color         : 'var(--color-muted)',
            textTransform : 'uppercase',
            letterSpacing : '0.5px',
            marginBottom  : 10,
          }}>
            By Category
          </div>
          {byCategory.map(item => (
            <CategoryRow
              key={item.category}
              item={item}
              maxContribution={maxContribution}
            />
          ))}
        </div>
      )}

      {/* Severity breakdown */}
      {bySeverity.length > 0 && (
        <div>
          <div style={{
            fontSize      : 11,
            fontWeight    : 700,
            color         : 'var(--color-muted)',
            textTransform : 'uppercase',
            letterSpacing : '0.5px',
            marginBottom  : 8,
          }}>
            By Severity
          </div>
          {bySeverity.map(item => (
            <SeverityRow key={item.severity} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}