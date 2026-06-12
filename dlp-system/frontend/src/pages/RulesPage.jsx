import { useState, useEffect, useCallback } from 'react';
import {
  fetchRules,
  createRule,
  updateRule,
  deleteRule,
  toggleRule,
} from '../api/client';
import PageHeader    from '../components/PageHeader';
import SeverityTag   from '../components/SeverityTag';
import RuleFormModal from '../components/RuleFormModal';

// ── Severity colours for the rule card border ─────────────────────────────────

const SEVERITY_BORDER = {
  CRITICAL : '#ef4444',
  HIGH     : '#f97316',
  MEDIUM   : '#f59e0b',
  LOW      : '#22c55e',
};

// ── Category icon map ─────────────────────────────────────────────────────────

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

// ── Toggle switch ─────────────────────────────────────────────────────────────

function ToggleSwitch({ checked, onChange, disabled }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={e => { e.stopPropagation(); onChange(); }}
      disabled={disabled}
      title={checked ? 'Disable rule' : 'Enable rule'}
      style={{
        width        : 36,
        height       : 20,
        borderRadius : 10,
        border       : 'none',
        background   : checked ? 'var(--color-success)' : 'var(--color-border)',
        cursor       : disabled ? 'not-allowed' : 'pointer',
        position     : 'relative',
        transition   : 'background 0.2s',
        flexShrink   : 0,
        opacity      : disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        position     : 'absolute',
        top          : 2,
        left         : checked ? 18 : 2,
        width        : 16,
        height       : 16,
        borderRadius : '50%',
        background   : '#fff',
        transition   : 'left 0.2s',
        boxShadow    : '0 1px 3px rgba(0,0,0,0.3)',
      }} />
    </button>
  );
}

// ── Rule card ─────────────────────────────────────────────────────────────────

