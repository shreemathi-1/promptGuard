/**
 * Segmented control for the detection engine used by /api/scan and /api/mask.
 *
 * Props:
 *   value    — 'REGEX' | 'AI' | 'HYBRID'
 *   onChange — (mode) => void
 *   disabled — bool
 */

const DETECTION_MODES = [
  { value: 'REGEX',  label: 'Regex',  hint: 'Pattern rules only' },
  { value: 'AI',     label: 'AI',     hint: 'Local ML models only (names, places, IDs…)' },
  { value: 'HYBRID', label: 'Hybrid', hint: 'Rules verified by ML (checksums + context), plus AI entities' },
];

export default function DetectionModeToggle({ value, onChange, disabled }) {
  const active = DETECTION_MODES.find(m => m.value === value);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <div
        role="radiogroup"
        aria-label="Detection mode"
        style={{
          display      : 'inline-flex',
          background   : 'var(--color-bg)',
          border       : '1px solid var(--color-border)',
          borderRadius : 6,
          overflow     : 'hidden',
        }}
      >
        {DETECTION_MODES.map((m, i) => {
          const isActive = m.value === value;
          return (
            <button
              key={m.value}
              role="radio"
              aria-checked={isActive}
              title={m.hint}
              disabled={disabled}
              onClick={() => onChange(m.value)}
              style={{
                background  : isActive ? 'var(--color-primary)' : 'transparent',
                color       : isActive ? 'var(--color-surface)' : 'var(--color-text-dim)',
                border      : 'none',
                borderLeft  : i > 0 ? '1px solid var(--color-border)' : 'none',
                padding     : '5px 14px',
                fontSize    : 12,
                fontWeight  : isActive ? 700 : 500,
                cursor      : disabled ? 'not-allowed' : 'pointer',
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>
      {active && (
        <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>{active.hint}</span>
      )}
    </div>
  );
}
