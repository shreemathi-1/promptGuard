import { useState, useRef } from 'react';
import { maskText }            from '../api/client';
import PageHeader              from '../components/PageHeader';
import MaskStyleSelector       from '../components/MaskStyleSelector';
import SeverityTag             from '../components/SeverityTag';
import RiskBreakdown       from '../components/RiskBreakdown';
import { scoreDetections } from '../api/client';

// ── Example inputs ────────────────────────────────────────────────────────────

const EXAMPLES = [
  {
    label : 'Card + SSN + Email',
    text  :
      'Bill customer Jane Smith (jane.smith@acme.com) for order #8821.\n' +
      'Charge card: 4111 1111 1111 1111 (CVV 123).\n' +
      'Government ID / SSN: 123-45-6789.',
  },
  {
    label : 'API key + IBAN',
    text  :
      'Deploy with AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\n' +
      'Wire funds to IBAN: GB29NWBK60161331926819',
  },
  {
    label : 'Phone + email',
    text  :
      'Support ticket from carlos@example.org — callback number (650) 555-0142.',
  },
];

// ── Diff viewer ───────────────────────────────────────────────────────────────

/**
 * Renders the masked text with each replaced token visually highlighted
 * in the colour matching its severity. Builds the highlighted output by
 * walking through replacements left-to-right and inserting spans.
 */
function MaskedTextViewer({ maskedText, replacements }) {
  if (!maskedText) return null;

  const SEVERITY_COLORS = {
    CRITICAL : { bg: 'rgba(239,68,68,0.18)',  color: '#fca5a5' },
    HIGH     : { bg: 'rgba(249,115,22,0.18)', color: '#fdba74' },
    MEDIUM   : { bg: 'rgba(234,179,8,0.18)',  color: '#fcd34d' },
    LOW      : { bg: 'rgba(34,197,94,0.15)',  color: '#86efac' },
  };

  // We need to locate each replacement token inside maskedText.
  // Since masking shifts indices we can't use original start/end —
  // instead we find each replacement string sequentially.
  const segments = [];
  let cursor = 0;
  const text  = maskedText;

  // Build a queue of replacement tokens in order they appear in maskedText
  const orderedReplacements = [...replacements].sort((a, b) => a.start - b.start);

  for (const rep of orderedReplacements) {
    const token = rep.replacement;
    const idx   = text.indexOf(token, cursor);
    if (idx === -1) continue;

    // Plain text before this token
    if (idx > cursor) {
      segments.push({ type: 'plain', text: text.slice(cursor, idx) });
    }

    // Highlighted token
    segments.push({ type: 'token', text: token, severity: rep.severity, category: rep.category });
    cursor = idx + token.length;
  }

  // Remaining plain text
  if (cursor < text.length) {
    segments.push({ type: 'plain', text: text.slice(cursor) });
  }

  return (
    <pre style={{
      fontFamily  : 'var(--font-mono)',
      fontSize    : 13,
      lineHeight  : 1.8,
      whiteSpace  : 'pre-wrap',
      wordBreak   : 'break-word',
      margin      : 0,
      color       : 'var(--color-text)',
    }}>
      {segments.map((seg, i) => {
        if (seg.type === 'plain') {
          return <span key={i}>{seg.text}</span>;
        }
        const palette = SEVERITY_COLORS[seg.severity] ?? SEVERITY_COLORS.LOW;
        return (
          <span
            key={i}
            title={`${seg.category} · ${seg.severity}`}
            style={{
              background   : palette.bg,
              color        : palette.color,
              borderRadius : 3,
              padding      : '1px 3px',
              fontWeight   : 700,
              cursor       : 'default',
            }}
          >
            {seg.text}
          </span>
        );
      })}
    </pre>
  );
}

// ── Replacement table ─────────────────────────────────────────────────────────

