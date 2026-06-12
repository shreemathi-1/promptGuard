/**
 * Three-way toggle for REDACT / PARTIAL / TOKENIZE mask styles.
 * Renders as a segmented button group.
 *
 * Props:
 *   value    — 'REDACT' | 'PARTIAL' | 'TOKENIZE'
 *   onChange — (newValue: string) => void
 *   disabled — bool
 */

const STYLES = [
  {
    value       : 'REDACT',
    label       : 'Redact',
    icon        : '🚫',
    description : 'Replace with [CATEGORY REDACTED]',
  },
  {
    value       : 'PARTIAL',
    label       : 'Partial',
    icon        : '◑',
    description : 'Mask all but last 4 characters',
  },
  {
    value       : 'TOKENIZE',
    label       : 'Tokenize',
    icon        : '🔐',
    description : 'Replace with deterministic UUID token',
  },
];

export default function MaskStyleSelector({ value, onChange, disabled }) {
  return (
    <div>
      <div style={{
        display       : 'flex',
        background    : 'var(--color-bg)',
        border        : '1px solid var(--color-border)',
        borderRadius  : 'var(--radius)',
        overflow      : 'hidden',
        width         : 'fit-content',
      }}>
        {STYLES.map((s, i) => {
          const isActive = value === s.value;
          return (
            <button
              key={s.value}
              onClick={() => !disabled && onChange(s.value)}
              disabled={disabled}
              title={s.description}
              style={{
                padding      : '8px 18px',
                border       : 'none',
                borderRight  : i < STYLES.length - 1
                  ? '1px solid var(--color-border)'
                  : 'none',
                background   : isActive
                  ? 'var(--color-primary-dim)'
                  : 'transparent',
                color        : isActive
                  ? 'var(--color-primary)'
                  : 'var(--color-text-dim)',
                fontWeight   : isActive ? 700 : 500,
                fontSize     : 13,
                cursor       : disabled ? 'not-allowed' : 'pointer',
                transition   : 'background 0.15s, color 0.15s',
                display      : 'flex',
                alignItems   : 'center',
                gap          : 6,
                opacity      : disabled ? 0.5 : 1,
              }}
            >
              <span>{s.icon}</span>
              <span>{s.label}</span>
            </button>
          );
        })}
      </div>

      {/* Active style description */}
      <p style={{
        marginTop  : 7,
        fontSize   : 12,
        color      : 'var(--color-muted)',
      }}>
        {STYLES.find(s => s.value === value)?.description}
      </p>
    </div>
  );
}