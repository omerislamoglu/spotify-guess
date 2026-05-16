import { Navigate, Outlet } from 'react-router-dom'
import useAuthStore from '../../store/useAuthStore'

/**
 * Wrap any route that requires a Firebase login.
 * Shows nothing while auth state is loading to prevent flash-redirects.
 */
export default function ProtectedRoute() {
  const { firebaseUser, loading } = useAuthStore()

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="h-8 w-8 animate-spin rounded-full border-4 border-brand-green border-t-transparent" />
      </div>
    )
  }

  return firebaseUser ? <Outlet /> : <Navigate to="/login" replace />
}
