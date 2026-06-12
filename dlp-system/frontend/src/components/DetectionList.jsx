import SeverityTag from './SeverityTag';

/**
 * Renders the full list of detections returned by /api/scan or /api/mask.
 *
 * Props:
 *   detections  — Detection[] from scanner result
 *   inputText   — original text (used to highlight matched substrings)
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

function categoryIcon(category) {
  return CATEGORY_ICONS[category] ?? '🔍';
}

/**
 * Highlights the matched substring inside the original text snippet.
 * Shows up to 40 chars of context around the match.
 */
function MatchContext({ inputText, detection }) {
  const { start, end, match } = detection;

  const CONTEXT = 36;
  const from    = Math.max(0, start - CONTEXT);
  const to      = Math.min(inputText.length, end + CONTEXT);

  const before = inputText.slice(from, start);
  const after  = inputText.slice(end, to);

  return (
    <span className="mono" style={{ fontSize: 12, color: 'var(--color-text-dim)' }}>
      {from > 0 && <span style={{ opacity: 0.4 }}>…</span>}
      {before}
      <mark style={{
        background    : 'rgba(239,68,68,0.25)',
        color         : '#fca5a5',
        borderRadius  : 3,
        padding       : '1px 2px',
        fontWeight    : 700,
      }}>
        {match}
      </mark>
      {after}
      {to < inputText.length && <span style={{ opacity: 0.4 }}>…</span>}
    </span>
  );
}

export default function DetectionList({ detections, inputText }) {
  if (!detections || detections.length === 0) {
    return (
      <div style={{
        textAlign  : 'center',
        padding    : '40px 0',
        color      : 'var(--color-muted)',
      }}>
        ✅ No sensitive data detected.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {detections.map((d, i) => (
        <div key={`${d.patternId}-${d.start}-${i}`} style={{
          background    : 'var(--color-bg)',
          border        : '1px solid var(--color-border)',
          borderRadius  : 'var(--radius)',
          padding       : '14px 16px',
          display       : 'flex',
          flexDirection : 'column',
          gap           : 8,
        }}>
          {/* Top row — icon + name + tags */}
          <div style={{
            display    : 'flex',
            alignItems : 'center',
            gap        : 8,
            flexWrap   : 'wrap',
          }}>
            <span style={{ fontSize: 16 }}>{categoryIcon(d.category)}</span>

            <span style={{ fontWeight: 700, fontSize: 13 }}>
              {d.patternName}
            </span>

            <SeverityTag severity={d.severity} />

            <span className="tag" style={{
              background : 'var(--color-surface)',
              color      : 'var(--color-text-dim)',
              border     : '1px solid var(--color-border)',
            }}>
              {d.category}
            </span>

            <span style={{
              marginLeft : 'auto',
              fontSize   : 11,
              color      : 'var(--color-muted)',
              fontFamily : 'var(--font-mono)',
            }}>
              pos {d.start}–{d.end} · {d.length} chars
            </span>
          </div>

          {/* Match context */}
          {inputText && (
            <div style={{
              background   : 'var(--color-surface)',
              borderRadius : 4,
              padding      : '7px 10px',
              lineHeight   : 1.7,
              overflowX    : 'auto',
              whiteSpace   : 'pre',
            }}>
              <MatchContext inputText={inputText} detection={d} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}