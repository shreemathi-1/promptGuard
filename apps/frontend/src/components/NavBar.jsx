import { NavLink } from 'react-router-dom';
import { useHealth } from '../hooks/useHealth';
import StatusBadge from './StatusBadge';

const NAV_ITEMS = [
  { to: '/',         label: 'Health'   },
  { to: '/scan',     label: 'Scan'     },
  { to: '/mask',     label: 'Mask'     },
  { to: '/rewrite',  label: 'Rewrite'  },
  { to: '/audit',    label: 'Audit'    },
  { to: '/rules',    label: 'Rules'    },
  { to: '/settings', label: 'Settings' },
];

const linkStyle = {
  padding:      '6px 14px',
  borderRadius: 'var(--radius)',
  fontSize:     14,
  fontWeight:   500,
  color:        'var(--color-text-dim)',
  transition:   'background 0.15s, color 0.15s',
};

const activeLinkStyle = {
  ...linkStyle,
  background: 'var(--color-primary-dim)',
  color:      'var(--color-primary)',
};

export default function NavBar() {
  const { health, loading } = useHealth(30_000);

  const dbStatus  = loading ? 'checking' : (health?.database ?? 'unreachable');
  const apiStatus = loading ? 'checking' : (health?.api     ?? 'unreachable');


  return (
    <nav style={{
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'space-between',
      padding:        '0 24px',
      height:         56,
      background:     'var(--color-surface)',
      borderBottom:   '1px solid var(--color-border)',
      position:       'sticky',
      top:            0,
      zIndex:         100,
    }}>
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          background:   'var(--color-primary)',
          color:        '#fff',
          fontWeight:   800,
          fontSize:     13,
          padding:      '4px 8px',
          borderRadius: 6,
          letterSpacing: 0.5,
          fontFamily:   'var(--font-mono)',
        }}>
          DLP
        </div>
        <span style={{ fontWeight: 700, fontSize: 15 }}>PromptGuard</span>
      </div>

      {/* Nav links */}
      <div style={{ display: 'flex', gap: 4 }}>
        {NAV_ITEMS.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            style={({ isActive }) => isActive ? activeLinkStyle : linkStyle}
          >
            {label}
          </NavLink>
        ))}
      </div>


    </nav>
  );
}