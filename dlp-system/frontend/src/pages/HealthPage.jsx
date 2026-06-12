import { useHealth } from '../hooks/useHealth';
import PageHeader from '../components/PageHeader';
import StatusBadge from '../components/StatusBadge';
import RiskSummaryCard from '../components/RiskSummaryCard'; 

function Row({ label, children }) {
  return (
    <tr>
      <td style={{
        padding:     '11px 20px 11px 0',
        color:       'var(--color-text-dim)',
        whiteSpace:  'nowrap',
        width:       140,
      }}>
        {label}
      </td>
      <td style={{ padding: '11px 0' }}>{children}</td>
    </tr>
  );
}

export default function HealthPage() {
  const { health, loading, error, refresh } = useHealth(30_000);

  return (
    <div>
      <PageHeader
        title="System Health"
        subtitle="Live status of the API and database. Auto-refreshes every 30 seconds."
      />

      <div className="card" style={{ maxWidth: 520 }}>
        {loading && !health && (
          <p className="text-muted">Checking system status…</p>
        )}

        {error && (
          <p className="text-danger" style={{ marginBottom: 12 }}>
            ⚠ {error}
          </p>
        )}

        {health && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <Row label="API">
                <StatusBadge value={health.api} />
              </Row>
              <Row label="Database">
                <StatusBadge value={health.database} />
              </Row>
              <Row label="Environment">
                <span className="mono">{health.environment}</span>
              </Row>
              <Row label="Uptime">
                <span className="mono">{health.uptime}s</span>
              </Row>
              <Row label="Server time">
                <span className="mono" style={{ fontSize: 12 }}>
                  {health.db_time
                    ? new Date(health.db_time).toLocaleString()
                    : '—'}
                </span>
              </Row>
            </tbody>
          </table>
        )}

        <hr className="divider" />

        <button
          className="btn btn-ghost"
          onClick={refresh}
          disabled={loading}
          style={{ fontSize: 13 }}
        >
          {loading ? 'Refreshing…' : '↻ Refresh now'}
        </button>
      </div>
      <div style={{ marginTop: 24 }}>
  <RiskSummaryCard defaultDays={7} />
</div>
    </div>
    
  );
}