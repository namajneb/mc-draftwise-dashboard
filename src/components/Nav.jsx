import { Link, useLocation } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { useAuth } from '../context/AuthContext'

const TABS = [
  { path: '/linkedin-ads', label: 'LinkedIn Ads' },
]

export default function Nav() {
  const { pathname } = useLocation()
  const { user } = useAuth()

  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 1000,
      height: 44, background: '#000', borderBottom: '1px solid #1a1a1a',
      display: 'flex', alignItems: 'center', padding: '0 24px', gap: 20,
    }}>
      <Link to="/" style={{ textDecoration: 'none', flexShrink: 0 }}>
        <span style={{ color: '#f0f2f5', fontSize: 11, fontWeight: 600, fontFamily: "'Inter', sans-serif", letterSpacing: '2px' }}>
          DRAFTWISE DASHBOARD
        </span>
      </Link>

      <div style={{ width: 1, height: 18, background: '#222', flexShrink: 0 }} />

      <div style={{ display: 'flex', gap: 3, flex: 1 }}>
        {TABS.map(d => {
          const active = pathname === d.path
          return (
            <Link key={d.path} to={d.path} style={{
              textDecoration: 'none',
              padding: '4px 12px', borderRadius: 4,
              fontSize: 11, fontFamily: "'Inter', sans-serif", letterSpacing: '1px',
              background: active ? '#161616' : 'transparent',
              color: active ? '#f0f2f5' : '#555',
              border: active ? '1px solid #2e2e2e' : '1px solid transparent',
              transition: 'all 0.15s',
            }}>{d.label}</Link>
          )
        })}
      </div>

      {user && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {user.photoURL && (
            <img
              src={user.photoURL}
              alt={user.displayName}
              referrerPolicy="no-referrer"
              style={{ width: 26, height: 26, borderRadius: '50%', border: '1px solid #2a2a2a' }}
            />
          )}
          <button
            onClick={() => signOut(auth)}
            style={{
              padding: '4px 12px', borderRadius: 4, border: '1px solid #1e1e1e',
              background: 'transparent', color: '#444', cursor: 'pointer',
              fontSize: 11, fontFamily: "'Inter', sans-serif", letterSpacing: '1px',
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => e.target.style.color = '#888'}
            onMouseLeave={e => e.target.style.color = '#444'}
          >Sign out</button>
        </div>
      )}
    </div>
  )
}
