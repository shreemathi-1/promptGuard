import { useEffect } from 'react';
import RiskScore    from './RiskScore';
import SeverityTag  from './SeverityTag';

/**
 * Slide-in drawer that shows the full detail of one audit log record.
 *
 * Props:
 *   record   — AuditRecord | null
 *   onClose  — () => void
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

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize      : 11,
        fontWeight    : 600,
        color         : 'var(--color-muted)',
        textTransform : 'uppercase',
        letterSpacing : '0.5px',
        marginBottom  : 5,
      }}>
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

export default function AuditDetailDrawer({ record, onClose }) {
  // Close on Escape key
  useEffect(() => {
    if (!record) return;
    function handler(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [record, onClose]);

  if (!record) return null;

  const detections = Array.isArray(record.detections) ? record.detections : [];

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position   : 'fixed',
          inset      : 0,
          background : 'rgba(0,0,0,0.55)',
          zIndex     : 200,
        }}
      />

      {/* Drawer panel */}
      <div style={{
        position   : 'fixed',
        top        : 0,
        right      : 0,
        bottom     : 0,
        width      : 'min(520px, 100vw)',
        background : 'var(--color-surface)',
        borderLeft : '1px solid var(--color-border)',
        zIndex     : 201,
        display    : 'flex',
        flexDirection: 'column',
        overflowY  : 'auto',
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
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Audit Record</div>
            <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
              {record.id}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background   : 'transparent',
              border       : '1px solid var(--color-border)',
              color        : 'var(--color-text-dim)',
              borderRadius : 6,
              width        : 32,
              height       : 32,
              fontSize     : 18,
              cursor       : 'pointer',
              display      : 'flex',
              alignItems   : 'center',
              justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '24px', flex: 1 }}>

          {/* Meta row */}
          <div style={{
            display             : 'grid',
            gridTemplateColumns : '1fr 1fr',
            gap                 : 12,
            marginBottom        : 20,
          }}>
            <div className="card" style={{ padding: '12px 14px' }}>
              <div style={{ fontSize: 11, color: 'var(--color-muted)', marginBottom: 4 }}>RISK SCORE</div>
              <RiskScore score={record.riskScore} showBar={false} />
            </div>
            <div className="card" style={{ padding: '12px 14px' }}>
              <div style={{ fontSize: 11, color: 'var(--color-muted)', marginBottom: 4 }}>DETECTIONS</div>
              <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--color-primary)' }}>
                {record.detectionCount}
              </span>
            </div>
          </div>

          <Field label="Timestamp">
            <span className="mono" style={{ fontSize: 13 }}>
              {new Date(record.createdAt).toLocaleString()}
            </span>
          </Field>

          <Field label="Operation">
            <span style={{
              display      : 'inline-block',
              padding      : '3px 10px',
              borderRadius : 5,
              fontSize     : 12,
              fontWeight   : 700,
              background   : record.maskStyle ? 'var(--color-primary-dim)' : '#1a2a1a',
              color        : record.maskStyle ? 'var(--color-primary)'     : 'var(--color-success)',
            }}>
              {record.maskStyle ? `MASK · ${record.maskStyle}` : 'SCAN ONLY'}
            </span>
          </Field>

          {record.sourceIp && (
            <Field label="Source IP">
              <span className="mono" style={{ fontSize: 13 }}>{record.sourceIp}</span>
            </Field>
          )}

          <hr className="divider" />

          {/* Input text */}
          <Field label="Input Text">
            <div style={{
              background   : 'var(--color-bg)',
              border       : '1px solid var(--color-border)',
              borderRadius : 6,
              padding      : '10px 12px',
              maxHeight    : 140,
              overflowY    : 'auto',
            }}>
              <pre style={{
                fontFamily : 'var(--font-mono)',
                fontSize   : 12,
                lineHeight : 1.7,
                whiteSpace : 'pre-wrap',
                wordBreak  : 'break-word',
                margin     : 0,
                color      : 'var(--color-text-dim)',
              }}>
                {record.inputText}
              </pre>
            </div>
          </Field>

          {/* Masked text — only for mask operations */}
          {record.maskedText && (
            <Field label="Masked Text">
              <div style={{
                background   : 'var(--color-bg)',
                border       : '1px solid var(--color-border)',
                borderRadius : 6,
                padding      : '10px 12px',
                maxHeight    : 140,
                overflowY    : 'auto',
              }}>
                <pre style={{
                  fontFamily : 'var(--font-mono)',
                  fontSize   : 12,
                  lineHeight : 1.7,
                  whiteSpace : 'pre-wrap',
                  wordBreak  : 'break-word',
                  margin     : 0,
                  color      : 'var(--color-text)',
                }}>
                  {record.maskedText}
                </pre>
              </div>
            </Field>
          )}

          <hr className="divider" />

          {/* Detections */}
          <Field label={`Detections (${detections.length})`}>
            {detections.length === 0 ? (
              <span style={{ color: 'var(--color-muted)', fontSize: 13 }}>
                No sensitive data was detected.
              </span>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {detections.map((d, i) => (
                  <div key={i} style={{
                    background   : 'var(--color-bg)',
                    border       : '1px solid var(--color-border)',
                    borderRadius : 6,
                    padding      : '10px 12px',
                    display      : 'flex',
                    alignItems   : 'center',
                    gap          : 8,
                    flexWrap     : 'wrap',
                  }}>
                    <span style={{ fontSize: 15 }}>
                      {CATEGORY_ICONS[d.category] ?? '🔍'}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>
                      {d.patternName}
                    </span>
                    <SeverityTag severity={d.severity} />
                    <span className="mono" style={{
                      fontSize     : 12,
                      background   : 'rgba(239,68,68,0.12)',
                      color        : '#fca5a5',
                      padding      : '2px 6px',
                      borderRadius : 3,
                      maxWidth     : 160,
                      overflow     : 'hidden',
                      textOverflow : 'ellipsis',
                      whiteSpace   : 'nowrap',
                    }}
                    title={d.match}
                    >
                      {d.match}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Field>

        </div>
      </div>
    </>
  );
}