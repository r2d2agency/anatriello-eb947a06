import React, { useState, useCallback, useMemo } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { useEmployees, useCreateEmployee, useUpdateEmployee, useDeleteEmployee, useRhDepartments, useBranches, useCreateBranch, useDeleteBranch, useCreateRhDepartment, useDeleteRhDepartment, useRhPositions, useCreateRhPosition, useDeleteRhPosition, useWorkerProfiles, useCreateWorkerProfile, useDeleteWorkerProfile, useRhDocuments, useCreateRhDocument, useDeleteRhDocument } from "@/hooks/use-rh";
import { useCompanies } from "@/hooks/use-companies";
import { useAppAccess, useGrantAppAccess, useBlockAppAccess, useResetAppPassword } from "@/hooks/use-promotor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Plus, Search, UserCircle, Building2, FileText, Edit, Trash2, Eye, EyeOff, Users, Loader2, Calendar, Briefcase, X, MapPin, UserCog, DollarSign, Gift, Smartphone, KeyRound, Copy, RefreshCw, FileSpreadsheet, Bell, History as HistoryIcon, AlertTriangle } from "lucide-react";
import { EmployeeImportExportDialog } from "@/components/rh/EmployeeImportExportDialog";
import { EmployeeNotificationsDialog } from "@/components/rh/EmployeeNotificationsDialog";
import { EmployeeHistoryDialog } from "@/components/rh/EmployeeHistoryDialog";
import { useUpload } from "@/hooks/use-upload";
import { format, differenceInYears, differenceInMonths, differenceInDays, addYears, addMonths } from "date-fns";
import { ptBR } from "date-fns/locale";

const STATUS_COLORS: Record<string, string> = {
  ativo: "bg-green-500/10 text-green-700 border-green-200",
  afastado: "bg-yellow-500/10 text-yellow-700 border-yellow-200",
  ferias: "bg-blue-500/10 text-blue-700 border-blue-200",
  desligado: "bg-red-500/10 text-red-700 border-red-200",
  suspenso: "bg-orange-500/10 text-orange-700 border-orange-200",
};

const EMPLOYMENT_LABELS: Record<string, string> = {
  clt: "CLT", pj: "PJ", freelancer: "Freelancer", temporario: "Temporário", estagiario: "Estagiário", aprendiz: "Aprendiz",
};

const PROFILE_LABELS: Record<string, string> = {
  administrativo: "Administrativo", supervisor: "Supervisor", promotor: "Promotor", operacional: "Operacional",
};

const SALARY_ITEM_TYPES = [
  "Salário Base", "Adicional Noturno", "Adicional Periculosidade", "Adicional Insalubridade",
  "Comissão", "Gratificação", "Hora Extra", "DSR", "Adicional de Função", "Bonificação", "Outro"
];

const BENEFIT_TYPES = [
  "Vale Transporte", "Vale Refeição", "Vale Alimentação", "Plano de Saúde", "Plano Odontológico",
  "Seguro de Vida", "Auxílio Creche", "Auxílio Educação", "Gympass/Wellhub", "PLR",
  "Cesta Básica", "Auxílio Home Office", "Outro"
];

const DEDUCTION_TYPES = [
  "Vale Transporte (desconto)", "Vale Refeição (desconto)", "Vale Alimentação (desconto)",
  "Plano de Saúde (desconto)", "Plano Odontológico (desconto)", "Convênio", "Empréstimo Consignado",
  "Adiantamento Salarial", "Pensão Alimentícia", "Contribuição Sindical", "Outro"
];

const DRIVER_POSITION_REGEX = /motorista|entregador|driver/i;

const WEEKDAYS = [
  { key: "seg", label: "Seg" },
  { key: "ter", label: "Ter" },
  { key: "qua", label: "Qua" },
  { key: "qui", label: "Qui" },
  { key: "sex", label: "Sex" },
  { key: "sab", label: "Sáb" },
  { key: "dom", label: "Dom" },
];

const DEFAULT_SCHEDULE = {
  days: { seg: true, ter: true, qua: true, qui: true, sex: true, sab: false, dom: false },
  entry: "08:00",
  exit: "17:00",
  lunch_start: "12:00",
  lunch_end: "13:00",
  per_day_enabled: false,
  per_day: {} as Record<string, { entry: string; exit: string; lunch_start: string; lunch_end: string }>,
};

function parseSchedule(ws: any) {
  const base = { ...DEFAULT_SCHEDULE, days: { ...DEFAULT_SCHEDULE.days }, per_day: {} };
  if (!ws) return base;
  if (typeof ws === "object" && ws.days) return { ...base, ...ws, days: { ...base.days, ...ws.days }, per_day: { ...(ws.per_day || {}) } };
  const match = typeof ws === "string" && ws.match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/);
  if (match) return { ...base, entry: match[1], exit: match[2] };
  try { const p = JSON.parse(ws); return { ...base, ...p, days: { ...base.days, ...(p.days || {}) }, per_day: { ...(p.per_day || {}) } }; } catch { return base; }
}

function getDayTimes(sched: any, day: string) {
  if (sched.per_day_enabled && sched.per_day?.[day]) return sched.per_day[day];
  return { entry: sched.entry, exit: sched.exit, lunch_start: sched.lunch_start, lunch_end: sched.lunch_end };
}

function dayHours(t: { entry: string; exit: string; lunch_start: string; lunch_end: string }) {
  const [eh, em] = t.entry.split(":").map(Number);
  const [xh, xm] = t.exit.split(":").map(Number);
  const [lsh, lsm] = t.lunch_start.split(":").map(Number);
  const [leh, lem] = t.lunch_end.split(":").map(Number);
  const totalMin = (xh * 60 + xm) - (eh * 60 + em);
  const lunchMin = (leh * 60 + lem) - (lsh * 60 + lsm);
  return Math.max(0, totalMin - lunchMin) / 60;
}

function calcScheduleHours(sched: any) {
  const activeDays = Object.entries(sched.days).filter(([, v]) => v).map(([k]) => k);
  const workDays = activeDays.length;
  const weeklyHours = activeDays.reduce((sum, d) => sum + dayHours(getDayTimes(sched, d)), 0);
  const dailyHours = workDays > 0 ? weeklyHours / workDays : 0;
  const weeksPerMonth = 4.33;
  const monthlyWorkDays = Math.round(workDays * weeksPerMonth);
  const monthlyHours = weeklyHours * weeksPerMonth;
  return { dailyHours, workDays, monthlyWorkDays, monthlyHours };
}

const EMPTY_FORM = {
  full_name: "", social_name: "", cpf: "", rg: "", birth_date: "", gender: "", email: "", phone: "",
  address: "", address_number: "", complement: "", neighborhood: "", city: "", state: "", zip_code: "",
  registration_number: "",
  worker_profile: "operacional", employment_type: "clt", position: "", salary: "",
  admission_date: "", company_id: "", department_id: "", branch_id: "", direct_manager_id: "",
  work_schedule: { ...DEFAULT_SCHEDULE, days: { ...DEFAULT_SCHEDULE.days } },
  bank_name: "", bank_agency: "", bank_account: "", bank_account_type: "", pix_key: "", pix_key_type: "",
  ctps_number: "", pis_pasep: "", cnpj: "", company_name: "", status: "ativo",
  facial_required: null as boolean | null,
  salary_items: [] as { type: string; description: string; value: string }[],
  benefits: [] as { type: string; description: string; value: string; employer_cost: string }[],
  deductions: [] as { type: string; description: string; value: string }[],
};

