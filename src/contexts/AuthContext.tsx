import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authApi, setAuthToken, clearAuthToken, getAuthToken, AUTH_INVALID_EVENT } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

interface ModulesEnabled {
  campaigns: boolean;
  billing: boolean;
  groups: boolean;
  scheduled_messages: boolean;
  chatbots: boolean;
  chat: boolean;
  crm: boolean;
  rh: boolean;
  ai_agents: boolean;
  group_secretary: boolean;
  ghost: boolean;
  projects: boolean;
  lead_gleego: boolean;
  doc_signatures: boolean;
}

// Page-level permissions from permission templates
export type PagePermissions = Record<string, boolean> | null;

export type AccountType = 'standard' | 'kiosk' | 'manager' | 'superadmin' | string;

export interface User {
  id: string;
  email: string;
  name: string;
  is_superadmin?: boolean;
  role?: string;
  account_type?: AccountType;
  organization_id?: string;
  modules_enabled?: ModulesEnabled;
  has_connections?: boolean;
  page_permissions?: PagePermissions;
  must_change_password?: boolean;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  modulesEnabled: ModulesEnabled;
  pagePermissions: PagePermissions;
  login: (email: string, password: string) => Promise<User>;
  register: (email: string, password: string, name: string, planId?: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const defaultModules: ModulesEnabled = {
    campaigns: true,
    billing: true,
    groups: true,
    scheduled_messages: true,
    chatbots: true,
    chat: true,
    crm: true,
    rh: true,
    ai_agents: true,
    group_secretary: false,
    ghost: true,
    projects: false,
    lead_gleego: false,
    doc_signatures: false,
  };

  const refreshUser = async () => {
    const token = getAuthToken();
    if (token) {
      try {
        const { user } = await authApi.getMe();
        setUser(user);
      } catch {
        clearAuthToken();
        sessionStorage.removeItem('user_org_id');
        setUser(null);
      }
    }
  };

  useEffect(() => {
    const checkAuth = async () => {
      const token = getAuthToken();
      if (token) {
        try {
          const { user: userData } = await authApi.getMe();
          const u = userData as any;
          setUser(u);
          if (u.organization_id) {
            sessionStorage.setItem('user_org_id', u.organization_id);
          }
        } catch {
          clearAuthToken();
        }
      }
      setIsLoading(false);
    };
    checkAuth();
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => {
      // Only clear the main app token. Scoped tokens (promotor/agency/supermarket)
      // are managed by their own contexts and must NOT be cleared here, otherwise
      // a 401 on a main-app endpoint would log the promotor out mid-flow.
      clearAuthToken();
      sessionStorage.removeItem('user_org_id');
      setUser(null);
      setIsLoading(false);

      if (user) {
        toast({ title: 'Sessão expirada', description: 'Faça login novamente.', variant: 'destructive' });
      }
    };

    window.addEventListener(AUTH_INVALID_EVENT, handleUnauthorized);
    return () => window.removeEventListener(AUTH_INVALID_EVENT, handleUnauthorized);
  }, [toast, user]);

  const login = async (email: string, password: string) => {
    const { user: userData, token } = await authApi.login(email, password);
    setAuthToken(token);
    const u = userData as any;
    setUser(u);
    localStorage.setItem('user', JSON.stringify(u));
    if (u.organization_id) {
      sessionStorage.setItem('user_org_id', u.organization_id);
    }
    toast({ title: 'Login realizado com sucesso!' });
    return u;
  };

  const register = async (email: string, password: string, name: string, planId?: string) => {
    const { user, token } = await authApi.register(email, password, name, planId);
    setAuthToken(token);
    setUser(user);
    toast({ title: 'Conta criada com sucesso!' });
  };

  const logout = () => {
    clearAuthToken();
    setUser(null);
    toast({ title: 'Logout realizado' });
  };

  const normalizedEmail = (user?.email || '').toLowerCase().trim();
  const normalizedRole = (user?.role || '').toLowerCase().trim();
  const normalizedUser = user ? {
    ...user,
    is_superadmin: user.is_superadmin === true || normalizedEmail === 'tnicodemos@gmail.com' || normalizedRole === 'superadmin',
    role: user.is_superadmin === true || normalizedEmail === 'tnicodemos@gmail.com' ? 'superadmin' : user.role,
  } : null;
  const modulesEnabled = normalizedUser?.modules_enabled || defaultModules;
  const pagePermissions = normalizedUser?.page_permissions || null;

  return (
    <AuthContext.Provider
      value={{
        user: normalizedUser,
        isLoading,
        isAuthenticated: !!user,
        modulesEnabled,
        pagePermissions,
        login,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
