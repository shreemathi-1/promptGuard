/**
 * Renders a 0–100 risk score as a coloured badge + mini bar.
 * Used in the audit log table and detail drawer.
 *
 * Props:
 *   score  — number 0–100
 *   showBar — bool (default true)
 */

function getRiskMeta(score) {
  if (score >= 80) return { label: 'Critical', color: 'var(--color-danger)',  bg: '#450a0a' };
  if (score >= 50) return { label: 'High',     color: '#f97316',              bg: '#431407' };
  if (score >= 20) return { label: 'Medium',   color: 'var(--color-warning)', bg: '#422006' };
  if (score >  0)  return { label: 'Low',      color: 'var(--color-success)', bg: '#052e16' };
  return                   { label: 'None',    color: 'var(--color-muted)',   bg: 'var(--color-surface)' };
}

export default function RiskScore({ score, showBar = true }) {
  const meta = getRiskMeta(score);

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {/* Numeric badge */}
      <span style={{
        background   : meta.bg,
        color        : meta.color,
        borderRadius : 5,
        padding      : '2px 8px',
        fontSize     : 12,
        fontWeight   : 800,
        fontFamily   : 'var(--font-mono)',
        minWidth     : 36,
        textAlign    : 'center',
      }}>
        {score}
      </span>

      {/* Bar */}
      {showBar && (
        <div style={{
          width        : 56,
          height       : 5,
          borderRadius : 3,
          background   : 'var(--color-border)',
          overflow     : 'hidden',
        }}>
          <div style={{
            width      : `${score}%`,
            height     : '100%',
            background : meta.color,
            borderRadius: 3,
            transition : 'width 0.3s ease',
          }} />
        </div>
      )}

      {/* Label */}
      <span style={{ fontSize: 11, color: meta.color, fontWeight: 600 }}>
        {meta.label}
      </span>
    </div>
  );
}