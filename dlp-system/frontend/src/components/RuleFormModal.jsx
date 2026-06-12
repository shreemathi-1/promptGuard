import { useState, useEffect, useRef } from 'react';

/**
 * Modal for creating or editing a custom rule.
 *
 * Props:
 *   mode      — 'create' | 'edit'
 *   rule      — existing rule object (edit mode only)
 *   onSubmit  — async (payload) => void
 *   onClose   — () => void
 */

const CATEGORIES = [
  'CREDIT_CARD', 'PHONE', 'SSN', 'BANK_ACCOUNT',
  'EMAIL', 'PASSPORT', 'API_KEY', 'CUSTOM',
];

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const SEVERITY_COLORS = {
  CRITICAL : '#ef4444',
  HIGH     : '#f97316',
  MEDIUM   : '#f59e0b',
  LOW      : '#22c55e',
};

const EMPTY_FORM = {
  name        : '',
  pattern     : '',
  category    : 'CUSTOM',
  severity    : 'HIGH',
  description : '',
  isActive    : true,
};

/**
 * Safely tests a regex pattern against sample text.
 * Returns { valid, matchCount, error }.
 */
function testPattern(pattern, sampleText) {
  if (!pattern.trim()) return { valid: false, matchCount: 0, error: null };
  try {
    const re      = new RegExp(pattern, 'gi');
    const matches = sampleText.match(re) ?? [];
    return { valid: true, matchCount: matches.length, error: null };
  } catch (err) {
    return { valid: false, matchCount: 0, error: err.message };
  }
}

// ── Field wrapper ─────────────────────────────────────────────────────────────

function Field({ label, required, hint, error, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{
        display      : 'block',
        fontSize     : 12,
        fontWeight   : 600,
        color        : error ? 'var(--color-danger)' : 'var(--color-text-dim)',
        marginBottom : 5,
        textTransform: 'uppercase',
        letterSpacing: '0.4px',
      }}>
        {label}
        {required && <span style={{ color: 'var(--color-danger)', marginLeft: 3 }}>*</span>}
      </label>
      {children}
      {hint && !error && (
        <p style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 4 }}>{hint}</p>
      )}
      {error && (
        <p style={{ fontSize: 11, color: 'var(--color-danger)', marginTop: 4 }}>⚠ {error}</p>
      )}
    </div>
  );
}

// ── Input style ───────────────────────────────────────────────────────────────

const inputStyle = {
  width        : '100%',
  background   : 'var(--color-bg)',
  border       : '1px solid var(--color-border)',
  borderRadius : 'var(--radius)',
  color        : 'var(--color-text)',
  padding      : '9px 12px',
  fontSize     : 13,
  outline      : 'none',
  transition   : 'border-color 0.15s',
  boxSizing    : 'border-box',
};

const inputFocusStyle = { borderColor: 'var(--color-primary)' };
const inputErrorStyle = { borderColor: 'var(--color-danger)' };

// ── Main modal ────────────────────────────────────────────────────────────────

