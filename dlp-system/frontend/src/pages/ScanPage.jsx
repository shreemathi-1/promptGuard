import { useState, useRef } from 'react';
import { scanText } from '../api/client';
import PageHeader    from '../components/PageHeader';
import DetectionList from '../components/DetectionList';
// Add to imports at top of ScanPage.jsx
import RiskBreakdown  from '../components/RiskBreakdown';
import { scoreDetections } from '../api/client';

// ── Sample texts for the "Try an example" buttons ───────────────────────────

const EXAMPLES = [
  {
    label : 'Credit card + SSN',
    text  : 'Customer John paid with card 4111 1111 1111 1111 (exp 12/26). SSN on file: 123-45-6789.',
  },
  {
    label : 'Email + phone',
    text  : 'Please contact sarah.jones@company.com or call her at (415) 555-0198 before 5pm.',
  },
  {
    label : 'AWS key + IBAN',
    text  : 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nBank transfer to: GB29NWBK60161331926819',
  },
  {
    label : 'Clean text',
    text  : 'The quarterly meeting is scheduled for next Monday at 10am in Conference Room B.',
  },
];

// ── Small stat pill ──────────────────────────────────────────────────────────

function StatPill({ label, value, accent }) {
  return (
    <div style={{
      background   : 'var(--color-bg)',
      border       : '1px solid var(--color-border)',
      borderRadius : 6,
      padding      : '8px 14px',
      display      : 'flex',
      flexDirection: 'column',
      gap          : 2,
      minWidth     : 90,
    }}>
      <span style={{
        fontSize   : 20,
        fontWeight : 800,
        color      : accent ?? 'var(--color-primary)',
        lineHeight : 1,
      }}>
        {value}
      </span>
      <span style={{ fontSize: 11, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </span>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function ScanPage() {
  const [inputText,   setInputText]   = useState('');
  const [result,      setResult]      = useState(null);   // ScanResult | null
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const textareaRef = useRef(null);
const [scoreResult, setScoreResult] = useState(null);
  // ── Handlers ─────────────────────────────────────────────────────────────

  async function handleScan() {
  if (!inputText.trim()) return;

  setLoading(true);
  setError(null);
  setResult(null);
  setScoreResult(null);

  try {
    const data = await scanText(inputText);
    setResult(data);

    // Score the detections for visual breakdown
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
    // Ctrl+Enter or Cmd+Enter triggers scan
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleScan();
    }
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const charCount      = inputText.length;
  const hasInput       = inputText.trim().length > 0;
  const hasResult      = result !== null;

  const criticalCount  = result?.detections.filter(d => d.severity === 'CRITICAL').length ?? 0;
  const highCount      = result?.detections.filter(d => d.severity === 'HIGH').length     ?? 0;

  const accentColor = criticalCount > 0
    ? 'var(--color-danger)'
    : highCount > 0
      ? '#f97316'
      : 'var(--color-success)';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <PageHeader
        title="Scan"
        subtitle="Paste any text below to detect sensitive data. Ctrl+Enter to run."
      />

      {/* ── Example buttons ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: 'var(--color-muted)', alignSelf: 'center' }}>
          Try an example:
        </span>
        {EXAMPLES.map((ex) => (
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
        <textarea
          ref={textareaRef}
          value={inputText}
          onChange={(e) => {
  setInputText(e.target.value);
  if (result) { setResult(null); setScoreResult(null); }
}}
          onKeyDown={handleKeyDown}
          placeholder="Paste or type text to scan for sensitive data…"
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
          onFocus={e  => (e.target.style.borderColor = 'var(--color-primary)')}
          onBlur={e   => (e.target.style.borderColor = 'var(--color-border)')}
        />

        {/* char counter + action buttons */}
        <div style={{
          display        : 'flex',
          justifyContent : 'space-between',
          alignItems     : 'center',
          marginTop      : 12,
          flexWrap       : 'wrap',
          gap            : 8,
        }}>
          <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>
            {charCount.toLocaleString()} / 50,000 characters
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
              onClick={handleScan}
              disabled={!hasInput || loading}
              style={{ minWidth: 100 }}
            >
              {loading ? 'Scanning…' : '🔍 Scan'}
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
          {/* Stats row */}
          <div style={{
            display      : 'flex',
            gap          : 10,
            marginBottom : 16,
            flexWrap     : 'wrap',
          }}>
            <StatPill
              label="Detections"
              value={result.detectionCount}
              accent={result.detectionCount > 0 ? accentColor : 'var(--color-success)'}
            />
            <StatPill
              label="Patterns checked"
              value={result.patternCount}
              accent="var(--color-primary)"
            />
            <StatPill
              label="Duration"
              value={`${result.durationMs}ms`}
              accent="var(--color-text-dim)"
            />
            {criticalCount > 0 && (
              <StatPill
                label="Critical"
                value={criticalCount}
                accent="var(--color-danger)"
              />
            )}
            {highCount > 0 && (
              <StatPill
                label="High"
                value={highCount}
                accent="#f97316"
              />
            )}
          </div>
          {/* Risk breakdown — only when detections exist */}
{scoreResult && result.detectionCount > 0 && (
  <div className="card" style={{ marginBottom: 16 }}>
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

          {/* Detection list */}
          <div className="card">
            <div style={{
              display        : 'flex',
              justifyContent : 'space-between',
              alignItems     : 'center',
              marginBottom   : result.detectionCount > 0 ? 16 : 0,
            }}>
              <h2 style={{ fontSize: 15, fontWeight: 700 }}>
                {result.detectionCount > 0
                  ? `${result.detectionCount} detection${result.detectionCount > 1 ? 's' : ''} found`
                  : 'No detections'}
              </h2>
              <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                {new Date(result.scannedAt).toLocaleTimeString()}
              </span>
            </div>

            <DetectionList
              detections={result.detections}
              inputText={inputText}
            />
          </div>
        </div>
      )}
    </div>
  );
}