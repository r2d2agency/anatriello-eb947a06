import { useState, useEffect } from 'react';
import { FileUploadInput } from '@/components/ui/file-upload-input';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { useSuperadmin } from '@/hooks/use-superadmin';
import { useAdminSettings } from '@/hooks/use-branding';
import { useUpload } from '@/hooks/use-upload';
import { BrandingTab } from '@/components/admin/BrandingTab';
import { toast } from 'sonner';
import { Shield, Building2, Users, Plus, Trash2, Loader2, Pencil, Crown, Image, Package, CalendarIcon, UserPlus, Eye, MessageSquare, Receipt, Wifi, Upload, Palette, Bot, Clock, Briefcase, Search, AlertTriangle, Mail, Sparkles, Key, Server, Lock } from 'lucide-react';
import { WapiInstancesTab } from '@/components/admin/WapiInstancesTab';
import { GlobalAgentsTab } from '@/components/admin/GlobalAgentsTab';
import { MerchImportTab } from '@/components/admin/MerchImportTab';
import { api } from '@/lib/api';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

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
  user_id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
}

export default function Admin() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  
  // W-API token
  const [wapiToken, setWapiToken] = useState('');
  const [savingWapiToken, setSavingWapiToken] = useState(false);
  const [loadingWapiToken, setLoadingWapiToken] = useState(false);
  
  // CNPJ API token
  const [cnpjApiToken, setCnpjApiToken] = useState('');
  const [savingCnpjToken, setSavingCnpjToken] = useState(false);

  // Doc Signature SMTP
  const [docSmtpHost, setDocSmtpHost] = useState('');
  const [docSmtpPort, setDocSmtpPort] = useState('587');
  const [docSmtpSecure, setDocSmtpSecure] = useState(true);
  const [docSmtpUsername, setDocSmtpUsername] = useState('');
  const [docSmtpPassword, setDocSmtpPassword] = useState('');
  const [docSmtpFromName, setDocSmtpFromName] = useState('');
  const [docSmtpFromEmail, setDocSmtpFromEmail] = useState('');
  const [savingDocSmtp, setSavingDocSmtp] = useState(false);
  const [testingDocSmtp, setTestingDocSmtp] = useState(false);
  const [showDocSmtpPassword, setShowDocSmtpPassword] = useState(false);
  
  // User search and filter
  const [userSearch, setUserSearch] = useState('');
  const [showOrphansOnly, setShowOrphansOnly] = useState(false);
  const [searchingUsers, setSearchingUsers] = useState(false);
  
  // Delete by email dialog
  const [deleteByEmailDialogOpen, setDeleteByEmailDialogOpen] = useState(false);
  const [emailToDelete, setEmailToDelete] = useState('');
  const [emailSearchResult, setEmailSearchResult] = useState<User | null>(null);
  const [searchingEmail, setSearchingEmail] = useState(false);
  
  // Create org dialog
  const [createOrgDialogOpen, setCreateOrgDialogOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgSlug, setNewOrgSlug] = useState('');
  const [newOrgLogo, setNewOrgLogo] = useState('');
  const [newOrgOwner, setNewOrgOwner] = useState('');
  const [newOrgOwnerName, setNewOrgOwnerName] = useState('');
  const [newOrgOwnerPassword, setNewOrgOwnerPassword] = useState('');
  const [newOrgPlan, setNewOrgPlan] = useState('');
  const [newOrgExpires, setNewOrgExpires] = useState<Date | undefined>();

  // Edit org dialog
  const [editOrgDialogOpen, setEditOrgDialogOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [editOrgName, setEditOrgName] = useState('');
  const [editOrgLogo, setEditOrgLogo] = useState('');
  const [editOrgPlan, setEditOrgPlan] = useState('');
  const [editOrgExpires, setEditOrgExpires] = useState<Date | undefined>();

  // Create plan dialog
  const [createPlanDialogOpen, setCreatePlanDialogOpen] = useState(false);
  const [newPlanName, setNewPlanName] = useState('');
  const [newPlanDescription, setNewPlanDescription] = useState('');
  const [newPlanConnections, setNewPlanConnections] = useState('1');
  const [newPlanMessages, setNewPlanMessages] = useState('1000');
  const [newPlanUsers, setNewPlanUsers] = useState('5');
  const [newPlanSupervisors, setNewPlanSupervisors] = useState('1');
  const [newPlanPrice, setNewPlanPrice] = useState('0');
  const [newPlanAsaas, setNewPlanAsaas] = useState(false);
  const [newPlanChat, setNewPlanChat] = useState(true);
  const [newPlanGroups, setNewPlanGroups] = useState(false);
  const [newPlanCampaigns, setNewPlanCampaigns] = useState(true);
  const [newPlanChatbots, setNewPlanChatbots] = useState(true);
  const [newPlanScheduled, setNewPlanScheduled] = useState(true);
  const [newPlanCRM, setNewPlanCRM] = useState(true);
  const [newPlanAIAgents, setNewPlanAIAgents] = useState(true);
  const [newPlanDepartments, setNewPlanDepartments] = useState(true);
  const [newPlanLeadScoring, setNewPlanLeadScoring] = useState(true);
  const [newPlanAISummary, setNewPlanAISummary] = useState(true);
  const [newPlanGroupSecretary, setNewPlanGroupSecretary] = useState(false);
  const [newPlanRH, setNewPlanRH] = useState(true);
  const [newPlanGhost, setNewPlanGhost] = useState(false);
  const [newPlanProjects, setNewPlanProjects] = useState(false);
  const [newPlanLeadGleego, setNewPlanLeadGleego] = useState(false);
  const [newPlanDocSignatures, setNewPlanDocSignatures] = useState(false);
  const [newPlanDocSignaturesLimit, setNewPlanDocSignaturesLimit] = useState('0');
  const [newPlanPeriod, setNewPlanPeriod] = useState('monthly');
  const [newPlanVisibleOnSignup, setNewPlanVisibleOnSignup] = useState(false);
  const [newPlanTrialDays, setNewPlanTrialDays] = useState('3');

  // Edit plan dialog
  const [editPlanDialogOpen, setEditPlanDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);

  // Organization members dialog
  const [membersDialogOpen, setMembersDialogOpen] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [orgLimits, setOrgLimits] = useState<{
    max_users: number;
    max_supervisors: number;
    current_users: number;
    current_supervisors: number;
    plan_name: string;
  } | null>(null);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // Add user to org dialog
  const [addUserDialogOpen, setAddUserDialogOpen] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState('agent');
  const [newUserAccountType, setNewUserAccountType] = useState('standard');

  // Change password dialog
  const [changePasswordDialogOpen, setChangePasswordDialogOpen] = useState(false);
  const [changePasswordUser, setChangePasswordUser] = useState<User | null>(null);
  const [changePasswordValue, setChangePasswordValue] = useState('');

  const { 
    loading: actionLoading,
    error,
    checkSuperadmin,
    getAllUsers,
    getAllOrganizations,
    getAllPlans,
    createOrganization,
    updateOrganization,
    deleteOrganization,
    createPlan,
    updatePlan,
    deletePlan,
    setSuperadmin,
    deleteUser,
    changeUserPassword,
    searchUserByEmail,
    deleteUserByEmail,
    getOrganizationMembers,
    createOrganizationUser,
    updateMemberRole,
    removeMember,
    syncAllPlansToOrganizations
  } = useSuperadmin();

  useEffect(() => {
    checkAccess();
  }, []);

  const checkAccess = async () => {
    const isAdmin = await checkSuperadmin();
    setIsSuperadmin(isAdmin);
    
    if (!isAdmin) {
      toast.error('Acesso negado. Apenas superadmins podem acessar esta página.');
      navigate('/dashboard');
      return;
    }
    
    loadData();
  };

  const loadWapiToken = async () => {
    setLoadingWapiToken(true);
    try {
      const settings = await api<Array<{ key: string; value: string }>>('/api/admin/settings');
      const foundWapi = settings.find(s => s.key === 'wapi_token');
      setWapiToken(foundWapi?.value || '');
      const foundCnpj = settings.find(s => s.key === 'cnpj_api_token');
      setCnpjApiToken(foundCnpj?.value || '');
      // Load doc signature SMTP
      const foundDocSmtp = settings.find(s => s.key === 'doc_signature_smtp');
      if (foundDocSmtp?.value) {
        try {
          const smtp = JSON.parse(foundDocSmtp.value);
          setDocSmtpHost(smtp.host || '');
          setDocSmtpPort(String(smtp.port || 587));
          setDocSmtpSecure(smtp.secure !== false);
          setDocSmtpUsername(smtp.username || '');
          setDocSmtpFromName(smtp.from_name || '');
          setDocSmtpFromEmail(smtp.from_email || '');
        } catch {}
      }
    } catch {
      // ignore
    } finally {
      setLoadingWapiToken(false);
    }
  };

  const handleSaveDocSmtp = async () => {
    if (!docSmtpHost || !docSmtpUsername || !docSmtpFromEmail) {
      toast.error('Preencha host, usuário e e-mail de envio');
      return;
    }
    setSavingDocSmtp(true);
    try {
      const payload = {
        host: docSmtpHost,
        port: parseInt(docSmtpPort) || 587,
        secure: docSmtpSecure,
        username: docSmtpUsername,
        password: docSmtpPassword || undefined,
        from_name: docSmtpFromName,
        from_email: docSmtpFromEmail,
      };
      await api('/api/admin/settings/doc-signature-smtp', {
        method: 'PUT',
        body: payload,
      });
      toast.success('SMTP de assinaturas salvo!');
      setDocSmtpPassword('');
    } catch (error: any) {
      toast.error(error.message || 'Erro ao salvar');
    } finally {
      setSavingDocSmtp(false);
    }
  };

  const handleTestDocSmtp = async () => {
    setTestingDocSmtp(true);
    try {
      const result = await api<{ success: boolean; message: string }>('/api/admin/settings/doc-signature-smtp/test', {
        method: 'POST',
      });
      toast.success(result.message || 'E-mail de teste enviado!');
    } catch (error: any) {
      toast.error(error.message || 'Falha no teste');
    } finally {
      setTestingDocSmtp(false);
    }
  };

  const handleSaveWapiToken = async () => {
    setSavingWapiToken(true);
    try {
      await api('/api/admin/settings/wapi_token', {
        method: 'PATCH',
        body: { value: wapiToken },
      });
      toast.success('Token W-API salvo com sucesso!');
    } catch (error: any) {
      toast.error(error.message || 'Erro ao salvar token');
    } finally {
      setSavingWapiToken(false);
    }
  };

  const loadData = async () => {
    setLoading(true);
    const [usersData, orgsData, plansData] = await Promise.all([
      getAllUsers({ search: userSearch, orphansOnly: showOrphansOnly }),
      getAllOrganizations(),
      getAllPlans()
    ]);
    setUsers(usersData);
    setOrganizations(orgsData);
    setPlans(plansData);
    setLoading(false);
    loadWapiToken();
  };

  // Reload users with search/filter
  const reloadUsers = async () => {
    setSearchingUsers(true);
    const usersData = await getAllUsers({ search: userSearch, orphansOnly: showOrphansOnly });
    setUsers(usersData);
    setSearchingUsers(false);
  };

  // Search user by email for deletion
  const handleSearchEmailForDelete = async () => {
    if (!emailToDelete.trim()) {
      toast.error('Digite um email');
      return;
    }
    setSearchingEmail(true);
    const user = await searchUserByEmail(emailToDelete.trim());
    setEmailSearchResult(user);
    setSearchingEmail(false);
    if (!user) {
      toast.info('Nenhum usuário encontrado com esse email');
    }
  };

  // Delete user by email
  const handleDeleteUserByEmail = async () => {
    if (!emailSearchResult) return;
    const success = await deleteUserByEmail(emailSearchResult.email);
    if (success) {
      toast.success(`Usuário ${emailSearchResult.email} excluído com sucesso!`);
      setDeleteByEmailDialogOpen(false);
      setEmailToDelete('');
      setEmailSearchResult(null);
      loadData();
    } else if (error) {
      toast.error(error);
    }
  };

  const generateSlug = (name: string) => {
    return name.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  // ============================================
  // PLANS HANDLERS
  // ============================================

  const handleCreatePlan = async () => {
    if (!newPlanName) {
      toast.error('Nome do plano é obrigatório');
      return;
    }

    const plan = await createPlan({
      name: newPlanName,
      description: newPlanDescription || undefined,
      max_connections: parseInt(newPlanConnections) || 1,
      max_monthly_messages: parseInt(newPlanMessages) || 1000,
      max_users: parseInt(newPlanUsers) || 5,
      max_supervisors: parseInt(newPlanSupervisors) || 1,
      has_asaas_integration: newPlanAsaas,
      has_chat: newPlanChat,
      has_whatsapp_groups: newPlanGroups,
      has_campaigns: newPlanCampaigns,
      has_chatbots: newPlanChatbots,
      has_scheduled_messages: newPlanScheduled,
      has_crm: newPlanCRM,
      has_ai_agents: newPlanAIAgents,
      has_departments: newPlanDepartments,
      has_lead_scoring: newPlanLeadScoring,
      has_ai_summary: newPlanAISummary,
      has_group_secretary: newPlanGroupSecretary,
      has_rh: newPlanRH,
      has_ghost: newPlanGhost,
      has_projects: newPlanProjects,
      has_lead_gleego: newPlanLeadGleego,
      has_doc_signatures: newPlanDocSignatures,
      doc_signatures_limit: parseInt(newPlanDocSignaturesLimit) || 0,
      price: parseFloat(newPlanPrice) || 0,
      billing_period: newPlanPeriod,
      visible_on_signup: newPlanVisibleOnSignup,
      trial_days: parseInt(newPlanTrialDays) || 3
    });

    if (plan) {
      toast.success('Plano criado com sucesso!');
      setCreatePlanDialogOpen(false);
      resetPlanForm();
      loadData();
    } else if (error) {
      toast.error(error);
    }
  };

  const resetPlanForm = () => {
    setNewPlanName('');
    setNewPlanDescription('');
    setNewPlanConnections('1');
    setNewPlanMessages('1000');
    setNewPlanUsers('5');
    setNewPlanSupervisors('1');
    setNewPlanPrice('0');
    setNewPlanAsaas(false);
    setNewPlanChat(true);
    setNewPlanGroups(false);
    setNewPlanCampaigns(true);
    setNewPlanChatbots(true);
    setNewPlanScheduled(true);
    setNewPlanCRM(true);
    setNewPlanAIAgents(true);
    setNewPlanDepartments(true);
    setNewPlanLeadScoring(true);
    setNewPlanAISummary(true);
    setNewPlanGroupSecretary(false);
    setNewPlanRH(true);
    setNewPlanGhost(false);
    setNewPlanProjects(false);
    setNewPlanLeadGleego(false);
    setNewPlanDocSignatures(false);
    setNewPlanDocSignaturesLimit('0');
    setNewPlanPeriod('monthly');
    setNewPlanVisibleOnSignup(false);
    setNewPlanTrialDays('3');
  };

  const handleUpdatePlan = async () => {
    if (!editingPlan) return;

    const updated = await updatePlan(editingPlan.id, {
      name: editingPlan.name,
      description: editingPlan.description,
      max_connections: editingPlan.max_connections,
      max_monthly_messages: editingPlan.max_monthly_messages,
      max_users: editingPlan.max_users,
      max_supervisors: editingPlan.max_supervisors,
      has_asaas_integration: editingPlan.has_asaas_integration,
      has_chat: editingPlan.has_chat,
      has_whatsapp_groups: editingPlan.has_whatsapp_groups,
      has_campaigns: editingPlan.has_campaigns,
      has_chatbots: editingPlan.has_chatbots,
      has_scheduled_messages: editingPlan.has_scheduled_messages,
      has_crm: editingPlan.has_crm,
      has_ai_agents: editingPlan.has_ai_agents,
      has_departments: editingPlan.has_departments,
      has_lead_scoring: editingPlan.has_lead_scoring,
      has_ai_summary: editingPlan.has_ai_summary,
      has_group_secretary: editingPlan.has_group_secretary,
      has_rh: editingPlan.has_rh,
      has_ghost: editingPlan.has_ghost,
      has_projects: editingPlan.has_projects,
      has_lead_gleego: editingPlan.has_lead_gleego,
      has_doc_signatures: editingPlan.has_doc_signatures,
      doc_signatures_limit: editingPlan.doc_signatures_limit,
      price: editingPlan.price,
      billing_period: editingPlan.billing_period,
      is_active: editingPlan.is_active,
      visible_on_signup: editingPlan.visible_on_signup,
      trial_days: editingPlan.trial_days
    });

    if (updated) {
      toast.success('Plano atualizado!');
      setEditPlanDialogOpen(false);
      setEditingPlan(null);
      loadData();
    } else if (error) {
      toast.error(error);
    }
  };

  const handleDeletePlan = async (id: string) => {
    const success = await deletePlan(id);
    if (success) {
      toast.success('Plano removido!');
      loadData();
    } else if (error) {
      toast.error(error);
    }
  };

  const handleSyncAllPlans = async () => {
    const result = await syncAllPlansToOrganizations();
    if (result) {
      // Log details for debugging
      console.log('[sync-all] Result:', result);
      if (result.details && result.details.length > 0) {
        const detailsText = result.details.map((d: any) => 
          `${d.plan}: ${d.organizations.join(', ')} (CRM: ${d.modules.crm ? 'ON' : 'OFF'})`
        ).join('\n');
        console.log('[sync-all] Details:\n', detailsText);
      }
      toast.success(`Módulos sincronizados para ${result.synced_organizations} organizações! Os usuários precisam fazer logout/login para ver as mudanças.`);
      loadData();
    } else if (error) {
      toast.error(error);
    }
  };

  // ============================================
  // ORGANIZATIONS HANDLERS
  // ============================================

  const handleCreateOrg = async () => {
    if (!newOrgName || !newOrgSlug || !newOrgOwner) {
      toast.error('Preencha todos os campos obrigatórios');
      return;
    }

    const org = await createOrganization({
      name: newOrgName,
      slug: newOrgSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      logo_url: newOrgLogo || undefined,
      owner_email: newOrgOwner,
      owner_name: newOrgOwnerName || undefined,
      owner_password: newOrgOwnerPassword || undefined,
      plan_id: newOrgPlan || undefined,
      expires_at: newOrgExpires?.toISOString()
    });

    if (org) {
      toast.success('Organização criada com sucesso!');
      setCreateOrgDialogOpen(false);
      setNewOrgName('');
      setNewOrgSlug('');
      setNewOrgLogo('');
      setNewOrgOwner('');
      setNewOrgOwnerName('');
      setNewOrgOwnerPassword('');
      setNewOrgPlan('');
      setNewOrgExpires(undefined);
      loadData();
    } else if (error) {
      toast.error(error);
    }
  };

  const handleUpdateOrg = async () => {
    if (!editingOrg) return;

    const updated = await updateOrganization(editingOrg.id, {
      name: editOrgName,
      logo_url: editOrgLogo || undefined,
      plan_id: editOrgPlan || undefined,
      expires_at: editOrgExpires?.toISOString()
    });

    if (updated) {
      toast.success('Organização atualizada!');
      setEditOrgDialogOpen(false);
      setEditingOrg(null);
      loadData();
    } else if (error) {
      toast.error(error);
    }
  };

  const handleDeleteOrg = async (id: string) => {
    const success = await deleteOrganization(id);
    if (success) {
      toast.success('Organização removida!');
      loadData();
    } else if (error) {
      toast.error(error);
    }
  };

  const openEditOrgDialog = (org: Organization) => {
    setEditingOrg(org);
    setEditOrgName(org.name);
    setEditOrgLogo(org.logo_url || '');
    setEditOrgPlan(org.plan_id || '');
    setEditOrgExpires(org.expires_at ? new Date(org.expires_at) : undefined);
    setEditOrgDialogOpen(true);
  };

  // ============================================
  // MEMBERS HANDLERS
  // ============================================

  const openMembersDialog = async (org: Organization) => {
    setSelectedOrg(org);
    setMembersDialogOpen(true);
    setLoadingMembers(true);
    const result = await getOrganizationMembers(org.id);
    setOrgMembers(result.members);
    setOrgLimits(result.limits);
    setLoadingMembers(false);
  };

  const reloadMembers = async () => {
    if (!selectedOrg) return;
    const result = await getOrganizationMembers(selectedOrg.id);
    setOrgMembers(result.members);
    setOrgLimits(result.limits);
  };

  const handleAddUser = async () => {
    if (!selectedOrg || !newUserEmail || !newUserName || !newUserPassword) {
      toast.error('Preencha todos os campos');
      return;
    }

    const user = await createOrganizationUser(selectedOrg.id, {
      email: newUserEmail,
      name: newUserName,
      password: newUserPassword,
      role: newUserRole,
      account_type: newUserAccountType
    });

    if (user) {
      toast.success('Usuário criado com sucesso!');
      setAddUserDialogOpen(false);
      setNewUserEmail('');
      setNewUserName('');
      setNewUserPassword('');
      setNewUserRole('agent');
      setNewUserAccountType('standard');
      // Reload members
      await reloadMembers();
      loadData();
    } else if (error) {
      toast.error(error);
    }
  };

  const handleUpdateRole = async (memberId: string, newRole: string) => {
    if (!selectedOrg) return;
    
    const success = await updateMemberRole(selectedOrg.id, memberId, newRole);
    if (success) {
      toast.success('Permissão atualizada!');
      await reloadMembers();
    } else if (error) {
      toast.error(error);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!selectedOrg) return;
    
    const success = await removeMember(selectedOrg.id, memberId);
    if (success) {
      toast.success('Membro removido!');
      await reloadMembers();
      loadData();
    } else if (error) {
      toast.error(error);
    }
  };

  const handleToggleSuperadmin = async (userId: string, currentValue: boolean) => {
    const success = await setSuperadmin(userId, !currentValue);
    if (success) {
      toast.success(!currentValue ? 'Superadmin ativado!' : 'Superadmin removido!');
      loadData();
    } else if (error) {
      toast.error(error);
    }
  };

  const handleDeleteUser = async (userId: string, userEmail: string) => {
    const success = await deleteUser(userId);
    if (success) {
      toast.success(`Usuário ${userEmail} excluído com sucesso!`);
      loadData();
    } else if (error) {
      toast.error(error);
    }
  };

  const handleChangePassword = async () => {
    if (!changePasswordUser || !changePasswordValue) {
      toast.error('Informe a nova senha');
      return;
    }
    if (changePasswordValue.length < 6) {
      toast.error('A senha deve ter pelo menos 6 caracteres');
      return;
    }
    const success = await changeUserPassword(changePasswordUser.id, changePasswordValue);
    if (success) {
      toast.success(`Senha do usuário ${changePasswordUser.email} alterada com sucesso!`);
      setChangePasswordDialogOpen(false);
      setChangePasswordUser(null);
      setChangePasswordValue('');
    } else if (error) {
      toast.error(error);
    }
  };

  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'owner':
        return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">Proprietário</Badge>;
      case 'admin':
        return <Badge className="bg-primary/20 text-primary border-primary/30">Admin</Badge>;
      case 'agent':
        return <Badge variant="secondary">Agente</Badge>;
      default:
        return <Badge variant="outline">{role}</Badge>;
    }
  };

  if (!isSuperadmin) {
    return null;
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              <Shield className="h-8 w-8 text-primary neon-text" />
              Painel Superadmin
            </h1>
            <p className="text-muted-foreground">
              Gerencie planos, organizações e usuários do sistema
            </p>
          </div>
        </div>

        <Tabs defaultValue="plans" className="space-y-6">
          <TabsList className="grid w-full max-w-6xl grid-cols-9">
            <TabsTrigger value="plans" className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Planos
            </TabsTrigger>
            <TabsTrigger value="organizations" className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Organizações
            </TabsTrigger>
            <TabsTrigger value="users" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Usuários
            </TabsTrigger>
            <TabsTrigger value="global-agents" className="flex items-center gap-2">
              <Bot className="h-4 w-4" />
              IA Global
            </TabsTrigger>
            <TabsTrigger value="ayratech-ai" className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              IA Validação
            </TabsTrigger>
            <TabsTrigger value="wapi-instances" className="flex items-center gap-2">
              <Server className="h-4 w-4" />
              Instâncias
            </TabsTrigger>
            <TabsTrigger value="integrations" className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              Integrações
            </TabsTrigger>
            <TabsTrigger value="branding" className="flex items-center gap-2">
              <Palette className="h-4 w-4" />
              Branding
            </TabsTrigger>
            <TabsTrigger value="merch-import" className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Importação
            </TabsTrigger>
          </TabsList>

          <TabsContent value="ayratech-ai" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5" /> IA de Validação de Promotores</CardTitle>
                <CardDescription>Configure o provedor e modelo usados para validar documentos de promotores (CNH, contrato, selfie, etc).</CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={() => navigate('/admin/ayratech-ai')}>
                  <Sparkles className="h-4 w-4 mr-2" /> Abrir configurações
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Plans Tab */}
          <TabsContent value="plans" className="space-y-4">
            <div className="flex justify-between items-center gap-2">
              <h2 className="text-xl font-semibold">Planos</h2>
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  onClick={handleSyncAllPlans}
                  disabled={actionLoading}
                >
                  {actionLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Package className="h-4 w-4 mr-2" />}
                  Sincronizar Módulos
                </Button>
                <Dialog open={createPlanDialogOpen} onOpenChange={setCreatePlanDialogOpen}>
                  <DialogTrigger asChild>
                    <Button className="neon-glow">
                      <Plus className="h-4 w-4 mr-2" />
                      Novo Plano
                    </Button>
                  </DialogTrigger>
                <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col">
                  <DialogHeader className="shrink-0">
                    <DialogTitle>Criar Plano</DialogTitle>
                    <DialogDescription>
                      Configure os limites e recursos do plano
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4 overflow-y-auto flex-1 pr-2">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Nome *</Label>
                        <Input
                          placeholder="Plano Básico"
                          value={newPlanName}
                          onChange={(e) => setNewPlanName(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Preço (R$)</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="99.90"
                          value={newPlanPrice}
                          onChange={(e) => setNewPlanPrice(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Descrição</Label>
                      <Textarea
                        placeholder="Descrição do plano..."
                        value={newPlanDescription}
                        onChange={(e) => setNewPlanDescription(e.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-4 gap-4">
                      <div className="space-y-2">
                        <Label className="flex items-center gap-1">
                          <Wifi className="h-3 w-3" />
                          Conexões
                        </Label>
                        <Input
                          type="number"
                          min="1"
                          value={newPlanConnections}
                          onChange={(e) => setNewPlanConnections(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="flex items-center gap-1">
                          <MessageSquare className="h-3 w-3" />
                          Msgs/mês
                        </Label>
                        <Input
                          type="number"
                          min="0"
                          value={newPlanMessages}
                          onChange={(e) => setNewPlanMessages(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          Usuários
                        </Label>
                        <Input
                          type="number"
                          min="1"
                          value={newPlanUsers}
                          onChange={(e) => setNewPlanUsers(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="flex items-center gap-1">
                          <Crown className="h-3 w-3" />
                          Supervisores
                        </Label>
                        <Input
                          type="number"
                          min="1"
                          value={newPlanSupervisors}
                          onChange={(e) => setNewPlanSupervisors(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Período</Label>
                      <Select value={newPlanPeriod} onValueChange={setNewPlanPeriod}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="monthly">Mensal</SelectItem>
                          <SelectItem value="yearly">Anual</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-4 pt-2">
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div className="flex items-center gap-2">
                          <Receipt className="h-4 w-4 text-muted-foreground" />
                          <Label htmlFor="asaas-switch">Integração Asaas</Label>
                        </div>
                        <Switch
                          id="asaas-switch"
                          checked={newPlanAsaas}
                          onCheckedChange={setNewPlanAsaas}
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div className="flex items-center gap-2">
                          <MessageSquare className="h-4 w-4 text-muted-foreground" />
                          <Label htmlFor="chat-switch">Chat WhatsApp</Label>
                        </div>
                        <Switch
                          id="chat-switch"
                          checked={newPlanChat}
                          onCheckedChange={setNewPlanChat}
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div className="flex items-center gap-2">
                          <Users className="h-4 w-4 text-muted-foreground" />
                          <Label htmlFor="groups-switch">Grupos WhatsApp</Label>
                        </div>
                        <Switch
                          id="groups-switch"
                          checked={newPlanGroups}
                          onCheckedChange={setNewPlanGroups}
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div className="flex items-center gap-2">
                          <MessageSquare className="h-4 w-4 text-muted-foreground" />
                          <Label htmlFor="campaigns-switch">Campanhas/Disparo</Label>
                        </div>
                        <Switch
                          id="campaigns-switch"
                          checked={newPlanCampaigns}
                          onCheckedChange={setNewPlanCampaigns}
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div className="flex items-center gap-2">
                          <Bot className="h-4 w-4 text-muted-foreground" />
                          <Label htmlFor="chatbots-switch">Chatbots</Label>
                        </div>
                        <Switch
                          id="chatbots-switch"
                          checked={newPlanChatbots}
                          onCheckedChange={setNewPlanChatbots}
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          <Label htmlFor="scheduled-switch">Agendamentos</Label>
                        </div>
                        <Switch
                          id="scheduled-switch"
                          checked={newPlanScheduled}
                          onCheckedChange={setNewPlanScheduled}
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div className="flex items-center gap-2">
                          <Briefcase className="h-4 w-4 text-muted-foreground" />
                          <Label htmlFor="crm-switch">CRM</Label>
                        </div>
                        <Switch
                          id="crm-switch"
                          checked={newPlanCRM}
                          onCheckedChange={setNewPlanCRM}
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div className="flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-muted-foreground" />
                          <Label htmlFor="ai-agents-switch">Agentes IA</Label>
                        </div>
                        <Switch
                          id="ai-agents-switch"
                          checked={newPlanAIAgents}
                          onCheckedChange={setNewPlanAIAgents}
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          <Label htmlFor="departments-switch">Departamentos/Filas</Label>
                        </div>
                        <Switch
                          id="departments-switch"
                          checked={newPlanDepartments}
                          onCheckedChange={setNewPlanDepartments}
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div className="flex items-center gap-2">
                          <Crown className="h-4 w-4 text-muted-foreground" />
                          <Label htmlFor="lead-scoring-switch">Lead Scoring</Label>
                        </div>
                        <Switch
                          id="lead-scoring-switch"
                          checked={newPlanLeadScoring}
                          onCheckedChange={setNewPlanLeadScoring}
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div className="flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-muted-foreground" />
                          <Label htmlFor="ai-summary-switch">Resumo IA de Conversas</Label>
                        </div>
                        <Switch
                          id="ai-summary-switch"
                          checked={newPlanAISummary}
                          onCheckedChange={setNewPlanAISummary}
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div className="flex items-center gap-2">
                          <Bot className="h-4 w-4 text-muted-foreground" />
                          <Label htmlFor="group-secretary-switch">Secretária IA de Grupos</Label>
                        </div>
                        <Switch
                          id="group-secretary-switch"
                          checked={newPlanGroupSecretary}
                          onCheckedChange={setNewPlanGroupSecretary}
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div className="flex items-center gap-2">
                          <Users className="h-4 w-4 text-muted-foreground" />
                          <Label htmlFor="rh-switch">Módulo RH</Label>
                        </div>
                        <Switch
                          id="rh-switch"
                          checked={newPlanRH}
                          onCheckedChange={setNewPlanRH}
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div className="flex items-center gap-2">
                          <Label htmlFor="ghost-switch">Módulo Fantasma</Label>
                        </div>
                        <Switch
                          id="ghost-switch"
                          checked={newPlanGhost}
                          onCheckedChange={setNewPlanGhost}
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div className="flex items-center gap-2">
                          <Label htmlFor="projects-switch">Módulo Projetos</Label>
                        </div>
                        <Switch
                          id="projects-switch"
                          checked={newPlanProjects}
                          onCheckedChange={setNewPlanProjects}
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div className="flex items-center gap-2">
                          <Label htmlFor="lead-gleego-switch">Lead Gleego</Label>
                        </div>
                        <Switch
                          id="lead-gleego-switch"
                          checked={newPlanLeadGleego}
                          onCheckedChange={setNewPlanLeadGleego}
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div className="flex items-center gap-2">
                          <Label htmlFor="doc-signatures-switch">Assinaturas de Doc.</Label>
                        </div>
                        <Switch
                          id="doc-signatures-switch"
                          checked={newPlanDocSignatures}
                          onCheckedChange={setNewPlanDocSignatures}
                        />
                      </div>
                      {newPlanDocSignatures && (
                        <div className="rounded-lg border p-3 ml-4">
                          <Label htmlFor="doc-sig-limit" className="text-sm">Limite mensal de documentos</Label>
                          <div className="flex items-center gap-2 mt-1">
                            <Input
                              id="doc-sig-limit"
                              type="number"
                              min="0"
                              value={newPlanDocSignaturesLimit}
                              onChange={(e) => setNewPlanDocSignaturesLimit(e.target.value)}
                              className="w-24"
                              placeholder="0"
                            />
                            <span className="text-xs text-muted-foreground">0 = ilimitado</span>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="border-t pt-4 space-y-4">
                      <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 p-3">
                        <div className="flex items-center gap-2">
                          <Eye className="h-4 w-4 text-primary" />
                          <div>
                            <Label htmlFor="visible-switch">Visível no Cadastro</Label>
                            <p className="text-xs text-muted-foreground">Usuários podem escolher este plano ao se cadastrar</p>
                          </div>
                        </div>
                        <Switch
                          id="visible-switch"
                          checked={newPlanVisibleOnSignup}
                          onCheckedChange={setNewPlanVisibleOnSignup}
                        />
                      </div>
                      {newPlanVisibleOnSignup && (
                        <div className="space-y-2">
                          <Label>Dias de Teste Grátis</Label>
                          <Input
                            type="number"
                            min="1"
                            max="30"
                            value={newPlanTrialDays}
                            onChange={(e) => setNewPlanTrialDays(e.target.value)}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setCreatePlanDialogOpen(false)}>
                      Cancelar
                    </Button>
                    <Button onClick={handleCreatePlan} disabled={actionLoading}>
                      {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Criar
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {loading ? (
                <div className="col-span-full flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : plans.length === 0 ? (
                <div className="col-span-full text-center py-12 text-muted-foreground">
                  <Package className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p>Nenhum plano cadastrado</p>
                </div>
              ) : (
                plans.map((plan) => (
                  <Card key={plan.id} className={cn(!plan.is_active && 'opacity-60')}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="flex items-center gap-2">
                            {plan.name}
                            {!plan.is_active && <Badge variant="outline">Inativo</Badge>}
                            {plan.visible_on_signup && <Badge variant="default" className="text-xs">Cadastro ({plan.trial_days || 3}d)</Badge>}
                          </CardTitle>
                          <CardDescription className="mt-1">
                            {plan.description || 'Sem descrição'}
                          </CardDescription>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-bold text-primary">
                            R$ {Number(plan.price).toFixed(2)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            /{plan.billing_period === 'monthly' ? 'mês' : 'ano'}
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="flex items-center gap-2">
                          <Wifi className="h-4 w-4 text-muted-foreground" />
                          <span>{plan.max_connections} conexões</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <MessageSquare className="h-4 w-4 text-muted-foreground" />
                          <span>{plan.max_monthly_messages.toLocaleString()} msgs</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Users className="h-4 w-4 text-muted-foreground" />
                          <span>{plan.max_users} usuários</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Crown className="h-4 w-4 text-muted-foreground" />
                          <span>{plan.max_supervisors} supervisores</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {plan.has_chat && (
                          <Badge variant="secondary" className="text-xs">Chat</Badge>
                        )}
                        {plan.has_asaas_integration && (
                          <Badge variant="secondary" className="text-xs">Asaas</Badge>
                        )}
                        {plan.has_whatsapp_groups && (
                          <Badge variant="secondary" className="text-xs">Grupos</Badge>
                        )}
                        {plan.has_campaigns && (
                          <Badge variant="secondary" className="text-xs">Campanhas</Badge>
                        )}
                        {plan.has_chatbots && (
                          <Badge variant="secondary" className="text-xs">Chatbots</Badge>
                        )}
                        {plan.has_scheduled_messages && (
                          <Badge variant="secondary" className="text-xs">Agendamentos</Badge>
                        )}
                        {plan.has_crm && (
                          <Badge variant="secondary" className="text-xs">CRM</Badge>
                        )}
                        {plan.has_ai_agents && (
                          <Badge variant="secondary" className="text-xs">Agentes IA</Badge>
                        )}
                        {plan.has_departments && (
                          <Badge variant="secondary" className="text-xs">Filas</Badge>
                        )}
                        {plan.has_lead_scoring && (
                          <Badge variant="secondary" className="text-xs">Lead Score</Badge>
                        )}
                        {plan.has_ai_summary && (
                          <Badge variant="secondary" className="text-xs">Resumo IA</Badge>
                        )}
                        {plan.has_group_secretary && (
                          <Badge variant="secondary" className="text-xs">Secretária IA</Badge>
                        )}
                        {plan.has_rh && (
                          <Badge variant="secondary" className="text-xs">RH</Badge>
                        )}
                        {plan.has_ghost && (
                          <Badge variant="secondary" className="text-xs">Fantasma</Badge>
                        )}
                        {plan.has_projects && (
                          <Badge variant="secondary" className="text-xs">Projetos</Badge>
                        )}
                        {plan.has_lead_gleego && (
                          <Badge variant="secondary" className="text-xs">Lead Gleego</Badge>
                        )}
                        {plan.has_doc_signatures && (
                          <Badge variant="secondary" className="text-xs">
                            Assinaturas {plan.doc_signatures_limit > 0 ? `(${plan.doc_signatures_limit}/mês)` : '(∞)'}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t">
                        <span className="text-sm text-muted-foreground">
                          {plan.org_count || 0} organizações
                        </span>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setEditingPlan({ ...plan });
                              setEditPlanDialogOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Deletar plano?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Esta ação é irreversível. O plano "{plan.name}" será removido.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDeletePlan(plan.id)}
                                  className="bg-destructive hover:bg-destructive/90"
                                >
                                  Deletar
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>

          {/* Organizations Tab */}
          <TabsContent value="organizations" className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold">Organizações</h2>
              <Dialog open={createOrgDialogOpen} onOpenChange={setCreateOrgDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="neon-glow">
                    <Plus className="h-4 w-4 mr-2" />
                    Nova Organização
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Criar Organização</DialogTitle>
                    <DialogDescription>
                      Crie uma nova organização e defina o proprietário
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Nome da Empresa *</Label>
                        <Input
                          placeholder="Empresa XYZ"
                          value={newOrgName}
                          onChange={(e) => {
                            setNewOrgName(e.target.value);
                            setNewOrgSlug(generateSlug(e.target.value));
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Slug (URL) *</Label>
                        <Input
                          placeholder="empresa-xyz"
                          value={newOrgSlug}
                          onChange={(e) => setNewOrgSlug(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Email do Proprietário *</Label>
                      <Input
                        type="email"
                        placeholder="proprietario@email.com"
                        value={newOrgOwner}
                        onChange={(e) => setNewOrgOwner(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Se o usuário não existir, preencha nome e senha abaixo para criá-lo.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Nome do Proprietário</Label>
                        <Input
                          placeholder="João Silva"
                          value={newOrgOwnerName}
                          onChange={(e) => setNewOrgOwnerName(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Senha (novo usuário)</Label>
                        <Input
                          type="password"
                          placeholder="••••••••"
                          value={newOrgOwnerPassword}
                          onChange={(e) => setNewOrgOwnerPassword(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Plano</Label>
                        <Select value={newOrgPlan} onValueChange={setNewOrgPlan}>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione um plano" />
                          </SelectTrigger>
                          <SelectContent>
                            {plans.filter(p => p.is_active).length === 0 ? (
                              <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                                Nenhum plano ativo. Crie planos na aba "Planos".
                              </div>
                            ) : (
                              plans.filter(p => p.is_active).map(plan => (
                                <SelectItem key={plan.id} value={plan.id}>
                                  {plan.name} - R$ {Number(plan.price).toFixed(2)}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Vencimento</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className={cn(
                                "w-full justify-start text-left font-normal",
                                !newOrgExpires && "text-muted-foreground"
                              )}
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {newOrgExpires ? format(newOrgExpires, "dd/MM/yyyy", { locale: ptBR }) : "Selecione"}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={newOrgExpires}
                              onSelect={setNewOrgExpires}
                              initialFocus
                              className="p-3 pointer-events-auto"
                            />
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        <Image className="h-4 w-4" />
                        Logo (opcional)
                      </Label>
                      <FileUploadInput
                        value={newOrgLogo}
                        onChange={(url) => setNewOrgLogo(url)}
                        accept="image/*"
                        placeholder="https://example.com/logo.png"
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setCreateOrgDialogOpen(false)}>
                      Cancelar
                    </Button>
                    <Button onClick={handleCreateOrg} disabled={actionLoading}>
                      {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Criar
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            <Card>
              <CardContent className="p-0">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : organizations.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Building2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p>Nenhuma organização cadastrada</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Logo</TableHead>
                        <TableHead>Nome</TableHead>
                        <TableHead>Plano</TableHead>
                        <TableHead>Membros</TableHead>
                        <TableHead>Vencimento</TableHead>
                        <TableHead className="w-[140px]">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {organizations.map((org) => (
                        <TableRow key={org.id}>
                          <TableCell>
                            {org.logo_url ? (
                              <img 
                                src={org.logo_url} 
                                alt={org.name}
                                className="h-10 w-10 rounded-lg object-cover border border-border"
                              />
                            ) : (
                              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                <Building2 className="h-5 w-5 text-primary" />
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <div>
                              <div className="font-medium">{org.name}</div>
                              <div className="text-xs text-muted-foreground">/{org.slug}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            {org.plan_name ? (
                              <Badge variant="secondary">
                                {org.plan_name}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{org.member_count || 0}</Badge>
                          </TableCell>
                          <TableCell>
                            {org.expires_at ? (
                              <Badge variant={isExpired(org.expires_at) ? "destructive" : "secondary"}>
                                {format(new Date(org.expires_at), "dd/MM/yyyy", { locale: ptBR })}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button 
                                variant="ghost" 
                                size="icon"
                                onClick={() => openMembersDialog(org)}
                                title="Gerenciar usuários"
                              >
                                <Users className="h-4 w-4" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon"
                                onClick={() => openEditOrgDialog(org)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Deletar organização?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Esta ação é irreversível. A organização "{org.name}" e todos os dados serão removidos.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => handleDeleteOrg(org.id)}
                                      className="bg-destructive hover:bg-destructive/90"
                                    >
                                      Deletar
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Users Tab */}
          <TabsContent value="users" className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Todos os Usuários</h2>
              <Dialog open={deleteByEmailDialogOpen} onOpenChange={(open) => {
                setDeleteByEmailDialogOpen(open);
                if (!open) {
                  setEmailToDelete('');
                  setEmailSearchResult(null);
                }
              }}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <Mail className="h-4 w-4" />
                    Excluir por Email
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Excluir Usuário por Email</DialogTitle>
                    <DialogDescription>
                      Digite o email do usuário que deseja excluir definitivamente do sistema.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="flex gap-2">
                      <Input
                        placeholder="email@exemplo.com"
                        value={emailToDelete}
                        onChange={(e) => {
                          setEmailToDelete(e.target.value);
                          setEmailSearchResult(null);
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearchEmailForDelete()}
                      />
                      <Button onClick={handleSearchEmailForDelete} disabled={searchingEmail}>
                        {searchingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                      </Button>
                    </div>
                    
                    {emailSearchResult && (
                      <Card className="border-destructive/50 bg-destructive/5">
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="font-medium">{emailSearchResult.name}</p>
                              <p className="text-sm text-muted-foreground">{emailSearchResult.email}</p>
                              <p className="text-xs text-muted-foreground mt-1">
                                Cadastrado em: {new Date(emailSearchResult.created_at).toLocaleDateString('pt-BR')}
                              </p>
                            </div>
                            {emailSearchResult.is_superadmin && (
                              <Badge className="bg-amber-500/20 text-amber-400">Superadmin</Badge>
                            )}
                          </div>
                          
                          {emailSearchResult.organizations && emailSearchResult.organizations.length > 0 ? (
                            <div>
                              <p className="text-xs font-medium mb-1">Organizações:</p>
                              <div className="flex flex-wrap gap-1">
                                {emailSearchResult.organizations.map((org, i) => (
                                  <Badge key={i} variant="outline" className="text-xs">
                                    {org.org_name} ({org.role})
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <Badge variant="secondary" className="gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              Usuário órfão (sem organização)
                            </Badge>
                          )}
                          
                          <div className="pt-2 border-t">
                            <p className="text-xs text-destructive mb-2">
                              Esta ação irá excluir permanentemente o usuário e liberar o email.
                            </p>
                            <Button 
                              variant="destructive" 
                              className="w-full"
                              onClick={handleDeleteUserByEmail}
                              disabled={actionLoading}
                            >
                              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                              <Trash2 className="h-4 w-4 mr-2" />
                              Excluir Definitivamente
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            
            {/* Search and Filter */}
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex-1 flex gap-2">
                    <Input
                      placeholder="Buscar por nome ou email..."
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && reloadUsers()}
                      className="flex-1"
                    />
                    <Button onClick={reloadUsers} disabled={searchingUsers}>
                      {searchingUsers ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <Label htmlFor="orphans-filter" className="text-sm whitespace-nowrap">Apenas órfãos</Label>
                    <Switch
                      id="orphans-filter"
                      checked={showOrphansOnly}
                      onCheckedChange={(v) => {
                        setShowOrphansOnly(v);
                        // Auto reload when toggled
                        setTimeout(() => reloadUsers(), 0);
                      }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-0">
                {loading || searchingUsers ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : users.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p>{showOrphansOnly ? 'Nenhum usuário órfão encontrado' : 'Nenhum usuário encontrado'}</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nome</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Organizações</TableHead>
                        <TableHead>Superadmin</TableHead>
                        <TableHead>Cadastrado em</TableHead>
                        <TableHead className="w-[100px]">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((user) => (
                        <TableRow key={user.id} className={user.is_orphan ? 'bg-amber-500/5' : ''}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{user.name}</span>
                              {user.is_superadmin && (
                                <Crown className="h-4 w-4 text-amber-500" />
                              )}
                              {user.is_orphan && (
                                <Badge variant="outline" className="text-amber-500 border-amber-500/30 text-xs">
                                  Órfão
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{user.email}</TableCell>
                          <TableCell>
                            {user.organizations && user.organizations.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {user.organizations.slice(0, 2).map((org, i) => (
                                  <Badge key={i} variant="secondary" className="text-xs">
                                    {org.org_name}
                                  </Badge>
                                ))}
                                {user.organizations.length > 2 && (
                                  <Badge variant="outline" className="text-xs">
                                    +{user.organizations.length - 2}
                                  </Badge>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Switch
                              checked={user.is_superadmin}
                              onCheckedChange={() => handleToggleSuperadmin(user.id, user.is_superadmin)}
                            />
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(user.created_at).toLocaleDateString('pt-BR')}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Alterar senha"
                                onClick={() => {
                                  setChangePasswordUser(user);
                                  setChangePasswordValue('');
                                  setChangePasswordDialogOpen(true);
                                }}
                              >
                                <Lock className="h-4 w-4" />
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Excluir Usuário</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Tem certeza que deseja excluir o usuário <strong>{user.email}</strong>?
                                      <br /><br />
                                      Esta ação irá:
                                      <ul className="list-disc list-inside mt-2 space-y-1">
                                        <li>Remover o usuário de todas as organizações</li>
                                        <li>Liberar o email para uso em novas contas</li>
                                        <li>Excluir permanentemente todos os dados do usuário</li>
                                      </ul>
                                      <br />
                                      <strong className="text-destructive">Esta ação não pode ser desfeita.</strong>
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                    <AlertDialogAction
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                      onClick={() => handleDeleteUser(user.id, user.email)}
                                    >
                                      Excluir Usuário
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Change Password Dialog */}
          <Dialog open={changePasswordDialogOpen} onOpenChange={setChangePasswordDialogOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Alterar Senha</DialogTitle>
                <DialogDescription>
                  Alterar a senha do usuário <strong>{changePasswordUser?.email}</strong>
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Nova Senha *</Label>
                  <Input
                    type="password"
                    placeholder="Mínimo 6 caracteres"
                    value={changePasswordValue}
                    onChange={(e) => setChangePasswordValue(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setChangePasswordDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleChangePassword} disabled={actionLoading}>
                  {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Salvar Senha
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* W-API Instances Tab */}
          <TabsContent value="wapi-instances" className="space-y-4">
            <WapiInstancesTab />
          </TabsContent>

          {/* Integrations Tab */}
          <TabsContent value="integrations" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Key className="h-5 w-5" />
                  Token W-API (WhatsApp)
                </CardTitle>
                <CardDescription>
                  Token da conta W-API para criação automática de instâncias WhatsApp em todas as organizações
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Token da Conta W-API</Label>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      placeholder="Cole aqui o token da conta W-API"
                      value={wapiToken}
                      onChange={(e) => setWapiToken(e.target.value)}
                      className="flex-1"
                    />
                    <Button onClick={handleSaveWapiToken} disabled={savingWapiToken}>
                      {savingWapiToken && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Salvar
                    </Button>
                    <Button 
                      variant="outline" 
                      onClick={async () => {
                        try {
                          const result = await api<{ valid: boolean; message?: string; error?: string }>('/api/connections/validate-wapi', {
                            method: 'POST',
                            body: { token: wapiToken || undefined },
                          });
                          if (result.valid) {
                            toast.success(result.message || 'Token válido!');
                          } else {
                            toast.error(result.error || 'Token inválido');
                          }
                        } catch (err: any) {
                          toast.error(err.message || 'Erro ao validar');
                        }
                      }}
                    >
                      Validar API
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Este token será usado globalmente para criar e gerenciar instâncias WhatsApp ao adicionar novas conexões.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* CNPJ API Integration */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Search className="h-5 w-5" />
                  API de Consulta CNPJ (Gleego)
                </CardTitle>
                <CardDescription>
                  Token para consulta automática de dados de empresas por CNPJ. Usado no cadastro de empresas do CRM.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Token da API CNPJ</Label>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      placeholder="Cole aqui o token da API CNPJ"
                      value={cnpjApiToken}
                      onChange={(e) => setCnpjApiToken(e.target.value)}
                      className="flex-1"
                    />
                    <Button 
                      onClick={async () => {
                        setSavingCnpjToken(true);
                        try {
                          await api('/api/admin/settings/cnpj_api_token', {
                            method: 'PATCH',
                            body: { value: cnpjApiToken },
                          });
                          toast.success('Token CNPJ salvo com sucesso!');
                        } catch (error: any) {
                          toast.error(error.message || 'Erro ao salvar token');
                        } finally {
                          setSavingCnpjToken(false);
                        }
                      }} 
                      disabled={savingCnpjToken}
                    >
                      {savingCnpjToken && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Salvar
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Este token será usado para buscar automaticamente dados de empresas (razão social, endereço, sócios, etc.) ao consultar um CNPJ no cadastro de empresas.
                  </p>
                </div>
              </CardContent>
            </Card>
            {/* Doc Signature SMTP */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="h-5 w-5" />
                  SMTP de Assinatura de Documentos
                </CardTitle>
                <CardDescription>
                  Configuração de e-mail usado para enviar códigos de verificação (OTP) no módulo de assinaturas eletrônicas. Este SMTP é usado como padrão do sistema.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Servidor SMTP</Label>
                    <Input
                      placeholder="smtp.gmail.com"
                      value={docSmtpHost}
                      onChange={(e) => setDocSmtpHost(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Porta</Label>
                    <Input
                      type="number"
                      placeholder="587"
                      value={docSmtpPort}
                      onChange={(e) => setDocSmtpPort(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={docSmtpSecure} onCheckedChange={setDocSmtpSecure} />
                  <Label>Usar TLS/SSL</Label>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Usuário (login)</Label>
                    <Input
                      placeholder="email@dominio.com"
                      value={docSmtpUsername}
                      onChange={(e) => setDocSmtpUsername(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Senha</Label>
                    <div className="flex gap-2">
                      <Input
                        type={showDocSmtpPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        value={docSmtpPassword}
                        onChange={(e) => setDocSmtpPassword(e.target.value)}
                      />
                      <Button variant="ghost" size="icon" onClick={() => setShowDocSmtpPassword(!showDocSmtpPassword)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Nome do remetente</Label>
                    <Input
                      placeholder="Assinaturas Digitais"
                      value={docSmtpFromName}
                      onChange={(e) => setDocSmtpFromName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>E-mail do remetente</Label>
                    <Input
                      type="email"
                      placeholder="assinaturas@suaempresa.com"
                      value={docSmtpFromEmail}
                      onChange={(e) => setDocSmtpFromEmail(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleSaveDocSmtp} disabled={savingDocSmtp}>
                    {savingDocSmtp && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Salvar SMTP
                  </Button>
                  <Button variant="outline" onClick={handleTestDocSmtp} disabled={testingDocSmtp || !docSmtpHost}>
                    {testingDocSmtp && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Enviar Teste
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Quando configurado, este SMTP será usado como fallback para enviar e-mails de verificação OTP no módulo de assinaturas, caso a organização não tenha SMTP próprio.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Global Agents Tab */}
          <GlobalAgentsTab />

          {/* Branding Tab */}
          <BrandingTab />

          {/* Merch Import Tab */}
          <TabsContent value="merch-import">
            <MerchImportTab />
          </TabsContent>
        </Tabs>
      </div>

      {/* Edit Organization Dialog */}
      <Dialog open={editOrgDialogOpen} onOpenChange={setEditOrgDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar Organização</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={editOrgName}
                onChange={(e) => setEditOrgName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Plano</Label>
                <Select value={editOrgPlan} onValueChange={setEditOrgPlan}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {plans.map(plan => (
                      <SelectItem key={plan.id} value={plan.id}>
                        {plan.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Vencimento</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !editOrgExpires && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {editOrgExpires ? format(editOrgExpires, "dd/MM/yyyy", { locale: ptBR }) : "Selecione"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={editOrgExpires}
                      onSelect={setEditOrgExpires}
                      initialFocus
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Logo</Label>
              <FileUploadInput
                value={editOrgLogo}
                onChange={(url) => setEditOrgLogo(url)}
                accept="image/*"
                placeholder="https://example.com/logo.png"
              />
              {editOrgLogo && (
                <div className="mt-2 flex justify-center">
                  <img 
                    src={editOrgLogo} 
                    alt="Preview" 
                    className="h-16 w-16 rounded-lg object-cover border border-border"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOrgDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleUpdateOrg} disabled={actionLoading}>
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Plan Dialog */}
      <Dialog open={editPlanDialogOpen} onOpenChange={setEditPlanDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle>Editar Plano</DialogTitle>
          </DialogHeader>
          {editingPlan && (
            <div className="grid gap-4 py-4 overflow-y-auto flex-1 pr-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nome</Label>
                  <Input
                    value={editingPlan.name}
                    onChange={(e) => setEditingPlan({ ...editingPlan, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Preço (R$)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editingPlan.price}
                    onChange={(e) => setEditingPlan({ ...editingPlan, price: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Descrição</Label>
                <Textarea
                  value={editingPlan.description || ''}
                  onChange={(e) => setEditingPlan({ ...editingPlan, description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label>Conexões</Label>
                  <Input
                    type="number"
                    min="1"
                    value={editingPlan.max_connections}
                    onChange={(e) => setEditingPlan({ ...editingPlan, max_connections: parseInt(e.target.value) || 1 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Msgs/mês</Label>
                  <Input
                    type="number"
                    min="0"
                    value={editingPlan.max_monthly_messages}
                    onChange={(e) => setEditingPlan({ ...editingPlan, max_monthly_messages: parseInt(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Usuários</Label>
                  <Input
                    type="number"
                    min="1"
                    value={editingPlan.max_users}
                    onChange={(e) => setEditingPlan({ ...editingPlan, max_users: parseInt(e.target.value) || 5 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Supervisores</Label>
                  <Input
                    type="number"
                    min="1"
                    value={editingPlan.max_supervisors}
                    onChange={(e) => setEditingPlan({ ...editingPlan, max_supervisors: parseInt(e.target.value) || 1 })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Período</Label>
                <Select 
                  value={editingPlan.billing_period} 
                  onValueChange={(v) => setEditingPlan({ ...editingPlan, billing_period: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Mensal</SelectItem>
                    <SelectItem value="yearly">Anual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-4 pt-2">
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <Label htmlFor="edit-asaas">Asaas</Label>
                  <Switch
                    id="edit-asaas"
                    checked={editingPlan.has_asaas_integration}
                    onCheckedChange={(v) => setEditingPlan({ ...editingPlan, has_asaas_integration: v })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <Label htmlFor="edit-chat">Chat</Label>
                  <Switch
                    id="edit-chat"
                    checked={editingPlan.has_chat}
                    onCheckedChange={(v) => setEditingPlan({ ...editingPlan, has_chat: v })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <Label htmlFor="edit-groups">Grupos</Label>
                  <Switch
                    id="edit-groups"
                    checked={editingPlan.has_whatsapp_groups}
                    onCheckedChange={(v) => setEditingPlan({ ...editingPlan, has_whatsapp_groups: v })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <Label htmlFor="edit-campaigns">Campanhas</Label>
                  <Switch
                    id="edit-campaigns"
                    checked={editingPlan.has_campaigns}
                    onCheckedChange={(v) => setEditingPlan({ ...editingPlan, has_campaigns: v })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <Label htmlFor="edit-chatbots">Chatbots</Label>
                  <Switch
                    id="edit-chatbots"
                    checked={editingPlan.has_chatbots}
                    onCheckedChange={(v) => setEditingPlan({ ...editingPlan, has_chatbots: v })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <Label htmlFor="edit-scheduled">Agendamentos</Label>
                  <Switch
                    id="edit-scheduled"
                    checked={editingPlan.has_scheduled_messages}
                    onCheckedChange={(v) => setEditingPlan({ ...editingPlan, has_scheduled_messages: v })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <Label htmlFor="edit-crm">CRM</Label>
                  <Switch
                    id="edit-crm"
                    checked={editingPlan.has_crm}
                    onCheckedChange={(v) => setEditingPlan({ ...editingPlan, has_crm: v })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <Label htmlFor="edit-ai-agents">Agentes IA</Label>
                  <Switch
                    id="edit-ai-agents"
                    checked={editingPlan.has_ai_agents}
                    onCheckedChange={(v) => setEditingPlan({ ...editingPlan, has_ai_agents: v })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <Label htmlFor="edit-departments">Departamentos/Filas</Label>
                  <Switch
                    id="edit-departments"
                    checked={editingPlan.has_departments}
                    onCheckedChange={(v) => setEditingPlan({ ...editingPlan, has_departments: v })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <Label htmlFor="edit-group-secretary">Secretária IA de Grupos</Label>
                  <Switch
                    id="edit-group-secretary"
                    checked={editingPlan.has_group_secretary}
                    onCheckedChange={(v) => setEditingPlan({ ...editingPlan, has_group_secretary: v })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <Label htmlFor="edit-rh">Módulo RH</Label>
                  <Switch
                    id="edit-rh"
                    checked={editingPlan.has_rh}
                    onCheckedChange={(v) => setEditingPlan({ ...editingPlan, has_rh: v })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <Label htmlFor="edit-ghost">Módulo Fantasma</Label>
                  <Switch
                    id="edit-ghost"
                    checked={editingPlan.has_ghost}
                    onCheckedChange={(v) => setEditingPlan({ ...editingPlan, has_ghost: v })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <Label htmlFor="edit-projects">Módulo Projetos</Label>
                  <Switch
                    id="edit-projects"
                    checked={editingPlan?.has_projects || false}
                    onCheckedChange={(v) => setEditingPlan({ ...editingPlan!, has_projects: v })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <Label htmlFor="edit-lead-gleego">Lead Gleego</Label>
                  <Switch
                    id="edit-lead-gleego"
                    checked={editingPlan?.has_lead_gleego || false}
                    onCheckedChange={(v) => setEditingPlan({ ...editingPlan!, has_lead_gleego: v })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <Label htmlFor="edit-doc-signatures">Assinaturas de Doc.</Label>
                  <Switch
                    id="edit-doc-signatures"
                    checked={editingPlan?.has_doc_signatures || false}
                    onCheckedChange={(v) => setEditingPlan({ ...editingPlan!, has_doc_signatures: v })}
                  />
                </div>
                {editingPlan?.has_doc_signatures && (
                  <div className="rounded-lg border p-3 ml-4">
                    <Label htmlFor="edit-doc-sig-limit" className="text-sm">Limite mensal de documentos</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <Input
                        id="edit-doc-sig-limit"
                        type="number"
                        min="0"
                        value={editingPlan?.doc_signatures_limit || 0}
                        onChange={(e) => setEditingPlan({ ...editingPlan!, doc_signatures_limit: parseInt(e.target.value) || 0 })}
                        className="w-24"
                        placeholder="0"
                      />
                      <span className="text-xs text-muted-foreground">0 = ilimitado</span>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <Label htmlFor="edit-lead-scoring">Lead Scoring</Label>
                  <Switch
                    id="edit-lead-scoring"
                    checked={editingPlan.has_lead_scoring}
                    onCheckedChange={(v) => setEditingPlan({ ...editingPlan, has_lead_scoring: v })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <Label htmlFor="edit-ai-summary">Resumo IA de Conversas</Label>
                  <Switch
                    id="edit-ai-summary"
                    checked={editingPlan.has_ai_summary}
                    onCheckedChange={(v) => setEditingPlan({ ...editingPlan, has_ai_summary: v })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <Label htmlFor="edit-active">Ativo</Label>
                  <Switch
                    id="edit-active"
                    checked={editingPlan.is_active}
                    onCheckedChange={(v) => setEditingPlan({ ...editingPlan, is_active: v })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <div>
                    <Label htmlFor="edit-visible">Visível no Cadastro</Label>
                    <p className="text-xs text-muted-foreground">Usuários podem escolher este plano</p>
                  </div>
                  <Switch
                    id="edit-visible"
                    checked={editingPlan.visible_on_signup}
                    onCheckedChange={(v) => setEditingPlan({ ...editingPlan, visible_on_signup: v })}
                  />
                </div>
                {editingPlan.visible_on_signup && (
                  <div className="space-y-2">
                    <Label>Dias de Teste Grátis</Label>
                    <Input
                      type="number"
                      min="1"
                      max="30"
                      value={editingPlan.trial_days || 3}
                      onChange={(e) => setEditingPlan({ ...editingPlan, trial_days: parseInt(e.target.value) || 3 })}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPlanDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleUpdatePlan} disabled={actionLoading}>
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Organization Members Dialog */}
      <Dialog open={membersDialogOpen} onOpenChange={setMembersDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Usuários - {selectedOrg?.name}
            </DialogTitle>
            <DialogDescription>
              Gerencie os usuários e permissões desta organização
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            {/* Limits info */}
            {orgLimits && (
              <div className="grid grid-cols-2 gap-3 mb-4 p-3 rounded-lg bg-muted/50 border">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Usuários
                  </span>
                  <Badge variant={orgLimits.current_users >= orgLimits.max_users ? 'destructive' : 'secondary'}>
                    {orgLimits.current_users}/{orgLimits.max_users}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground flex items-center gap-2">
                    <Crown className="h-4 w-4" />
                    Supervisores
                  </span>
                  <Badge variant={orgLimits.current_supervisors >= orgLimits.max_supervisors ? 'destructive' : 'secondary'}>
                    {orgLimits.current_supervisors}/{orgLimits.max_supervisors}
                  </Badge>
                </div>
              </div>
            )}
            
            <div className="flex justify-end mb-4">
              <Dialog open={addUserDialogOpen} onOpenChange={setAddUserDialogOpen}>
                <DialogTrigger asChild>
                  <Button 
                    size="sm"
                    disabled={orgLimits && orgLimits.current_users >= orgLimits.max_users}
                  >
                    <UserPlus className="h-4 w-4 mr-2" />
                    Adicionar Usuário
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Adicionar Usuário</DialogTitle>
                    <DialogDescription>
                      Crie um novo usuário para esta organização
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Nome *</Label>
                      <Input
                        placeholder="Nome completo"
                        value={newUserName}
                        onChange={(e) => setNewUserName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Email *</Label>
                      <Input
                        type="email"
                        placeholder="usuario@email.com"
                        value={newUserEmail}
                        onChange={(e) => setNewUserEmail(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Senha *</Label>
                      <Input
                        type="password"
                        placeholder="Senha segura"
                        value={newUserPassword}
                        onChange={(e) => setNewUserPassword(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Tipo de conta</Label>
                      <Select value={newUserAccountType} onValueChange={setNewUserAccountType}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="standard">Padrão</SelectItem>
                          <SelectItem value="timeclock_kiosk">Tablet de ponto</SelectItem>
                          <SelectItem value="manager">Gestor</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Permissão</Label>
                      <Select value={newUserRole} onValueChange={setNewUserRole}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="owner">Proprietário</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="agent">Agente</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setAddUserDialogOpen(false)}>
                      Cancelar
                    </Button>
                    <Button onClick={handleAddUser} disabled={actionLoading}>
                      {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Criar
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            {loadingMembers ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : orgMembers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p>Nenhum usuário nesta organização</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Permissão</TableHead>
                    <TableHead className="w-[100px]">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orgMembers.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell className="font-medium">{member.name}</TableCell>
                      <TableCell className="text-muted-foreground">{member.email}</TableCell>
                      <TableCell>
                        <Select
                          value={member.role}
                          onValueChange={(value) => handleUpdateRole(member.id, value)}
                        >
                          <SelectTrigger className="w-[140px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="owner">Proprietário</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="agent">Agente</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remover membro?</AlertDialogTitle>
                              <AlertDialogDescription>
                                {member.name} será removido desta organização.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleRemoveMember(member.id)}
                                className="bg-destructive hover:bg-destructive/90"
                              >
                                Remover
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}