export default function RuleFormModal({ mode, rule, onSubmit, onClose }) {
  const isEdit    = mode === 'edit';
  const titleText = isEdit ? 'Edit Rule' : 'Create Custom Rule';

  const [form,       setForm]       = useState(() =>
    isEdit
      ? {
          name        : rule.name        ?? '',
          pattern     : rule.pattern     ?? '',
          category    : rule.category    ?? 'CUSTOM',
          severity    : rule.severity    ?? 'HIGH',
          description : rule.description ?? '',
          isActive    : rule.isActive    ?? true,
        }
      : { ...EMPTY_FORM }
  );

  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [submitting,  setSubmitting]  = useState(false);
  const [sampleText,  setSampleText]  = useState(
    'Test input: john@example.com, 4111 1111 1111 1111, (555) 867-5309'
  );

  const nameRef = useRef(null);

  // Auto-focus name field on open
  useEffect(() => {
    setTimeout(() => nameRef.current?.focus(), 50);
  }, []);

  // Close on Escape
  useEffect(() => {
    function handler(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // ── Live regex test ───────────────────────────────────────────────────────

  const regexTest = testPattern(form.pattern, sampleText);

  // ── Handlers ──────────────────────────────────────────────────────────────

  function setField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
    setFieldErrors(prev => ({ ...prev, [key]: undefined }));
    setSubmitError(null);
  }

  function validate() {
    const errors = {};
    if (!form.name.trim())          errors.name    = 'Name is required';
    if (!form.pattern.trim())       errors.pattern = 'Pattern is required';
    else if (!regexTest.valid)      errors.pattern = regexTest.error;
    if (!form.category)             errors.category = 'Category is required';
    if (!form.severity)             errors.severity = 'Severity is required';
    return errors;
  }

  async function handleSubmit() {
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const payload = {
        name        : form.name.trim(),
        pattern     : form.pattern.trim(),
        category    : form.category,
        severity    : form.severity,
        description : form.description.trim() || null,
        isActive    : form.isActive,
      };
      await onSubmit(payload);
      onClose();
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position   : 'fixed',
          inset      : 0,
          background : 'rgba(0,0,0,0.6)',
          zIndex     : 300,
        }}
      />

      {/* Modal */}
      <div style={{
        position     : 'fixed',
        top          : '50%',
        left         : '50%',
        transform    : 'translate(-50%, -50%)',
        width        : 'min(600px, 95vw)',
        maxHeight    : '90vh',
        overflowY    : 'auto',
        background   : 'var(--color-surface)',
        border       : '1px solid var(--color-border)',
        borderRadius : 12,
        zIndex       : 301,
        display      : 'flex',
        flexDirection: 'column',
      }}>

        {/* Header */}
        <div style={{
          display        : 'flex',
          justifyContent : 'space-between',
          alignItems     : 'center',
          padding        : '18px 24px',
          borderBottom   : '1px solid var(--color-border)',
          position       : 'sticky',
          top            : 0,
          background     : 'var(--color-surface)',
          zIndex         : 1,
        }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{titleText}</div>
          <button
            onClick={onClose}
            style={{
              background    : 'transparent',
              border        : '1px solid var(--color-border)',
              color         : 'var(--color-text-dim)',
              borderRadius  : 6,
              width         : 32,
              height        : 32,
              fontSize      : 18,
              cursor        : 'pointer',
              display       : 'flex',
              alignItems    : 'center',
              justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '24px' }}>

          {/* Name */}
          <Field label="Rule Name" required error={fieldErrors.name}>
            <input
              ref={nameRef}
              type="text"
              value={form.name}
              onChange={e => setField('name', e.target.value)}
              placeholder="e.g. Internal Employee ID"
              style={{
                ...inputStyle,
                ...(fieldErrors.name ? inputErrorStyle : {}),
              }}
              onFocus={e  => !fieldErrors.name && (e.target.style.borderColor = 'var(--color-primary)')}
              onBlur={e   => (e.target.style.borderColor = fieldErrors.name ? 'var(--color-danger)' : 'var(--color-border)')}
              maxLength={100}
              disabled={submitting}
            />
          </Field>

          {/* Pattern */}
          <Field
            label="Regex Pattern"
            required
            hint="Standard JavaScript regex. No surrounding slashes needed."
            error={fieldErrors.pattern}
          >
            <input
              type="text"
              value={form.pattern}
              onChange={e => setField('pattern', e.target.value)}
              placeholder="e.g. EMP-[0-9]{6}"
              style={{
                ...inputStyle,
                fontFamily   : 'var(--font-mono)',
                fontSize     : 13,
                ...(fieldErrors.pattern ? inputErrorStyle : {}),
              }}
              onFocus={e  => !fieldErrors.pattern && (e.target.style.borderColor = 'var(--color-primary)')}
              onBlur={e   => (e.target.style.borderColor = fieldErrors.pattern ? 'var(--color-danger)' : 'var(--color-border)')}
              disabled={submitting}
            />

            {/* Live regex tester */}
            {form.pattern.trim() && (
              <div style={{
                marginTop    : 8,
                background   : 'var(--color-bg)',
                border       : `1px solid ${regexTest.valid ? 'var(--color-border)' : 'var(--color-danger)'}`,
                borderRadius : 6,
                padding      : '10px 12px',
              }}>
                <div style={{
                  display        : 'flex',
                  justifyContent : 'space-between',
                  alignItems     : 'center',
                  marginBottom   : 8,
                }}>
                  <span style={{ fontSize: 11, color: 'var(--color-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                    Live Tester
                  </span>
                  <span style={{
                    fontSize   : 12,
                    fontWeight : 700,
                    color      : regexTest.valid
                      ? regexTest.matchCount > 0
                        ? 'var(--color-success)'
                        : 'var(--color-muted)'
                      : 'var(--color-danger)',
                  }}>
                    {regexTest.valid
                      ? regexTest.matchCount > 0
                        ? `✓ ${regexTest.matchCount} match${regexTest.matchCount > 1 ? 'es' : ''}`
                        : '○ No matches'
                      : '✗ Invalid regex'}
                  </span>
                </div>
                <input
                  type="text"
                  value={sampleText}
                  onChange={e => setSampleText(e.target.value)}
                  placeholder="Type sample text to test against…"
                  style={{
                    ...inputStyle,
                    padding  : '7px 10px',
                    fontSize : 12,
                    border   : '1px solid var(--color-border)',
                  }}
                  onFocus={e  => (e.target.style.borderColor = 'var(--color-primary)')}
                  onBlur={e   => (e.target.style.borderColor = 'var(--color-border)')}
                />
              </div>
            )}
          </Field>

          {/* Category + Severity — side by side */}
          <div style={{
            display             : 'grid',
            gridTemplateColumns : '1fr 1fr',
            gap                 : 12,
          }}>
            <Field label="Category" required error={fieldErrors.category}>
              <select
                value={form.category}
                onChange={e => setField('category', e.target.value)}
                style={{
                  ...inputStyle,
                  cursor : 'pointer',
                }}
                disabled={submitting}
              >
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>

            <Field label="Severity" required error={fieldErrors.severity}>
              <select
                value={form.severity}
                onChange={e => setField('severity', e.target.value)}
                style={{
                  ...inputStyle,
                  cursor : 'pointer',
                  color  : SEVERITY_COLORS[form.severity] ?? 'var(--color-text)',
                  fontWeight: 700,
                }}
                disabled={submitting}
              >
                {SEVERITIES.map(s => (
                  <option key={s} value={s} style={{ color: SEVERITY_COLORS[s], fontWeight: 700 }}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* Description */}
          <Field label="Description" hint="Optional. Explain what this rule detects.">
            <textarea
              value={form.description}
              onChange={e => setField('description', e.target.value)}
              placeholder="e.g. Matches internal employee ID format EMP-XXXXXX"
              rows={2}
              maxLength={500}
              style={{
                ...inputStyle,
                resize     : 'vertical',
                lineHeight : 1.6,
              }}
              onFocus={e  => (e.target.style.borderColor = 'var(--color-primary)')}
              onBlur={e   => (e.target.style.borderColor = 'var(--color-border)')}
              disabled={submitting}
            />
            <p style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 3, textAlign: 'right' }}>
              {form.description.length} / 500
            </p>
          </Field>

          {/* Active toggle */}
          <div style={{
            display    : 'flex',
            alignItems : 'center',
            gap        : 10,
            padding    : '10px 14px',
            background : 'var(--color-bg)',
            border     : '1px solid var(--color-border)',
            borderRadius: 'var(--radius)',
          }}>
            <button
              role="switch"
              aria-checked={form.isActive}
              onClick={() => setField('isActive', !form.isActive)}
              disabled={submitting}
              style={{
                width        : 40,
                height       : 22,
                borderRadius : 11,
                border       : 'none',
                background   : form.isActive ? 'var(--color-success)' : 'var(--color-border)',
                cursor       : 'pointer',
                position     : 'relative',
                transition   : 'background 0.2s',
                flexShrink   : 0,
              }}
            >
              <span style={{
                position   : 'absolute',
                top        : 2,
                left       : form.isActive ? 20 : 2,
                width      : 18,
                height     : 18,
                borderRadius: '50%',
                background : '#fff',
                transition : 'left 0.2s',
              }} />
            </button>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {form.isActive ? 'Active' : 'Inactive'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>
                {form.isActive
                  ? 'Rule will run on every scan'
                  : 'Rule will be saved but not run'}
              </div>
            </div>
          </div>

          {/* Submit error */}
          {submitError && (
            <div style={{
              marginTop    : 14,
              background   : '#450a0a',
              border       : '1px solid #7f1d1d',
              borderRadius : 'var(--radius)',
              padding      : '10px 14px',
              color        : '#fca5a5',
              fontSize     : 13,
            }}>
              ⚠ {submitError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display        : 'flex',
          justifyContent : 'flex-end',
          gap            : 8,
          padding        : '16px 24px',
          borderTop      : '1px solid var(--color-border)',
          position       : 'sticky',
          bottom         : 0,
          background     : 'var(--color-surface)',
        }}>
          <button
            className="btn btn-ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={submitting}
            style={{ minWidth: 110 }}
          >
            {submitting
              ? (isEdit ? 'Saving…' : 'Creating…')
              : (isEdit ? '✓ Save Changes' : '+ Create Rule')}
          </button>
        </div>
      </div>
    </>
  );
}