/**
 * Renders a coloured dot + label for a status string.
 * Accepts: 'ok' | 'unreachable' | 'checking' | any string
 */

const VARIANTS = {
  ok:          { color: 'var(--color-success)', label: 'Online' },
  unreachable: { color: 'var(--color-danger)',  label: 'Offline' },
  checking:    { color: 'var(--color-warning)', label: 'Checking…' },
};

export default function StatusBadge({ value }) {
  const v = VARIANTS[value] ?? { color: 'var(--color-muted)', label: value ?? '—' };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: v.color,
        boxShadow: `0 0 6px ${v.color}`,
        flexShrink: 0,
      }} />
      <span style={{ color: v.color, fontWeight: 600, fontSize: 13 }}>
        {v.label}
      </span>
    </span>
  );
}