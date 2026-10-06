import SeverityTag from './SeverityTag';
import { categoryIcon } from '../constants/categories';

/**
 * Renders the full list of detections returned by /api/scan or /api/mask.
 *
 * Props:
 *   detections  — Detection[] from scanner result
 *   inputText   — original text (used to highlight matched substrings)
 */

const SOURCE_STYLES = {
  REGEX  : { label: 'REGEX',  bg: 'var(--color-surface-alt)', color: 'var(--color-text-dim)', hint: 'Matched by a regex rule' },
  AI     : { label: 'AI',     bg: '#e6effc',                  color: '#1d4ed8',               hint: 'Found by the local ML model' },
  HYBRID : { label: 'HYBRID', bg: '#e7f4ea',                  color: 'var(--color-success)',  hint: 'Regex match verified by the ML validator' },
};

function SourceBadge({ source }) {
  const s = SOURCE_STYLES[source];
  if (!s) return null;
  return (
    <span className="tag" title={s.hint} style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

function confidenceColor(confidence) {
  if (confidence >= 0.85) return 'var(--color-success)';
  if (confidence >= 0.6)  return 'var(--color-warning)';
  return 'var(--color-danger)';
}

function ConfidenceBar({ confidence }) {
  if (typeof confidence !== 'number') return null;
  const pct   = Math.round(confidence * 100);
  const color = confidenceColor(confidence);

  return (
    <span
      title={`Model confidence: ${pct}%`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
    >
      <span style={{
        width        : 60,
        height       : 5,
        background   : 'var(--color-border)',
        borderRadius : 3,
        overflow     : 'hidden',
      }}>
        <span style={{
          display      : 'block',
          width        : `${pct}%`,
          height       : '100%',
          background   : color,
          borderRadius : 3,
        }} />
      </span>
      <span style={{ fontSize: 11, fontWeight: 700, color, fontFamily: 'var(--font-mono)' }}>
        {pct}%
      </span>
    </span>
  );
}

/**
 * Turns a validator reason code ("luhn_valid", "context:card") into a chip label.
 * Returns { text, ok } where ok is true / false / null (neutral).
 */
function describeReason(reason) {
  const [code, detail] = reason.split(':');
  if (code === 'context')          return { text: `"${detail}" nearby`, ok: true };
  if (code === 'negative_context') return { text: `"${detail}" nearby`, ok: false };

  const words = code.replace(/_(valid|invalid)$/, '').replace(/_/g, ' ');
  const text  = detail ? `${words} ${detail}` : words;
  if (code.endsWith('_invalid')) return { text, ok: false };
  if (code.endsWith('_valid'))   return { text, ok: true };
  return { text, ok: null };
}

function ReasonChip({ reason }) {
  const { text, ok } = describeReason(reason);
  const color = ok === true ? 'var(--color-success)' : ok === false ? 'var(--color-danger)' : 'var(--color-text-dim)';
  return (
    <span title={reason} style={{
      fontSize     : 11,
      color,
      background   : 'var(--color-surface)',
      border       : '1px solid var(--color-border)',
      borderRadius : 4,
      padding      : '1px 7px',
    }}>
      {ok === true ? '✓ ' : ok === false ? '✗ ' : ''}{text}
    </span>
  );
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

            <SourceBadge source={d.source} />

            <span className="tag" style={{
              background : 'var(--color-surface)',
              color      : 'var(--color-text-dim)',
              border     : '1px solid var(--color-border)',
            }}>
              {d.category}
            </span>

            <span style={{
              marginLeft : 'auto',
              display    : 'inline-flex',
              alignItems : 'center',
              gap        : 12,
              fontSize   : 11,
              color      : 'var(--color-muted)',
              fontFamily : 'var(--font-mono)',
            }}>
              <ConfidenceBar confidence={d.confidence} />
              pos {d.start}–{d.end} · {d.length} chars
            </span>
          </div>

          {/* Validator reasons (HYBRID hits) */}
          {d.reasons?.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {d.reasons.map(reason => <ReasonChip key={reason} reason={reason} />)}
            </div>
          )}

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