function ReplacementTable({ replacements }) {
  if (!replacements || replacements.length === 0) return null;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{
        width          : '100%',
        borderCollapse : 'collapse',
        fontSize       : 12,
      }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
            {['#', 'Original', 'Replacement', 'Category', 'Severity'].map(h => (
              <th key={h} style={{
                padding     : '7px 10px',
                textAlign   : 'left',
                color       : 'var(--color-muted)',
                fontWeight  : 600,
                whiteSpace  : 'nowrap',
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {replacements.map((r, i) => (
            <tr key={i} style={{
              borderBottom : '1px solid var(--color-border)',
            }}>
              <td style={{ padding: '8px 10px', color: 'var(--color-muted)' }}>
                {i + 1}
              </td>
              <td style={{ padding: '8px 10px' }}>
                <span className="mono" style={{
                  background   : 'rgba(239,68,68,0.12)',
                  color        : '#fca5a5',
                  padding      : '2px 6px',
                  borderRadius : 3,
                }}>
                  {r.original}
                </span>
              </td>
              <td style={{ padding: '8px 10px' }}>
                <span className="mono" style={{
                  background   : 'rgba(79,142,247,0.12)',
                  color        : 'var(--color-primary)',
                  padding      : '2px 6px',
                  borderRadius : 3,
                }}>
                  {r.replacement}
                </span>
              </td>
              <td style={{ padding: '8px 10px', color: 'var(--color-text-dim)' }}>
                {r.category}
              </td>
              <td style={{ padding: '8px 10px' }}>
                <SeverityTag severity={r.severity} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard API unavailable */
    }
  }

  return (
    <button
      className="btn btn-ghost"
      onClick={handleCopy}
      style={{ fontSize: 12, padding: '5px 12px' }}
    >
      {copied ? '✓ Copied' : '⎘ Copy masked text'}
    </button>
  );
}

// ── Stat pill (reused from ScanPage pattern) ──────────────────────────────────

function StatPill({ label, value, accent }) {
  return (
    <div style={{
      background   : 'var(--color-bg)',
      border       : '1px solid var(--color-border)',
      borderRadius : 6,
      padding      : '8px 14px',
      minWidth     : 90,
    }}>
      <div style={{
        fontSize   : 20,
        fontWeight : 800,
        color      : accent ?? 'var(--color-primary)',
        lineHeight : 1,
      }}>
        {value}
      </div>
      <div style={{
        fontSize      : 11,
        color         : 'var(--color-muted)',
        textTransform : 'uppercase',
        letterSpacing : '0.5px',
        marginTop     : 2,
      }}>
        {label}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MaskPage() {
  const [inputText, setInputText] = useState('');
  const [style,     setStyle]     = useState('REDACT');
  const [result,    setResult]    = useState(null);   // MaskResult | null
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);
  const [activeTab, setActiveTab] = useState('output'); // 'output' | 'table'
  const textareaRef = useRef(null);
  const [scoreResult, setScoreResult] = useState(null);

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleMask() {
  if (!inputText.trim()) return;

  setLoading(true);
  setError(null);
  setResult(null);
  setScoreResult(null);

  try {
    const data = await maskText(inputText, style);
    setResult(data);
    setActiveTab('output');

    if (data.detections.length > 0) {
      const scored = await scoreDetections(data.detections);
      setScoreResult(scored);
    }
  } catch (err) {
    setError(err.message);
  } finally {
    setLoading(false);
  }
}

  function handleExample(text) {
    setInputText(text);
    setResult(null);
    setError(null);
    textareaRef.current?.focus();
  }

  function handleClear() {
    setInputText('');
    setResult(null);
    setError(null);
    textareaRef.current?.focus();
  }

  function handleKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleMask();
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const hasInput  = inputText.trim().length > 0;
  const hasResult = result !== null;

  const criticalCount = result?.detections.filter(d => d.severity === 'CRITICAL').length ?? 0;
  const riskAccent    = criticalCount > 0
    ? 'var(--color-danger)'
    : result?.maskedCount > 0
      ? '#f97316'
      : 'var(--color-success)';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <PageHeader
        title="Mask"
        subtitle="Detect and redact sensitive data. Choose a masking style, then press Ctrl+Enter."
      />

      {/* ── Example buttons ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: 'var(--color-muted)', alignSelf: 'center' }}>
          Try an example:
        </span>
        {EXAMPLES.map(ex => (
          <button
            key={ex.label}
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: '5px 12px' }}
            onClick={() => handleExample(ex.text)}
          >
            {ex.label}
          </button>
        ))}
      </div>

      {/* ── Input card ── */}
      <div className="card" style={{ marginBottom: 20 }}>

        {/* Style selector */}
        <div style={{ marginBottom: 16 }}>
          <label style={{
            display      : 'block',
            fontSize     : 12,
            fontWeight   : 600,
            color        : 'var(--color-text-dim)',
            marginBottom : 8,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            Masking Style
          </label>
          <MaskStyleSelector
            value={style}
            onChange={(v) => {
  setStyle(v);
  setResult(null);
  setScoreResult(null);
}}
            disabled={loading}
          />
        </div>

        <hr className="divider" />

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={inputText}
          onChange={e => {
            setInputText(e.target.value);
            if (result) setResult(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Paste or type text to scan and mask…"
          rows={8}
          style={{
            width        : '100%',
            background   : 'var(--color-bg)',
            border       : '1px solid var(--color-border)',
            borderRadius : 'var(--radius)',
            color        : 'var(--color-text)',
            padding      : '12px 14px',
            resize       : 'vertical',
            lineHeight   : 1.7,
            outline      : 'none',
            fontFamily   : 'var(--font-mono)',
            fontSize     : 13,
            transition   : 'border-color 0.15s',
          }}
          onFocus={e => (e.target.style.borderColor = 'var(--color-primary)')}
          onBlur={e  => (e.target.style.borderColor = 'var(--color-border)')}
        />

        {/* Footer row */}
        <div style={{
          display        : 'flex',
          justifyContent : 'space-between',
          alignItems     : 'center',
          marginTop      : 12,
          flexWrap       : 'wrap',
          gap            : 8,
        }}>
          <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>
            {inputText.length.toLocaleString()} / 50,000 characters
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-ghost"
              onClick={handleClear}
              disabled={!hasInput && !hasResult}
            >
              Clear
            </button>
            <button
              className="btn btn-primary"
              onClick={handleMask}
              disabled={!hasInput || loading}
              style={{ minWidth: 110 }}
            >
              {loading ? 'Masking…' : '🔐 Mask'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{
          background   : '#450a0a',
          border       : '1px solid #7f1d1d',
          borderRadius : 'var(--radius)',
          padding      : '12px 16px',
          color        : '#fca5a5',
          marginBottom : 20,
          fontSize     : 13,
        }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Results ── */}
      {hasResult && (
        <div>
          {/* Stat row */}
          <div style={{
            display      : 'flex',
            gap          : 10,
            marginBottom : 16,
            flexWrap     : 'wrap',
          }}>
            <StatPill
              label="Masked"
              value={result.maskedCount}
              accent={result.maskedCount > 0 ? riskAccent : 'var(--color-success)'}
            />
            <StatPill
              label="Detections"
              value={result.detectionCount}
              accent="var(--color-primary)"
            />
            <StatPill
              label="Style"
              value={result.style}
              accent="var(--color-text-dim)"
            />
            <StatPill
              label="Duration"
              value={`${result.durationMs}ms`}
              accent="var(--color-text-dim)"
            />
          </div>

          {result.maskedCount === 0 ? (
            /* ── No detections ── */
            <div className="card" style={{ textAlign: 'center', padding: '36px 24px' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>No sensitive data found</div>
              <div style={{ color: 'var(--color-muted)', fontSize: 13 }}>
                The text is clean — nothing was masked.
              </div>
            </div>
          ) : (
            /* ── Output card ── */
            <div className="card">
              {/* Tab bar + copy button */}
              <div style={{
                display        : 'flex',
                justifyContent : 'space-between',
                alignItems     : 'center',
                marginBottom   : 16,
                flexWrap       : 'wrap',
                gap            : 8,
              }}>
                {/* Risk breakdown */}
{scoreResult && (
  <div className="card" style={{ marginTop: 16 }}>
    <div style={{
      fontSize      : 11,
      fontWeight    : 700,
      color         : 'var(--color-muted)',
      textTransform : 'uppercase',
      letterSpacing : '0.5px',
      marginBottom  : 14,
    }}>
      Risk Analysis
    </div>
    <RiskBreakdown scoreResult={scoreResult} />
  </div>
)}
                {/* Tabs */}
                <div style={{ display: 'flex', gap: 4 }}>
                  {[
                    { id: 'output', label: '📄 Masked Output' },
                    { id: 'table',  label: `🔄 Replacements (${result.maskedCount})` },
                  ].map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className="btn btn-ghost"
                      style={{
                        fontSize   : 12,
                        padding    : '5px 12px',
                        background : activeTab === tab.id
                          ? 'var(--color-primary-dim)'
                          : 'transparent',
                        color      : activeTab === tab.id
                          ? 'var(--color-primary)'
                          : 'var(--color-text-dim)',
                        borderColor: activeTab === tab.id
                          ? 'var(--color-primary-dim)'
                          : 'var(--color-border)',
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Copy button — only on output tab */}
                {activeTab === 'output' && (
                  <CopyButton text={result.maskedText} />
                )}
              </div>

              {/* Tab content */}
              {activeTab === 'output' && (
                <div style={{
                  background   : 'var(--color-bg)',
                  border       : '1px solid var(--color-border)',
                  borderRadius : 'var(--radius)',
                  padding      : '14px 16px',
                  minHeight    : 80,
                }}>
                  <MaskedTextViewer
                    maskedText={result.maskedText}
                    replacements={result.replacements}
                  />
                </div>
              )}

              {activeTab === 'table' && (
                <ReplacementTable replacements={result.replacements} />
              )}
            </div>
          )}

          {/* ── Side-by-side diff (shown when there are detections) ── */}
          {result.maskedCount > 0 && (
            <div style={{ marginTop: 16 }}>
              <div className="card">
                <h3 style={{
                  fontSize     : 13,
                  fontWeight   : 700,
                  color        : 'var(--color-text-dim)',
                  marginBottom : 14,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}>
                  Before / After
                </h3>
                <div style={{
                  display             : 'grid',
                  gridTemplateColumns : '1fr 1fr',
                  gap                 : 12,
                }}>
                  {/* Before */}
                  <div>
                    <div style={{
                      fontSize     : 11,
                      color        : 'var(--color-muted)',
                      marginBottom : 6,
                      fontWeight   : 600,
                    }}>
                      ORIGINAL
                    </div>
                    <div style={{
                      background   : 'var(--color-bg)',
                      border       : '1px solid var(--color-border)',
                      borderRadius : 6,
                      padding      : '12px 14px',
                      minHeight    : 60,
                    }}>
                      <pre style={{
                        fontFamily : 'var(--font-mono)',
                        fontSize   : 12,
                        lineHeight : 1.8,
                        whiteSpace : 'pre-wrap',
                        wordBreak  : 'break-word',
                        margin     : 0,
                        color      : 'var(--color-text-dim)',
                      }}>
                        {result.originalText}
                      </pre>
                    </div>
                  </div>

                  {/* After */}
                  <div>
                    <div style={{
                      fontSize     : 11,
                      color        : 'var(--color-muted)',
                      marginBottom : 6,
                      fontWeight   : 600,
                    }}>
                      MASKED ({result.style})
                    </div>
                    <div style={{
                      background   : 'var(--color-bg)',
                      border       : '1px solid var(--color-border)',
                      borderRadius : 6,
                      padding      : '12px 14px',
                      minHeight    : 60,
                    }}>
                        
                      <MaskedTextViewer
                        maskedText={result.maskedText}
                        replacements={result.replacements}
                      />
                    </div>
                  </div>
                </div>
              </div>
              {/* Risk breakdown */}
{scoreResult && (
  <div className="card" style={{ marginTop: 16 }}>
    <div style={{
      fontSize      : 11,
      fontWeight    : 700,
      color         : 'var(--color-muted)',
      textTransform : 'uppercase',
      letterSpacing : '0.5px',
      marginBottom  : 14,
    }}>
      Risk Analysis
    </div>
    <RiskBreakdown scoreResult={scoreResult} />
  </div>
)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}