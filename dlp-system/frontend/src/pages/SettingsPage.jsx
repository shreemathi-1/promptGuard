import { useState, useEffect, useCallback } from 'react';
import {
  fetchSettings,
  updateSetting,
} from '../api/client';
import PageHeader from '../components/PageHeader';

// ── Constants ─────────────────────────────────────────────────────────────────

const SETTING_META = {
  mask_style: {
    label   : 'Default Mask Style',
    icon    : '🔐',
    hint    : 'Applied when a mask request does not specify a style.',
    options : [
      {
        value       : 'REDACT',
        label       : 'Redact',
        description : 'Replaces sensitive value with [CATEGORY REDACTED]',
        example     : '[CREDIT_CARD REDACTED]',
      },
      {
        value       : 'PARTIAL',
        label       : 'Partial',
        description : 'Masks all but the last 4 characters with asterisks',
        example     : '***************1111',
      },
      {
        value       : 'TOKENIZE',
        label       : 'Tokenize',
        description : 'Replaces with a deterministic UUID token',
        example     : '[TOKEN:a1b2c3d4-…]',
      },
    ],
  },
  sensitivity_level: {
    label   : 'Detection Sensitivity',
    icon    : '🎯',
    hint    : 'Sets the minimum severity level included in scan results.',
    options : [
      {
        value       : 'LOW',
        label       : 'Low',
        description : 'Report all detections including emails and phone numbers',
        example     : 'LOW · MEDIUM · HIGH · CRITICAL',
      },
      {
        value       : 'MEDIUM',
        label       : 'Medium',
        description : 'Skip low-severity matches, report MEDIUM and above',
        example     : 'MEDIUM · HIGH · CRITICAL',
      },
      {
        value       : 'HIGH',
        label       : 'High (default)',
        description : 'Only report HIGH and CRITICAL detections',
        example     : 'HIGH · CRITICAL',
      },
      {
        value       : 'CRITICAL',
        label       : 'Critical only',
        description : 'Only report the highest severity detections',
        example     : 'CRITICAL only',
      },
    ],
  },
  log_input_text: {
    label   : 'Log Input Text',
    icon    : '📋',
    hint    : 'When disabled, raw input is never stored in audit logs.',
    options : [
      {
        value       : 'true',
        label       : 'Enabled',
        description : 'Store the original input text in audit records',
        example     : 'Full text visible in audit log',
      },
      {
        value       : 'false',
        label       : 'Disabled (privacy mode)',
        description : 'Store a placeholder instead — audit log shows [INPUT LOGGING DISABLED]',
        example     : '[INPUT LOGGING DISABLED]',
      },
    ],
  },
};

// ── Helper: severity colour ───────────────────────────────────────────────────

function severityColor(level) {
  const map = {
    CRITICAL : 'var(--color-danger)',
    HIGH     : '#f97316',
    MEDIUM   : 'var(--color-warning)',
    LOW      : 'var(--color-success)',
  };
  return map[level] ?? 'var(--color-muted)';
}

// ── Option card (radio-style) ─────────────────────────────────────────────────

function OptionCard({ option, selected, onChange, disabled }) {
  const isActive = selected === option.value;

  return (
    <label style={{
      display      : 'flex',
      alignItems   : 'flex-start',
      gap          : 12,
      padding      : '12px 14px',
      background   : isActive ? 'var(--color-primary-dim)' : 'var(--color-bg)',
      border       : `1px solid ${isActive ? 'var(--color-primary)' : 'var(--color-border)'}`,
      borderRadius : 'var(--radius)',
      cursor       : disabled ? 'not-allowed' : 'pointer',
      transition   : 'background 0.15s, border-color 0.15s',
      opacity      : disabled ? 0.55 : 1,
    }}>
      <input
        type="radio"
        checked={isActive}
        onChange={() => !disabled && onChange(option.value)}
        disabled={disabled}
        style={{ marginTop: 3, accentColor: 'var(--color-primary)', flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontWeight : 700,
          fontSize   : 13,
          color      : isActive ? 'var(--color-primary)' : 'var(--color-text)',
          marginBottom: 3,
        }}>
          {option.label}
        </div>
        <div style={{
          fontSize   : 12,
          color      : 'var(--color-muted)',
          lineHeight : 1.5,
          marginBottom: 6,
        }}>
          {option.description}
        </div>
        <div style={{
          fontFamily   : 'var(--font-mono)',
          fontSize     : 11,
          color        : isActive ? 'var(--color-primary)' : 'var(--color-text-dim)',
          background   : 'var(--color-surface)',
          border       : '1px solid var(--color-border)',
          borderRadius : 4,
          padding      : '2px 7px',
          display      : 'inline-block',
        }}>
          {option.example}
        </div>
      </div>
    </label>
  );
}

