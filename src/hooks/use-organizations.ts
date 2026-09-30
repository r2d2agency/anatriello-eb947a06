import { useState, useCallback } from 'react';
import { API_URL, getAuthToken } from '@/lib/api';

interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  role: 'owner' | 'admin' | 'manager' | 'agent';
  created_at: string;
}

interface AssignedConnection {
  id: string;
  name: string;
}

interface AssignedDepartment {
  id: string;
  name: string;
  role: string;
}

interface OrganizationMember {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'manager' | 'agent';
  assigned_connections: AssignedConnection[];
  assigned_departments: AssignedDepartment[];
  is_active?: boolean;
  created_at: string;
}

interface OrgDepartment {
  id: string;
  name: string;
  color: string;
  icon: string;
  is_active: boolean;
}

interface OrgConnection {
  id: string;
  name: string;
  phone_number: string | null;
  status: string;
  provider: string | null;
}

interface AddMemberParams {
  email: string;
  role: string;
  name?: string;
  password?: string;
  account_type?: string;
  connection_ids?: string[];
  department_ids?: string[];
}

interface UpdateMemberParams {
  role?: string;
  connection_ids?: string[];
  department_ids?: string[];
  is_active?: boolean;
}

interface AddMemberResult {
  success: boolean;
  user_created?: boolean;
  requires_registration?: boolean;
  message?: string;
}

export function useOrganizations() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getHeaders = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${getAuthToken()}`
  });

  const getOrganizations = useCallback(async (): Promise<Organization[]> => {
    try {
      const response = await fetch(`${API_URL}/api/organizations`, { headers: getHeaders() });
      if (!response.ok) throw new Error('Erro ao buscar organizações');
      return response.json();
    } catch (err) {
      console.error('Get organizations error:', err);
      return [];
    }
  }, []);

  const getOrganization = useCallback(async (id: string): Promise<Organization | null> => {
    try {
      const response = await fetch(`${API_URL}/api/organizations/${id}`, { headers: getHeaders() });
      if (!response.ok) throw new Error('Erro ao buscar organização');
      return response.json();
    } catch (err) {
      console.error('Get organization error:', err);
      return null;
    }
  }, []);

  const createOrganization = useCallback(async (name: string, slug: string): Promise<Organization | null> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_URL}/api/organizations`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ name, slug })
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Erro ao criar organização');
      }
      
      return response.json();
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateOrganization = useCallback(async (id: string, data: { name?: string; logo_url?: string }): Promise<Organization | null> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_URL}/api/organizations/${id}`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify(data)
      });
      
      if (!response.ok) {
        const resData = await response.json();
        throw new Error(resData.error || 'Erro ao atualizar organização');
      }
      
      return response.json();
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const getMembers = useCallback(async (organizationId: string): Promise<OrganizationMember[]> => {
    try {
      const response = await fetch(`${API_URL}/api/organizations/${organizationId}/members`, { headers: getHeaders() });
      if (!response.ok) throw new Error('Erro ao buscar membros');
      return response.json();
    } catch (err) {
      console.error('Get members error:', err);
      return [];
    }
  }, []);

  const getConnections = useCallback(async (organizationId: string): Promise<OrgConnection[]> => {
    try {
      const response = await fetch(`${API_URL}/api/organizations/${organizationId}/connections`, { headers: getHeaders() });
      if (!response.ok) throw new Error('Erro ao buscar conexões');
      return response.json();
    } catch (err) {
      console.error('Get org connections error:', err);
      return [];
    }
  }, []);

  const addMember = useCallback(async (organizationId: string, params: AddMemberParams): Promise<AddMemberResult> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_URL}/api/organizations/${organizationId}/members`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(params)
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        if (data.requires_registration) {
          setError(data.details || data.error);
          return { success: false, requires_registration: true };
        }
        throw new Error(data.details || data.error || 'Erro ao adicionar membro');
      }
      
      return { 
        success: true, 
        user_created: data.user_created,
        message: data.message 
      };
    } catch (err: any) {
      setError(err.message);
      return { success: false };
    } finally {
      setLoading(false);
    }
  }, []);

  const updateMember = useCallback(async (organizationId: string, userId: string, data: UpdateMemberParams): Promise<boolean> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_URL}/api/organizations/${organizationId}/members/${userId}`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify(data)
      });
      
      if (!response.ok) {
        const resData = await response.json();
        throw new Error(resData.error || 'Erro ao atualizar membro');
      }
      
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const getDepartments = useCallback(async (organizationId: string): Promise<OrgDepartment[]> => {
    try {
      const response = await fetch(`${API_URL}/api/organizations/${organizationId}/departments`, { headers: getHeaders() });
      if (!response.ok) throw new Error('Erro ao buscar departamentos');
      return response.json();
    } catch (err) {
      console.error('Get org departments error:', err);
      return [];
    }
  }, []);

  const removeMember = useCallback(async (organizationId: string, userId: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_URL}/api/organizations/${organizationId}/members/${userId}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Erro ao remover membro');
      }
      
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateMemberPassword = useCallback(async (organizationId: string, userId: string, password: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_URL}/api/organizations/${organizationId}/members/${userId}/password`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ password })
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Erro ao atualizar senha');
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
    getOrganizations,
    getOrganization,
    createOrganization,
    updateOrganization,
    getMembers,
    getConnections,
    getDepartments,
    addMember,
    updateMember,
    removeMember,
    updateMemberPassword
  };
}