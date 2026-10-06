import { useState } from 'react';
import { rewriteText, restoreText, forgetRewrite } from '../api/client';
import PageHeader          from '../components/PageHeader';
import DetectionModeToggle from '../components/DetectionModeToggle';
import AiStatusBanner      from '../components/AiStatusBanner';
import { categoryIcon }    from '../constants/categories';

/**
 * Smart Rewrite: prompt → realistic fakes → chatbot → paste reply → real values back.
 *
 *   1. Rewrite  — POST /api/ai/rewrite swaps each sensitive value for a fake of the same type
 *   2. Copy the rewritten prompt into ChatGPT (or any chatbot)
 *   3. Restore  — POST /api/ai/restore swaps the fakes in the reply back to the originals
 *
 * The mapping is kept in the ML service's memory, so follow-up prompts in the
 * same session reuse the same fakes until "Start over".
 */

const EXAMPLES = [
  {
    label : 'Email draft',
    text  :
      'Write a polite payment reminder to Priya Sharma in Chennai. Her card 4111 1111 1111 1111 ' +
      'was declined and her Aadhaar 2345 6789 0124 is on file. Reply to priya.sharma@gmail.com.',
  },
  {
    label : 'Support ticket',
    text  :
      'Summarise this ticket: Rahul Verma (+91 98765 43210) from Infosys says his IBAN ' +
      'GB29NWBK60161331926819 was charged twice.',
  },
];

const PALETTE = {
  original : { bg: '#fdecea', color: 'var(--color-danger)'  },
  fake     : { bg: '#e6effc', color: '#1d4ed8'              },
  restored : { bg: '#e7f4ea', color: 'var(--color-success)' },
};

const textareaStyle = {
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
};

const sectionLabel = {
  fontSize      : 11,
  fontWeight    : 700,
  color         : 'var(--color-muted)',
  textTransform : 'uppercase',
  letterSpacing : '0.5px',
  marginBottom  : 8,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Finds every occurrence of each value in text → non-overlapping spans, left to right. */
function findSpans(text, values) {
  const spans = [];
  const sorted = [...new Set(values)].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const value of sorted) {
    let idx = text.indexOf(value);
    while (idx !== -1) {
      const end = idx + value.length;
      if (!spans.some(s => idx < s.end && end > s.start)) spans.push({ start: idx, end });
      idx = text.indexOf(value, end);
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

function Highlighted({ text, spans, tone, titleFor }) {
  const palette = PALETTE[tone];
  const parts = [];
  let cursor = 0;
  spans.forEach((s, i) => {
    if (s.start > cursor) parts.push(<span key={`t${i}`}>{text.slice(cursor, s.start)}</span>);
    parts.push(
      <span key={`h${i}`} title={titleFor?.(s)} style={{
        background   : palette.bg,
        color        : palette.color,
        borderRadius : 3,
        padding      : '1px 3px',
        fontWeight   : 700,
      }}>
        {text.slice(s.start, s.end)}
      </span>
    );
    cursor = s.end;
  });
  if (cursor < text.length) parts.push(<span key="tail">{text.slice(cursor)}</span>);

  return (
    <pre style={{
      fontFamily : 'var(--font-mono)',
      fontSize   : 13,
      lineHeight : 1.8,
      whiteSpace : 'pre-wrap',
      wordBreak  : 'break-word',
      margin     : 0,
      color      : 'var(--color-text)',
    }}>
      {parts}
    </pre>
  );
}

function Panel({ label, children }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={sectionLabel}>{label}</div>
      <div style={{
        background   : 'var(--color-bg)',
        border       : '1px solid var(--color-border)',
        borderRadius : 6,
        padding      : '12px 14px',
        minHeight    : 60,
      }}>
        {children}
      </div>
    </div>
  );
}

function CopyButton({ text, label }) {
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
    <button className="btn btn-ghost" onClick={handleCopy} style={{ fontSize: 12, padding: '5px 12px' }}>
      {copied ? '✓ Copied' : `⎘ ${label}`}
    </button>
  );
}

function ErrorBox({ message }) {
  return (
    <div style={{
      background   : '#fdecea',
      border       : '1px solid var(--color-danger)',
      borderRadius : 'var(--radius)',
      padding      : '12px 16px',
      color        : 'var(--color-danger)',
      marginBottom : 20,
      fontSize     : 13,
    }}>
      ⚠ {message}
    </div>
  );
}

function StepTitle({ n, title, hint }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
      <span style={{
        width          : 22,
        height         : 22,
        borderRadius   : '50%',
        background     : 'var(--color-primary)',
        color          : 'var(--color-surface)',
        fontSize       : 12,
        fontWeight     : 700,
        display        : 'inline-flex',
        alignItems     : 'center',
        justifyContent : 'center',
        flexShrink     : 0,
      }}>
        {n}
      </span>
      <span style={{ fontWeight: 700, fontSize: 15 }}>{title}</span>
      {hint && <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>{hint}</span>}
    </div>
  );
}

