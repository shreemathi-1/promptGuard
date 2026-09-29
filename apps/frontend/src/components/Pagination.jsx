/**
 * Pagination controls.
 *
 * Props:
 *   pagination — { page, pageSize, totalCount, totalPages, hasNext, hasPrev }
 *   onChange   — (newPage: number) => void
 *   loading    — bool
 */

export default function Pagination({ pagination, onChange, loading }) {
  if (!pagination || pagination.totalPages <= 1) return null;

  const { page, totalPages, totalCount, pageSize, hasNext, hasPrev } = pagination;

  const from = (page - 1) * pageSize + 1;
  const to   = Math.min(page * pageSize, totalCount);

  // Build page number window: always show first, last, and 2 around current
  function getPageNumbers() {
    const pages = new Set([1, totalPages]);
    for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i++) {
      pages.add(i);
    }
    const sorted = [...pages].sort((a, b) => a - b);

    // Insert null for gaps
    const result = [];
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push(null);
      result.push(sorted[i]);
    }
    return result;
  }

  const btnBase = {
    minWidth     : 32,
    height       : 32,
    borderRadius : 6,
    border       : '1px solid var(--color-border)',
    background   : 'transparent',
    color        : 'var(--color-text-dim)',
    fontSize     : 13,
    fontWeight   : 500,
    cursor       : 'pointer',
    transition   : 'background 0.15s, color 0.15s',
    display      : 'inline-flex',
    alignItems   : 'center',
    justifyContent: 'center',
    padding      : '0 8px',
  };

  const btnActive = {
    ...btnBase,
    background  : 'var(--color-primary-dim)',
    color       : 'var(--color-primary)',
    borderColor : 'var(--color-primary-dim)',
    fontWeight  : 700,
  };

  const btnDisabled = {
    ...btnBase,
    opacity : 0.35,
    cursor  : 'not-allowed',
  };

  return (
    <div style={{
      display        : 'flex',
      justifyContent : 'space-between',
      alignItems     : 'center',
      marginTop      : 16,
      flexWrap       : 'wrap',
      gap            : 8,
    }}>
      {/* Record range */}
      <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>
        {from}–{to} of {totalCount.toLocaleString()} records
      </span>

      {/* Page buttons */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {/* Prev */}
        <button
          style={hasPrev && !loading ? btnBase : btnDisabled}
          disabled={!hasPrev || loading}
          onClick={() => onChange(page - 1)}
        >
          ‹
        </button>

        {/* Page numbers */}
        {getPageNumbers().map((p, i) =>
          p === null ? (
            <span key={`gap-${i}`} style={{ color: 'var(--color-muted)', padding: '0 4px' }}>…</span>
          ) : (
            <button
              key={p}
              style={p === page ? btnActive : (loading ? btnDisabled : btnBase)}
              disabled={loading}
              onClick={() => p !== page && onChange(p)}
            >
              {p}
            </button>
          )
        )}

        {/* Next */}
        <button
          style={hasNext && !loading ? btnBase : btnDisabled}
          disabled={!hasNext || loading}
          onClick={() => onChange(page + 1)}
        >
          ›
        </button>
      </div>
    </div>
  );
}