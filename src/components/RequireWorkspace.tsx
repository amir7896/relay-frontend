import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

/** Requires an active workspace membership before entering the app shell. */
export function RequireWorkspace() {
  const { session } = useAuth();
  const location = useLocation();

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!session.organizations.length || !session.activeOrganizationId) {
    return <Navigate to="/onboarding" replace />;
  }

  return <Outlet />;
}
