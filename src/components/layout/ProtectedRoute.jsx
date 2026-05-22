import { Navigate, Outlet, useLocation } from 'react-router-dom'
import useAuthStore from '../../store/useAuthStore'

export default function ProtectedRoute() {
  const { firebaseUser, loading } = useAuthStore()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="h-8 w-8 animate-spin rounded-full border-4 border-brand-green border-t-transparent" />
      </div>
    )
  }

  if (!firebaseUser) {
    const returnTo = location.pathname + location.search
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />
  }

  return <Outlet />
}