function MappingTable({ replacements }) {
  // One row per distinct original → fake
  const rows = [];
  const seen = new Set();
  for (const r of replacements) {
    const key = `${r.category}|${r.original}`;
    if (!seen.has(key)) {
      seen.add(key);
      rows.push(r);
    }
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
            {['Category', 'Original', 'Fake sent to the chatbot'].map(h => (
              <th key={h} style={{ padding: '7px 10px', textAlign: 'left', color: 'var(--color-muted)', fontWeight: 600 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={`${r.category}|${r.original}`} style={{ borderBottom: '1px solid var(--color-border)' }}>
              <td style={{ padding: '8px 10px', color: 'var(--color-text-dim)', whiteSpace: 'nowrap' }}>
                {categoryIcon(r.category)} {r.category}
              </td>
              <td style={{ padding: '8px 10px' }}>
                <span className="mono" style={{ background: PALETTE.original.bg, color: PALETTE.original.color, padding: '2px 6px', borderRadius: 3 }}>
                  {r.original}
                </span>
              </td>
              <td style={{ padding: '8px 10px' }}>
                <span className="mono" style={{ background: PALETTE.fake.bg, color: PALETTE.fake.color, padding: '2px 6px', borderRadius: 3 }}>
                  {r.fake}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RewritePage() {
  const [inputText,  setInputText]  = useState('');
  const [mode,       setMode]       = useState('HYBRID');
  const [rewrite,    setRewrite]    = useState(null);   // RewriteResult | null
  const [mappingId,  setMappingId]  = useState(null);   // kept across follow-up prompts
  const [promptCount, setPromptCount] = useState(0);
  const [reply,      setReply]      = useState('');
  const [restored,   setRestored]   = useState(null);   // { text, restoredCount } | null
  const [loading,    setLoading]    = useState(null);   // 'rewrite' | 'restore' | null
  const [error,      setError]      = useState(null);

  async function handleRewrite() {
    if (!inputText.trim()) return;
    setLoading('rewrite');
    setError(null);
    setRestored(null);
    setReply('');
    try {
      const data = await rewriteText(inputText, { mode, mappingId });
      // A new id means the old mapping expired, so this is a fresh session
      setPromptCount(n => (data.mappingId === mappingId ? n + 1 : 1));
      setRewrite(data);
      setMappingId(data.mappingId);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(null);
    }
  }

  async function handleRestore() {
    if (!reply.trim() || !mappingId) return;
    setLoading('restore');
    setError(null);
    try {
      setRestored(await restoreText(mappingId, reply));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(null);
    }
  }

  async function handleStartOver() {
    if (mappingId) {
      // Best effort: the mapping expires on its own anyway
      forgetRewrite(mappingId).catch(() => {});
    }
    setInputText('');
    setRewrite(null);
    setMappingId(null);
    setPromptCount(0);
    setReply('');
    setRestored(null);
    setError(null);
  }

  function handleSampleReply() {
    setReply(`Sure! Here's a clearer version of your request:\n\n${rewrite.rewrittenText}`);
    setRestored(null);
  }

  function handleExample(text) {
    setInputText(text);
    setError(null);
  }

  // Values to highlight in the restored reply; names may come back one part at a time
  const originals = rewrite?.replacements.flatMap(r =>
    r.category === 'PERSON' ? [r.original, ...r.original.split(/\s+/)] : [r.original]
  ) ?? [];
  const fakeTitle = (s) => {
    const r = rewrite.replacements.find(x => x.fakeStart === s.start);
    return r ? `${r.category} · replaces "${r.original}"` : undefined;
  };

  return (
    <div>
      <PageHeader
        title="Smart Rewrite"
        subtitle="Send prompts to any chatbot with realistic fakes in place of real data, then restore the real values in its reply."
      />

      {/* ── Step 1: prompt ── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <StepTitle n={1} title="Your prompt" hint="Real names, IDs and numbers are fine here — they never leave PromptGuard." />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' }}>
          <DetectionModeToggle value={mode} onChange={setMode} disabled={loading !== null} />
          <span style={{ flex: 1 }} />
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

        <textarea
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          onKeyDown={e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              handleRewrite();
            }
          }}
          placeholder="Paste the prompt you want to send to a chatbot…"
          rows={6}
          style={textareaStyle}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>
            {mappingId
              ? `Session active · prompt ${promptCount} · the same fakes are reused for follow-ups`
              : `${inputText.length.toLocaleString()} / 50,000 characters`}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={handleStartOver} disabled={!inputText && !rewrite}>
              Start over
            </button>
            <button
              className="btn btn-primary"
              onClick={handleRewrite}
              disabled={!inputText.trim() || loading !== null}
              style={{ minWidth: 110 }}
            >
              {loading === 'rewrite' ? 'Rewriting…' : mappingId ? '✨ Rewrite follow-up' : '✨ Rewrite'}
            </button>
          </div>
        </div>
      </div>

      {error && <ErrorBox message={error} />}

      {/* ── Step 2: rewritten prompt ── */}
      {rewrite && (
        <div className="card" style={{ marginBottom: 20 }}>
          <StepTitle
            n={2}
            title="Copy the rewritten prompt into your chatbot"
            hint={`${rewrite.replacements.length} value${rewrite.replacements.length !== 1 ? 's' : ''} replaced · ${rewrite.effectiveMode} · ${rewrite.durationMs}ms`}
          />

          <AiStatusBanner result={rewrite} />

          {rewrite.replacements.length === 0 ? (
            <div style={{ color: 'var(--color-muted)', fontSize: 13, marginBottom: 12 }}>
              ✅ No sensitive data found — the prompt is unchanged and safe to send as-is.
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 16 }}>
                <Panel label="Original (stays here)">
                  <Highlighted
                    text={rewrite.originalText}
                    spans={rewrite.replacements.map(r => ({ start: r.start, end: r.end }))}
                    tone="original"
                  />
                </Panel>
                <Panel label="Rewritten (send this)">
                  <Highlighted
                    text={rewrite.rewrittenText}
                    spans={rewrite.replacements.map(r => ({ start: r.fakeStart, end: r.fakeEnd }))}
                    tone="fake"
                    titleFor={fakeTitle}
                  />
                </Panel>
              </div>

              <div style={sectionLabel}>Mapping</div>
              <MappingTable replacements={rewrite.replacements} />
            </>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>
              The mapping is held in memory only and expires after {Math.round(rewrite.ttlSeconds / 60)} min without use.
            </span>
            <CopyButton text={rewrite.rewrittenText} label="Copy rewritten prompt" />
          </div>
        </div>
      )}

      {/* ── Step 3: restore ── */}
      {rewrite && rewrite.replacements.length > 0 && (
        <div className="card">
          <StepTitle n={3} title="Paste the chatbot's reply" hint="The fakes in it are swapped back to your real values." />

          <textarea
            value={reply}
            onChange={e => {
              setReply(e.target.value);
              if (restored) setRestored(null);
            }}
            onKeyDown={e => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                handleRestore();
              }
            }}
            placeholder="Paste the chatbot's answer here…"
            rows={6}
            style={textareaStyle}
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button className="btn btn-ghost" onClick={handleSampleReply} title="Fill in a sample reply to try the restore step">
              Use sample reply
            </button>
            <button
              className="btn btn-primary"
              onClick={handleRestore}
              disabled={!reply.trim() || loading !== null}
              style={{ minWidth: 110 }}
            >
              {loading === 'restore' ? 'Restoring…' : '↩ Restore'}
            </button>
          </div>

          {restored && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ ...sectionLabel, marginBottom: 0 }}>
                  Restored reply · {restored.restoredCount} value{restored.restoredCount !== 1 ? 's' : ''} put back
                </div>
                <CopyButton text={restored.text} label="Copy restored reply" />
              </div>
              <div style={{
                background   : 'var(--color-bg)',
                border       : '1px solid var(--color-border)',
                borderRadius : 6,
                padding      : '12px 14px',
              }}>
                <Highlighted text={restored.text} spans={findSpans(restored.text, originals)} tone="restored" />
              </div>
              {restored.restoredCount === 0 && (
                <div style={{ fontSize: 12, color: 'var(--color-warning)', marginTop: 8 }}>
                  No fakes were found in this reply — check that you pasted the chatbot's answer to the rewritten prompt.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