// ============ CPF Validation ============
function validateCPF(cpf: string): boolean {
  const cleaned = cpf.replace(/\D/g, "");
  if (cleaned.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cleaned)) return false; // all same digits
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cleaned[i]) * (10 - i);
  let remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  if (remainder !== parseInt(cleaned[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cleaned[i]) * (11 - i);
  remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  return remainder === parseInt(cleaned[10]);
}

function formatCPF(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function formatCEP(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

// ============ Age Calculation ============
function calcAge(birthDate: string): string {
  if (!birthDate) return "";
  const birth = new Date(birthDate + "T00:00:00");
  const today = new Date();
  const years = differenceInYears(today, birth);
  const afterYears = addYears(birth, years);
  const months = differenceInMonths(today, afterYears);
  const afterMonths = addMonths(afterYears, months);
  const days = differenceInDays(today, afterMonths);
  return `${years} anos, ${months} meses e ${days} dias`;
}

export default function RHColaboradores() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("sem_desligados");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [profileFilter, setProfileFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifEmployee, setNotifEmployee] = useState<{ id: string; name: string } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyEmployee, setHistoryEmployee] = useState<{ id: string; name: string } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<any>({ ...EMPTY_FORM });
  const [showSensitive, setShowSensitive] = useState(false);
  const [cpfError, setCpfError] = useState("");
  const [cepLoading, setCepLoading] = useState(false);
  const [importExportOpen, setImportExportOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const { toast } = useToast();

  const { data: rawEmployees = [], isLoading } = useEmployees({
    search: search || undefined,
    status: !["all", "sem_desligados"].includes(statusFilter) ? statusFilter : undefined,
    company_id: companyFilter !== "all" ? companyFilter : undefined,
  });
  // Base para os cards (sem depender do filtro de status)
  const { data: allEmployees = [] } = useEmployees({
    company_id: companyFilter !== "all" ? companyFilter : undefined,
  });
  const { companies } = useCompanies();

  const employees = useMemo(() => {
    let list = rawEmployees;
    if (statusFilter === "sem_desligados") list = list.filter((e: any) => e.status !== "desligado");
    if (profileFilter === "all") return list;
    if (profileFilter === "promotor_access") return list.filter((e: any) => e.promotor_access);
    return list.filter((e: any) => e.worker_profile === profileFilter);
  }, [rawEmployees, profileFilter, statusFilter]);
  const { data: departments = [] } = useRhDepartments();
  const { data: branches = [] } = useBranches();
  const { data: positions = [] } = useRhPositions();
  const { data: workerProfiles = [] } = useWorkerProfiles();
  const createMut = useCreateEmployee();
  const updateMut = useUpdateEmployee();
  const deleteMut = useDeleteEmployee();
  const createDeptMut = useCreateRhDepartment();
  const deleteDeptMut = useDeleteRhDepartment();
  const createPosMut = useCreateRhPosition();
  const deletePosMut = useDeleteRhPosition();
  const createBranchMut = useCreateBranch();
  const deleteBranchMut = useDeleteBranch();
  const createProfileMut = useCreateWorkerProfile();
  const deleteProfileMut = useDeleteWorkerProfile();

  const [newDeptName, setNewDeptName] = useState("");
  const [newPosName, setNewPosName] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [newProfileName, setNewProfileName] = useState("");
  const [showDeptManager, setShowDeptManager] = useState(false);
  const [showPosManager, setShowPosManager] = useState(false);
  const [showBranchManager, setShowBranchManager] = useState(false);
  const [showProfileManager, setShowProfileManager] = useState(false);

  const maskCPF = (cpf: string) => {
    if (!cpf) return "—";
    if (showSensitive) return cpf;
    return cpf.replace(/(\d{3})\.\d{3}\.\d{3}(-\d{2})/, "$1.***.***$2");
  };

  // ============ CEP Lookup ============
  const lookupCEP = useCallback(async (cep: string) => {
    const digits = cep.replace(/\D/g, "");
    if (digits.length !== 8) return;
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setForm((p: any) => ({
          ...p,
          address: data.logradouro || p.address,
          neighborhood: data.bairro || p.neighborhood,
          city: data.localidade || p.city,
          state: data.uf || p.state,
          complement: data.complemento || p.complement,
        }));
        toast({ title: "Endereço preenchido automaticamente!" });
      } else {
        toast({ title: "CEP não encontrado", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erro ao buscar CEP", variant: "destructive" });
    } finally {
      setCepLoading(false);
    }
  }, [toast]);

  // ============ CPF handler ============
  const handleCPFChange = (value: string) => {
    const formatted = formatCPF(value);
    setField("cpf", formatted);
    const digits = value.replace(/\D/g, "");
    if (digits.length === 11) {
      if (!validateCPF(digits)) {
        setCpfError("CPF inválido");
      } else {
        setCpfError("");
      }
    } else {
      setCpfError("");
    }
  };

  const openNew = () => { setForm({ ...EMPTY_FORM }); setEditId(null); setCpfError(""); setDialogOpen(true); };
  const openEdit = (emp: any) => {
    setForm({
      ...emp,
      salary: emp.salary || "",
      birth_date: emp.birth_date?.slice(0, 10) || "",
      admission_date: emp.admission_date?.slice(0, 10) || "",
      work_schedule: parseSchedule(emp.work_schedule),
      salary_items: emp.salary_items || [],
      benefits: emp.benefits || [],
      deductions: emp.deductions || [],
    });
    setEditId(emp.id);
    setCpfError("");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.full_name) { toast({ title: "Nome é obrigatório", variant: "destructive" }); return; }
    if (cpfError) { toast({ title: "CPF inválido, corrija antes de salvar", variant: "destructive" }); return; }
    try {
      if (editId) {
        await updateMut.mutateAsync({ id: editId, ...form });
        toast({ title: "Colaborador atualizado!" });
      } else {
        await createMut.mutateAsync(form);
        toast({ title: "Colaborador cadastrado!" });
      }
      setDialogOpen(false);
    } catch {
      toast({ title: "Erro ao salvar", variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Deseja desligar este colaborador?")) return;
    await deleteMut.mutateAsync(id);
    toast({ title: "Colaborador desligado" });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`ATENÇÃO: Apagar PERMANENTEMENTE ${selectedIds.length} colaboradores selecionados? Esta ação não pode ser desfeita.`)) return;
    
    try {
      await Promise.all(selectedIds.map(id => deleteMut.mutateAsync({ id, hard: true })));
      toast({ title: `${selectedIds.length} colaboradores apagados com sucesso` });
      setSelectedIds([]);
    } catch (error) {
      toast({ title: "Erro ao apagar alguns colaboradores", variant: "destructive" });
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === employees.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(employees.map((e: any) => e.id));
    }
  };

  const setField = (key: string, val: any) => setForm((p: any) => ({ ...p, [key]: val }));

  const stats = {
    total: allEmployees.filter((e: any) => e.status !== "desligado").length,
    ativos: allEmployees.filter((e: any) => e.status === "ativo").length,
    afastados: allEmployees.filter((e: any) => e.status === "afastado" || e.status === "ferias").length,
    desligados: allEmployees.filter((e: any) => e.status === "desligado").length,
  };

  // ============ Alerta de vencimento de CNH (motorista/entregador) ============
  const cnhAlerts = useMemo(() => {
    const now = new Date();
    return allEmployees
      .filter((e: any) => e.status !== "desligado" && e.cnh_expiry && DRIVER_POSITION_REGEX.test(e.position || ""))
      .map((e: any) => {
        const expiry = new Date(`${String(e.cnh_expiry).slice(0, 10)}T00:00:00`);
        const days = Math.ceil((expiry.getTime() - now.getTime()) / 86400000);
        return { ...e, cnhDays: days };
      })
      .filter((e: any) => e.cnhDays <= 30)
      .sort((a: any, b: any) => a.cnhDays - b.cnhDays);
  }, [allEmployees]);

  return (
    <MainLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Users className="h-6 w-6 text-primary" /> Colaboradores</h1>
            <p className="text-sm text-muted-foreground">Gestão de pessoas e fichas cadastrais</p>
          </div>
          <div className="flex gap-2">
            {selectedIds.length > 0 && (
              <Button variant="destructive" onClick={handleBulkDelete} className="gap-2">
                <Trash2 className="h-4 w-4" /> Apagar Permanentemente ({selectedIds.length})
              </Button>
            )}
            <Button variant="outline" onClick={() => setImportExportOpen(true)} className="gap-2"><FileSpreadsheet className="h-4 w-4" /> Importar / Exportar</Button>
            <Button onClick={openNew} className="gap-2"><Plus className="h-4 w-4" /> Novo Colaborador</Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total (sem desligados)", value: stats.total, color: "text-foreground", filter: "sem_desligados" },
            { label: "Ativos", value: stats.ativos, color: "text-green-600", filter: "ativo" },
            { label: "Afastados", value: stats.afastados, color: "text-yellow-600", filter: "afastado" },
            { label: "Desligados", value: stats.desligados, color: "text-red-600", filter: "desligado" },
          ].map(s => (
            <Card key={s.label} className="cursor-pointer hover:border-primary transition-colors" onClick={() => setStatusFilter(s.filter)}>
              <CardContent className="p-4 text-center">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Alerta de vencimento de CNH (motorista/entregador) */}
        {cnhAlerts.length > 0 && (
          <Card className="border-orange-300 bg-orange-500/5">
            <CardContent className="p-4 space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-2 text-orange-700">
                <AlertTriangle className="h-4 w-4" /> CNH vencida ou próxima do vencimento ({cnhAlerts.length})
              </h3>
              <div className="space-y-1">
                {cnhAlerts.map((e: any) => (
                  <div key={e.id} className="flex items-center justify-between text-sm p-2 rounded-md bg-background border cursor-pointer hover:border-orange-400"
                    onClick={() => openEdit(e)}>
                    <span className="font-medium">{e.full_name} <span className="text-xs text-muted-foreground font-normal">({e.position})</span></span>
                    <Badge variant="outline" className={e.cnhDays < 0 ? "text-red-700 border-red-300 bg-red-500/10" : "text-orange-700 border-orange-300 bg-orange-500/10"}>
                      {e.cnhDays < 0 ? `Vencida há ${Math.abs(e.cnhDays)} dia(s)` : e.cnhDays === 0 ? "Vence hoje" : `Vence em ${e.cnhDays} dia(s)`}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar por nome, CPF ou e-mail..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={companyFilter} onValueChange={setCompanyFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Empresa" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas Empresas</SelectItem>
              {companies.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.trade_name || c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sem_desligados">Ativos e afastados</SelectItem>
              <SelectItem value="all">Todos (incl. desligados)</SelectItem>
              <SelectItem value="ativo">Ativo</SelectItem>
              <SelectItem value="afastado">Afastado</SelectItem>
              <SelectItem value="ferias">Férias</SelectItem>
              <SelectItem value="desligado">Desligado</SelectItem>
            </SelectContent>
          </Select>
          <Select value={profileFilter} onValueChange={setProfileFilter}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos Perfis</SelectItem>
              <SelectItem value="promotor">Promotor</SelectItem>
              <SelectItem value="promotor_access">Com Acesso App</SelectItem>
              <SelectItem value="administrativo">Administrativo</SelectItem>
              <SelectItem value="supervisor">Supervisor</SelectItem>
              <SelectItem value="operacional">Operacional</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => setShowSensitive(!showSensitive)} title={showSensitive ? "Ocultar dados sensíveis" : "Mostrar dados sensíveis"}>
            {showSensitive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </Button>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox 
                      checked={selectedIds.length === employees.length && employees.length > 0} 
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead className="hidden md:table-cell">CPF</TableHead>
                  <TableHead className="hidden md:table-cell">Cargo</TableHead>
                  <TableHead className="hidden lg:table-cell">Vínculo</TableHead>
                  <TableHead className="hidden lg:table-cell">Departamento</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-32">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
                ) : employees.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Nenhum colaborador encontrado</TableCell></TableRow>
                ) : employees.map((emp: any) => (
                  <TableRow key={emp.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openEdit(emp)}>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox 
                        checked={selectedIds.includes(emp.id)} 
                        onCheckedChange={() => toggleSelect(emp.id)} 
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <UserCircle className="h-8 w-8 text-muted-foreground" />
                        <div>
                          <p className="font-medium">{emp.full_name}</p>
                          <p className="text-xs text-muted-foreground">{emp.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm">{maskCPF(emp.cpf)}</TableCell>
                    <TableCell className="hidden md:table-cell text-sm">{emp.position || "—"}</TableCell>
                    <TableCell className="hidden lg:table-cell"><Badge variant="outline" className="text-xs">{EMPLOYMENT_LABELS[emp.employment_type] || emp.employment_type}</Badge></TableCell>
                    <TableCell className="hidden lg:table-cell text-sm">{emp.department_name || "—"}</TableCell>
                    <TableCell><Badge className={STATUS_COLORS[emp.status] || ""}>{emp.status}</Badge></TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" title="Trilha / histórico do colaborador" onClick={e => { e.stopPropagation(); setHistoryEmployee({ id: emp.id, name: emp.full_name }); setHistoryOpen(true); }}><HistoryIcon className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" title="Histórico de notificações" onClick={e => { e.stopPropagation(); setNotifEmployee({ id: emp.id, name: emp.full_name }); setNotifOpen(true); }}><Bell className="h-4 w-4" /></Button>

                        <Button variant="ghost" size="icon" onClick={e => { e.stopPropagation(); openEdit(emp); }}><Edit className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={e => { e.stopPropagation(); handleDelete(emp.id); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Employee Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl p-0 gap-0 w-screen h-[100dvh] max-h-[100dvh] sm:w-full sm:h-auto sm:max-h-[95vh] rounded-none sm:rounded-lg flex flex-col">
          <DialogHeader className="p-4 sm:p-6 pb-3 border-b shrink-0 space-y-1">
            <DialogTitle className="text-base sm:text-lg pr-8">{editId ? "Editar Colaborador" : "Novo Colaborador"}</DialogTitle>
            {form.birth_date && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span>Idade: <strong className="text-foreground">{calcAge(form.birth_date)}</strong></span>
              </div>
            )}
          </DialogHeader>
          <Tabs defaultValue="pessoal" className="flex-1 flex flex-col overflow-hidden">
            <div className="overflow-x-auto scrollbar-none border-b shrink-0">
              <TabsList className="flex sm:grid sm:grid-cols-5 w-max sm:w-full min-w-full px-4 sm:px-6 h-auto bg-transparent rounded-none gap-1 py-2">
                <TabsTrigger value="pessoal" className="flex-shrink-0">Pessoal</TabsTrigger>
                <TabsTrigger value="profissional" className="flex-shrink-0">Profissional</TabsTrigger>
                <TabsTrigger value="remuneracao" className="flex-shrink-0 gap-1"><DollarSign className="h-3 w-3" />Remuneração</TabsTrigger>
                <TabsTrigger value="documentos" className="flex-shrink-0">Documentos</TabsTrigger>
                <TabsTrigger value="bancario" className="flex-shrink-0">Bancário</TabsTrigger>
              </TabsList>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">



            <TabsContent value="pessoal" className="space-y-3 mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><Label>Nome Completo *</Label><Input value={form.full_name} onChange={e => setField("full_name", e.target.value)} /></div>
                <div><Label>Nome Social</Label><Input value={form.social_name} onChange={e => setField("social_name", e.target.value)} /></div>
                <div>
                  <Label>CPF</Label>
                  <Input
                    value={form.cpf}
                    onChange={e => handleCPFChange(e.target.value)}
                    placeholder="000.000.000-00"
                    maxLength={14}
                    className={cpfError ? "border-destructive" : ""}
                  />
                  {cpfError && <p className="text-xs text-destructive mt-1">{cpfError}</p>}
                </div>
                <div><Label>RG</Label><Input value={form.rg} onChange={e => setField("rg", e.target.value)} /></div>
                <div>
                  <Label>Data de Nascimento</Label>
                  <Input type="date" value={form.birth_date} onChange={e => setField("birth_date", e.target.value)} />
                  {form.birth_date && (
                    <p className="text-xs text-muted-foreground mt-1">{calcAge(form.birth_date)}</p>
                  )}
                </div>
                <div><Label>Gênero</Label>
                  <Select value={form.gender} onValueChange={v => setField("gender", v)}>
                    <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="masculino">Masculino</SelectItem>
                      <SelectItem value="feminino">Feminino</SelectItem>
                      <SelectItem value="outro">Outro</SelectItem>
                      <SelectItem value="nao_informar">Prefiro não informar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>E-mail</Label><Input type="email" value={form.email} onChange={e => setField("email", e.target.value)} /></div>
                <div><Label>Telefone</Label><Input placeholder="(00) 00000-0000" value={form.phone} onChange={e => {
                  let v = e.target.value.replace(/\D/g, "").slice(0, 11);
                  if (v.length > 6) v = `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`;
                  else if (v.length > 2) v = `(${v.slice(0,2)}) ${v.slice(2)}`;
                  else if (v.length > 0) v = `(${v}`;
                  setField("phone", v);
                }} /></div>
              </div>

              {/* Endereço com CEP auto-fill */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label>CEP</Label>
                  <div className="relative">
                    <Input
                      value={form.zip_code}
                      onChange={e => {
                        const formatted = formatCEP(e.target.value);
                        setField("zip_code", formatted);
                        if (formatted.replace(/\D/g, "").length === 8) {
                          lookupCEP(formatted);
                        }
                      }}
                      placeholder="00000-000"
                      maxLength={9}
                    />
                    {cepLoading && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
                  </div>
                </div>
                <div className="md:col-span-2"><Label>Endereço</Label><Input value={form.address} onChange={e => setField("address", e.target.value)} /></div>
                <div><Label>Número</Label><Input value={form.address_number} onChange={e => setField("address_number", e.target.value)} /></div>
                <div><Label>Complemento</Label><Input value={form.complement} onChange={e => setField("complement", e.target.value)} /></div>
                <div><Label>Bairro</Label><Input value={form.neighborhood} onChange={e => setField("neighborhood", e.target.value)} /></div>
                <div><Label>Cidade</Label><Input value={form.city} onChange={e => setField("city", e.target.value)} /></div>
                <div><Label>Estado</Label><Input value={form.state} onChange={e => setField("state", e.target.value)} maxLength={2} /></div>
              </div>
            </TabsContent>

            <TabsContent value="profissional" className="space-y-3 mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><Label>Matrícula</Label><Input value={form.registration_number} onChange={e => setField("registration_number", e.target.value)} /></div>
                <div>
                  <div className="flex items-center justify-between">
                    <Label>Cargo</Label>
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1" onClick={() => setShowPosManager(!showPosManager)}>
                      <Briefcase className="h-3 w-3" /> Gerenciar
                    </Button>
                  </div>
                  <Select value={form.position || ""} onValueChange={v => setField("position", v)}>
                    <SelectTrigger><SelectValue placeholder="Selecionar cargo" /></SelectTrigger>
                    <SelectContent className="max-h-[50vh] overflow-y-auto">
                      {positions.map((p: any) => <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>)}
                      {positions.length === 0 && <p className="text-xs text-muted-foreground text-center py-2">Nenhum cargo cadastrado</p>}
                    </SelectContent>
                  </Select>
                  {showPosManager && (
                    <div className="mt-2 p-3 border rounded-lg bg-muted/30 space-y-2">
                      <p className="text-xs font-medium">Cargos cadastrados:</p>
                      <div className="flex flex-wrap gap-1">
                        {positions.map((p: any) => (
                          <Badge key={p.id} variant="secondary" className="gap-1 pr-1">
                            {p.name}
                            <button onClick={() => deletePosMut.mutate(p.id)} className="ml-1 hover:text-destructive"><X className="h-3 w-3" /></button>
                          </Badge>
                        ))}
                      </div>
                      <div className="flex gap-1">
                        <Input value={newPosName} onChange={e => setNewPosName(e.target.value)} placeholder="Novo cargo..." className="h-8 text-sm" />
                        <Button size="sm" className="h-8 shrink-0" disabled={!newPosName.trim() || createPosMut.isPending}
                          onClick={async () => { await createPosMut.mutateAsync({ name: newPosName.trim() }); setNewPosName(""); }}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <Label>Perfil Funcional</Label>
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1" onClick={() => setShowProfileManager(!showProfileManager)}>
                      <UserCog className="h-3 w-3" /> Gerenciar
                    </Button>
                  </div>
                  <Select value={form.worker_profile || ""} onValueChange={v => setField("worker_profile", v)}>
                    <SelectTrigger><SelectValue placeholder="Selecionar perfil" /></SelectTrigger>
                    <SelectContent>
                      {/* Default profiles */}
                      {Object.entries(PROFILE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                      {/* Custom profiles */}
                      {workerProfiles.filter((p: any) => !Object.keys(PROFILE_LABELS).includes(p.name)).map((p: any) => (
                        <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {showProfileManager && (
                    <div className="mt-2 p-3 border rounded-lg bg-muted/30 space-y-2">
                      <p className="text-xs font-medium">Perfis cadastrados:</p>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(PROFILE_LABELS).map(([k, v]) => (
                          <Badge key={k} variant="outline" className="gap-1">{v}</Badge>
                        ))}
                        {workerProfiles.map((p: any) => (
                          <Badge key={p.id} variant="secondary" className="gap-1 pr-1">
                            {p.name}
                            <button onClick={() => deleteProfileMut.mutate(p.id)} className="ml-1 hover:text-destructive"><X className="h-3 w-3" /></button>
                          </Badge>
                        ))}
                      </div>
                      <div className="flex gap-1">
                        <Input value={newProfileName} onChange={e => setNewProfileName(e.target.value)} placeholder="Novo perfil..." className="h-8 text-sm" />
                        <Button size="sm" className="h-8 shrink-0" disabled={!newProfileName.trim() || createProfileMut.isPending}
                          onClick={async () => { await createProfileMut.mutateAsync({ name: newProfileName.trim() }); setNewProfileName(""); }}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
                <div><Label>Tipo de Vínculo</Label>
                  <Select value={form.employment_type} onValueChange={v => setField("employment_type", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(EMPLOYMENT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <Label>Departamento</Label>
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1" onClick={() => setShowDeptManager(!showDeptManager)}>
                      <Building2 className="h-3 w-3" /> Gerenciar
                    </Button>
                  </div>
                  <Select value={form.department_id || ""} onValueChange={v => setField("department_id", v)}>
                    <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                    <SelectContent>
                      {departments.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                      {departments.length === 0 && <p className="text-xs text-muted-foreground text-center py-2">Nenhum departamento cadastrado</p>}
                    </SelectContent>
                  </Select>
                  {showDeptManager && (
                    <div className="mt-2 p-3 border rounded-lg bg-muted/30 space-y-2">
                      <p className="text-xs font-medium">Departamentos cadastrados:</p>
                      <div className="flex flex-wrap gap-1">
                        {departments.map((d: any) => (
                          <Badge key={d.id} variant="secondary" className="gap-1 pr-1">
                            {d.name}
                            <button onClick={() => deleteDeptMut.mutate(d.id)} className="ml-1 hover:text-destructive"><X className="h-3 w-3" /></button>
                          </Badge>
                        ))}
                      </div>
                      <div className="flex gap-1">
                        <Input value={newDeptName} onChange={e => setNewDeptName(e.target.value)} placeholder="Novo departamento..." className="h-8 text-sm" />
                        <Button size="sm" className="h-8 shrink-0" disabled={!newDeptName.trim() || createDeptMut.isPending}
                          onClick={async () => { await createDeptMut.mutateAsync({ name: newDeptName.trim() }); setNewDeptName(""); }}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <Label>Empresa (Holding)</Label>
                  <Select value={form.company_id || ""} onValueChange={v => setField("company_id", v)}>
                    <SelectTrigger><SelectValue placeholder="Selecionar empresa" /></SelectTrigger>
                    <SelectContent>
                      {companies.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.trade_name || c.name}</SelectItem>)}
                      {companies.length === 0 && <p className="text-xs text-muted-foreground text-center py-2">Nenhuma empresa cadastrada</p>}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <Label>Filial</Label>
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1" onClick={() => setShowBranchManager(!showBranchManager)}>
                      <MapPin className="h-3 w-3" /> Gerenciar
                    </Button>
                  </div>
                  <Select value={form.branch_id || ""} onValueChange={v => setField("branch_id", v)}>
                    <SelectTrigger><SelectValue placeholder="Selecionar filial" /></SelectTrigger>
                    <SelectContent>
                      {branches.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                      {branches.length === 0 && <p className="text-xs text-muted-foreground text-center py-2">Nenhuma filial cadastrada</p>}
                    </SelectContent>
                  </Select>
                  {showBranchManager && (
                    <div className="mt-2 p-3 border rounded-lg bg-muted/30 space-y-2">
                      <p className="text-xs font-medium">Filiais cadastradas:</p>
                      <div className="flex flex-wrap gap-1">
                        {branches.map((b: any) => (
                          <Badge key={b.id} variant="secondary" className="gap-1 pr-1">
                            {b.name}
                            <button onClick={() => deleteBranchMut.mutate(b.id)} className="ml-1 hover:text-destructive"><X className="h-3 w-3" /></button>
                          </Badge>
                        ))}
                      </div>
                      <div className="flex gap-1">
                        <Input value={newBranchName} onChange={e => setNewBranchName(e.target.value)} placeholder="Nova filial..." className="h-8 text-sm" />
                        <Button size="sm" className="h-8 shrink-0" disabled={!newBranchName.trim() || createBranchMut.isPending}
                          onClick={async () => { await createBranchMut.mutateAsync({ name: newBranchName.trim() }); setNewBranchName(""); }}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
                <div><Label>Salário Mensal (R$)</Label><Input type="number" value={form.salary} onChange={e => setField("salary", e.target.value)} /></div>

                {/* ====== JORNADA DE TRABALHO DETALHADA ====== */}
                <div className="col-span-2 space-y-3 p-4 rounded-lg border bg-muted/30">
                  <Label className="text-sm font-semibold flex items-center gap-2"><Calendar className="h-4 w-4" /> Jornada de Trabalho</Label>
                  {(() => {
                    const sched = form.work_schedule && typeof form.work_schedule === "object" ? form.work_schedule : parseSchedule(form.work_schedule);
                    const updateSched = (patch: any) => setField("work_schedule", { ...sched, ...patch });
                    const toggleDay = (day: string) => updateSched({ days: { ...sched.days, [day]: !sched.days[day] } });

                    const stats = calcScheduleHours(sched);
                    const hourlyRate = stats.monthlyHours > 0 && form.salary ? parseFloat(form.salary) / stats.monthlyHours : 0;

                    return (
                      <>
                        {/* Days of week toggles */}
                        <div className="flex flex-wrap gap-2">
                          {WEEKDAYS.map(wd => (
                            <button key={wd.key} type="button" onClick={() => toggleDay(wd.key)}
                              className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                                sched.days[wd.key]
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-muted text-muted-foreground border-border hover:bg-accent"
                              }`}>
                              {wd.label}
                            </button>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Dias trabalhados: {Object.entries(sched.days).filter(([,v]) => v).map(([k]) => WEEKDAYS.find(w => w.key === k)?.label).join(", ") || "Nenhum"}
                          {" · "}Folga: {Object.entries(sched.days).filter(([,v]) => !v).map(([k]) => WEEKDAYS.find(w => w.key === k)?.label).join(", ") || "Nenhuma"}
                        </p>

                        {/* Toggle padrão / por dia */}
                        <div className="flex items-center gap-2 pt-1">
                          <input
                            id="per-day-toggle"
                            type="checkbox"
                            checked={!!sched.per_day_enabled}
                            onChange={e => {
                              const enabled = e.target.checked;
                              const per_day = { ...(sched.per_day || {}) };
                              if (enabled) {
                                Object.entries(sched.days).forEach(([d, active]) => {
                                  if (active && !per_day[d]) {
                                    per_day[d] = { entry: sched.entry, exit: sched.exit, lunch_start: sched.lunch_start, lunch_end: sched.lunch_end };
                                  }
                                });
                              }
                              updateSched({ per_day_enabled: enabled, per_day });
                            }}
                            className="h-4 w-4"
                          />
                          <Label htmlFor="per-day-toggle" className="text-xs cursor-pointer">Horário diferente por dia</Label>
                        </div>

                        {!sched.per_day_enabled ? (
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div><Label className="text-xs">Entrada</Label><Input type="time" value={sched.entry} onChange={e => updateSched({ entry: e.target.value })} /></div>
                            <div><Label className="text-xs">Saída</Label><Input type="time" value={sched.exit} onChange={e => updateSched({ exit: e.target.value })} /></div>
                            <div><Label className="text-xs">Início Almoço</Label><Input type="time" value={sched.lunch_start} onChange={e => updateSched({ lunch_start: e.target.value })} /></div>
                            <div><Label className="text-xs">Fim Almoço</Label><Input type="time" value={sched.lunch_end} onChange={e => updateSched({ lunch_end: e.target.value })} /></div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {WEEKDAYS.filter(wd => sched.days[wd.key]).map(wd => {
                              const t = sched.per_day?.[wd.key] || { entry: sched.entry, exit: sched.exit, lunch_start: sched.lunch_start, lunch_end: sched.lunch_end };
                              const setT = (patch: any) => updateSched({ per_day: { ...(sched.per_day || {}), [wd.key]: { ...t, ...patch } } });
                              return (
                                <div key={wd.key} className="grid grid-cols-[50px_1fr_1fr_1fr_1fr] gap-2 items-center p-2 rounded border bg-background">
                                  <span className="text-xs font-semibold text-primary">{wd.label}</span>
                                  <div><Label className="text-[10px] text-muted-foreground">Entrada</Label><Input type="time" value={t.entry} onChange={e => setT({ entry: e.target.value })} className="h-8" /></div>
                                  <div><Label className="text-[10px] text-muted-foreground">Saída</Label><Input type="time" value={t.exit} onChange={e => setT({ exit: e.target.value })} className="h-8" /></div>
                                  <div><Label className="text-[10px] text-muted-foreground">Ini. Almoço</Label><Input type="time" value={t.lunch_start} onChange={e => setT({ lunch_start: e.target.value })} className="h-8" /></div>
                                  <div><Label className="text-[10px] text-muted-foreground">Fim Almoço</Label><Input type="time" value={t.lunch_end} onChange={e => setT({ lunch_end: e.target.value })} className="h-8" /></div>
                                </div>
                              );
                            })}
                            {Object.values(sched.days).every(v => !v) && (
                              <p className="text-xs text-muted-foreground italic">Selecione ao menos um dia trabalhado acima.</p>
                            )}
                          </div>
                        )}

                        {/* Calculated stats */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-lg bg-background border">
                          <div className="text-center">
                            <p className="text-xs text-muted-foreground">Horas/Dia (méd.)</p>
                            <p className="text-sm font-semibold">{stats.dailyHours.toFixed(1)}h</p>
                          </div>
                          <div className="text-center">
                            <p className="text-xs text-muted-foreground">Dias/Semana</p>
                            <p className="text-sm font-semibold">{stats.workDays}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-xs text-muted-foreground">Horas/Mês ({stats.monthlyWorkDays}d)</p>
                            <p className="text-sm font-semibold">{stats.monthlyHours.toFixed(0)}h</p>
                          </div>
                          <div className="text-center">
                            <p className="text-xs text-muted-foreground">Valor/Hora</p>
                            <p className="text-sm font-semibold text-primary">R$ {hourlyRate.toFixed(2)}</p>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>

                <div><Label>Data de Admissão</Label><Input type="date" value={form.admission_date} onChange={e => setField("admission_date", e.target.value)} /></div>
                <div><Label>Supervisor / Responsável</Label>
                  <Select value={form.direct_manager_id || "__none__"} onValueChange={v => setField("direct_manager_id", v === "__none__" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="Selecionar supervisor" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Nenhum</SelectItem>
                      {employees.filter((e: any) => e.id !== editId && (e.worker_profile === 'supervisor' || e.worker_profile === 'administrativo')).map((e: any) => (
                        <SelectItem key={e.id} value={e.id}>{e.full_name} ({e.position || e.worker_profile})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Status</Label>
                  <Select value={form.status} onValueChange={v => setField("status", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ativo">Ativo</SelectItem>
                      <SelectItem value="afastado">Afastado</SelectItem>
                      <SelectItem value="ferias">Férias</SelectItem>
                      <SelectItem value="suspenso">Suspenso</SelectItem>
                      <SelectItem value="desligado">Desligado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="md:col-span-2">
                  <Label>Validação Facial (este colaborador)</Label>
                  <Select
                    value={form.facial_required === true ? "always" : form.facial_required === false ? "never" : "default"}
                    onValueChange={v => setField("facial_required", v === "always" ? true : v === "never" ? false : null)}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Seguir configuração da organização (padrão)</SelectItem>
                      <SelectItem value="always">Sempre exigir biometria facial</SelectItem>
                      <SelectItem value="never">Dispensar — não exigir facial</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Substitui a configuração global de RH → Biometria Facial apenas para este colaborador.
                  </p>
                </div>

                {/* Acesso App Promotor */}
                {editId && <PromotorAccessToggle employeeId={editId} />}
              </div>
            </TabsContent>

            {/* ===== ABA REMUNERAÇÃO ===== */}
            <TabsContent value="remuneracao" className="space-y-4 mt-4">
              {/* Composição Salarial */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold flex items-center gap-2"><DollarSign className="h-4 w-4 text-primary" /> Composição Salarial</h3>
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1"
                    onClick={() => setForm((p: any) => ({
                      ...p,
                      salary_items: [...(p.salary_items || []), { type: "Salário Base", description: "", value: "" }]
                    }))}>
                    <Plus className="h-3 w-3" /> Adicionar Item
                  </Button>
                </div>
                {(form.salary_items || []).length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4 border rounded-lg border-dashed">Nenhum item de composição salarial adicionado</p>
                )}
                {(form.salary_items || []).map((item: any, idx: number) => (
                  <div key={idx} className="grid grid-cols-[1fr_1.5fr_auto_auto] gap-2 items-end p-3 rounded-lg bg-muted/30 border">
                    <div>
                      <Label className="text-xs">Tipo</Label>
                      <Select value={item.type} onValueChange={v => {
                        const items = [...form.salary_items];
                        items[idx] = { ...items[idx], type: v };
                        setField("salary_items", items);
                      }}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {SALARY_ITEM_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Descrição</Label>
                      <Input className="h-8 text-xs" placeholder="Detalhes..." value={item.description}
                        onChange={e => {
                          const items = [...form.salary_items];
                          items[idx] = { ...items[idx], description: e.target.value };
                          setField("salary_items", items);
                        }} />
                    </div>
                    <div>
                      <Label className="text-xs">Valor (R$)</Label>
                      <Input className="h-8 text-xs w-28" type="number" placeholder="0,00" value={item.value}
                        onChange={e => {
                          const items = [...form.salary_items];
                          items[idx] = { ...items[idx], value: e.target.value };
                          setField("salary_items", items);
                        }} />
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                      onClick={() => {
                        const items = form.salary_items.filter((_: any, i: number) => i !== idx);
                        setField("salary_items", items);
                      }}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                {(form.salary_items || []).length > 0 && (
                  <div className="flex justify-end p-2 rounded-lg bg-primary/5 border border-primary/20">
                    <p className="text-sm font-semibold">Total Composição: <span className="text-primary">
                      R$ {(form.salary_items || []).reduce((s: number, i: any) => s + (parseFloat(i.value) || 0), 0).toFixed(2)}
                    </span></p>
                  </div>
                )}
              </div>

              {/* Benefícios */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold flex items-center gap-2"><Gift className="h-4 w-4 text-primary" /> Benefícios</h3>
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1"
                    onClick={() => setForm((p: any) => ({
                      ...p,
                      benefits: [...(p.benefits || []), { type: "Vale Refeição", description: "", value: "", employer_cost: "" }]
                    }))}>
                    <Plus className="h-3 w-3" /> Adicionar Benefício
                  </Button>
                </div>
                {(form.benefits || []).length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4 border rounded-lg border-dashed">Nenhum benefício adicionado</p>
                )}
                {(form.benefits || []).map((ben: any, idx: number) => (
                  <div key={idx} className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-2 items-end p-3 rounded-lg bg-muted/30 border">
                    <div>
                      <Label className="text-xs">Benefício</Label>
                      <Select value={ben.type} onValueChange={v => {
                        const items = [...form.benefits];
                        items[idx] = { ...items[idx], type: v };
                        setField("benefits", items);
                      }}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {BENEFIT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Descrição</Label>
                      <Input className="h-8 text-xs" placeholder="Detalhes..." value={ben.description}
                        onChange={e => {
                          const items = [...form.benefits];
                          items[idx] = { ...items[idx], description: e.target.value };
                          setField("benefits", items);
                        }} />
                    </div>
                    <div>
                      <Label className="text-xs">Valor (R$)</Label>
                      <Input className="h-8 text-xs w-24" type="number" placeholder="0,00" value={ben.value}
                        onChange={e => {
                          const items = [...form.benefits];
                          items[idx] = { ...items[idx], value: e.target.value };
                          setField("benefits", items);
                        }} />
                    </div>
                    <div>
                      <Label className="text-xs">Custo Empresa</Label>
                      <Input className="h-8 text-xs w-24" type="number" placeholder="0,00" value={ben.employer_cost}
                        onChange={e => {
                          const items = [...form.benefits];
                          items[idx] = { ...items[idx], employer_cost: e.target.value };
                          setField("benefits", items);
                        }} />
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                      onClick={() => {
                        const items = form.benefits.filter((_: any, i: number) => i !== idx);
                        setField("benefits", items);
                      }}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                {(form.benefits || []).length > 0 && (
                  <div className="flex justify-between p-2 rounded-lg bg-primary/5 border border-primary/20 text-sm">
                    <p className="font-semibold">Total Benefícios: <span className="text-primary">
                      R$ {(form.benefits || []).reduce((s: number, i: any) => s + (parseFloat(i.value) || 0), 0).toFixed(2)}
                    </span></p>
                    <p className="font-semibold">Custo Empresa: <span className="text-destructive">
                      R$ {(form.benefits || []).reduce((s: number, i: any) => s + (parseFloat(i.employer_cost) || 0), 0).toFixed(2)}
                    </span></p>
                  </div>
                )}
              </div>

              {/* Descontos Fixos */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold flex items-center gap-2"><Trash2 className="h-4 w-4 text-destructive" /> Descontos</h3>
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1"
                    onClick={() => setForm((p: any) => ({
                      ...p,
                      deductions: [...(p.deductions || []), { type: "Convênio", description: "", value: "" }]
                    }))}>
                    <Plus className="h-3 w-3" /> Adicionar Desconto
                  </Button>
                </div>
                {(form.deductions || []).length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4 border rounded-lg border-dashed">Nenhum desconto fixo adicionado</p>
                )}
                {(form.deductions || []).map((item: any, idx: number) => (
                  <div key={idx} className="grid grid-cols-[1fr_1.5fr_auto_auto] gap-2 items-end p-3 rounded-lg bg-muted/30 border">
                    <div>
                      <Label className="text-xs">Tipo</Label>
                      <Select value={item.type} onValueChange={v => {
                        const items = [...form.deductions];
                        items[idx] = { ...items[idx], type: v };
                        setField("deductions", items);
                      }}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {DEDUCTION_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Descrição</Label>
                      <Input className="h-8 text-xs" placeholder="Detalhes..." value={item.description}
                        onChange={e => {
                          const items = [...form.deductions];
                          items[idx] = { ...items[idx], description: e.target.value };
                          setField("deductions", items);
                        }} />
                    </div>
                    <div>
                      <Label className="text-xs">Valor (R$)</Label>
                      <Input className="h-8 text-xs w-28" type="number" placeholder="0,00" value={item.value}
                        onChange={e => {
                          const items = [...form.deductions];
                          items[idx] = { ...items[idx], value: e.target.value };
                          setField("deductions", items);
                        }} />
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                      onClick={() => {
                        const items = form.deductions.filter((_: any, i: number) => i !== idx);
                        setField("deductions", items);
                      }}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                {(form.deductions || []).length > 0 && (
                  <div className="flex justify-end p-2 rounded-lg bg-destructive/5 border border-destructive/20">
                    <p className="text-sm font-semibold">Total Descontos: <span className="text-destructive">
                      R$ {(form.deductions || []).reduce((s: number, i: any) => s + (parseFloat(i.value) || 0), 0).toFixed(2)}
                    </span></p>
                  </div>
                )}
              </div>

              {/* Resumo Geral */}
              {((form.salary_items || []).length > 0 || (form.benefits || []).length > 0 || (form.deductions || []).length > 0) && (
                <div className="p-3 rounded-lg bg-primary/10 border border-primary/30 space-y-1">
                  <h4 className="text-sm font-bold text-primary">Resumo da Remuneração</h4>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div>
                      <p className="text-xs text-muted-foreground">Composição Salarial</p>
                      <p className="font-semibold text-sm">R$ {(form.salary_items || []).reduce((s: number, i: any) => s + (parseFloat(i.value) || 0), 0).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Benefícios</p>
                      <p className="font-semibold text-sm">R$ {(form.benefits || []).reduce((s: number, i: any) => s + (parseFloat(i.value) || 0), 0).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Descontos</p>
                      <p className="font-semibold text-sm text-destructive">- R$ {(form.deductions || []).reduce((s: number, i: any) => s + (parseFloat(i.value) || 0), 0).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Total Líquido</p>
                      <p className="font-bold text-sm text-primary">R$ {(
                        (form.salary_items || []).reduce((s: number, i: any) => s + (parseFloat(i.value) || 0), 0) +
                        (form.benefits || []).reduce((s: number, i: any) => s + (parseFloat(i.value) || 0), 0) -
                        (form.deductions || []).reduce((s: number, i: any) => s + (parseFloat(i.value) || 0), 0)
                      ).toFixed(2)}</p>
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="documentos" className="space-y-4 mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><Label>CTPS Número</Label><Input value={form.ctps_number} onChange={e => setField("ctps_number", e.target.value)} /></div>
                <div><Label>PIS/PASEP</Label><Input value={form.pis_pasep} onChange={e => setField("pis_pasep", e.target.value)} /></div>
                {form.employment_type === "pj" && (
                  <>
                    <div><Label>CNPJ</Label><Input value={form.cnpj} onChange={e => setField("cnpj", e.target.value)} /></div>
                    <div><Label>Razão Social</Label><Input value={form.company_name} onChange={e => setField("company_name", e.target.value)} /></div>
                  </>
                )}
              </div>

              <div className="border-t pt-4">
                <Label className="text-sm font-semibold flex items-center gap-2 mb-2">
                  <FileText className="h-4 w-4" /> Arquivos do Colaborador
                </Label>
                {editId ? (
                  <EmployeeDocumentsManager employeeId={editId} />
                ) : (
                  <p className="text-sm text-muted-foreground p-4 border border-dashed rounded-lg text-center">
                    Salve o colaborador primeiro para anexar documentos.
                  </p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="bancario" className="space-y-3 mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><Label>Banco</Label><Input value={form.bank_name} onChange={e => setField("bank_name", e.target.value)} /></div>
                <div><Label>Agência</Label><Input value={form.bank_agency} onChange={e => setField("bank_agency", e.target.value)} /></div>
                <div><Label>Conta</Label><Input value={form.bank_account} onChange={e => setField("bank_account", e.target.value)} /></div>
                <div><Label>Tipo de Conta</Label>
                  <Select value={form.bank_account_type || ""} onValueChange={v => setField("bank_account_type", v)}>
                    <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="corrente">Corrente</SelectItem>
                      <SelectItem value="poupanca">Poupança</SelectItem>
                      <SelectItem value="salario">Conta Salário</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="border-t pt-3 space-y-3">
                <Label className="text-sm font-semibold flex items-center gap-2">
                  <KeyRound className="h-4 w-4" /> Chave PIX
                </Label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <Label>Tipo da Chave</Label>
                    <Select value={form.pix_key_type || ""} onValueChange={v => setField("pix_key_type", v)}>
                      <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cpf">CPF</SelectItem>
                        <SelectItem value="cnpj">CNPJ</SelectItem>
                        <SelectItem value="email">E-mail</SelectItem>
                        <SelectItem value="telefone">Telefone</SelectItem>
                        <SelectItem value="aleatoria">Chave Aleatória</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-2">
                    <Label>Chave PIX</Label>
                    <Input value={form.pix_key} onChange={e => setField("pix_key", e.target.value)} placeholder="Digite a chave PIX" />
                  </div>
                </div>
              </div>
            </TabsContent>
            </div>
          </Tabs>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 p-4 sm:p-6 border-t bg-background shrink-0" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="w-full sm:w-auto">Cancelar</Button>
            <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending} className="w-full sm:w-auto">
              {createMut.isPending || updateMut.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </div>


        </DialogContent>
      </Dialog>
      <EmployeeNotificationsDialog
        open={notifOpen}
        onOpenChange={setNotifOpen}
        employeeId={notifEmployee?.id}
        employeeName={notifEmployee?.name}
      />
      <EmployeeHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        employeeId={historyEmployee?.id}
        employeeName={historyEmployee?.name}
      />

      <EmployeeImportExportDialog
        open={importExportOpen}
        onOpenChange={setImportExportOpen}
        employees={rawEmployees}
        departments={departments}
        branches={branches}
        companies={companies}
        defaultCompanyId={companyFilter !== "all" ? companyFilter : undefined}
        onImport={async (rows) => {
          for (const row of rows) {
            await createMut.mutateAsync(row);
          }
        }}
      />
    </MainLayout>
  );
}

function generateTempPassword() {
  const nums = String(Math.floor(Math.random() * 900 + 100));
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  const letters = chars[Math.floor(Math.random() * 26)] + chars[Math.floor(Math.random() * 26)];
  return `anatri${nums}${letters}`;
}

function PromotorAccessToggle({ employeeId }: { employeeId: string }) {
  const { data: access, isLoading } = useAppAccess(employeeId);
  const grantAccess = useGrantAppAccess();
  const blockAccess = useBlockAppAccess();
  const resetPassword = useResetAppPassword();
  const { toast } = useToast();
  const [generatedPass, setGeneratedPass] = React.useState<string | null>(null);

  const isEnabled = access && ['liberado', 'aguardando_login', 'ativo'].includes(access.access_status);

  const handleToggle = async (enabled: boolean) => {
    try {
      if (enabled) {
        const tempPass = generateTempPassword();
        await grantAccess.mutateAsync({ employee_id: employeeId, password: tempPass });
        setGeneratedPass(tempPass);
        toast({ title: "Acesso liberado!" });
      } else {
        await blockAccess.mutateAsync(employeeId);
        setGeneratedPass(null);
        toast({ title: "Acesso bloqueado" });
      }
    } catch {
      toast({ title: "Erro ao alterar acesso", variant: "destructive" });
    }
  };

  const handleResetPassword = async () => {
    try {
      const newPass = generateTempPassword();
      await resetPassword.mutateAsync({ employee_id: employeeId, new_password: newPass });
      setGeneratedPass(newPass);
      toast({ title: "Nova senha gerada!" });
    } catch {
      toast({ title: "Erro ao gerar nova senha", variant: "destructive" });
    }
  };

  const copyPassword = () => {
    if (generatedPass) {
      navigator.clipboard.writeText(generatedPass);
      toast({ title: "Senha copiada!" });
    }
  };

  return (
    <div className="col-span-2 space-y-2">
      <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
        <Smartphone className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <Label className="text-sm font-medium">Acesso ao App do Promotor</Label>
          <p className="text-xs text-muted-foreground">
            {isLoading ? "Carregando..." : isEnabled ? `Status: ${access.access_status} • Último login: ${access.last_login ? new Date(access.last_login).toLocaleDateString('pt-BR') : 'Nunca'}` : "Sem acesso ao aplicativo"}
          </p>
        </div>
        <Switch
          checked={!!isEnabled}
          onCheckedChange={handleToggle}
          disabled={isLoading || grantAccess.isPending || blockAccess.isPending}
        />
      </div>
      {isEnabled && (
        <Button type="button" variant="outline" size="sm" onClick={handleResetPassword} disabled={resetPassword.isPending}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${resetPassword.isPending ? 'animate-spin' : ''}`} /> Gerar nova senha
        </Button>
      )}
      {generatedPass && (
        <div className="flex items-center gap-2 p-2 rounded-md border border-primary/30 bg-primary/5">
          <KeyRound className="h-4 w-4 text-primary" />
          <span className="text-sm font-mono font-medium flex-1">{generatedPass}</span>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={copyPassword}>
            <Copy className="h-3.5 w-3.5 mr-1" /> Copiar
          </Button>
        </div>
      )}
    </div>
  );
}

// ============ Employee Documents Manager (drag & drop + naming) ============
function EmployeeDocumentsManager({ employeeId }: { employeeId: string }) {
  const { data: docs = [], isLoading } = useRhDocuments({ employee_id: employeeId });
  const createDoc = useCreateRhDocument();
  const deleteDoc = useDeleteRhDocument();
  const { toast } = useToast();
  const [isDragging, setIsDragging] = React.useState(false);
  const [pending, setPending] = React.useState<{ file: File; title: string; doc_type: string }[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const DOC_TYPES = ["RG", "CPF", "CNH", "Comprovante de Residência", "CTPS", "PIS", "Título de Eleitor", "Certificado de Reservista", "Contrato", "Atestado", "Certificado", "Exame Admissional", "Outro"];

  const addFiles = (files: FileList | File[]) => {
    const arr = Array.from(files).map(f => ({
      file: f,
      title: f.name.replace(/\.[^.]+$/, ""),
      doc_type: "Outro",
    }));
    setPending(prev => [...prev, ...arr]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const { uploadFile } = useUpload();

  const handleUploadAll = async () => {
    if (!pending.length) return;
    setUploading(true);
    try {
      for (const item of pending) {
        const url = await uploadFile(item.file);
        if (!url) throw new Error("Falha no upload");
        await createDoc.mutateAsync({
          employee_id: employeeId,
          doc_type: item.doc_type,
          title: item.title || item.file.name,
          file_url: url,
          status: "aprovado",
        });
      }
      setPending([]);
      toast({ title: "Documentos enviados!" });
    } catch (err: any) {
      toast({ title: "Erro ao enviar documentos", description: err?.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 bg-muted/30"
        }`}
      >
        <FileText className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm font-medium">Arraste arquivos aqui ou clique para selecionar</p>
        <p className="text-xs text-muted-foreground mt-1">PDF, imagens, DOC, XLS (até 100MB)</p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
        />
      </div>

      {pending.length > 0 && (
        <div className="space-y-2 p-3 rounded-lg border bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase">Pendentes de envio</p>
          {pending.map((item, idx) => (
            <div key={idx} className="grid grid-cols-1 md:grid-cols-[1fr_180px_auto] gap-2 items-center p-2 border rounded-md">
              <Input
                value={item.title}
                onChange={e => setPending(prev => prev.map((p, i) => i === idx ? { ...p, title: e.target.value } : p))}
                placeholder="Nome do documento"
              />
              <Select value={item.doc_type} onValueChange={v => setPending(prev => prev.map((p, i) => i === idx ? { ...p, doc_type: v } : p))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOC_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground truncate max-w-[100px]">{item.file.name}</span>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7"
                  onClick={() => setPending(prev => prev.filter((_, i) => i !== idx))}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
          <Button type="button" size="sm" onClick={handleUploadAll} disabled={uploading} className="w-full">
            {uploading ? <><Loader2 className="h-3 w-3 mr-2 animate-spin" /> Enviando...</> : <>Enviar {pending.length} arquivo(s)</>}
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase">Documentos salvos ({docs.length})</p>
        {isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-3">Carregando...</p>
        ) : docs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-3">Nenhum documento anexado.</p>
        ) : (
          docs.map((doc: any) => (
            <div key={doc.id} className="flex items-center gap-2 p-2 border rounded-md bg-card">
              <FileText className="h-4 w-4 text-primary flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{doc.title}</p>
                <p className="text-xs text-muted-foreground">{doc.doc_type} • {new Date(doc.created_at).toLocaleDateString('pt-BR')}</p>
              </div>
              {doc.file_url && (
                <Button type="button" variant="ghost" size="sm" asChild>
                  <a href={doc.file_url} target="_blank" rel="noreferrer">Abrir</a>
                </Button>
              )}
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                onClick={() => { if (confirm("Excluir este documento?")) deleteDoc.mutate(doc.id); }}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
