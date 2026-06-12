import { useState, useEffect, useCallback } from 'react';
import { fetchAuditLogs }    from '../api/client';
import PageHeader            from '../components/PageHeader';
import RiskScore             from '../components/RiskScore';
import Pagination            from '../components/Pagination';
import AuditDetailDrawer     from '../components/AuditDetailDrawer';
import ExportPanel from '../components/ExportPanel';    // ← ADD

// ── Filter bar ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  'CREDIT_CARD', 'SSN', 'PHONE', 'EMAIL',
  'BANK_ACCOUNT', 'PASSPORT', 'API_KEY', 'CUSTOM',
];

const MASK_STYLES = ['REDACT', 'PARTIAL', 'TOKENIZE'];


function FilterBar({ filters, onChange, onReset, loading }) {
  function set(key, value) {
    onChange({ ...filters, [key]: value, page: 1 });
  }

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

  const inputStyle = {
    ...selectStyle,
    width: 80,
  };

  return (
    <div style={{
      display    : 'flex',
      flexWrap   : 'wrap',
      gap        : 8,
      marginBottom: 16,
      alignItems : 'center',
    }}>
      {/* Min risk */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>Risk ≥</span>
        <input
          type="number"
          min={0}
          max={100}
          value={filters.minRisk ?? ''}
          onChange={e => set('minRisk', e.target.value === '' ? undefined : Number(e.target.value))}
          placeholder="0"
          style={inputStyle}
          disabled={loading}
        />
      </div>

      {/* Category filter */}
      <select
        value={filters.category ?? ''}
        onChange={e => set('category', e.target.value || undefined)}
        style={selectStyle}
        disabled={loading}
      >
        <option value="">All categories</option>
        {CATEGORIES.map(c => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>

      {/* Mask style filter */}
      <select
        value={filters.style ?? ''}
        onChange={e => set('style', e.target.value || undefined)}
        style={selectStyle}
        disabled={loading}
      >
        <option value="">All operations</option>
        <option value="">— Mask style —</option>
        {MASK_STYLES.map(s => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      {/* Has detections */}
      <select
        value={filters.hasDetections ?? ''}
        onChange={e => set('hasDetections', e.target.value === '' ? undefined : e.target.value === 'true')}
        style={selectStyle}
        disabled={loading}
      >
        <option value="">All events</option>
        <option value="true">With detections</option>
        <option value="false">No detections</option>
      </select>

      {/* Sort */}
      <select
        value={`${filters.sortBy ?? 'created_at'}:${filters.sortDir ?? 'DESC'}`}
        onChange={e => {
          const [sortBy, sortDir] = e.target.value.split(':');
          onChange({ ...filters, sortBy, sortDir, page: 1 });
        }}
        style={selectStyle}
        disabled={loading}
      >
        <option value="created_at:DESC">Newest first</option>
        <option value="created_at:ASC">Oldest first</option>
        <option value="risk_score:DESC">Highest risk first</option>
        <option value="risk_score:ASC">Lowest risk first</option>
        <option value="detection_count:DESC">Most detections</option>
      </select>

      {/* Reset */}
      <button
        className="btn btn-ghost"
        style={{ fontSize: 12, padding: '6px 12px' }}
        onClick={onReset}
        disabled={loading}
      >
        ↺ Reset
      </button>
    </div>
  );
}

// ── Table row ─────────────────────────────────────────────────────────────────

function AuditRow({ record, onClick }) {
  const detections = Array.isArray(record.detections) ? record.detections : [];

  // Build a compact category summary: "CREDIT_CARD × 2, SSN × 1"
  const categoryCounts = detections.reduce((acc, d) => {
    acc[d.category] = (acc[d.category] ?? 0) + 1;
    return acc;
  }, {});

  const categoryTags = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3); // show max 3 in table

  return (
    <tr
      onClick={onClick}
      style={{
        borderBottom : '1px solid var(--color-border)',
        cursor       : 'pointer',
        transition   : 'background 0.1s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {/* Timestamp */}
      <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
        <div style={{ fontSize: 13, color: 'var(--color-text)' }}>
          {new Date(record.createdAt).toLocaleDateString()}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
          {new Date(record.createdAt).toLocaleTimeString()}
        </div>
      </td>

      {/* Operation */}
      <td style={{ padding: '12px 14px' }}>
        <span style={{
          display      : 'inline-block',
          padding      : '2px 8px',
          borderRadius : 5,
          fontSize     : 11,
          fontWeight   : 700,
          background   : record.maskStyle ? 'var(--color-primary-dim)' : '#1a2a1a',
          color        : record.maskStyle ? 'var(--color-primary)'     : 'var(--color-success)',
        }}>
          {record.maskStyle ? `MASK` : 'SCAN'}
        </span>
        {record.maskStyle && (
          <span style={{
            marginLeft : 5,
            fontSize   : 11,
            color      : 'var(--color-muted)',
          }}>
            {record.maskStyle}
          </span>
        )}
      </td>

      {/* Risk score */}
      <td style={{ padding: '12px 14px' }}>
        <RiskScore score={record.riskScore} />
      </td>

      {/* Detections */}
      <td style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          {record.detectionCount === 0 ? (
            <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>—</span>
          ) : (
            <>
              {categoryTags.map(([cat, count]) => (
                <span key={cat} style={{
                  background   : 'var(--color-surface)',
                  border       : '1px solid var(--color-border)',
                  borderRadius : 4,
                  padding      : '1px 6px',
                  fontSize     : 11,
                  color        : 'var(--color-text-dim)',
                }}>
                  {cat}
                  {count > 1 && (
                    <span style={{ color: 'var(--color-primary)', marginLeft: 3 }}>×{count}</span>
                  )}
                </span>
              ))}
              {Object.keys(categoryCounts).length > 3 && (
                <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>
                  +{Object.keys(categoryCounts).length - 3} more
                </span>
              )}
            </>
          )}
        </div>
      </td>

      {/* Input preview */}
      <td style={{ padding: '12px 14px', maxWidth: 220 }}>
        <span style={{
          fontSize     : 12,
          color        : 'var(--color-text-dim)',
          fontFamily   : 'var(--font-mono)',
          overflow     : 'hidden',
          textOverflow : 'ellipsis',
          whiteSpace   : 'nowrap',
          display      : 'block',
        }}>
          {record.inputText?.slice(0, 60)}
          {record.inputText?.length > 60 ? '…' : ''}
        </span>
      </td>

      {/* Chevron */}
      <td style={{ padding: '12px 14px', color: 'var(--color-muted)', fontSize: 16 }}>›</td>
    </tr>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ hasFilters }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 24px' }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>
        {hasFilters ? '🔎' : '📋'}
      </div>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>
        {hasFilters ? 'No records match your filters' : 'No audit events yet'}
      </div>
      <div style={{ color: 'var(--color-muted)', fontSize: 13 }}>
        {hasFilters
          ? 'Try adjusting or resetting the filters above.'
          : 'Run a scan or mask operation to see events here.'}
      </div>
    </div>
  );
}

// ── Default filters ───────────────────────────────────────────────────────────

const DEFAULT_FILTERS = {
  page     : 1,
  pageSize : 20,
  sortBy   : 'created_at',
  sortDir  : 'DESC',
};

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AuditPage() {
  const [filters,        setFilters]        = useState(DEFAULT_FILTERS);
  const [records,        setRecords]        = useState([]);
  const [pagination,     setPagination]     = useState(null);
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState(null);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [showExport, setShowExport] = useState(false);

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const fetchRecords = useCallback(async (params) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAuditLogs(params);
      setRecords(data.records);
      setPagination(data.pagination);
    } catch (err) {
      setError(err.message);
      setRecords([]);
      setPagination(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecords(filters);
  }, [filters, fetchRecords]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleFilterChange(newFilters) {
    setFilters(newFilters);
  }

  function handleReset() {
    setFilters(DEFAULT_FILTERS);
  }

  function handlePageChange(newPage) {
    setFilters(prev => ({ ...prev, page: newPage }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const hasFilters = Object.keys(filters).some(
    k => !['page', 'pageSize', 'sortBy', 'sortDir'].includes(k) && filters[k] !== undefined
  );

  const totalCount = pagination?.totalCount ?? 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <div style={{
        display        : 'flex',
        justifyContent : 'space-between',
        alignItems     : 'flex-start',
        marginBottom   : 24,
        flexWrap       : 'wrap',
        gap            : 12,
      }}>
        <PageHeader
          title="Audit Log"
          subtitle="Full history of every scan and mask operation."
        />

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Live record count */}
          {pagination && (
            <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>
              {totalCount.toLocaleString()} total record{totalCount !== 1 ? 's' : ''}
            </span>
          )}
          {/* Refresh */}
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: '6px 12px' }}
            onClick={() => fetchRecords(filters)}
            disabled={loading}
          >
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>
      {/* Export toggle */}
<button
  className="btn btn-ghost"
  style={{ fontSize: 12, padding: '6px 12px' }}
  onClick={() => setShowExport(prev => !prev)}
>
  {showExport ? '✕ Close Export' : '⬇ Export'}
</button>

{/* Refresh — already exists */}
<button
  className="btn btn-ghost"
  style={{ fontSize: 12, padding: '6px 12px' }}
  onClick={() => fetchRecords(filters)}
  disabled={loading}
>
  {loading ? 'Loading…' : '↻ Refresh'}
</button>

      {/* Filters */}
      <FilterBar
        filters={filters}
        onChange={handleFilterChange}
        onReset={handleReset}
        loading={loading}
      />
{/* Export panel */}
{showExport && (
  <div style={{ marginBottom: 20 }}>
    <ExportPanel auditFilters={filters} />
  </div>
)}
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
        }}>
          ⚠ {error}
        </div>
      )}

      {/* Table card */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading && records.length === 0 ? (
          <div style={{ padding: '60px 24px', textAlign: 'center', color: 'var(--color-muted)' }}>
            Loading audit records…
          </div>
        ) : records.length === 0 ? (
          <EmptyState hasFilters={hasFilters} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{
                  background   : 'var(--color-bg)',
                  borderBottom : '1px solid var(--color-border)',
                }}>
                  {['Timestamp', 'Operation', 'Risk Score', 'Detections', 'Input Preview', ''].map(h => (
                    <th key={h} style={{
                      padding      : '11px 14px',
                      textAlign    : 'left',
                      fontSize     : 11,
                      fontWeight   : 700,
                      color        : 'var(--color-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      whiteSpace   : 'nowrap',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody style={{ opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s' }}>
                {records.map(record => (
                  <AuditRow
                    key={record.id}
                    record={record}
                    onClick={() => setSelectedRecord(record)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination inside card */}
        {pagination && records.length > 0 && (
          <div style={{
            padding      : '12px 16px',
            borderTop    : '1px solid var(--color-border)',
            background   : 'var(--color-bg)',
          }}>
            <Pagination
              pagination={pagination}
              onChange={handlePageChange}
              loading={loading}
            />
          </div>
        )}
      </div>

      {/* Detail drawer */}
      <AuditDetailDrawer
        record={selectedRecord}
        onClose={() => setSelectedRecord(null)}
      />
    </div>
  );
}