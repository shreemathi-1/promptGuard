/**
 * Banners shown above scan / mask results:
 *   - red banner when the prompt-injection model flags the text
 *   - notice when the ML service was unreachable and the scan fell back to regex
 *
 * Props:
 *   result — DetectionResult fields from /api/scan or /api/mask
 *            { mode, effectiveMode, aiAvailable, injection }
 */

function Banner({ tone, icon, title, children }) {
  const palette = tone === 'danger'
    ? { bg: '#fdecea', border: 'var(--color-danger)',  color: 'var(--color-danger)'  }
    : { bg: '#fdf3e1', border: 'var(--color-warning)', color: 'var(--color-warning)' };

  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      style={{
        display      : 'flex',
        gap          : 12,
        alignItems   : 'flex-start',
        background   : palette.bg,
        border       : `1px solid ${palette.border}`,
        borderLeft   : `4px solid ${palette.border}`,
        borderRadius : 'var(--radius)',
        padding      : '12px 16px',
        marginBottom : 16,
      }}
    >
      <span style={{ fontSize: 18, lineHeight: 1.3 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: palette.color, marginBottom: 2 }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-dim)', lineHeight: 1.5 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

export default function AiStatusBanner({ result }) {
  if (!result) return null;

  const { mode, effectiveMode, aiAvailable, injection } = result;
  const fellBack = mode && effectiveMode && mode !== effectiveMode;

  return (
    <>
      {injection?.isInjection && (
        <Banner tone="danger" icon="🛑" title="Prompt injection detected">
          The injection model scored this text{' '}
          <strong className="mono">{Math.round(injection.score * 100)}%</strong>{' '}
          likely to be a jailbreak or instruction-override attempt. Review it before
          sending it to an LLM.
        </Banner>
      )}

      {fellBack && (
        <Banner tone="warning" icon="⚠️" title="AI service unavailable — ran in regex-only mode">
          {mode} mode was requested, but the ML service didn't respond, so only regex
          rules were applied. Names, places and other unstructured PII may be missed.
        </Banner>
      )}

      {!fellBack && aiAvailable === false && mode !== 'REGEX' && (
        <Banner tone="warning" icon="⚠️" title="Prompt-injection check unavailable">
          The ML service didn't answer the injection check for this scan.
        </Banner>
      )}
    </>
  );
}
