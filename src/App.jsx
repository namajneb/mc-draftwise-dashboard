import { Routes, Route, Navigate } from 'react-router-dom'
import Nav from './components/Nav'
import Home from './pages/Home'
import LinkedInAdsDashboard from './dashboards/LinkedInAdsDashboard'
import HeyReachDashboard from './dashboards/HeyReachDashboard'

export default function App() {
  return (
    <>
      <Nav />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/linkedin-ads" element={<LinkedInAdsDashboard />} />
        <Route path="/heyreach" element={<HeyReachDashboard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
