import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { RequireAuth } from '@/components/RequireAuth'
import { LoginPage } from '@/pages/Login'
import { HomePage } from '@/pages/Home'
import { InterviewPage } from '@/pages/Interview'
import { SummaryPage } from '@/pages/Summary'
import { HistoryPage } from '@/pages/History'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="/interview/:id" element={<InterviewPage />} />
        <Route path="/sessions/:id" element={<SummaryPage />} />
        <Route path="/history" element={<HistoryPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
