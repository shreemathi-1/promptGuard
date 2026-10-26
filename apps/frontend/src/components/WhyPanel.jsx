import { useState } from 'react';
import { explainDetection } from '../api/client';

/**
 * "Why is this risky?" panel for one detection, shown under it in DetectionList.
 *
 * Loads the template explanation (instant, no LLM) when opened; the user can
 * then ask the local LLM for a version tailored to the surrounding text.
 *
 * Props:
 *   detection  — Detection { category, match, start, end, source, confidence, reasons, recognizer }
 *   inputText  — original text, for context around the match
 *   detections — all detections in the text; the others are masked out of the context
 */

const CONTEXT_RADIUS = 120;

/**
 * Text around the match with every *other* detection replaced by its category,
 * so the LLM never sees names, numbers or keys it wasn't asked about.
 * (The ML service hides the explained value itself.)
 */
function maskedContext(detection, inputText, detections) {
  if (!inputText) return '';
  const from = Math.max(0, detection.start - CONTEXT_RADIUS);
  const to   = Math.min(inputText.length, detection.end + CONTEXT_RADIUS);

  let out    = '';
  let cursor = from;
  const others = detections
    .filter(d => d !== detection && d.start >= from && d.end <= to)
    .sort((a, b) => a.start - b.start);
  for (const d of others) {
    if (d.start < cursor) continue;
    out   += inputText.slice(cursor, d.start) + `[${d.category}]`;
    cursor = d.end;
  }
  return out + inputText.slice(cursor, to);
}

function buildPayload(detection, inputText, detections, useLlm) {
  const { category, match, source, confidence, reasons, recognizer } = detection;
  const context = maskedContext(detection, inputText, detections);
  return {
    category,
    match,
    context,
    source,
    confidence : typeof confidence === 'number' ? confidence : null,
    reasons    : reasons ?? [],
    recognizer : recognizer ?? null,
    useLlm,
  };
}

function ExplanationBody({ result }) {
  const { explanation, evidence } = result;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, lineHeight: 1.6 }}>
      <div style={{ color: 'var(--color-text)' }}>{explanation.summary}</div>

      {explanation.risks.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--color-text-dim)' }}>
          {explanation.risks.map(r => <li key={r}>{r}</li>)}
        </ul>
      )}

      <div style={{ color: 'var(--color-success)', fontWeight: 600 }}>
        → {explanation.recommendation}
      </div>

      {evidence.length > 0 && (
        <div style={{ color: 'var(--color-muted)', fontSize: 11 }}>
          <strong>Why it was flagged:</strong> {evidence.join(' · ')}
        </div>
      )}
    </div>
  );
}

export default function WhyPanel({ detection, inputText, detections = [] }) {
  const [open,     setOpen]     = useState(false);
  const [template, setTemplate] = useState(null);
  const [llm,      setLlm]      = useState(null);
  const [loading,  setLoading]  = useState(null);   // 'template' | 'llm' | null
  const [error,    setError]    = useState(null);

  async function load(useLlm) {
    setLoading(useLlm ? 'llm' : 'template');
    setError(null);
    try {
      const result = await explainDetection(buildPayload(detection, inputText, detections, useLlm));
      (useLlm ? setLlm : setTemplate)(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(null);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !template && loading === null) load(false);
  }

  const shown = llm ?? template;

  return (
    <div>
      <button
        onClick={toggle}
        aria-expanded={open}
        style={{
          background : 'none',
          border     : 'none',
          padding    : 0,
          fontSize   : 12,
          fontWeight : 600,
          color      : 'var(--color-primary)',
          cursor     : 'pointer',
        }}
      >
        {open ? '▾' : '▸'} Why is this risky?
      </button>

      {open && (
        <div style={{
          marginTop    : 8,
          background   : 'var(--color-surface)',
          border       : '1px solid var(--color-border)',
          borderRadius : 6,
          padding      : '10px 12px',
        }}>
          {loading === 'template' && !shown && (
            <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>Loading…</div>
          )}

          {shown && <ExplanationBody result={shown} />}

          {error && (
            <div style={{ fontSize: 12, color: 'var(--color-danger)', marginTop: shown ? 8 : 0 }}>⚠ {error}</div>
          )}

          {template && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>
                {llm ? `Written by local LLM (${llm.model}) · sensitive values were hidden from it` : 'Standard explanation for this category'}
              </span>
              {!llm && (
                <button
                  className="btn btn-ghost"
                  onClick={() => load(true)}
                  disabled={loading !== null}
                  style={{ fontSize: 11, padding: '3px 10px' }}
                  title="Uses Ollama running on this machine"
                >
                  {loading === 'llm' ? 'Asking local LLM…' : '✨ Explain in context (local LLM)'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
