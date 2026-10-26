/**
 * Consistent page title + optional subtitle used at the top of every page.
 */
export default function PageHeader({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)' }}>
        {title}
      </h1>
      {subtitle && (
        <p style={{ marginTop: 4, color: 'var(--color-text-dim)', fontSize: 14 }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}