// ── Single setting card ───────────────────────────────────────────────────────

function SettingCard({ settingKey, setting, onSave }) {
  const meta = SETTING_META[settingKey];

  const [localValue, setLocalValue] = useState(setting.value);
  const [saving,     setSaving]     = useState(false);
  const [saveError,  setSaveError]  = useState(null);
  const [savedAt,    setSavedAt]    = useState(null);

  // Sync if parent setting changes (e.g. after initial load)
  useEffect(() => {
    setLocalValue(setting.value);
  }, [setting.value]);

  const isDirty = localValue !== setting.value;

  async function handleSave() {
    if (!isDirty) return;

    setSaving(true);
    setSaveError(null);

    try {
      await onSave(settingKey, localValue);
      setSavedAt(new Date());
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleDiscard() {
    setLocalValue(setting.value);
    setSaveError(null);
  }

  if (!meta) return null;

  return (
    <div className="card" style={{ marginBottom: 16 }}>

      {/* Card header */}
      <div style={{
        display        : 'flex',
        justifyContent : 'space-between',
        alignItems     : 'flex-start',
        marginBottom   : 16,
        flexWrap       : 'wrap',
        gap            : 8,
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>{meta.icon}</span>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{meta.label}</span>
            {isDirty && (
              <span style={{
                fontSize     : 10,
                background   : '#422006',
                color        : '#fcd34d',
                border       : '1px solid #78350f',
                borderRadius : 4,
                padding      : '2px 6px',
                fontWeight   : 700,
                letterSpacing: '0.4px',
              }}>
                UNSAVED
              </span>
            )}
          </div>
          <p style={{
            fontSize   : 12,
            color      : 'var(--color-muted)',
            marginTop  : 4,
            lineHeight : 1.5,
          }}>
            {meta.hint}
          </p>
        </div>

        {/* Saved timestamp */}
        {savedAt && !isDirty && (
          <div style={{
            fontSize   : 11,
            color      : 'var(--color-success)',
            fontWeight : 600,
            textAlign  : 'right',
          }}>
            ✓ Saved at {savedAt.toLocaleTimeString()}
          </div>
        )}
      </div>

      {/* Option cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        {meta.options.map(option => (
          <OptionCard
            key={option.value}
            option={option}
            selected={localValue}
            onChange={setLocalValue}
            disabled={saving}
          />
        ))}
      </div>

      {/* Save error */}
      {saveError && (
        <div style={{
          background   : '#450a0a',
          border       : '1px solid #7f1d1d',
          borderRadius : 'var(--radius)',
          padding      : '10px 14px',
          color        : '#fca5a5',
          fontSize     : 13,
          marginBottom : 12,
          display      : 'flex',
          justifyContent: 'space-between',
          alignItems   : 'center',
        }}>
          <span>⚠ {saveError}</span>
          <button
            onClick={() => setSaveError(null)}
            style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 16 }}
          >
            ×
          </button>
        </div>
      )}

      {/* Action buttons */}
      <div style={{
        display    : 'flex',
        gap        : 8,
        justifyContent: 'flex-end',
      }}>
        {isDirty && (
          <button
            className="btn btn-ghost"
            onClick={handleDiscard}
            disabled={saving}
          >
            Discard
          </button>
        )}
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={!isDirty || saving}
          style={{ minWidth: 100 }}
        >
          {saving ? 'Saving…' : isDirty ? '✓ Save' : 'Saved'}
        </button>
      </div>
    </div>
  );
}

// ── About card ────────────────────────────────────────────────────────────────

function AboutCard() {
  const routes = [
    { method: 'GET',    path: '/api/health',        desc: 'System + DB status'         },
    { method: 'POST',   path: '/api/scan',           desc: 'Detect sensitive data'      },
    { method: 'POST',   path: '/api/mask',           desc: 'Detect + mask'              },
    { method: 'GET',    path: '/api/audit',          desc: 'Paginated audit log'        },
    { method: 'GET',    path: '/api/audit/:id',      desc: 'Single audit record'        },
    { method: 'GET',    path: '/api/rules',          desc: 'List scan patterns'         },
    { method: 'POST',   path: '/api/rules',          desc: 'Create custom rule'         },
    { method: 'PUT',    path: '/api/rules/:id',      desc: 'Update rule'                },
    { method: 'DELETE', path: '/api/rules/:id',      desc: 'Delete rule'                },
    { method: 'PATCH',  path: '/api/rules/:id/toggle', desc: 'Toggle rule active state' },
    { method: 'GET',    path: '/api/risk/summary',   desc: 'Risk analytics'             },
    { method: 'POST',   path: '/api/risk/score',     desc: 'Score detections on-demand' },
    { method: 'GET',    path: '/api/export/audit',   desc: 'Export CSV / JSON'          },
    { method: 'GET',    path: '/api/settings',       desc: 'List all settings'          },
    { method: 'PUT',    path: '/api/settings/:key',  desc: 'Update single setting'      },
    { method: 'PUT',    path: '/api/settings',       desc: 'Bulk update settings'       },
  ];

  const METHOD_COLORS = {
    GET    : { bg: '#052e16', color: '#86efac' },
    POST   : { bg: '#1e3a6e', color: '#93c5fd' },
    PUT    : { bg: '#422006', color: '#fcd34d' },
    DELETE : { bg: '#450a0a', color: '#fca5a5' },
    PATCH  : { bg: '#2d1b69', color: '#c4b5fd' },
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{
        fontSize      : 11,
        fontWeight    : 700,
        color         : 'var(--color-muted)',
        textTransform : 'uppercase',
        letterSpacing : '0.5px',
        marginBottom  : 16,
      }}>
        System Information
      </div>

      {/* Version info */}
      <div style={{
        display             : 'grid',
        gridTemplateColumns : 'repeat(auto-fit, minmax(140px, 1fr))',
        gap                 : 10,
        marginBottom        : 20,
      }}>
        {[
          { label: 'Version',   value: '1.0.0'      },
          { label: 'Features',  value: '20 / 20'    },
          { label: 'API Base',  value: ':4000'      },
          { label: 'Frontend',  value: ':5173'      },
        ].map(item => (
          <div key={item.label} style={{
            background   : 'var(--color-bg)',
            border       : '1px solid var(--color-border)',
            borderRadius : 6,
            padding      : '10px 12px',
          }}>
            <div style={{
              fontSize   : 14,
              fontWeight : 800,
              color      : 'var(--color-primary)',
              fontFamily : 'var(--font-mono)',
              lineHeight : 1,
              marginBottom: 4,
            }}>
              {item.value}
            </div>
            <div style={{
              fontSize      : 11,
              color         : 'var(--color-muted)',
              textTransform : 'uppercase',
              letterSpacing : '0.5px',
            }}>
              {item.label}
            </div>
          </div>
        ))}
      </div>

      <hr className="divider" />

      {/* API route map */}
      <div style={{
        fontSize      : 11,
        fontWeight    : 700,
        color         : 'var(--color-muted)',
        textTransform : 'uppercase',
        letterSpacing : '0.5px',
        marginBottom  : 10,
      }}>
        API Surface ({routes.length} endpoints)
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {routes.map((r, i) => {
          const palette = METHOD_COLORS[r.method] ?? METHOD_COLORS.GET;
          return (
            <div key={i} style={{
              display    : 'flex',
              alignItems : 'center',
              gap        : 10,
              padding    : '6px 10px',
              background : 'var(--color-bg)',
              borderRadius: 5,
            }}>
              <span style={{
                fontSize     : 10,
                fontWeight   : 800,
                background   : palette.bg,
                color        : palette.color,
                borderRadius : 4,
                padding      : '2px 6px',
                minWidth     : 48,
                textAlign    : 'center',
                fontFamily   : 'var(--font-mono)',
                letterSpacing: '0.3px',
              }}>
                {r.method}
              </span>
              <span style={{
                fontFamily   : 'var(--font-mono)',
                fontSize     : 12,
                color        : 'var(--color-text-dim)',
                flex         : 1,
              }}>
                {r.path}
              </span>
              <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>
                {r.desc}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Danger zone card ──────────────────────────────────────────────────────────

function DangerZoneCard({ onResetSettings }) {
  const [confirming, setConfirming] = useState(false);
  const [resetting,  setResetting]  = useState(false);
  const [done,       setDone]       = useState(false);

  async function handleReset() {
    setResetting(true);
    try {
      await onResetSettings();
      setDone(true);
      setConfirming(false);
      setTimeout(() => setDone(false), 3000);
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="card" style={{
      border : '1px solid #7f1d1d',
    }}>
      <div style={{
        fontSize      : 11,
        fontWeight    : 700,
        color         : 'var(--color-danger)',
        textTransform : 'uppercase',
        letterSpacing : '0.5px',
        marginBottom  : 12,
      }}>
        ⚠ Danger Zone
      </div>

      <div style={{
        display        : 'flex',
        justifyContent : 'space-between',
        alignItems     : 'flex-start',
        gap            : 16,
        flexWrap       : 'wrap',
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
            Reset settings to defaults
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-muted)', lineHeight: 1.5 }}>
            Restores mask_style → REDACT, sensitivity_level → HIGH,
            log_input_text → true.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          {done && (
            <span style={{ fontSize: 12, color: 'var(--color-success)', fontWeight: 600 }}>
              ✓ Reset complete
            </span>
          )}
          {confirming ? (
            <>
              <button
                onClick={handleReset}
                disabled={resetting}
                style={{
                  background   : 'var(--color-danger)',
                  border       : 'none',
                  color        : '#fff',
                  borderRadius : 'var(--radius)',
                  padding      : '8px 16px',
                  fontWeight   : 700,
                  fontSize     : 13,
                  cursor       : resetting ? 'not-allowed' : 'pointer',
                  opacity      : resetting ? 0.5 : 1,
                }}
              >
                {resetting ? 'Resetting…' : 'Confirm Reset'}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => setConfirming(false)}
                disabled={resetting}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              className="btn btn-ghost"
              onClick={() => setConfirming(true)}
              style={{ color: 'var(--color-danger)', borderColor: '#7f1d1d' }}
            >
              Reset to defaults
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [settings, setSettings] = useState({});   // { [key]: Setting }
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);

  // ── Fetch settings ────────────────────────────────────────────────────────

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSettings();
      const map  = {};
      for (const s of data.settings) {
        map[s.key] = s;
      }
      setSettings(map);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // ── Save handler ──────────────────────────────────────────────────────────

  async function handleSave(key, value) {
    const updated = await updateSetting(key, value);
    setSettings(prev => ({
      ...prev,
      [key]: updated,
    }));
  }

  // ── Reset to defaults ─────────────────────────────────────────────────────

  async function handleResetSettings() {
    const defaults = {
      mask_style       : 'REDACT',
      sensitivity_level: 'HIGH',
      log_input_text   : 'true',
    };

    for (const [key, value] of Object.entries(defaults)) {
      await updateSetting(key, value);
    }

    await loadSettings();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <div style={{
        display        : 'flex',
        justifyContent : 'space-between',
        alignItems     : 'flex-start',
        marginBottom   : 28,
        flexWrap       : 'wrap',
        gap            : 12,
      }}>
        <PageHeader
          title="Settings"
          subtitle="System-wide configuration for the DLP engine. Changes take effect immediately."
        />
        <button
          className="btn btn-ghost"
          style={{ fontSize: 12, padding: '6px 12px' }}
          onClick={loadSettings}
          disabled={loading}
        >
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>

      {/* Load error */}
      {error && (
        <div style={{
          background   : '#450a0a',
          border       : '1px solid #7f1d1d',
          borderRadius : 'var(--radius)',
          padding      : '12px 16px',
          color        : '#fca5a5',
          fontSize     : 13,
          marginBottom : 20,
          display      : 'flex',
          justifyContent: 'space-between',
          alignItems   : 'center',
        }}>
          <span>⚠ Failed to load settings: {error}</span>
          <button
            onClick={loadSettings}
            style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontWeight: 700 }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && Object.keys(settings).length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--color-muted)' }}>
          Loading settings…
        </div>
      )}

      {/* Setting cards */}
      {!loading && Object.keys(settings).length > 0 && (
        <div style={{ opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s' }}>

          {/* Render each known setting */}
          {Object.keys(SETTING_META).map(key => {
            const setting = settings[key];
            if (!setting) return null;
            return (
              <SettingCard
                key={key}
                settingKey={key}
                setting={setting}
                onSave={handleSave}
              />
            );
          })}

          <hr className="divider" />

          {/* Danger zone */}
          <DangerZoneCard onResetSettings={handleResetSettings} />

          <hr className="divider" />

          {/* About / API surface */}
          <AboutCard />
        </div>
      )}
    </div>
  );
}