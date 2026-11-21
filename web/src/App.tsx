import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthGate } from './components/AuthGate'
import { Layout } from './components/Layout'
import { Clients } from './pages/Clients'
import { ClientPage } from './pages/ClientPage'
import { Alerts } from './pages/Alerts'
import { Queue } from './pages/Queue'
import { Team } from './pages/Team'
import { Admin } from './pages/Admin'

export default function App() {
  return (
    <BrowserRouter>
      <AuthGate>
        <Layout>
          <Routes>
            <Route path="/" element={<Navigate to="/app" replace />} />
            <Route path="/app" element={<Clients />} />
            <Route path="/app/accounts/:id" element={<ClientPage />} />
            <Route path="/app/alerts" element={<Alerts />} />
            <Route path="/app/queue" element={<Queue />} />
            <Route path="/app/team" element={<Team />} />
            <Route path="/app/admin" element={<Admin />} />
            <Route path="*" element={<Navigate to="/app" replace />} />
          </Routes>
        </Layout>
      </AuthGate>
    </BrowserRouter>
  )
}
