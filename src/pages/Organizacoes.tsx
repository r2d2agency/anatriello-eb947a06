import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useOrganizations } from '@/hooks/use-organizations';
import { useSuperadmin } from '@/hooks/use-superadmin';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Building2, Plus, Users, Trash2, UserPlus, Crown, Shield, User, Briefcase, Loader2, Pencil, Link2, Settings, KeyRound, Megaphone, Receipt, UsersRound, CalendarClock, Bot, Layers, MessagesSquare, Upload, Image, BarChart3, Lock, Copy } from 'lucide-react';
import { useUpload } from '@/hooks/use-upload';
import { PAGE_PERMISSIONS, PAGE_SECTIONS, createFullPermissions, createEmptyPermissions } from '@/lib/page-permissions';

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
  is_active?: boolean;
  assigned_connections: AssignedConnection[];
  assigned_departments: AssignedDepartment[];
  permission_template_id?: string;
  template_name?: string;
  template_color?: string;
  created_at: string;
}

interface PermissionTemplate {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  color: string;
  permissions: Record<string, boolean>;
  member_count: number;
  created_at: string;
}

interface OrgConnection {
  id: string;
  name: string;
  phone_number: string | null;
  status: string;
}

interface OrgDepartment {
  id: string;
  name: string;
  color: string;
  icon: string;
  is_active: boolean;
}

const roleLabels = {
  owner: { label: 'Proprietário', icon: Crown, color: 'bg-amber-500' },
  admin: { label: 'Admin', icon: Shield, color: 'bg-blue-500' },
  manager: { label: 'Supervisor', icon: Briefcase, color: 'bg-green-500' },
  agent: { label: 'Agente', icon: User, color: 'bg-gray-500' }
};

