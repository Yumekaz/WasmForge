import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './brandFonts.css'
import App from './App.jsx'
import LandingPage from './components/LandingPage.jsx'
import TeacherPage from './pages/TeacherPage.jsx'
import TestRoomPage from './pages/TestRoomPage.jsx'

registerSW({ immediate: true })

function normalizePath(pathname) {
  const normalizedPath = pathname.replace(/\/+$/u, '') || '/'
  if (normalizedPath === '/ide' || normalizedPath.startsWith('/ide/')) {
    return '/ide'
  }
  if (normalizedPath === '/test' || normalizedPath.startsWith('/test/')) {
    return '/test'
  }
  if (normalizedPath === '/teacher' || normalizedPath.startsWith('/teacher/')) {
    return '/teacher'
  }
  return '/'
}

function Root() {
  const [pathname, setPathname] = useState(() => normalizePath(window.location.pathname))

  useEffect(() => {
    const handlePopState = () => {
      setPathname(normalizePath(window.location.pathname))
    }

    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [])

  const navigate = (nextPath) => {
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath)
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    setPathname(nextPath)
  }

  if (pathname === '/ide') {
    return <App onNavigateHome={() => navigate('/')} />
  }

  if (pathname === '/test') {
    return (
      <TestRoomPage
        onNavigateHome={() => navigate('/')}
        onNavigateIde={() => navigate('/ide')}
        onNavigateTeacher={() => navigate('/teacher')}
      />
    )
  }

  if (pathname === '/teacher') {
    return (
      <TeacherPage
        onNavigateHome={() => navigate('/')}
        onNavigateIde={() => navigate('/ide')}
        onNavigateTest={() => navigate('/test')}
      />
    )
  }

  return <LandingPage onOpenIde={() => navigate('/ide')} />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
