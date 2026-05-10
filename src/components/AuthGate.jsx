import { useState } from 'react'
import { signInWithPopup, signOut } from 'firebase/auth'
import { auth, googleProvider } from '../firebase'
import { useAuth } from '../context/AuthContext'

function isAllowed(email) {
  return email?.endsWith('@draftwise.com') || email?.endsWith('@montgomerycode.com')
}

export default function AuthGate({ children }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid #1a1a1a', borderTopColor: '#0A66C2', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  if (!user) return <SignInPage />

  if (!isAllowed(user.email)) {
    signOut(auth)
    return <UnauthorisedPage email={user.email} />
  }

  return children
}

function SignInPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  const handleSignIn = async () => {
    setLoading(true)
    setError(null)
    try {
      await signInWithPopup(auth, googleProvider)
    } catch (e) {
      setError('Sign-in failed. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#0c0c0c',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'DM Mono', 'Courier New', monospace",
    }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@800&display=swap');`}</style>

      <div style={{ width: '100%', maxWidth: 380, padding: '0 24px' }}>
        <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 12, padding: '40px 36px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, #0A66C2, transparent)' }} />

          <div style={{ fontSize: 9, color: '#333', letterSpacing: '2.5px', marginBottom: 6 }}>DRAFTWISE</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#f0f2f5', fontFamily: "'Syne', sans-serif", marginBottom: 8 }}>Sign in</div>
          <div style={{ fontSize: 11, color: '#444', lineHeight: 1.7, marginBottom: 28 }}>
            Access is restricted to authorised accounts.
          </div>

          <button
            onClick={handleSignIn}
            disabled={loading}
            style={{
              width: '100%', padding: '12px 16px', borderRadius: 8,
              border: '1px solid #2e2e2e', background: loading ? '#0f0f0f' : '#161616',
              color: loading ? '#333' : '#f0f2f5', cursor: loading ? 'default' : 'pointer',
              fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              transition: 'all 0.15s',
            }}
          >
            {!loading && (
              <svg width="18" height="18" viewBox="0 0 18 18">
                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
                <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/>
                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z"/>
              </svg>
            )}
            {loading ? 'Signing in…' : 'Continue with Google'}
          </button>

          {error && (
            <div style={{ marginTop: 14, fontSize: 11, color: '#e05252', textAlign: 'center' }}>{error}</div>
          )}
        </div>
      </div>
    </div>
  )
}

function UnauthorisedPage({ email }) {
  return (
    <div style={{
      minHeight: '100vh', background: '#0c0c0c',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'DM Mono', 'Courier New', monospace",
    }}>
      <div style={{ width: '100%', maxWidth: 380, padding: '0 24px' }}>
        <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 12, padding: '40px 36px' }}>
          <div style={{ fontSize: 9, color: '#333', letterSpacing: '2.5px', marginBottom: 6 }}>DRAFTWISE</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#f0f2f5', marginBottom: 8 }}>Access denied</div>
          <div style={{ fontSize: 11, color: '#444', lineHeight: 1.7 }}>
            <span style={{ color: '#666' }}>{email}</span> is not authorised to view this dashboard.
          </div>
        </div>
      </div>
    </div>
  )
}
