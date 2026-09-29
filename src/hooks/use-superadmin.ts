import { useState, useCallback } from 'react';
import { API_URL, getAuthToken } from '@/lib/api';

interface UserOrganization {
  org_id: string;
  org_name: string;
  role: string;
}

interface User {
  id: string;
  email: string;
  name: string;
  is_superadmin: boolean;
  created_at: string;
  organizations?: UserOrganization[];
  is_orphan?: boolean;
}

interface Plan {
  id: string;
  name: string;
  description: string | null;
  max_connections: number;
  max_monthly_messages: number;
  max_users: number;
  max_supervisors: number;
  has_asaas_integration: boolean;
  has_chat: boolean;
  has_whatsapp_groups: boolean;
  has_campaigns: boolean;
  has_chatbots: boolean;
  has_scheduled_messages: boolean;
  has_crm: boolean;
  has_ai_agents: boolean;
  has_departments: boolean;
  has_lead_scoring: boolean;
  has_ai_summary: boolean;
  has_group_secretary: boolean;
  has_rh: boolean;
  has_ghost: boolean;
  has_projects: boolean;
  has_lead_gleego: boolean;
  has_doc_signatures: boolean;
  doc_signatures_limit: number;
  price: number;
  billing_period: string;
  is_active: boolean;
  visible_on_signup: boolean;
  trial_days: number;
  org_count?: number;
  created_at: string;
}

interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  plan_id: string | null;
  plan_name?: string;
  plan_price?: number;
  expires_at: string | null;
  member_count?: number;
  created_at: string;
}

interface OrgMember {
  id: string;
  account_type?: string;
  user_id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
}