function RuleCard({ rule, onToggle, onEdit, onDelete, toggling, deleting }) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const borderColor = rule.isActive
    ? (SEVERITY_BORDER[rule.severity] ?? 'var(--color-border)')
    : 'var(--color-border)';

  return (
    <div style={{
      background   : 'var(--color-card, var(--color-surface))',
      border       : `1px solid var(--color-border)`,
      borderLeft   : `3px solid ${borderColor}`,
      borderRadius : 'var(--radius)',
      padding      : '14px 16px',
      opacity      : rule.isActive ? 1 : 0.6,
      transition   : 'opacity 0.2s',
    }}>
      {/* Top row */}
      <div style={{
        display    : 'flex',
        alignItems : 'flex-start',
        gap        : 10,
        marginBottom: rule.description ? 8 : 0,
      }}>
        {/* Icon */}
        <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>
          {CATEGORY_ICONS[rule.category] ?? '🔍'}
        </span>

        {/* Name + tags */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display    : 'flex',
            alignItems : 'center',
            gap        : 7,
            flexWrap   : 'wrap',
            marginBottom: 4,
          }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{rule.name}</span>
            <SeverityTag severity={rule.severity} />

            {rule.isBuiltin && (
              <span className="tag" style={{
                background : 'var(--color-primary-dim)',
                color      : 'var(--color-primary)',
              }}>
                Built-in
              </span>
            )}

            {!rule.isActive && (
              <span className="tag" style={{
                background : 'var(--color-surface)',
                color      : 'var(--color-muted)',
                border     : '1px solid var(--color-border)',
              }}>
                Disabled
              </span>
            )}
          </div>

          {/* Pattern */}
          <div style={{
            fontFamily   : 'var(--font-mono)',
            fontSize     : 12,
            color        : 'var(--color-text-dim)',
            background   : 'var(--color-bg)',
            border       : '1px solid var(--color-border)',
            borderRadius : 4,
            padding      : '3px 8px',
            display      : 'inline-block',
            maxWidth     : '100%',
            overflow     : 'hidden',
            textOverflow : 'ellipsis',
            whiteSpace   : 'nowrap',
          }}
          title={rule.pattern}
          >
            {rule.pattern}
          </div>
        </div>

        {/* Actions */}
        <div style={{
          display    : 'flex',
          alignItems : 'center',
          gap        : 6,
          flexShrink : 0,
        }}>
          <ToggleSwitch
            checked={rule.isActive}
            onChange={onToggle}
            disabled={toggling || deleting}
          />

          {!rule.isBuiltin && (
            <>
              <button
                className="btn btn-ghost"
                onClick={onEdit}
                disabled={toggling || deleting}
                style={{ fontSize: 12, padding: '4px 10px' }}
              >
                ✏ Edit
              </button>

              {confirmDelete ? (
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    onClick={() => { onDelete(); setConfirmDelete(false); }}
                    disabled={deleting}
                    style={{
                      background   : 'var(--color-danger)',
                      border       : 'none',
                      color        : '#fff',
                      borderRadius : 6,
                      padding      : '4px 10px',
                      fontSize     : 12,
                      fontWeight   : 600,
                      cursor       : deleting ? 'not-allowed' : 'pointer',
                      opacity      : deleting ? 0.5 : 1,
                    }}
                  >
                    {deleting ? 'Deleting…' : 'Confirm'}
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                    style={{ fontSize: 12, padding: '4px 10px' }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  className="btn btn-ghost"
                  onClick={() => setConfirmDelete(true)}
                  disabled={toggling || deleting}
                  style={{
                    fontSize  : 12,
                    padding   : '4px 10px',
                    color     : 'var(--color-danger)',
                  }}
                >
                  🗑
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Description */}
      {rule.description && (
        <p style={{
          fontSize   : 12,
          color      : 'var(--color-muted)',
          marginLeft : 28,
          lineHeight : 1.5,
        }}>
          {rule.description}
        </p>
      )}

      {/* Category + dates footer */}
      <div style={{
        display    : 'flex',
        gap        : 12,
        marginTop  : 10,
        marginLeft : 28,
        fontSize   : 11,
        color      : 'var(--color-muted)',
        flexWrap   : 'wrap',
      }}>
        <span>{rule.category}</span>
        <span>·</span>
        <span>Added {new Date(rule.createdAt).toLocaleDateString()}</span>
        {rule.updatedAt !== rule.createdAt && (
          <>
            <span>·</span>
            <span>Updated {new Date(rule.updatedAt).toLocaleDateString()}</span>
          </>
        )}
      </div>
    </div>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  '', 'CREDIT_CARD', 'PHONE', 'SSN', 'BANK_ACCOUNT',
  'EMAIL', 'PASSPORT', 'API_KEY', 'CUSTOM',
];

const SEVERITIES = ['', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

function FilterBar({ filters, onChange, onReset }) {
  const selectStyle = {
    background   : 'var(--color-bg)',
    border       : '1px solid var(--color-border)',
    borderRadius : 'var(--radius)',
    color        : 'var(--color-text)',
    padding      : '7px 10px',
    fontSize     : 13,
    cursor       : 'pointer',
    outline      : 'none',
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      {/* Search by name */}
      <input
        type="text"
        placeholder="Search by name…"
        value={filters.search ?? ''}
        onChange={e => onChange({ ...filters, search: e.target.value })}
        style={{
          ...selectStyle,
          width: 180,
          cursor: 'text',
        }}
      />

      {/* Category */}
      <select
        value={filters.category ?? ''}
        onChange={e => onChange({ ...filters, category: e.target.value || undefined })}
        style={selectStyle}
      >
        <option value="">All categories</option>
        {CATEGORIES.filter(Boolean).map(c => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>

      {/* Severity */}
      <select
        value={filters.severity ?? ''}
        onChange={e => onChange({ ...filters, severity: e.target.value || undefined })}
        style={selectStyle}
      >
        <option value="">All severities</option>
        {SEVERITIES.filter(Boolean).map(s => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      {/* Active status */}
      <select
        value={filters.isActive ?? ''}
        onChange={e => onChange({ ...filters, isActive: e.target.value === '' ? undefined : e.target.value })}
        style={selectStyle}
      >
        <option value="">All rules</option>
        <option value="true">Active only</option>
        <option value="false">Disabled only</option>
      </select>

      {/* Builtin filter */}
      <select
        value={filters.isBuiltin ?? ''}
        onChange={e => onChange({ ...filters, isBuiltin: e.target.value === '' ? undefined : e.target.value })}
        style={selectStyle}
      >
        <option value="">All types</option>
        <option value="false">Custom only</option>
        <option value="true">Built-in only</option>
      </select>

      <button
        className="btn btn-ghost"
        style={{ fontSize: 12, padding: '6px 12px' }}
        onClick={onReset}
      >
        ↺ Reset
      </button>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ hasFilters, onCreateClick }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 24px' }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>
        {hasFilters ? '🔎' : '⚙️'}
      </div>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>
        {hasFilters ? 'No rules match your filters' : 'No custom rules yet'}
      </div>
      <div style={{ color: 'var(--color-muted)', fontSize: 13, marginBottom: 16 }}>
        {hasFilters
          ? 'Try adjusting or resetting the filters.'
          : 'Create your first custom detection rule below.'}
      </div>
      {!hasFilters && (
        <button className="btn btn-primary" onClick={onCreateClick}>
          + Create Rule
        </button>
      )}
    </div>
  );
}

// ── Default filters ───────────────────────────────────────────────────────────

const DEFAULT_FILTERS = {};

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RulesPage() {
  const [allRules,   setAllRules]   = useState([]);
  const [filters,    setFilters]    = useState(DEFAULT_FILTERS);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);

  // Modal state
  const [modalMode,  setModalMode]  = useState(null);   // 'create' | 'edit' | null
  const [editingRule, setEditingRule] = useState(null);

  // Per-rule action states
  const [togglingId,  setTogglingId]  = useState(null);
  const [deletingId,  setDeletingId]  = useState(null);

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const loadRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Always fetch all rules; we filter client-side for search
      const params = {};
      if (filters.category)  params.category  = filters.category;
      if (filters.severity)  params.severity  = filters.severity;
      if (filters.isActive !== undefined && filters.isActive !== '')
        params.isActive = filters.isActive;
      if (filters.isBuiltin !== undefined && filters.isBuiltin !== '')
        params.isBuiltin = filters.isBuiltin;

      const data = await fetchRules(params);
      setAllRules(data.rules);
    } catch (err) {
      setError(err.message);
      setAllRules([]);
    } finally {
      setLoading(false);
    }
  }, [filters.category, filters.severity, filters.isActive, filters.isBuiltin]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  // ── Client-side search filter ─────────────────────────────────────────────

  const visibleRules = filters.search
    ? allRules.filter(r =>
        r.name.toLowerCase().includes(filters.search.toLowerCase()) ||
        r.description?.toLowerCase().includes(filters.search.toLowerCase()) ||
        r.pattern.toLowerCase().includes(filters.search.toLowerCase())
      )
    : allRules;

  // ── Split builtin vs custom ───────────────────────────────────────────────

  const customRules  = visibleRules.filter(r => !r.isBuiltin);
  const builtinRules = visibleRules.filter(r =>  r.isBuiltin);

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleToggle(rule) {
    setTogglingId(rule.id);
    try {
      const updated = await toggleRule(rule.id);
      setAllRules(prev =>
        prev.map(r => r.id === rule.id ? updated : r)
      );
    } catch (err) {
      setError(`Failed to toggle "${rule.name}": ${err.message}`);
    } finally {
      setTogglingId(null);
    }
  }

  async function handleCreate(payload) {
    const created = await createRule(payload);
    setAllRules(prev => [created, ...prev]);
  }

  async function handleEdit(payload) {
    const updated = await updateRule(editingRule.id, payload);
    setAllRules(prev =>
      prev.map(r => r.id === editingRule.id ? updated : r)
    );
  }

  async function handleDelete(rule) {
    setDeletingId(rule.id);
    try {
      await deleteRule(rule.id);
      setAllRules(prev => prev.filter(r => r.id !== rule.id));
    } catch (err) {
      setError(`Failed to delete "${rule.name}": ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  const activeCount   = allRules.filter(r =>  r.isActive).length;
  const disabledCount = allRules.filter(r => !r.isActive).length;
  const customCount   = allRules.filter(r => !r.isBuiltin).length;

  const hasFilters = Object.values(filters).some(v => v !== undefined && v !== '');

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header row */}
      <div style={{
        display        : 'flex',
        justifyContent : 'space-between',
        alignItems     : 'flex-start',
        marginBottom   : 20,
        flexWrap       : 'wrap',
        gap            : 12,
      }}>
        <PageHeader
          title="Detection Rules"
          subtitle="Manage built-in and custom regex patterns used by the DLP scanner."
        />
        <button
          className="btn btn-primary"
          onClick={() => { setEditingRule(null); setModalMode('create'); }}
          style={{ whiteSpace: 'nowrap' }}
        >
          + Create Rule
        </button>
      </div>

      {/* Stat pills */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Total',    value: allRules.length, color: 'var(--color-primary)' },
          { label: 'Active',   value: activeCount,     color: 'var(--color-success)' },
          { label: 'Disabled', value: disabledCount,   color: 'var(--color-muted)'   },
          { label: 'Custom',   value: customCount,     color: '#f97316'              },
        ].map(s => (
          <div key={s.label} style={{
            background   : 'var(--color-surface)',
            border       : '1px solid var(--color-border)',
            borderRadius : 8,
            padding      : '10px 16px',
          }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color, lineHeight: 1 }}>
              {s.value}
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ marginBottom: 20 }}>
        <FilterBar
          filters={filters}
          onChange={setFilters}
          onReset={() => setFilters(DEFAULT_FILTERS)}
        />
      </div>

      {/* Error */}
      {error && (
        <div style={{
          background   : '#450a0a',
          border       : '1px solid #7f1d1d',
          borderRadius : 'var(--radius)',
          padding      : '12px 16px',
          color        : '#fca5a5',
          marginBottom : 16,
          fontSize     : 13,
          display      : 'flex',
          justifyContent: 'space-between',
          alignItems   : 'center',
        }}>
          <span>⚠ {error}</span>
          <button
            onClick={() => setError(null)}
            style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 16 }}
          >
            ×
          </button>
        </div>
      )}

      {loading && allRules.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--color-muted)' }}>
          Loading rules…
        </div>
      ) : visibleRules.length === 0 ? (
        <EmptyState
          hasFilters={hasFilters}
          onCreateClick={() => { setEditingRule(null); setModalMode('create'); }}
        />
      ) : (
        <>
          {/* ── Custom rules section ── */}
          {customRules.length > 0 && (
            <section style={{ marginBottom: 32 }}>
              <div style={{
                fontSize      : 11,
                fontWeight    : 700,
                color         : 'var(--color-muted)',
                textTransform : 'uppercase',
                letterSpacing : '1px',
                marginBottom  : 10,
                paddingBottom : 8,
                borderBottom  : '1px solid var(--color-border)',
              }}>
                Custom Rules ({customRules.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {customRules.map(rule => (
                  <RuleCard
                    key={rule.id}
                    rule={rule}
                    onToggle={() => handleToggle(rule)}
                    onEdit={() => { setEditingRule(rule); setModalMode('edit'); }}
                    onDelete={() => handleDelete(rule)}
                    toggling={togglingId === rule.id}
                    deleting={deletingId === rule.id}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── Built-in rules section ── */}
          {builtinRules.length > 0 && (
            <section>
              <div style={{
                fontSize      : 11,
                fontWeight    : 700,
                color         : 'var(--color-muted)',
                textTransform : 'uppercase',
                letterSpacing : '1px',
                marginBottom  : 10,
                paddingBottom : 8,
                borderBottom  : '1px solid var(--color-border)',
              }}>
                Built-in Rules ({builtinRules.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {builtinRules.map(rule => (
                  <RuleCard
                    key={rule.id}
                    rule={rule}
                    onToggle={() => handleToggle(rule)}
                    onEdit={() => {}}    // no-op — edit blocked for builtins
                    onDelete={() => {}}  // no-op — delete blocked for builtins
                    toggling={togglingId === rule.id}
                    deleting={false}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* Create / Edit modal */}
      {modalMode && (
        <RuleFormModal
          mode={modalMode}
          rule={editingRule}
          onSubmit={modalMode === 'create' ? handleCreate : handleEdit}
          onClose={() => { setModalMode(null); setEditingRule(null); }}
        />
      )}
    </div>
  );
}