import { useState, useEffect } from 'react';
import { fetchExportColumns, buildExportUrl } from '../api/client';

/**
 * Export panel embedded in the Audit page.
 *
 * Lets the user:
 *   - Select output format (CSV / JSON)
 *   - Choose columns to include
 *   - Set a row limit
 *   - Carry over filters from the audit table
 *   - Trigger a browser file download
 *
 * Props:
 *   auditFilters — current filter state from AuditPage
 *                  { minRisk, maxRisk, style, dateFrom, dateTo,
 *                    hasDetections, sortBy, sortDir }
 */

const FORMAT_OPTIONS = [
  { value: 'csv',  label: '📄 CSV',  description: 'Open in Excel, Google Sheets, or any spreadsheet app' },
  { value: 'json', label: '{ } JSON', description: 'Machine-readable, ideal for SIEM / log pipelines' },
];

const LIMIT_OPTIONS = [
  { value: 100,   label: 'Last 100 rows'   },
  { value: 500,   label: 'Last 500 rows'   },
  { value: 1000,  label: 'Last 1,000 rows' },
  { value: 5000,  label: 'Last 5,000 rows' },
  { value: 10000, label: 'All (max 10,000)'},
];

export default function ExportPanel({ auditFilters = {} }) {
  const [columns,         setColumns]         = useState([]);
  const [selectedColumns, setSelectedColumns] = useState([]);
  const [format,          setFormat]          = useState('csv');
  const [limit,           setLimit]           = useState(1000);
  const [useFilters,      setUseFilters]      = useState(true);
  const [loading,         setLoading]         = useState(false);
  const [columnsLoading,  setColumnsLoading]  = useState(true);
  const [downloading,     setDownloading]     = useState(false);
  const [lastExport,      setLastExport]      = useState(null);
  const [error,           setError]           = useState(null);

  // ── Load column definitions ───────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      setColumnsLoading(true);
      try {
        const data        = await fetchExportColumns();
        setColumns(data.columns);
        setSelectedColumns(data.defaultColumns);
      } catch (err) {
        setError('Failed to load column definitions: ' + err.message);
      } finally {
        setColumnsLoading(false);
      }
    }
    load();
  }, []);

  // ── Column toggle ─────────────────────────────────────────────────────────

  function toggleColumn(key) {
    setSelectedColumns(prev =>
      prev.includes(key)
        ? prev.filter(k => k !== key)
        : [...prev, key]
    );
  }

  function selectAll() {
    setSelectedColumns(columns.map(c => c.key));
  }

  function selectDefault() {
    const defaults = columns.filter(c => c.always || c.key.startsWith('created'))
      .map(c => c.key);
    // Re-use the server defaults
    setSelectedColumns(columns.filter(c => c.always).map(c => c.key).concat(
      ['created_at', 'risk_score', 'detection_count', 'mask_style', 'categories']
    ));
  }

  // ── Build params for export URL ───────────────────────────────────────────

  function buildParams() {
    const params = {
      format,
      limit,
      columns : selectedColumns,
      sortBy  : auditFilters.sortBy  ?? 'created_at',
      sortDir : auditFilters.sortDir ?? 'DESC',
    };

    if (useFilters) {
      if (auditFilters.minRisk       !== undefined) params.minRisk       = auditFilters.minRisk;
      if (auditFilters.maxRisk       !== undefined) params.maxRisk       = auditFilters.maxRisk;
      if (auditFilters.style         !== undefined) params.style         = auditFilters.style;
      if (auditFilters.dateFrom      !== undefined) params.dateFrom      = auditFilters.dateFrom;
      if (auditFilters.dateTo        !== undefined) params.dateTo        = auditFilters.dateTo;
      if (auditFilters.hasDetections !== undefined) params.hasDetections = auditFilters.hasDetections;
    }

    return params;
  }

  // ── Download handler ──────────────────────────────────────────────────────

  function handleDownload() {
    if (selectedColumns.length === 0) {
      setError('Select at least one column to export.');
      return;
    }

    setError(null);
    setDownloading(true);

    try {
      const params     = buildParams();
      const exportUrl  = buildExportUrl(params);

      // Trigger browser download by navigating a hidden anchor
      const link       = document.createElement('a');
      link.href        = exportUrl;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setLastExport({
        timestamp : new Date().toLocaleString(),
        format    : format.toUpperCase(),
        columns   : selectedColumns.length,
        limit,
        withFilters: useFilters,
      });
    } catch (err) {
      setError('Export failed: ' + err.message);
    } finally {
      // Brief delay so the user sees the button state change
      setTimeout(() => setDownloading(false), 800);
    }
  }

  // ── Active filter count ───────────────────────────────────────────────────

  const activeFilterCount = Object.keys(auditFilters).filter(k =>
    !['page', 'pageSize', 'sortBy', 'sortDir'].includes(k) &&
    auditFilters[k] !== undefined &&
    auditFilters[k] !== ''
  ).length;

  // ── Styles ────────────────────────────────────────────────────────────────

  const sectionTitle = {
    fontSize      : 11,
    fontWeight    : 700,
    color         : 'var(--color-muted)',
    textTransform : 'uppercase',
    letterSpacing : '0.5px',
    marginBottom  : 8,
  };

  const selectStyle = {
    background   : 'var(--color-bg)',
    border       : '1px solid var(--color-border)',
    borderRadius : 'var(--radius)',
    color        : 'var(--color-text)',
    padding      : '8px 12px',
    fontSize     : 13,
    cursor       : 'pointer',
    outline      : 'none',
    width        : '100%',
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="card">

      {/* Panel header */}
      <div style={{
        display        : 'flex',
        justifyContent : 'space-between',
        alignItems     : 'center',
        marginBottom   : 20,
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Export Audit Log</div>
          <div style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 2 }}>
            Download records as CSV or JSON
          </div>
        </div>
        {lastExport && (
          <div style={{
            fontSize     : 11,
            color        : 'var(--color-muted)',
            textAlign    : 'right',
            lineHeight   : 1.5,
          }}>
            <div style={{ color: 'var(--color-success)', fontWeight: 600 }}>
              ✓ Last export
            </div>
            <div>{lastExport.timestamp}</div>
            <div>{lastExport.format} · {lastExport.columns} columns</div>
          </div>
        )}
      </div>

      <div style={{
        display             : 'grid',
        gridTemplateColumns : 'repeat(auto-fit, minmax(260px, 1fr))',
        gap                 : 24,
      }}>

        {/* ── Left column: format + limit + filters ── */}
        <div>

          {/* Format selector */}
          <div style={{ marginBottom: 20 }}>
            <div style={sectionTitle}>Output Format</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {FORMAT_OPTIONS.map(opt => (
                <label key={opt.value} style={{
                  display      : 'flex',
                  alignItems   : 'flex-start',
                  gap          : 10,
                  padding      : '10px 12px',
                  background   : format === opt.value ? 'var(--color-primary-dim)' : 'var(--color-bg)',
                  border       : `1px solid ${format === opt.value ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  borderRadius : 'var(--radius)',
                  cursor       : 'pointer',
                  transition   : 'background 0.15s',
                }}>
                  <input
                    type="radio"
                    name="export-format"
                    value={opt.value}
                    checked={format === opt.value}
                    onChange={() => setFormat(opt.value)}
                    style={{ marginTop: 2, accentColor: 'var(--color-primary)' }}
                  />
                  <div>
                    <div style={{
                      fontWeight : 700,
                      fontSize   : 13,
                      color      : format === opt.value ? 'var(--color-primary)' : 'var(--color-text)',
                    }}>
                      {opt.label}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>
                      {opt.description}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Row limit */}
          <div style={{ marginBottom: 20 }}>
            <div style={sectionTitle}>Row Limit</div>
            <select
              value={limit}
              onChange={e => setLimit(Number(e.target.value))}
              style={selectStyle}
            >
              {LIMIT_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Filter carry-over */}
          <div style={{ marginBottom: 20 }}>
            <div style={sectionTitle}>Filters</div>
            <label style={{
              display      : 'flex',
              alignItems   : 'flex-start',
              gap          : 10,
              padding      : '10px 12px',
              background   : 'var(--color-bg)',
              border       : '1px solid var(--color-border)',
              borderRadius : 'var(--radius)',
              cursor       : 'pointer',
            }}>
              <input
                type="checkbox"
                checked={useFilters}
                onChange={e => setUseFilters(e.target.checked)}
                style={{ marginTop: 3, accentColor: 'var(--color-primary)' }}
              />
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  Apply current table filters
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>
                  {activeFilterCount > 0
                    ? `${activeFilterCount} active filter${activeFilterCount > 1 ? 's' : ''} will be applied`
                    : 'No active filters — will export all records'}
                </div>
              </div>
            </label>

            {/* Show active filter summary */}
            {useFilters && activeFilterCount > 0 && (
              <div style={{
                marginTop    : 8,
                padding      : '8px 12px',
                background   : 'var(--color-bg)',
                border       : '1px solid var(--color-border)',
                borderRadius : 'var(--radius)',
                fontSize     : 11,
                color        : 'var(--color-text-dim)',
                lineHeight   : 1.7,
              }}>
                {[
                  auditFilters.minRisk  !== undefined && `Min risk: ${auditFilters.minRisk}`,
                  auditFilters.maxRisk  !== undefined && `Max risk: ${auditFilters.maxRisk}`,
                  auditFilters.style    !== undefined && `Style: ${auditFilters.style}`,
                  auditFilters.dateFrom !== undefined && `From: ${auditFilters.dateFrom?.slice(0, 10)}`,
                  auditFilters.dateTo   !== undefined && `To: ${auditFilters.dateTo?.slice(0, 10)}`,
                  auditFilters.hasDetections !== undefined && `Has detections: ${auditFilters.hasDetections}`,
                ].filter(Boolean).map((f, i) => (
                  <span key={i} style={{
                    display      : 'inline-block',
                    marginRight  : 6,
                    background   : 'var(--color-surface)',
                    border       : '1px solid var(--color-border)',
                    borderRadius : 4,
                    padding      : '1px 6px',
                  }}>
                    {f}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Right column: column selector ── */}
        <div>
          <div style={{
            display        : 'flex',
            justifyContent : 'space-between',
            alignItems     : 'center',
            marginBottom   : 8,
          }}>
            <div style={sectionTitle}>Columns</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11, padding: '3px 8px' }}
                onClick={selectAll}
              >
                All
              </button>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11, padding: '3px 8px' }}
                onClick={selectDefault}
              >
                Default
              </button>
            </div>
          </div>

          {columnsLoading ? (
            <div style={{ color: 'var(--color-muted)', fontSize: 13 }}>Loading columns…</div>
          ) : (
            <div style={{
              display       : 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap           : 6,
            }}>
              {columns.map(col => {
                const isSelected = selectedColumns.includes(col.key);
                const isAlways   = col.always;

                return (
                  <label key={col.key} style={{
                    display      : 'flex',
                    alignItems   : 'center',
                    gap          : 7,
                    padding      : '7px 10px',
                    background   : isSelected ? 'var(--color-primary-dim)' : 'var(--color-bg)',
                    border       : `1px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    borderRadius : 6,
                    cursor       : isAlways ? 'not-allowed' : 'pointer',
                    opacity      : isAlways ? 0.7 : 1,
                    transition   : 'background 0.1s',
                    fontSize     : 12,
                  }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => !isAlways && toggleColumn(col.key)}
                      disabled={isAlways}
                      style={{ accentColor: 'var(--color-primary)' }}
                    />
                    <span style={{
                      color      : isSelected ? 'var(--color-primary)' : 'var(--color-text)',
                      fontWeight : isSelected ? 600 : 400,
                    }}>
                      {col.header}
                    </span>
                    {isAlways && (
                      <span style={{ fontSize: 10, color: 'var(--color-muted)', marginLeft: 'auto' }}>
                        req
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          )}

          {selectedColumns.length === 0 && !columnsLoading && (
            <p style={{ fontSize: 12, color: 'var(--color-danger)', marginTop: 6 }}>
              Select at least one column.
            </p>
          )}
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{
          marginTop    : 16,
          background   : '#450a0a',
          border       : '1px solid #7f1d1d',
          borderRadius : 'var(--radius)',
          padding      : '10px 14px',
          color        : '#fca5a5',
          fontSize     : 13,
          display      : 'flex',
          justifyContent: 'space-between',
          alignItems   : 'center',
        }}>
          <span>⚠ {error}</span>
          <button
            onClick={() => setError(null)}
            style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 16 }}
          >×</button>
        </div>
      )}

      <hr className="divider" />

      {/* ── Download button ── */}
      <div style={{
        display        : 'flex',
        justifyContent : 'space-between',
        alignItems     : 'center',
        flexWrap       : 'wrap',
        gap            : 8,
      }}>
        <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>
          {selectedColumns.length} column{selectedColumns.length !== 1 ? 's' : ''} selected
          {' · '}
          up to {limit.toLocaleString()} rows
          {' · '}
          {format.toUpperCase()}
        </span>

        <button
          className="btn btn-primary"
          onClick={handleDownload}
          disabled={downloading || selectedColumns.length === 0 || columnsLoading}
          style={{ minWidth: 160 }}
        >
          {downloading
            ? '⏳ Preparing…'
            : `⬇ Download ${format.toUpperCase()}`}
        </button>
      </div>
    </div>
  );
}