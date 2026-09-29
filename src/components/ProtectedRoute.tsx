import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  loginPath?: string;
  allowedAccountTypes?: string[];
  redirectAccountType?: string;
}

const ProtectedRoute = ({ children, loginPath = '/login', allowedAccountTypes, redirectAccountType }: ProtectedRouteProps) => {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to={loginPath} replace />;
  }

  const accountType = user?.account_type || 'standard';
  const isKioskRoute = window.location.pathname === '/kiosk' || window.location.pathname === '/kiosk/login';

  if (accountType === 'timeclock_kiosk' && !isKioskRoute) {
    return <Navigate to="/kiosk" replace />;
  }

  if (allowedAccountTypes && !allowedAccountTypes.includes(accountType)) {
    const destination = redirectAccountType === 'kiosk' ? '/kiosk/login' : '/login';
    return <Navigate to={destination} replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