export default function Organizacoes() {
  const { refreshUser } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [connections, setConnections] = useState<OrgConnection[]>([]);
  const [departments, setDepartments] = useState<OrgDepartment[]>([]);
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  
  // Create org dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgSlug, setNewOrgSlug] = useState('');
  
  // Edit org dialog
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editOrgName, setEditOrgName] = useState('');
  const [editOrgLogo, setEditOrgLogo] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  
  // Create user dialog
  const [createUserDialogOpen, setCreateUserDialogOpen] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberPassword, setNewMemberPassword] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<string>('agent');
  const [newMemberAccountType, setNewMemberAccountType] = useState<string>('standard');
  const [newMemberConnectionIds, setNewMemberConnectionIds] = useState<string[]>([]);
  const [newMemberDepartmentIds, setNewMemberDepartmentIds] = useState<string[]>([]);

  // Edit member dialog
  const [editMemberDialogOpen, setEditMemberDialogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<OrganizationMember | null>(null);
  const [editMemberRole, setEditMemberRole] = useState<string>('agent');
  const [editMemberConnectionIds, setEditMemberConnectionIds] = useState<string[]>([]);
  const [editMemberDepartmentIds, setEditMemberDepartmentIds] = useState<string[]>([]);

  // Edit password dialog
  const [editPasswordDialogOpen, setEditPasswordDialogOpen] = useState(false);
  const [editPasswordMember, setEditPasswordMember] = useState<OrganizationMember | null>(null);
  const [newPassword, setNewPassword] = useState('');

  // Modules settings
  const [activeTab, setActiveTab] = useState('members');
  const [modulesEnabled, setModulesEnabled] = useState({
    campaigns: true,
    billing: true,
    groups: true,
    scheduled_messages: true,
    chatbots: true,
    chat: true,
    crm: true,
    rh: true,
    group_secretary: false,
    ghost: false,
    projects: false,
    lead_gleego: false,
    shared_conversations: false,
  });
  const [leadGleegoApiKey, setLeadGleegoApiKey] = useState('');
  const [leadGleegoApiKeyMasked, setLeadGleegoApiKeyMasked] = useState('');
  const [gleegoFunnelId, setGleegoFunnelId] = useState('');
  const [gleegoStageId, setGleegoStageId] = useState('');
  const [gleegoWebhookId, setGleegoWebhookId] = useState('');
  const [gleegoDealTitleTemplate, setGleegoDealTitleTemplate] = useState('{nome}');
  const [gleegoFunnels, setGleegoFunnels] = useState<Array<{id: string; name: string; stages?: Array<{id: string; name: string}>}>>([]);
  const [gleegoWebhooks, setGleegoWebhooks] = useState<Array<{id: string; name: string; distribution_enabled: boolean}>>([]);
  const [savingModules, setSavingModules] = useState(false);

  // Permission templates
  const [templates, setTemplates] = useState<PermissionTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PermissionTemplate | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [templateColor, setTemplateColor] = useState('#6366f1');
  const [templatePermissions, setTemplatePermissions] = useState<Record<string, boolean>>(createEmptyPermissions());
  const [savingTemplate, setSavingTemplate] = useState(false);

  // Edit member template
  const [editMemberTemplateId, setEditMemberTemplateId] = useState<string>('');

  const { 
    loading, 
    error,
    getOrganizations, 
    createOrganization, 
    updateOrganization,
    getMembers, 
    getConnections,
    getDepartments,
    addMember, 
    updateMember,
    removeMember,
    updateMemberPassword 
  } = useOrganizations();

  const { checkSuperadmin } = useSuperadmin();

  useEffect(() => {
    loadOrganizations();
    checkSuperadmin().then(setIsSuperadmin);
  }, []);

  useEffect(() => {
    if (selectedOrg) {
      loadMembers(selectedOrg.id);
      loadConnections(selectedOrg.id);
      loadDepartments(selectedOrg.id);
      loadModules(selectedOrg.id);
      loadTemplates(selectedOrg.id);
    }
  }, [selectedOrg]);

  const loadOrganizations = async () => {
    setLoadingOrgs(true);
    const orgs = await getOrganizations();
    setOrganizations(orgs);
    if (orgs.length > 0 && !selectedOrg) {
      setSelectedOrg(orgs[0]);
    }
    setLoadingOrgs(false);
  };

  const loadMembers = async (orgId: string) => {
    setLoadingMembers(true);
    const membersList = await getMembers(orgId);
    setMembers(membersList);
    setLoadingMembers(false);
  };

  const loadConnections = async (orgId: string) => {
    const conns = await getConnections(orgId);
    setConnections(conns);
  };

  const loadDepartments = async (orgId: string) => {
    const depts = await getDepartments(orgId);
    setDepartments(depts);
  };

  const loadModules = async (orgId: string) => {
    try {
      const modules = await api<Record<string, boolean>>(`/api/organizations/${orgId}/modules`);
      setModulesEnabled({
        campaigns: modules.campaigns ?? true,
        billing: modules.billing ?? true,
        groups: modules.groups ?? true,
        scheduled_messages: modules.scheduled_messages ?? true,
        chatbots: modules.chatbots ?? true,
        chat: modules.chat ?? true,
        crm: modules.crm ?? true,
        rh: modules.rh ?? true,
        group_secretary: modules.group_secretary ?? false,
        ghost: modules.ghost ?? false,
        projects: modules.projects ?? false,
        lead_gleego: modules.lead_gleego ?? false,
        shared_conversations: modules.shared_conversations ?? false,
      });
    } catch (error) {
      console.error('Error loading modules:', error);
    }
    // Load Lead Gleego integration settings
    try {
      const settings = await api<any>(`/api/lead-gleego/settings`);
      setLeadGleegoApiKeyMasked(settings.lead_gleego_api_key_masked || '');
      setGleegoFunnelId(settings.lead_gleego_funnel_id || '');
      setGleegoStageId(settings.lead_gleego_stage_id || '');
      setGleegoWebhookId(settings.lead_gleego_webhook_id || '');
      setGleegoDealTitleTemplate(settings.lead_gleego_deal_title_template || '{nome}');
    } catch {
      // ignore
    }
    // Load funnels with stages for Gleego config
    try {
      const funnels = await api<any[]>(`/api/crm/funnels`);
      // Load stages for each funnel
      const funnelsWithStages = await Promise.all(
        (funnels || []).map(async (f: any) => {
          try {
            const detail = await api<any>(`/api/crm/funnels/${f.id}`);
            return { ...f, stages: detail.stages || [] };
          } catch {
            return { ...f, stages: [] };
          }
        })
      );
      setGleegoFunnels(funnelsWithStages);
    } catch { }
    // Load webhooks for distribution selection
    try {
      const webhooks = await api<any[]>(`/api/lead-webhooks`);
      setGleegoWebhooks(webhooks || []);
    } catch { }
  };

  const loadTemplates = async (orgId: string) => {
    setLoadingTemplates(true);
    try {
      const tpls = await api<PermissionTemplate[]>(`/api/organizations/${orgId}/permission-templates`);
      setTemplates(tpls);
    } catch {
      setTemplates([]);
    }
    setLoadingTemplates(false);
  };

  const openTemplateDialog = (template?: PermissionTemplate) => {
    if (template) {
      setEditingTemplate(template);
      setTemplateName(template.name);
      setTemplateDescription(template.description || '');
      setTemplateColor(template.color);
      setTemplatePermissions(template.permissions || createEmptyPermissions());
    } else {
      setEditingTemplate(null);
      setTemplateName('');
      setTemplateDescription('');
      setTemplateColor('#6366f1');
      setTemplatePermissions(createEmptyPermissions());
    }
    setTemplateDialogOpen(true);
  };

  const handleSaveTemplate = async () => {
    if (!selectedOrg || !templateName.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }
    setSavingTemplate(true);
    try {
      const data = { name: templateName, description: templateDescription, color: templateColor, permissions: templatePermissions };
      if (editingTemplate) {
        await api(`/api/organizations/${selectedOrg.id}/permission-templates/${editingTemplate.id}`, { method: 'PUT', body: data });
        toast.success('Template atualizado!');
      } else {
        await api(`/api/organizations/${selectedOrg.id}/permission-templates`, { method: 'POST', body: data });
        toast.success('Template criado!');
      }
      setTemplateDialogOpen(false);
      loadTemplates(selectedOrg.id);
    } catch (error: any) {
      toast.error(error.message || 'Erro ao salvar template');
    }
    setSavingTemplate(false);
  };

  const handleDeleteTemplate = async (templateId: string) => {
    if (!selectedOrg) return;
    try {
      await api(`/api/organizations/${selectedOrg.id}/permission-templates/${templateId}`, { method: 'DELETE' });
      toast.success('Template excluído!');
      loadTemplates(selectedOrg.id);
    } catch (error: any) {
      toast.error(error.message || 'Erro ao excluir template');
    }
  };

  const handleDuplicateTemplate = (template: PermissionTemplate) => {
    setEditingTemplate(null);
    setTemplateName(`${template.name} (cópia)`);
    setTemplateDescription(template.description || '');
    setTemplateColor(template.color);
    setTemplatePermissions({ ...template.permissions });
    setTemplateDialogOpen(true);
  };

  const handleAssignTemplate = async (memberId: string, templateId: string | null) => {
    if (!selectedOrg) return;
    try {
      await api(`/api/organizations/${selectedOrg.id}/members/${memberId}/template`, {
        method: 'PATCH',
        body: { permission_template_id: templateId },
      });
      toast.success('Permissões atualizadas!');
      loadMembers(selectedOrg.id);
      refreshUser();
    } catch (error: any) {
      toast.error(error.message || 'Erro ao atribuir template');
    }
  };

  const toggleSectionPermissions = (section: string, value: boolean) => {
    const sectionKeys = PAGE_PERMISSIONS.filter(p => p.section === section).map(p => p.key);
    setTemplatePermissions(prev => {
      const updated = { ...prev };
      sectionKeys.forEach(key => { updated[key] = value; });
      return updated;
    });
  };

  const handleSaveLeadGleegoSettings = async () => {
    try {
      const body: Record<string, any> = {};
      if (leadGleegoApiKey.trim()) body.lead_gleego_api_key = leadGleegoApiKey;
      body.lead_gleego_funnel_id = gleegoFunnelId || null;
      body.lead_gleego_stage_id = gleegoStageId || null;
      body.lead_gleego_webhook_id = (gleegoWebhookId && gleegoWebhookId !== 'none') ? gleegoWebhookId : null;
      body.lead_gleego_deal_title_template = gleegoDealTitleTemplate || '{nome}';

      await api('/api/lead-gleego/settings', { method: 'PUT', body });
      toast.success('Configurações do Lead Gleego salvas!');
      setLeadGleegoApiKey('');
      if (selectedOrg) loadModules(selectedOrg.id);
    } catch (error: any) {
      toast.error(error.message || 'Erro ao salvar configurações');
    }
  };

  const handleSaveModules = async () => {
    if (!selectedOrg) return;
    
    setSavingModules(true);
    try {
      await api(`/api/organizations/${selectedOrg.id}`, {
        method: 'PATCH',
        body: { modules_enabled: modulesEnabled },
      });
      await refreshUser();
      toast.success('Configurações salvas!');
    } catch (error: any) {
      toast.error(error.message || 'Erro ao salvar configurações');
    } finally {
      setSavingModules(false);
    }
  };

  const handleCreateOrg = async () => {
    if (!newOrgName || !newOrgSlug) {
      toast.error('Preencha todos os campos');
      return;
    }

    const slug = newOrgSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const org = await createOrganization(newOrgName, slug);
    
    if (org) {
      toast.success('Organização criada com sucesso!');
      setCreateDialogOpen(false);
      setNewOrgName('');
      setNewOrgSlug('');
      loadOrganizations();
      setSelectedOrg(org);
    } else if (error) {
      toast.error(error);
    }
  };

  const { uploadFile, isUploading: isUploadingLogo } = useUpload();

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await uploadFile(file);
      if (url) setEditOrgLogo(url);
    } catch {
      toast.error('Erro ao enviar logo');
    }
    if (logoInputRef.current) logoInputRef.current.value = '';
  };

  const handleUpdateOrg = async () => {
    if (!selectedOrg || !editOrgName) return;
    
    const data: { name?: string; logo_url?: string } = { name: editOrgName };
    if (editOrgLogo !== undefined) data.logo_url = editOrgLogo || '';
    
    const updated = await updateOrganization(selectedOrg.id, data);
    if (updated) {
      toast.success('Organização atualizada!');
      setEditDialogOpen(false);
      loadOrganizations();
      setSelectedOrg({ ...selectedOrg, name: editOrgName, logo_url: editOrgLogo });
    } else if (error) {
      toast.error(error);
    }
  };

  const handleCreateUser = async () => {
    if (!selectedOrg) return;
    
    if (!newMemberName || !newMemberEmail || !newMemberPassword) {
      toast.error('Preencha nome, email e senha');
      return;
    }
    if (newMemberPassword.length < 6) {
      toast.error('Senha deve ter pelo menos 6 caracteres');
      return;
    }

    const result = await addMember(selectedOrg.id, {
      email: newMemberEmail,
      role: newMemberRole,
      name: newMemberName,
      password: newMemberPassword,
      account_type: newMemberAccountType,
      connection_ids: newMemberConnectionIds.length > 0 ? newMemberConnectionIds : undefined,
      department_ids: newMemberDepartmentIds.length > 0 ? newMemberDepartmentIds : undefined
    });

    if (result.success) {
      toast.success(result.message || 'Usuário criado com sucesso!');
      resetCreateUserDialog();
      loadMembers(selectedOrg.id);
    } else if (error) {
      toast.error(error);
    }
  };

  const resetCreateUserDialog = () => {
    setCreateUserDialogOpen(false);
    setNewMemberEmail('');
    setNewMemberName('');
    setNewMemberPassword('');
    setNewMemberRole('agent');
    setNewMemberAccountType('standard');
    setNewMemberConnectionIds([]);
    setNewMemberDepartmentIds([]);
  };

  const handleOpenEditMember = (member: OrganizationMember) => {
    setEditingMember(member);
    setEditMemberRole(member.role);
    setEditMemberConnectionIds(member.assigned_connections?.map(c => c.id) || []);
    setEditMemberDepartmentIds(member.assigned_departments?.map(d => d.id) || []);
    setEditMemberTemplateId(member.permission_template_id || '');
    setEditMemberDialogOpen(true);
  };

  const handleUpdateMember = async () => {
    if (!selectedOrg || !editingMember) return;

    const updateData: { role?: string; connection_ids?: string[]; department_ids?: string[] } = {
      connection_ids: editMemberConnectionIds,
      department_ids: editMemberDepartmentIds,
    };
    
    // Only include role if it's different and member is not owner
    if (editingMember.role !== 'owner' && editMemberRole !== editingMember.role) {
      updateData.role = editMemberRole;
    }

    const success = await updateMember(selectedOrg.id, editingMember.user_id, updateData);

    if (success) {
      // Also update template assignment
      const newTemplateId = editMemberTemplateId === 'none' ? null : (editMemberTemplateId || null);
      const currentTemplateId = editingMember.permission_template_id || null;
      if (newTemplateId !== currentTemplateId) {
        await handleAssignTemplate(editingMember.user_id, newTemplateId);
      } else {
        toast.success('Membro atualizado!');
        loadMembers(selectedOrg.id);
      }
      setEditMemberDialogOpen(false);
      setEditingMember(null);
    } else if (error) {
      toast.error(error);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!selectedOrg) return;
    
    const success = await removeMember(selectedOrg.id, userId);
    if (success) {
      toast.success('Membro removido!');
      loadMembers(selectedOrg.id);
    } else if (error) {
      toast.error(error);
    }
  };

  const handleToggleActive = async (member: OrganizationMember) => {
    if (!selectedOrg || member.role === 'owner') return;
    const newActive = !(member.is_active !== false);
    const success = await updateMember(selectedOrg.id, member.user_id, { is_active: newActive });
    if (success) {
      toast.success(newActive ? 'Usuário ativado!' : 'Usuário desativado!');
      loadMembers(selectedOrg.id);
    } else if (error) {
      toast.error(error);
    }
  };

  const handleOpenEditPassword = (member: OrganizationMember) => {
    setEditPasswordMember(member);
    setNewPassword('');
    setEditPasswordDialogOpen(true);
  };

  const handleUpdatePassword = async () => {
    if (!selectedOrg || !editPasswordMember) return;
    
    if (!newPassword || newPassword.length < 6) {
      toast.error('Senha deve ter pelo menos 6 caracteres');
      return;
    }

    const success = await updateMemberPassword(selectedOrg.id, editPasswordMember.user_id, newPassword);
    if (success) {
      toast.success('Senha atualizada com sucesso!');
      setEditPasswordDialogOpen(false);
      setEditPasswordMember(null);
      setNewPassword('');
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

  const toggleConnection = (connId: string, connectionIds: string[], setConnectionIds: (ids: string[]) => void) => {
    if (connectionIds.includes(connId)) {
      setConnectionIds(connectionIds.filter(id => id !== connId));
    } else {
      setConnectionIds([...connectionIds, connId]);
    }
  };

  const canManageOrg = selectedOrg?.role === 'owner' || selectedOrg?.role === 'admin';

  return (
    <MainLayout>
      <div className="space-y-6 overflow-hidden">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight truncate">Organizações</h1>
            <p className="text-muted-foreground text-sm sm:text-base">
              Gerencie suas organizações e membros da equipe
            </p>
          </div>
          
          {isSuperadmin && (
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button className="shrink-0 w-full sm:w-auto">
                  <Plus className="h-4 w-4 mr-2" />
                  Nova Organização
                </Button>
              </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Criar Organização</DialogTitle>
                <DialogDescription>
                  Crie uma nova organização para gerenciar sua equipe
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="org-name">Nome</Label>
                  <Input
                    id="org-name"
                    placeholder="Minha Empresa"
                    value={newOrgName}
                    onChange={(e) => {
                      setNewOrgName(e.target.value);
                      setNewOrgSlug(generateSlug(e.target.value));
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-slug">Slug (identificador único)</Label>
                  <Input
                    id="org-slug"
                    placeholder="minha-empresa"
                    value={newOrgSlug}
                    onChange={(e) => setNewOrgSlug(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Usado na URL: ayratech.app/{newOrgSlug || 'slug'}
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleCreateOrg} disabled={loading}>
                  {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Criar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-4 min-w-0">
          {/* Sidebar - Organizations List */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Minhas Organizações
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loadingOrgs ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : organizations.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Building2 className="h-12 w-12 mx-auto mb-2 opacity-30" />
                  <p>Nenhuma organização</p>
                  <p className="text-sm">Crie uma para começar</p>
                </div>
              ) : (
                <div className="divide-y">
                  {organizations.map((org) => (
                    <button
                      key={org.id}
                      onClick={() => setSelectedOrg(org)}
                      className={`w-full text-left p-4 hover:bg-muted/50 transition-colors ${
                        selectedOrg?.id === org.id ? 'bg-muted' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Building2 className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{org.name}</p>
                          <p className="text-xs text-muted-foreground">/{org.slug}</p>
                        </div>
                        <Badge variant="secondary" className={`${roleLabels[org.role].color} text-white text-xs`}>
                          {roleLabels[org.role].label}
                        </Badge>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Main Content - Selected Organization */}
          <div className="lg:col-span-3 space-y-6 min-w-0 overflow-hidden">
            {selectedOrg ? (
              <>
                {/* Org Header */}
                <Card>
                  <CardHeader className="p-4 sm:p-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                        {selectedOrg.logo_url ? (
                          <img src={selectedOrg.logo_url} alt={selectedOrg.name} className="h-12 w-12 sm:h-16 sm:w-16 rounded-xl object-contain shrink-0" />
                        ) : (
                          <div className="h-12 w-12 sm:h-16 sm:w-16 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                            <Building2 className="h-6 w-6 sm:h-8 sm:w-8 text-primary" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <CardTitle className="text-xl sm:text-2xl truncate">{selectedOrg.name}</CardTitle>
                          <CardDescription className="truncate">/{selectedOrg.slug}</CardDescription>
                        </div>
                      </div>
                      {canManageOrg && (
                        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                          <DialogTrigger asChild>
                            <Button variant="outline" size="sm" onClick={() => { setEditOrgName(selectedOrg.name); setEditOrgLogo(selectedOrg.logo_url); }} className="shrink-0 w-full sm:w-auto">
                              <Pencil className="h-4 w-4 mr-2" />
                              Editar
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
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
                              <div className="space-y-2">
                                <Label>Logo</Label>
                                <input
                                  ref={logoInputRef}
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={handleLogoUpload}
                                />
                                {editOrgLogo ? (
                                  <div className="space-y-2">
                                    <div className="rounded-lg border bg-muted/50 p-3 flex items-center justify-center">
                                      <img src={editOrgLogo} alt="Logo" className="max-h-20 max-w-full object-contain" />
                                    </div>
                                    <div className="flex gap-2">
                                      <Button type="button" variant="outline" size="sm" className="flex-1" onClick={() => logoInputRef.current?.click()} disabled={isUploadingLogo}>
                                        {isUploadingLogo ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
                                        Alterar
                                      </Button>
                                      <Button type="button" variant="outline" size="sm" onClick={() => setEditOrgLogo(null)} className="text-destructive hover:text-destructive">
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <Button type="button" variant="outline" className="w-full h-20 border-dashed flex flex-col gap-1" onClick={() => logoInputRef.current?.click()} disabled={isUploadingLogo}>
                                    {isUploadingLogo ? (
                                      <Loader2 className="h-5 w-5 animate-spin" />
                                    ) : (
                                      <>
                                        <Image className="h-5 w-5" />
                                        <span className="text-xs">Clique para enviar logo</span>
                                      </>
                                    )}
                                  </Button>
                                )}
                              </div>
                            </div>
                            <DialogFooter>
                              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                                Cancelar
                              </Button>
                              <Button onClick={handleUpdateOrg} disabled={loading}>
                                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                Salvar
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      )}
                    </div>
                  </CardHeader>
                </Card>

                {/* Tabs for Members and Settings */}
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="members" className="flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      Membros
                    </TabsTrigger>
                    <TabsTrigger value="permissions" className="flex items-center gap-2">
                      <Lock className="h-4 w-4" />
                      Permissões
                    </TabsTrigger>
                    <TabsTrigger value="settings" className="flex items-center gap-2">
                      <Settings className="h-4 w-4" />
                      Configurações
                    </TabsTrigger>
                  </TabsList>

                  {/* Members Tab */}
                  <TabsContent value="members">
                    <Card>
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <div>
                            <CardTitle className="flex items-center gap-2">
                              <Users className="h-5 w-5" />
                              Membros da Equipe
                            </CardTitle>
                            <CardDescription>
                              {members.length} membro{members.length !== 1 ? 's' : ''} na organização
                            </CardDescription>
                          </div>
                          {canManageOrg && (
                            <Dialog open={createUserDialogOpen} onOpenChange={(open) => {
                              if (!open) resetCreateUserDialog();
                              else setCreateUserDialogOpen(true);
                            }}>
                              <DialogTrigger asChild>
                                <Button size="sm">
                                  <UserPlus className="h-4 w-4 mr-2" />
                                  Criar Usuário
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-md">
                                <DialogHeader>
                                  <DialogTitle>Criar Novo Usuário</DialogTitle>
                                  <DialogDescription>
                                    Crie um novo usuário que será automaticamente membro desta organização
                                  </DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
                                  <div className="space-y-2">
                                    <Label>Nome *</Label>
                                    <Input
                                      placeholder="Nome do usuário"
                                      value={newMemberName}
                                      onChange={(e) => setNewMemberName(e.target.value)}
                                    />
                                  </div>
                                  
                                  <div className="space-y-2">
                                    <Label>Email *</Label>
                                    <Input
                                      type="email"
                                      placeholder="usuario@email.com"
                                      value={newMemberEmail}
                                      onChange={(e) => setNewMemberEmail(e.target.value)}
                                    />
                                  </div>
                                  
                                  <div className="space-y-2">
                                    <Label>Senha *</Label>
                                    <Input
                                      type="password"
                                      placeholder="Mínimo 6 caracteres"
                                      value={newMemberPassword}
                                      onChange={(e) => setNewMemberPassword(e.target.value)}
                                    />
                                  </div>
                                  
                                  <div className="space-y-2">
                                    <Label>Função</Label>
                                    <Select value={newMemberRole} onValueChange={setNewMemberRole}>
                                      <SelectTrigger>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="admin">Admin - Gerencia tudo</SelectItem>
                                        <SelectItem value="manager">Supervisor - Apenas visualização</SelectItem>
                                        <SelectItem value="agent">Agente - Acesso básico</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>

                                  <div className="space-y-2">
                                    <Label>Tipo de conta</Label>
                                    <Select value={newMemberAccountType} onValueChange={setNewMemberAccountType}>
                                      <SelectTrigger><SelectValue /></SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="standard">Conta normal</SelectItem>
                                        <SelectItem value="timeclock_kiosk">Tablet de ponto</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">O tablet acessará somente o relógio de ponto.</p>
                                  </div>

                                  {connections.length > 0 && (
                                    <div className="space-y-2">
                                      <Label className="flex items-center gap-2">
                                        <Link2 className="h-4 w-4" />
                                        Conexões permitidas
                                      </Label>
                                      <p className="text-xs text-muted-foreground mb-2">
                                        Selecione as conexões que este usuário pode acessar. Se nenhuma for selecionada, ele verá todas.
                                      </p>
                                      <div className="space-y-2 border rounded-md p-3 max-h-40 overflow-y-auto">
                                        {connections.map((conn) => (
                                          <div key={conn.id} className="flex items-center space-x-2">
                                            <Checkbox
                                              id={`conn-new-${conn.id}`}
                                              checked={newMemberConnectionIds.includes(conn.id)}
                                              onCheckedChange={() => toggleConnection(conn.id, newMemberConnectionIds, setNewMemberConnectionIds)}
                                            />
                                            <label
                                              htmlFor={`conn-new-${conn.id}`}
                                              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex-1"
                                            >
                                              {conn.name}
                                              {conn.phone_number && (
                                                <span className="text-muted-foreground ml-2 text-xs">
                                                  ({conn.phone_number})
                                                </span>
                                              )}
                                            </label>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                                <DialogFooter>
                                  <Button variant="outline" onClick={resetCreateUserDialog}>
                                    Cancelar
                                  </Button>
                                  <Button onClick={handleCreateUser} disabled={loading}>
                                    {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                    Criar Usuário
                                  </Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent>
                        {loadingMembers ? (
                          <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                          </div>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Usuário</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Função</TableHead>
                                <TableHead>Permissões</TableHead>
                                <TableHead>Conexões</TableHead>
                                <TableHead>Desde</TableHead>
                                {canManageOrg && <TableHead className="w-[120px]">Ações</TableHead>}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {members.map((member) => {
                                const RoleIcon = roleLabels[member.role].icon;
                                const assignedConns = member.assigned_connections || [];
                                const assignedDepts = member.assigned_departments || [];
                                return (
                                  <TableRow key={member.id}>
                                    <TableCell>
                                      <div className="flex items-center gap-3">
                                        <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center">
                                          <User className="h-4 w-4" />
                                        </div>
                                        <div>
                                          <p className="font-medium">{member.name}</p>
                                          <p className="text-sm text-muted-foreground">{member.email}</p>
                                        </div>
                                      </div>
                                    </TableCell>
                                    <TableCell>
                                      {member.role === 'owner' ? (
                                        <Badge variant="secondary" className="bg-primary/10 text-primary text-xs">Ativo</Badge>
                                      ) : (
                                        <div className="flex items-center gap-2">
                                          <Switch
                                            checked={member.is_active !== false}
                                            onCheckedChange={() => handleToggleActive(member)}
                                          />
                                          <span className={`text-xs ${member.is_active !== false ? 'text-primary' : 'text-muted-foreground'}`}>
                                            {member.is_active !== false ? 'Ativo' : 'Inativo'}
                                          </span>
                                        </div>
                                      )}
                                    </TableCell>
                                    <TableCell>
                                      <Badge variant="secondary" className={`${roleLabels[member.role].color} text-white`}>
                                        <RoleIcon className="h-3 w-3 mr-1" />
                                        {roleLabels[member.role].label}
                                      </Badge>
                                    </TableCell>
                                    <TableCell>
                                      {member.template_name ? (
                                        <Badge variant="outline" className="text-xs" style={{ borderColor: member.template_color || '#6366f1', color: member.template_color || '#6366f1' }}>
                                          <Lock className="h-3 w-3 mr-1" />
                                          {member.template_name}
                                        </Badge>
                                      ) : (
                                        <span className="text-muted-foreground text-sm">Padrão (cargo)</span>
                                      )}
                                    </TableCell>
                                    <TableCell>
                                      {assignedConns.length === 0 ? (
                                        <span className="text-muted-foreground text-sm">Todas</span>
                                      ) : (
                                        <div className="flex flex-wrap gap-1">
                                          {assignedConns.slice(0, 2).map((c) => (
                                            <Badge key={c.id} variant="outline" className="text-xs">
                                              {c.name}
                                            </Badge>
                                          ))}
                                          {assignedConns.length > 2 && (
                                            <Badge variant="outline" className="text-xs">
                                              +{assignedConns.length - 2}
                                            </Badge>
                                          )}
                                        </div>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                      {new Date(member.created_at).toLocaleDateString('pt-BR')}
                                    </TableCell>
                                    {canManageOrg && (
                                      <TableCell>
                                        <div className="flex items-center gap-1">
                                          <Button 
                                                variant="ghost" 
                                                size="icon"
                                              onClick={() => handleOpenEditMember(member)}
                                              title="Editar membro"
                                            >
                                                <Settings className="h-4 w-4" />
                                              </Button>
                                          {member.role !== 'owner' && (
                                            <>
                                              <Button 
                                                variant="ghost" 
                                                size="icon"
                                                onClick={() => handleOpenEditPassword(member)}
                                                title="Alterar senha"
                                              >
                                                <KeyRound className="h-4 w-4" />
                                              </Button>
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
                                                      {member.name} será removido da organização e perderá acesso a todos os recursos.
                                                    </AlertDialogDescription>
                                                  </AlertDialogHeader>
                                                  <AlertDialogFooter>
                                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                    <AlertDialogAction
                                                      onClick={() => handleRemoveMember(member.user_id)}
                                                      className="bg-destructive hover:bg-destructive/90"
                                                    >
                                                      Remover
                                                    </AlertDialogAction>
                                                  </AlertDialogFooter>
                                                </AlertDialogContent>
                                              </AlertDialog>
                                            </>
                                          )}
                                        </div>
                                      </TableCell>
                                    )}
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>

                  {/* Permissions Tab */}
                  <TabsContent value="permissions">
                    <Card>
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <div>
                            <CardTitle className="flex items-center gap-2">
                              <Lock className="h-5 w-5" />
                              Templates de Permissão
                            </CardTitle>
                            <CardDescription>
                              Crie perfis de acesso personalizados e atribua a cada usuário
                            </CardDescription>
                          </div>
                          {canManageOrg && (
                            <Button size="sm" onClick={() => openTemplateDialog()}>
                              <Plus className="h-4 w-4 mr-2" />
                              Novo Template
                            </Button>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent>
                        {loadingTemplates ? (
                          <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                          </div>
                        ) : templates.length === 0 ? (
                          <div className="text-center py-12 text-muted-foreground">
                            <Lock className="h-12 w-12 mx-auto mb-3 opacity-30" />
                            <p className="font-medium">Nenhum template criado</p>
                            <p className="text-sm mt-1">
                              Sem templates, o acesso é controlado pelo cargo (admin, supervisor, agente).
                              <br />
                              Crie templates para personalizar as permissões de cada usuário.
                            </p>
                            {canManageOrg && (
                              <Button className="mt-4" onClick={() => openTemplateDialog()}>
                                <Plus className="h-4 w-4 mr-2" />
                                Criar Primeiro Template
                              </Button>
                            )}
                          </div>
                        ) : (
                          <div className="grid gap-4 sm:grid-cols-2">
                            {templates.map((tpl) => {
                              const enabledCount = Object.values(tpl.permissions).filter(Boolean).length;
                              return (
                                <div key={tpl.id} className="rounded-lg border p-4 space-y-3">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tpl.color }} />
                                      <span className="font-medium">{tpl.name}</span>
                                    </div>
                                    <div className="flex gap-1">
                                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDuplicateTemplate(tpl)} title="Duplicar">
                                        <Copy className="h-3.5 w-3.5" />
                                      </Button>
                                      {canManageOrg && (
                                        <>
                                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openTemplateDialog(tpl)} title="Editar">
                                            <Pencil className="h-3.5 w-3.5" />
                                          </Button>
                                          <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive">
                                                <Trash2 className="h-3.5 w-3.5" />
                                              </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                              <AlertDialogHeader>
                                                <AlertDialogTitle>Excluir template?</AlertDialogTitle>
                                                <AlertDialogDescription>
                                                  {tpl.member_count > 0
                                                    ? `${tpl.member_count} membro(s) usam este template. Eles voltarão para permissões padrão por cargo.`
                                                    : 'Este template será removido permanentemente.'}
                                                </AlertDialogDescription>
                                              </AlertDialogHeader>
                                              <AlertDialogFooter>
                                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                <AlertDialogAction onClick={() => handleDeleteTemplate(tpl.id)} className="bg-destructive hover:bg-destructive/90">
                                                  Excluir
                                                </AlertDialogAction>
                                              </AlertDialogFooter>
                                            </AlertDialogContent>
                                          </AlertDialog>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                  {tpl.description && (
                                    <p className="text-sm text-muted-foreground">{tpl.description}</p>
                                  )}
                                  <div className="flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground">{enabledCount} páginas habilitadas</span>
                                    <Badge variant="secondary" className="text-xs">
                                      {tpl.member_count} membro{tpl.member_count !== 1 ? 's' : ''}
                                    </Badge>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>

                  {/* Settings Tab */}
                  <TabsContent value="settings">
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Settings className="h-5 w-5" />
                          Módulos Habilitados
                        </CardTitle>
                        <CardDescription>
                          Ative ou desative funcionalidades para esta organização
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-6">
                        {/* Campaigns */}
                        <div className="flex items-center justify-between rounded-lg border p-4">
                          <div className="flex items-center gap-4">
                            <div className="h-10 w-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
                              <Megaphone className="h-5 w-5 text-orange-500" />
                            </div>
                            <div>
                              <p className="font-medium">Campanhas</p>
                              <p className="text-sm text-muted-foreground">
                                Disparo em massa para listas de contatos
                              </p>
                            </div>
                          </div>
                          <Switch
                            checked={modulesEnabled.campaigns}
                            onCheckedChange={(checked) => setModulesEnabled(prev => ({ ...prev, campaigns: checked }))}
                            disabled={!canManageOrg}
                          />
                        </div>

                        {/* Billing (Asaas) */}
                        <div className="flex items-center justify-between rounded-lg border p-4">
                          <div className="flex items-center gap-4">
                            <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                              <Receipt className="h-5 w-5 text-green-500" />
                            </div>
                            <div>
                              <p className="font-medium">Cobranças (Asaas)</p>
                              <p className="text-sm text-muted-foreground">
                                Integração com Asaas para lembretes de pagamento
                              </p>
                            </div>
                          </div>
                          <Switch
                            checked={modulesEnabled.billing}
                            onCheckedChange={(checked) => setModulesEnabled(prev => ({ ...prev, billing: checked }))}
                            disabled={!canManageOrg}
                          />
                        </div>

                        {/* Groups */}
                        <div className="flex items-center justify-between rounded-lg border p-4">
                          <div className="flex items-center gap-4">
                            <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                              <UsersRound className="h-5 w-5 text-blue-500" />
                            </div>
                            <div>
                              <p className="font-medium">Grupos WhatsApp</p>
                              <p className="text-sm text-muted-foreground">
                                Atendimento e gestão de grupos
                              </p>
                            </div>
                          </div>
                          <Switch
                            checked={modulesEnabled.groups}
                            onCheckedChange={(checked) => setModulesEnabled(prev => ({ ...prev, groups: checked }))}
                            disabled={!canManageOrg}
                          />
                        </div>

                        {/* Scheduled Messages */}
                        <div className="flex items-center justify-between rounded-lg border p-4">
                          <div className="flex items-center gap-4">
                            <div className="h-10 w-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                              <CalendarClock className="h-5 w-5 text-purple-500" />
                            </div>
                            <div>
                              <p className="font-medium">Mensagens Agendadas</p>
                              <p className="text-sm text-muted-foreground">
                                Agendar envio de mensagens para data/hora específica
                              </p>
                            </div>
                          </div>
                          <Switch
                            checked={modulesEnabled.scheduled_messages}
                            onCheckedChange={(checked) => setModulesEnabled(prev => ({ ...prev, scheduled_messages: checked }))}
                            disabled={!canManageOrg}
                          />
                        </div>

                        {/* Chat */}
                        <div className="flex items-center justify-between rounded-lg border p-4">
                          <div className="flex items-center gap-4">
                            <div className="h-10 w-10 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                              <MessagesSquare className="h-5 w-5 text-indigo-500" />
                            </div>
                            <div>
                              <p className="font-medium">Chat WhatsApp</p>
                              <p className="text-sm text-muted-foreground">
                                Atendimento e conversa com clientes via WhatsApp
                              </p>
                            </div>
                          </div>
                          <Switch
                            checked={modulesEnabled.chat}
                            onCheckedChange={(checked) => setModulesEnabled(prev => ({ ...prev, chat: checked }))}
                            disabled={!canManageOrg}
                          />
                        </div>

                        {/* Chatbots */}
                        <div className="flex items-center justify-between rounded-lg border p-4">
                          <div className="flex items-center gap-4">
                            <div className="h-10 w-10 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                              <Bot className="h-5 w-5 text-cyan-500" />
                            </div>
                            <div>
                              <p className="font-medium">Chatbots</p>
                              <p className="text-sm text-muted-foreground">
                                Automações, fluxos e menus interativos de atendimento
                              </p>
                            </div>
                          </div>
                          <Switch
                            checked={modulesEnabled.chatbots}
                            onCheckedChange={(checked) => setModulesEnabled(prev => ({ ...prev, chatbots: checked }))}
                            disabled={!canManageOrg}
                          />
                        </div>

                        {/* CRM */}
                        <div className="flex items-center justify-between rounded-lg border p-4">
                          <div className="flex items-center gap-4">
                            <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                              <Briefcase className="h-5 w-5 text-amber-500" />
                            </div>
                            <div>
                              <p className="font-medium">CRM</p>
                              <p className="text-sm text-muted-foreground">
                                Gestão de negociações, empresas e tarefas comerciais
                              </p>
                            </div>
                          </div>
                          <Switch
                            checked={modulesEnabled.crm}
                            onCheckedChange={(checked) => setModulesEnabled(prev => ({ ...prev, crm: checked }))}
                            disabled={!canManageOrg}
                          />
                        </div>

                        {/* Group Secretary */}
                        <div className="flex items-center justify-between rounded-lg border p-4">
                          <div className="flex items-center gap-4">
                            <div className="h-10 w-10 rounded-lg bg-teal-500/10 flex items-center justify-center">
                              <Bot className="h-5 w-5 text-teal-500" />
                            </div>
                            <div>
                              <p className="font-medium">Secretária IA de Grupos</p>
                              <p className="text-sm text-muted-foreground">
                                Monitora grupos e notifica quando alguém é mencionado
                              </p>
                            </div>
                          </div>
                          <Switch
                            checked={modulesEnabled.group_secretary}
                            onCheckedChange={(checked) => setModulesEnabled(prev => ({ ...prev, group_secretary: checked }))}
                            disabled={!canManageOrg}
                          />
                        </div>

                        {/* RH */}
                        <div className="flex items-center justify-between rounded-lg border p-4">
                          <div className="flex items-center gap-4">
                            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                              <Users className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <p className="font-medium">RH</p>
                              <p className="text-sm text-muted-foreground">
                                Colaboradores, ponto, banco de horas e holerite
                              </p>
                            </div>
                          </div>
                          <Switch
                            checked={modulesEnabled.rh}
                            onCheckedChange={(checked) => setModulesEnabled(prev => ({ ...prev, rh: checked }))}
                            disabled={!canManageOrg}
                          />
                        </div>

                        {/* Ghost Module */}
                        <div className="flex items-center justify-between rounded-lg border p-4">
                          <div>
                            <p className="text-sm font-medium">Módulo Fantasma</p>
                            <p className="text-xs text-muted-foreground">
                              Análise inteligente de conversas por IA
                            </p>
                          </div>
                          <Switch
                            checked={modulesEnabled.ghost}
                            onCheckedChange={(checked) => setModulesEnabled(prev => ({ ...prev, ghost: checked }))}
                            disabled={!canManageOrg}
                          />
                        </div>

                        {/* Projects Module */}
                        <div className="flex items-center justify-between rounded-lg border p-4">
                          <div>
                            <p className="text-sm font-medium">Projetos</p>
                            <p className="text-xs text-muted-foreground">
                              Gestão de projetos vinculados a negociações do CRM
                            </p>
                          </div>
                          <Switch
                            checked={modulesEnabled.projects}
                            onCheckedChange={(checked) => setModulesEnabled(prev => ({ ...prev, projects: checked }))}
                            disabled={!canManageOrg}
                          />
                        </div>

                        {/* Lead Gleego Module */}
                        <div className="rounded-lg border p-4 space-y-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                                <BarChart3 className="h-5 w-5 text-emerald-500" />
                              </div>
                              <div>
                                <p className="font-medium">Lead Gleego</p>
                                <p className="text-sm text-muted-foreground">
                                  Integração SSO com o Lead Extractor Gleego
                                </p>
                              </div>
                            </div>
                            <Switch
                              checked={modulesEnabled.lead_gleego}
                              onCheckedChange={(checked) => setModulesEnabled(prev => ({ ...prev, lead_gleego: checked }))}
                              disabled={!canManageOrg}
                            />
                          </div>
                          {modulesEnabled.lead_gleego && canManageOrg && (
                            <div className="space-y-4 pt-2 border-t">
                              <div>
                                <Label className="text-sm font-medium flex items-center gap-2">
                                  <KeyRound className="h-4 w-4" />
                                  Chave de API (SSO + Recebimento de Leads)
                                </Label>
                                {leadGleegoApiKeyMasked && (
                                  <p className="text-xs text-muted-foreground mt-1">
                                    Chave atual: <code className="bg-muted px-1 rounded">{leadGleegoApiKeyMasked}</code>
                                  </p>
                                )}
                              </div>
                              <div className="flex gap-2">
                                <Input
                                  type="password"
                                  placeholder="Cole a chave secreta aqui"
                                  value={leadGleegoApiKey}
                                  onChange={(e) => setLeadGleegoApiKey(e.target.value)}
                                />
                              </div>

                              {/* CRM Config */}
                              <div className="space-y-3 pt-3 border-t border-border/50">
                                <p className="text-sm font-medium">📊 Destino dos Leads no CRM</p>
                                <p className="text-xs text-muted-foreground">
                                  Configure para onde os leads do FormGleego serão enviados. Sem funil/etapa, vão para Prospects.
                                </p>
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <Label className="text-xs">Funil</Label>
                                    <Select value={gleegoFunnelId} onValueChange={(val) => { setGleegoFunnelId(val); setGleegoStageId(''); }}>
                                      <SelectTrigger className="h-9">
                                        <SelectValue placeholder="Selecione o funil" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {gleegoFunnels.map(f => (
                                          <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div>
                                    <Label className="text-xs">Etapa</Label>
                                    <Select value={gleegoStageId} onValueChange={setGleegoStageId} disabled={!gleegoFunnelId}>
                                      <SelectTrigger className="h-9">
                                        <SelectValue placeholder="Selecione a etapa" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {(gleegoFunnels.find(f => f.id === gleegoFunnelId)?.stages || []).map(s => (
                                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                              </div>

                              {/* Distribution */}
                              <div className="space-y-3 pt-3 border-t border-border/50">
                                <p className="text-sm font-medium">🔄 Distribuição Round-Robin</p>
                                <p className="text-xs text-muted-foreground">
                                  Selecione um webhook com distribuição ativa para usar o mesmo rodízio de vendedores.
                                </p>
                                <Select value={gleegoWebhookId} onValueChange={setGleegoWebhookId}>
                                  <SelectTrigger className="h-9">
                                    <SelectValue placeholder="Nenhum (sem distribuição)" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">Nenhum</SelectItem>
                                    {gleegoWebhooks.filter(w => w.distribution_enabled).map(w => (
                                      <SelectItem key={w.id} value={w.id}>
                                        {w.name} ✅
                                      </SelectItem>
                                    ))}
                                    {gleegoWebhooks.filter(w => !w.distribution_enabled).map(w => (
                                      <SelectItem key={w.id} value={w.id}>
                                        {w.name} (sem distribuição)
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              {/* Deal Title Template */}
                              <div className="space-y-3 pt-3 border-t border-border/50">
                                <p className="text-sm font-medium">📝 Título da Negociação</p>
                                <p className="text-xs text-muted-foreground">
                                  Use variáveis como <code className="bg-muted px-1 rounded">{'{nome}'}</code>, <code className="bg-muted px-1 rounded">{'{email}'}</code>, <code className="bg-muted px-1 rounded">{'{telefone}'}</code>, <code className="bg-muted px-1 rounded">{'{empresa}'}</code>. Ex: <code className="bg-muted px-1 rounded">{'{nome}'} | Orçamento</code>
                                </p>
                                <Input
                                  placeholder="{nome}"
                                  value={gleegoDealTitleTemplate}
                                  onChange={(e) => setGleegoDealTitleTemplate(e.target.value)}
                                />
                              </div>

                              <Button onClick={handleSaveLeadGleegoSettings} size="sm" className="w-full">
                                Salvar Configurações do Gleego
                              </Button>
                            </div>
                          )}
                        </div>

                        {/* Shared Conversations */}
                        <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 p-4">
                          <div className="flex items-center gap-4">
                            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                              <Users className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <p className="font-medium">Conversas Compartilhadas</p>
                              <p className="text-sm text-muted-foreground">
                                Todos os usuários vinculados a uma conexão podem ver todas as conversas dessa conexão
                              </p>
                            </div>
                          </div>
                          <Switch
                            checked={modulesEnabled.shared_conversations}
                            onCheckedChange={(checked) => setModulesEnabled(prev => ({ ...prev, shared_conversations: checked }))}
                            disabled={!canManageOrg}
                          />
                        </div>

                        {/* Save Button */}
                        {canManageOrg && (
                          <div className="flex justify-end pt-4">
                            <Button onClick={handleSaveModules} disabled={savingModules}>
                              {savingModules && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                              Salvar Configurações
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
              </>
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <Building2 className="h-16 w-16 text-muted-foreground/30 mb-4" />
                  <h3 className="text-lg font-medium mb-2">Nenhuma organização selecionada</h3>
                  <p className="text-muted-foreground mb-4">
                    Selecione uma organização ou crie uma nova para começar
                  </p>
                  <Button onClick={() => setCreateDialogOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Criar Organização
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Edit Member Dialog */}
        <Dialog open={editMemberDialogOpen} onOpenChange={setEditMemberDialogOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
            <DialogHeader className="shrink-0">
              <DialogTitle>Editar Membro</DialogTitle>
              <DialogDescription>
                Gerenciar cargo, conexões e departamentos de {editingMember?.name}
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-6 overflow-y-auto flex-1 pr-2">
              {/* Role - only if not owner */}
              {editingMember?.role !== 'owner' && (
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Cargo
                  </Label>
                  <Select value={editMemberRole} onValueChange={setEditMemberRole}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin - Gerencia tudo</SelectItem>
                      <SelectItem value="manager">Supervisor - Visualização avançada</SelectItem>
                      <SelectItem value="agent">Agente - Acesso básico</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Permission Template */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  Template de Permissões
                </Label>
                <Select value={editMemberTemplateId} onValueChange={setEditMemberTemplateId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Padrão (baseado no cargo)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Padrão (baseado no cargo)</SelectItem>
                    {templates.map(tpl => (
                      <SelectItem key={tpl.id} value={tpl.id}>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: tpl.color }} />
                          {tpl.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Define quais páginas e módulos o usuário pode acessar
                </p>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Link2 className="h-4 w-4" />
                  Conexões permitidas
                </Label>
                {connections.length === 0 ? (
                  <p className="text-muted-foreground text-sm py-2">
                    Nenhuma conexão disponível
                  </p>
                ) : (
                  <div className="space-y-2 border rounded-md p-3 max-h-40 overflow-y-auto">
                    {connections.map((conn) => (
                      <div key={conn.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`edit-conn-${conn.id}`}
                          checked={editMemberConnectionIds.includes(conn.id)}
                          onCheckedChange={() => toggleConnection(conn.id, editMemberConnectionIds, setEditMemberConnectionIds)}
                        />
                        <label
                          htmlFor={`edit-conn-${conn.id}`}
                          className="text-sm font-medium leading-none cursor-pointer flex-1"
                        >
                          {conn.name}
                          {conn.phone_number && (
                            <span className="text-muted-foreground ml-2 text-xs">
                              ({conn.phone_number})
                            </span>
                          )}
                        </label>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Sem seleção = acesso a todas as conexões
                </p>
              </div>

              {/* Departments */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Layers className="h-4 w-4" />
                  Departamentos (Filas)
                </Label>
                {departments.length === 0 ? (
                  <p className="text-muted-foreground text-sm py-2">
                    Nenhum departamento cadastrado
                  </p>
                ) : (
                  <div className="space-y-2 border rounded-md p-3 max-h-40 overflow-y-auto">
                    {departments.filter(d => d.is_active).map((dept) => (
                      <div key={dept.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`edit-dept-${dept.id}`}
                          checked={editMemberDepartmentIds.includes(dept.id)}
                          onCheckedChange={() => {
                            if (editMemberDepartmentIds.includes(dept.id)) {
                              setEditMemberDepartmentIds(prev => prev.filter(id => id !== dept.id));
                            } else {
                              setEditMemberDepartmentIds(prev => [...prev, dept.id]);
                            }
                          }}
                        />
                        <label
                          htmlFor={`edit-dept-${dept.id}`}
                          className="text-sm font-medium leading-none cursor-pointer flex-1 flex items-center gap-2"
                        >
                          <span 
                            className="w-3 h-3 rounded-full" 
                            style={{ backgroundColor: dept.color || '#6366f1' }}
                          />
                          {dept.name}
                        </label>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Selecione os departamentos que este usuário pode atender
                </p>
              </div>
            </div>
            <DialogFooter className="shrink-0">
              <Button variant="outline" onClick={() => setEditMemberDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleUpdateMember} disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Password Dialog */}
        <Dialog open={editPasswordDialogOpen} onOpenChange={(open) => {
          if (!open) {
            setEditPasswordDialogOpen(false);
            setEditPasswordMember(null);
            setNewPassword('');
          }
        }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Alterar Senha</DialogTitle>
              <DialogDescription>
                Defina uma nova senha para {editPasswordMember?.name}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">Nova Senha</Label>
                <Input
                  id="new-password"
                  type="password"
                  placeholder="Mínimo 6 caracteres"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditPasswordDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleUpdatePassword} disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Template Editor Dialog */}
        <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
            <DialogHeader className="shrink-0">
              <DialogTitle>{editingTemplate ? 'Editar Template' : 'Novo Template de Permissão'}</DialogTitle>
              <DialogDescription>Defina quais páginas os usuários com este template podem acessar</DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-6 overflow-y-auto flex-1 pr-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nome *</Label>
                  <Input placeholder="Ex: Vendedor, Gerente..." value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Cor</Label>
                  <div className="flex gap-2">
                    {['#6366f1','#f59e0b','#10b981','#ef4444','#8b5cf6','#06b6d4','#ec4899'].map(color => (
                      <button key={color} className={`w-8 h-8 rounded-full border-2 transition-transform ${templateColor === color ? 'scale-110 border-foreground' : 'border-transparent'}`} style={{ backgroundColor: color }} onClick={() => setTemplateColor(color)} />
                    ))}
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Descrição</Label>
                <Input placeholder="Descrição opcional" value={templateDescription} onChange={(e) => setTemplateDescription(e.target.value)} />
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-semibold">Páginas Habilitadas</Label>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setTemplatePermissions(createFullPermissions())}>Marcar Todas</Button>
                    <Button variant="outline" size="sm" onClick={() => setTemplatePermissions(createEmptyPermissions())}>Desmarcar Todas</Button>
                  </div>
                </div>
                {PAGE_SECTIONS.map(section => {
                  const sectionPages = PAGE_PERMISSIONS.filter(p => p.section === section);
                  const enabledInSection = sectionPages.filter(p => templatePermissions[p.key]).length;
                  const allEnabled = enabledInSection === sectionPages.length;
                  return (
                    <div key={section} className="rounded-lg border p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Checkbox checked={allEnabled} onCheckedChange={(checked) => toggleSectionPermissions(section, !!checked)} />
                        <span className="font-medium text-sm">{section}</span>
                        <Badge variant="secondary" className="text-xs">{enabledInSection}/{sectionPages.length}</Badge>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pl-6">
                        {sectionPages.map(page => (
                          <div key={page.key} className="flex items-center space-x-2">
                            <Checkbox id={`perm-${page.key}`} checked={templatePermissions[page.key] || false} onCheckedChange={(checked) => setTemplatePermissions(prev => ({ ...prev, [page.key]: !!checked }))} />
                            <label htmlFor={`perm-${page.key}`} className="text-sm leading-none cursor-pointer">{page.label}</label>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <DialogFooter className="shrink-0">
              <Button variant="outline" onClick={() => setTemplateDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleSaveTemplate} disabled={savingTemplate}>
                {savingTemplate && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editingTemplate ? 'Salvar' : 'Criar Template'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}