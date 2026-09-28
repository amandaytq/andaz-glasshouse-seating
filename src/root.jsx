import { useCallback, useEffect, useState } from 'react'
import { SeatingPlannerPage } from './pages/seating-planner-page.jsx'
import { NavBar } from './components/nav-bar.jsx'
import { GuestListPage } from './pages/guest-list-page.jsx'
import { PasswordGate } from './components/password-gate.jsx'

// Two pages, no router library needed for that:
//   /  (and anything else, incl. /guest-list) — the guest list, with a navbar
//   /assign-seats — the seating planner (pages/seating-planner-page.jsx),
//   behind a password gate
// Amplify's SPA rewrite (`/<*>` -> /index.html) and Vite's dev server both
// already serve index.html for any unknown path, so plain History API
// navigation works in prod and dev without extra config.
function usePath() {
  const [path, setPath] = useState(window.location.pathname)

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((to) => {
    if (to !== window.location.pathname) {
      window.history.pushState(null, '', to)
    }
    setPath(to)
  }, [])

  return [path, navigate]
}

export default function Root() {
  const [path, navigate] = usePath()

  if (path === '/assign-seats') {
    return (
      <PasswordGate password="qqandtoto" storageKey="glasshouse-assign-seats-unlocked">
        <SeatingPlannerPage onHome={() => navigate('/')} />
      </PasswordGate>
    )
  }

  return (
    <>
      <NavBar navigate={navigate} active="guests" />
      <GuestListPage />
    </>
  )
}