export function useSuperadmin() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getHeaders = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${getAuthToken()}`
  });

  const checkSuperadmin = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(`${API_URL}/api/admin/check`, { headers: getHeaders() });
      if (!response.ok) return false;
      const data = await response.json();
      return data.isSuperadmin;
    } catch {
      return false;
    }
  }, []);

  // ============================================
  // PLANS
  // ============================================

  const getAllPlans = useCallback(async (): Promise<Plan[]> => {
    try {
      const response = await fetch(`${API_URL}/api/admin/plans`, { headers: getHeaders() });
      if (!response.ok) throw new Error('Acesso negado');
      return response.json();
    } catch (err) {
      console.error('Get plans error:', err);
      return [];
    }
  }, []);

  const createPlan = useCallback(async (data: {
    name: string;
    description?: string;
    max_connections: number;
    max_monthly_messages: number;
    max_users: number;
    max_supervisors: number;
    has_asaas_integration: boolean;
    has_chat: boolean;
    has_whatsapp_groups: boolean;
    has_campaigns: boolean;
    has_chatbots: boolean;
    has_scheduled_messages: boolean;
    has_crm: boolean;
    has_ai_agents: boolean;
    has_departments: boolean;
    has_lead_scoring: boolean;
    has_ai_summary: boolean;
    has_group_secretary: boolean;
    has_rh?: boolean;
    has_ghost?: boolean;
    has_projects?: boolean;
    has_lead_gleego?: boolean;
    has_doc_signatures?: boolean;
    doc_signatures_limit?: number;
    price: number;
    billing_period: string;
    visible_on_signup?: boolean;
    trial_days?: number;
  }): Promise<Plan | null> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_URL}/api/admin/plans`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data)
      });
      
      if (!response.ok) {
        const res = await response.json();
        throw new Error(res.error || 'Erro ao criar plano');
      }
      
      return response.json();
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const updatePlan = useCallback(async (id: string, data: Partial<Plan>): Promise<Plan | null> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_URL}/api/admin/plans/${id}`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify(data)
      });
      
      if (!response.ok) {
        const res = await response.json();
        throw new Error(res.error || 'Erro ao atualizar plano');
      }
      
      return response.json();
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const deletePlan = useCallback(async (id: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_URL}/api/admin/plans/${id}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      
      if (!response.ok) {
        const res = await response.json();
        throw new Error(res.error || 'Erro ao deletar plano');
      }
      
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const syncAllPlansToOrganizations = useCallback(async (): Promise<{ synced_organizations: number; details?: any[] } | null> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_URL}/api/admin/plans/sync-all`, {
        method: 'POST',
        headers: getHeaders()
      });
      
      if (!response.ok) {
        const res = await response.json();
        throw new Error(res.error || 'Erro ao sincronizar planos');
      }
      
      return response.json();
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // ============================================
  // USERS
  // ============================================

  const getAllUsers = useCallback(async (options?: { search?: string; orphansOnly?: boolean }): Promise<User[]> => {
    try {
      const params = new URLSearchParams();
      if (options?.search) params.append('search', options.search);
      if (options?.orphansOnly) params.append('orphans_only', 'true');
      
      const url = `${API_URL}/api/admin/users${params.toString() ? `?${params}` : ''}`;
      const response = await fetch(url, { headers: getHeaders() });
      if (!response.ok) throw new Error('Acesso negado');
      return response.json();
    } catch (err) {
      console.error('Get users error:', err);
      return [];
    }
  }, []);

  const searchUserByEmail = useCallback(async (email: string): Promise<User | null> => {
    try {
      const response = await fetch(`${API_URL}/api/admin/users/search-email?email=${encodeURIComponent(email)}`, { 
        headers: getHeaders() 
      });
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error('Erro ao buscar usuário');
      }
      return response.json();
    } catch (err) {
      console.error('Search user by email error:', err);
      return null;
    }
  }, []);

  const deleteUserByEmail = useCallback(async (email: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_URL}/api/admin/users/by-email/${encodeURIComponent(email)}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      
      if (!response.ok) {
        const res = await response.json();
        throw new Error(res.error || 'Erro ao excluir usuário');
      }
      
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const setSuperadmin = useCallback(async (userId: string, isSuperadmin: boolean): Promise<boolean> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_URL}/api/admin/users/${userId}/superadmin`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ is_superadmin: isSuperadmin })
      });
      
      if (!response.ok) {
        const res = await response.json();
        throw new Error(res.error || 'Erro ao atualizar usuário');
      }
      
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteUser = useCallback(async (userId: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_URL}/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      
      if (!response.ok) {
        const res = await response.json();
        throw new Error(res.error || 'Erro ao excluir usuário');
      }
      
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const changeUserPassword = useCallback(async (userId: string, newPassword: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_URL}/api/admin/users/${userId}/password`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ new_password: newPassword })
      });
      
      if (!response.ok) {
        const res = await response.json();
        throw new Error(res.error || 'Erro ao alterar senha');
      }
      
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  // ============================================
  // ORGANIZATIONS
  // ============================================

  const getAllOrganizations = useCallback(async (): Promise<Organization[]> => {
    try {
      const response = await fetch(`${API_URL}/api/admin/organizations`, { headers: getHeaders() });
      if (!response.ok) throw new Error('Acesso negado');
      return response.json();
    } catch (err) {
      console.error('Get organizations error:', err);
      return [];
    }
  }, []);

  const createOrganization = useCallback(async (data: { 
    name: string; 
    slug: string; 
    logo_url?: string;
    owner_email: string;
    owner_name?: string;
    owner_password?: string;
    plan_id?: string;
    expires_at?: string;
  }): Promise<Organization | null> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_URL}/api/admin/organizations`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data)
      });
      
      if (!response.ok) {
        const res = await response.json();
        throw new Error(res.error || 'Erro ao criar organização');
      }
      
      return response.json();
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateOrganization = useCallback(async (id: string, data: { 
    name?: string; 
    logo_url?: string;
    plan_id?: string;
    expires_at?: string;
  }): Promise<Organization | null> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_URL}/api/admin/organizations/${id}`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify(data)
      });
      
      if (!response.ok) {
        const res = await response.json();
        throw new Error(res.error || 'Erro ao atualizar organização');
      }
      
      return response.json();
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteOrganization = useCallback(async (id: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_URL}/api/admin/organizations/${id}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      
      if (!response.ok) {
        const res = await response.json();
        throw new Error(res.error || 'Erro ao deletar organização');
      }
      
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  // ============================================
  // ORGANIZATION MEMBERS
  // ============================================

  const getOrganizationMembers = useCallback(async (orgId: string): Promise<{
    members: OrgMember[];
    limits: {
      max_users: number;
      max_supervisors: number;
      current_users: number;
      current_supervisors: number;
      plan_name: string;
    };
  }> => {
    try {
      const response = await fetch(`${API_URL}/api/admin/organizations/${orgId}/members`, { headers: getHeaders() });
      if (!response.ok) throw new Error('Acesso negado');
      return response.json();
    } catch (err) {
      console.error('Get org members error:', err);
      return { members: [], limits: { max_users: 0, max_supervisors: 0, current_users: 0, current_supervisors: 0, plan_name: '' } };
    }
  }, []);

  const createOrganizationUser = useCallback(async (orgId: string, data: {
    email: string;
    name: string;
    password: string;
    role: string;
    account_type?: string;
  }): Promise<OrgMember | null> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_URL}/api/admin/organizations/${orgId}/users`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data)
      });
      
      if (!response.ok) {
        const res = await response.json();
        throw new Error(res.error || 'Erro ao criar usuário');
      }
      
      return response.json();
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateMemberRole = useCallback(async (orgId: string, memberId: string, role: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_URL}/api/admin/organizations/${orgId}/members/${memberId}`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ role })
      });
      
      if (!response.ok) {
        const res = await response.json();
        throw new Error(res.error || 'Erro ao atualizar membro');
      }
      
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const removeMember = useCallback(async (orgId: string, memberId: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_URL}/api/admin/organizations/${orgId}/members/${memberId}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      
      if (!response.ok) {
        const res = await response.json();
        throw new Error(res.error || 'Erro ao remover membro');
      }
      
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    error,
    checkSuperadmin,
    // Plans
    getAllPlans,
    createPlan,
    updatePlan,
    deletePlan,
    syncAllPlansToOrganizations,
    // Users
    getAllUsers,
    setSuperadmin,
    deleteUser,
    changeUserPassword,
    searchUserByEmail,
    deleteUserByEmail,
    // Organizations
    getAllOrganizations,
    createOrganization,
    updateOrganization,
    deleteOrganization,
    // Organization Members
    getOrganizationMembers,
    createOrganizationUser,
    updateMemberRole,
    removeMember
  };
}