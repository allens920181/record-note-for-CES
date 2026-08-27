import { useEffect } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Dashboard } from './routes/Dashboard'
import { TermPage } from './routes/TermPage'
import { CoursePage } from './routes/CoursePage'
import { CalendarPage } from './routes/CalendarPage'
import { AssignmentsPage } from './routes/AssignmentsPage'
import { SearchPage } from './routes/SearchPage'
import { SessionPage } from './routes/SessionPage'
import { SettingsPage } from './routes/SettingsPage'
import { migrateLegacyWorkSlots } from './db'
import { failInterruptedJobs } from './stt/transcribe'

export function App() {
  useEffect(() => {
    // A job left running when the tab closed has nothing advancing it now.
    void failInterruptedJobs()
    // Study time used to live in the timetable; move any stragglers out.
    void migrateLegacyWorkSlots()
  }, [])

  return (
    // HashRouter keeps deep links working on a static host with no rewrites.
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/term/:termId" element={<TermPage />} />
          <Route path="/course/:courseId" element={<CoursePage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/assignments" element={<AssignmentsPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/session/:sessionId" element={<SessionPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Dashboard />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
