import { Link } from 'react-router-dom'

const LinkedInIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="24" height="24" rx="4" fill="#0A66C2"/>
    <path d="M7.5 10.5H5V19H7.5V10.5Z" fill="white"/>
    <circle cx="6.25" cy="7.25" r="1.5" fill="white"/>
    <path d="M19 14.5C19 12.5 17.8 10.5 15.5 10.5C14.2 10.5 13.2 11.1 12.7 12V10.5H10.2V19H12.7V14.8C12.7 13.5 13.5 12.8 14.6 12.8C15.7 12.8 16.5 13.5 16.5 14.8V19H19V14.5Z" fill="white"/>
  </svg>
)

const HeyReachIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#0ea97a" opacity="0.15"/>
    <path d="M8 9h2v6H8V9zm0 0c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="#0ea97a" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
    <path d="M14 12c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2z" fill="#0ea97a"/>
    <path d="M16 15l2 2" stroke="#0ea97a" strokeWidth="1.8" strokeLinecap="round"/>
  </svg>
)

const DASHBOARDS = [
  {
    path: '/linkedin-ads',
    title: 'LinkedIn Ads Performance',
    description: 'Live ad performance, CTR, CPC, and spend tracking across LinkedIn campaigns.',
    icon: <LinkedInIcon size={20} />,
    iconColor: '#0A66C2',
    tag: 'Live Data',
    tagColor: '#3dbb7a',
    available: true,
  },
  {
    path: '/heyreach',
    title: 'HeyReach Outreach',
    description: 'LinkedIn outreach analytics — connection requests, acceptance rates, reply rates, and per-campaign breakdown.',
    icon: <HeyReachIcon size={20} />,
    iconColor: '#0ea97a',
    tag: 'Live Data',
    tagColor: '#3dbb7a',
    available: true,
  },
]

function DashCard({ d }) {
  const inner = (
    <div
      className="dash-card"
      style={{
        background: '#111', border: '1px solid #1e1e1e', borderRadius: 10,
        padding: '24px', cursor: d.available ? 'pointer' : 'default',
        position: 'relative', overflow: 'hidden',
        height: '100%', boxSizing: 'border-box',
        opacity: d.available ? 1 : 0.45,
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: d.iconColor + '66' }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 8,
          background: d.iconColor + '18', border: `1px solid ${d.iconColor}33`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{d.icon}</div>
        <span style={{
          fontSize: 8, color: d.tagColor,
          background: d.tagColor + '18', border: `1px solid ${d.tagColor}33`,
          padding: '3px 9px', borderRadius: 3, letterSpacing: '1.5px', fontFamily: "'Inter', sans-serif",
        }}>{d.tag}</span>
      </div>

      <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 16, fontWeight: 700, color: '#f0f2f5', marginBottom: 8 }}>{d.title}</div>
      <div style={{ fontSize: 11, color: '#555', lineHeight: 1.75, fontFamily: "'Inter', sans-serif" }}>{d.description}</div>

      {d.available && (
        <div style={{ marginTop: 22, fontSize: 10, color: '#333', letterSpacing: '1px', fontFamily: "'Inter', sans-serif" }}>
          OPEN DASHBOARD →
        </div>
      )}
    </div>
  )

  return d.available
    ? <Link to={d.path} style={{ textDecoration: 'none' }}>{inner}</Link>
    : <div>{inner}</div>
}

export default function Home() {
  return (
    <div style={{ minHeight: '100vh', background: '#0c0c0c', fontFamily: "'Inter', sans-serif", color: '#b2b2b2', padding: '36px 36px 60px' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .dash-card { transition: border-color 0.15s, transform 0.15s; }
        .dash-card:hover { border-color: #333 !important; transform: translateY(-2px); }
      `}</style>

      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {DASHBOARDS.map((d, i) => <DashCard key={i} d={d} />)}
        </div>
      </div>
    </div>
  )
}
