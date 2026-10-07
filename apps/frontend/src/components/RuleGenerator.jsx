import { useState } from 'react';
import { generateRule } from '../api/client';

/**
 * "Generate with AI" tab of RuleFormModal.
 *
 * Description + examples → the local LLM proposes a regex, which is tested
 * against the examples (in Python, then again in JavaScript — the scanner's
 * engine). The user reviews the results and hands the rule to the form.
 *
 * Props:
 *   onUse — ({ pattern, name, category, severity, description }) => void
 */

const inputStyle = {
  width        : '100%',
  background   : 'var(--color-bg)',
  border       : '1px solid var(--color-border)',
  borderRadius : 'var(--radius)',
  color        : 'var(--color-text)',
  padding      : '9px 12px',
  fontSize     : 13,
  outline      : 'none',
  boxSizing    : 'border-box',
  resize       : 'vertical',
  lineHeight   : 1.6,
};

const labelStyle = {
  display       : 'block',
  fontSize      : 12,
  fontWeight    : 600,
  color         : 'var(--color-text-dim)',
  marginBottom  : 5,
  textTransform : 'uppercase',
  letterSpacing : '0.4px',
};

const EXAMPLE = {
  description : 'Internal employee IDs: EMP- followed by exactly 6 digits',
  examples    : 'EMP-123456\nEMP-000981\nemp-554433',
  negatives   : 'EMP-12345\nEMP-1234567\nTEMP-123456',
};

function lines(value) {
  return value.split('\n').map(l => l.trim()).filter(Boolean);
}

function TestTable({ tests }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
            {['', 'Example', 'Expected', 'Matched'].map(h => (
              <th key={h} style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--color-muted)', fontWeight: 600 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tests.map((t, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
              <td style={{ padding: '6px 8px', fontWeight: 700, color: t.passed ? 'var(--color-success)' : 'var(--color-danger)' }}>
                {t.passed ? '✓' : '✗'}
              </td>
              <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)' }}>{t.text}</td>
              <td style={{ padding: '6px 8px', color: 'var(--color-text-dim)' }}>{t.expected ? 'match' : 'no match'}</td>
              <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)', color: 'var(--color-text-dim)' }}>
                {t.matched ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Notes({ items, tone }) {
  if (!items?.length) return null;
  const color = tone === 'danger' ? 'var(--color-danger)' : 'var(--color-warning)';
  return (
    <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color }}>
      {items.map(item => <li key={item}>{item}</li>)}
    </ul>
  );
}

export default function RuleGenerator({ onUse }) {
  const [description, setDescription] = useState('');
  const [examples,    setExamples]    = useState('');
  const [negatives,   setNegatives]   = useState('');
  const [result,      setResult]      = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);

  const canGenerate = description.trim().length >= 3 && lines(examples).length > 0 && !loading;

  async function handleGenerate() {
    if (!canGenerate) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await generateRule({
        description : description.trim(),
        examples    : lines(examples),
        negatives   : lines(negatives),
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleUse() {
    const { rule } = result;
    onUse({
      pattern     : rule.pattern,
      name        : rule.name,
      category    : rule.category,
      severity    : rule.severity,
      description : rule.explanation || description.trim(),
    });
  }

  function fillExample() {
    setDescription(EXAMPLE.description);
    setExamples(EXAMPLE.examples);
    setNegatives(EXAMPLE.negatives);
    setResult(null);
    setError(null);
  }

  const passed = result?.tests.filter(t => t.passed).length ?? 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 8 }}>
        <p style={{ fontSize: 12, color: 'var(--color-muted)', margin: 0 }}>
          Describe the data and give examples. A local LLM writes the regex; PromptGuard tests it before you save.
        </p>
        <button className="btn btn-ghost" onClick={fillExample} style={{ fontSize: 11, padding: '3px 10px', flexShrink: 0 }}>
          Try an example
        </button>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>What should it detect? <span style={{ color: 'var(--color-danger)' }}>*</span></label>
        <textarea
          rows={2}
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="e.g. Internal employee IDs: EMP- followed by 6 digits"
          maxLength={500}
          style={inputStyle}
          disabled={loading}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 14 }}>
        <div>
          <label style={labelStyle}>Should match <span style={{ color: 'var(--color-danger)' }}>*</span></label>
          <textarea
            rows={4}
            value={examples}
            onChange={e => setExamples(e.target.value)}
            placeholder={'One value per line\nEMP-123456'}
            style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            disabled={loading}
          />
        </div>
        <div>
          <label style={labelStyle}>Should not match</label>
          <textarea
            rows={4}
            value={negatives}
            onChange={e => setNegatives(e.target.value)}
            placeholder={'Optional, one per line\nEMP-12345'}
            style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            disabled={loading}
          />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
        {loading && (
          <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>
            The local LLM can take up to a minute…
          </span>
        )}
        <button className="btn btn-primary" onClick={handleGenerate} disabled={!canGenerate} style={{ minWidth: 150 }}>
          {loading ? 'Generating…' : result ? '↻ Generate again' : '✨ Generate regex'}
        </button>
      </div>

      {error && (
        <div style={{
          marginTop    : 14,
          background   : '#fdecea',
          border       : '1px solid var(--color-danger)',
          borderRadius : 'var(--radius)',
          padding      : '10px 14px',
          color        : 'var(--color-danger)',
          fontSize     : 13,
        }}>
          ⚠ {error}
        </div>
      )}

      {result && (
        <div style={{
          marginTop    : 16,
          background   : 'var(--color-bg)',
          border       : `1px solid ${result.verified ? 'var(--color-success)' : 'var(--color-warning)'}`,
          borderRadius : 'var(--radius)',
          padding      : '12px 14px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: result.verified ? 'var(--color-success)' : 'var(--color-warning)' }}>
              {result.verified
                ? `✓ All ${result.tests.length} tests passed in JavaScript`
                : `${passed} of ${result.tests.length} tests passed — review before using`}
            </span>
            <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>
              {result.rule.strategy === 'EXAMPLES'
                ? `Pattern inferred from your examples${result.model ? `, named by ${result.model}` : ' (local LLM unavailable)'}`
                : `Written by ${result.model}`}
              {' · '}{result.attempts} LLM attempt{result.attempts !== 1 ? 's' : ''} · {(result.durationMs / 1000).toFixed(1)}s
            </span>
          </div>

          <code style={{
            display      : 'block',
            fontFamily   : 'var(--font-mono)',
            fontSize     : 13,
            background   : 'var(--color-surface)',
            border       : '1px solid var(--color-border)',
            borderRadius : 4,
            padding      : '8px 10px',
            wordBreak    : 'break-all',
            marginBottom : 8,
          }}>
            {result.rule.pattern}
          </code>

          {result.rule.explanation && (
            <p style={{ fontSize: 12, color: 'var(--color-text-dim)', margin: '0 0 10px' }}>{result.rule.explanation}</p>
          )}

          <TestTable tests={result.tests} />
          <Notes items={result.rule.problems} tone="danger" />
          <Notes items={result.rule.warnings} tone="warning" />

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button
              className="btn btn-primary"
              onClick={handleUse}
              disabled={result.rule.problems.length > 0}
              title={result.rule.problems.length > 0 ? 'This pattern has problems that would break the scanner' : undefined}
            >
              Use this rule →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
