import { Link, useLocation, useNavigate } from "react-router-dom";
import { APP_VERSION } from "@/version";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  Bot,
  Brain,
  Briefcase,
  Building2,
  CalendarDays,
  ChevronDown,
  Clock,
  Code,
  ClipboardList,
  FileSignature,
  FileText,
  GitBranch,
  Kanban,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Map,
  Menu,
  MessageSquare,
  MessagesSquare,
  MousePointerClick,
  Plug,
  Receipt,
  RefreshCw,
  Send,
  Settings,
  Shield,
  Sparkles,
  User,
  Users,
  UserPlus,
  UserMinus,
  Zap,
  Bell,
  Lock,
  Webhook,
  Ghost,
  FolderKanban,
  BarChart4,
  DollarSign,
  MapPin,
  Radio,
  ShoppingBag,
  Tags as TagsIcon,
  Boxes,
  Shirt,
  Inbox,
  Store,
  Camera,
  Navigation,
  ShieldCheck,
  ScanFace,
  AlertTriangle,
  HelpCircle,
  BookOpen,
  Truck,
  Route as RouteIcon,
  Package,
  Users2,
  TrendingUp,
  FileDown,
  FileUp,
  Smartphone,
} from "lucide-react";
import { API_URL, getAuthToken } from "@/lib/api";
import ayratechLogo from "@/assets/ayratech_logo.jpg";
import { useAuth } from "@/contexts/AuthContext";
import { useBranding } from "@/hooks/use-branding";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface NavItem {
  name: string;
  href: string;
  icon: any;
  pageKey?: string; // Used for permission template matching
  moduleKey?: 'campaigns' | 'billing' | 'groups' | 'scheduled_messages' | 'chatbots' | 'chat' | 'crm' | 'rh' | 'ai_agents' | 'group_secretary' | 'ghost' | 'projects' | 'lead_gleego' | 'doc_signatures' | 'merchandising';
  adminOnly?: boolean;
  ownerOnly?: boolean;
  superadminOnly?: boolean;
}

interface NavSection {
  title: string;
  icon: any;
  items: NavItem[];
  moduleKey?: 'campaigns' | 'billing' | 'groups' | 'scheduled_messages' | 'chatbots' | 'chat' | 'crm' | 'rh' | 'ai_agents' | 'group_secretary' | 'ghost' | 'projects' | 'lead_gleego' | 'doc_signatures' | 'merchandising';
  adminOnly?: boolean; // Entire section requires admin role
}

const getNavSections = (hasConnections: boolean): NavSection[] => [
  {
    title: "Atendimento",
    icon: MessagesSquare,
    moduleKey: 'chat',
    items: [
      ...(hasConnections ? [{ name: "Chat", href: "/chat", icon: MessagesSquare, pageKey: 'chat', moduleKey: 'chat' as const }] : []),
      ...(hasConnections ? [{ name: "Secretária IA", href: "/secretaria-grupos", icon: Bot, pageKey: 'secretaria_ia', moduleKey: 'chat' as const, adminOnly: true }] : []),
      { name: "Agentes IA", href: "/agentes-ia", icon: Sparkles, pageKey: 'agentes_ia', moduleKey: 'chat' as const, superadminOnly: true },
      { name: "IA Assistentes", href: "/agentes-ia-cliente", icon: Bot, pageKey: 'ia_assistentes', moduleKey: 'chat' as const },
      ...(hasConnections ? [{ name: "Chatbots", href: "/chatbots", icon: Bot, pageKey: 'chatbots', moduleKey: 'chat' as const, adminOnly: true }] : []),
      ...(hasConnections ? [{ name: "Fluxos", href: "/fluxos", icon: GitBranch, pageKey: 'fluxos', moduleKey: 'chat' as const, adminOnly: true }] : []),
      { name: "Departamentos", href: "/departamentos", icon: Building2, pageKey: 'departamentos', moduleKey: 'chat' as const, adminOnly: true },
      { name: "Agendamentos", href: "/agendamentos", icon: Bell, pageKey: 'agendamentos', moduleKey: 'chat' as const },
      { name: "Respostas Rápidas", href: "/respostas-rapidas", icon: MessageSquare, pageKey: 'respostas_rapidas', moduleKey: 'chat' as const },
      { name: "Tags", href: "/tags", icon: Receipt, pageKey: 'tags', moduleKey: 'chat' as const },
      { name: "Contatos", href: "/contatos-chat", icon: Users, pageKey: 'contatos', moduleKey: 'chat' as const },
    ],
  },
  {
    title: "CRM",
    icon: Briefcase,
    moduleKey: 'crm',
    items: [
      { name: "Negociações", href: "/crm/negociacoes", icon: Kanban, pageKey: 'crm_negociacoes' },
      { name: "Prospects", href: "/crm/prospects", icon: UserPlus, pageKey: 'crm_prospects' },
      { name: "Empresas", href: "/crm/empresas", icon: Building2, pageKey: 'crm_empresas' },
      { name: "Projetos", href: "/projetos", icon: FolderKanban, pageKey: 'projetos', moduleKey: 'projects' },
      { name: "Mapa CRM", href: "/mapa", icon: Map, pageKey: 'mapa' },
      { name: "Agenda", href: "/crm/agenda", icon: CalendarDays, pageKey: 'crm_agenda' },
      { name: "Tarefas", href: "/tarefas", icon: ClipboardList, pageKey: 'crm_tarefas' },
      { name: "Relatórios", href: "/crm/relatorios", icon: BarChart3, pageKey: 'crm_relatorios' },
      { name: "Revenue Intel", href: "/revenue-intelligence", icon: Brain, pageKey: 'revenue_intelligence', adminOnly: true },
      { name: "Fantasma", href: "/modulo-fantasma", icon: Ghost, pageKey: 'modulo_fantasma', ownerOnly: true, moduleKey: 'ghost' },
      { name: "Configurações", href: "/crm/configuracoes", icon: Settings, pageKey: 'crm_configuracoes', adminOnly: true },
    ],
  },
  {
    title: "RH",
    icon: Users,
    items: [
      { name: "Holding", href: "/rh/holding", icon: Building2, pageKey: 'rh_holding', adminOnly: true },
      { name: "Empresas", href: "/rh/empresas", icon: Building2, pageKey: 'rh_empresas', adminOnly: true },
      { name: "Dashboard", href: "/rh/dashboard", icon: LayoutDashboard, pageKey: 'rh_dashboard', moduleKey: 'rh' },
      { name: "Analytics", href: "/rh/analytics", icon: TrendingUp, pageKey: 'rh_analytics', moduleKey: 'rh' },
      { name: "Colaboradores", href: "/rh/colaboradores", icon: UserPlus, pageKey: 'rh_colaboradores', moduleKey: 'rh' },
      { name: "Admissão", href: "/rh/admissao", icon: UserPlus, pageKey: 'rh_admissao', moduleKey: 'rh' },
      { name: "Ponto", href: "/rh/ponto", icon: Clock, pageKey: 'rh_ponto', moduleKey: 'rh' },
      { name: "Relógio de Ponto (Tablet)", href: "/rh/relogio-ponto", icon: ScanFace, pageKey: 'rh_relogio_ponto', moduleKey: 'rh' },
      { name: "Holerite", href: "/rh/holerite", icon: DollarSign, pageKey: 'rh_holerite', moduleKey: 'rh' },
      { name: "Deduções / Lançamentos", href: "/rh/deducoes", icon: DollarSign, pageKey: 'rh_deducoes', moduleKey: 'rh' },
      { name: "Folha de Pagamento", href: "/rh/folha-pagamento", icon: DollarSign, pageKey: 'rh_folha_pagamento', moduleKey: 'rh' },
      { name: "Integração Folha", href: "/rh/folha-export", icon: FileDown, pageKey: 'rh_folha_export', moduleKey: 'rh' },
      { name: "Banco de Horas", href: "/rh/banco-horas", icon: Clock, pageKey: 'rh_banco_horas', moduleKey: 'rh' },
      { name: "Escalas", href: "/rh/escalas", icon: CalendarDays, pageKey: 'rh_escalas', moduleKey: 'rh' },
      { name: "Espelho Digital", href: "/rh/espelho-digital", icon: FileText, pageKey: 'rh_espelho_digital', moduleKey: 'rh' },
      { name: "Férias Coletivas", href: "/rh/ferias-coletivas", icon: CalendarDays, pageKey: 'rh_ferias_coletivas', moduleKey: 'rh' },
      { name: "Desligamento", href: "/rh/desligamento", icon: UserMinus, pageKey: 'rh_desligamento', moduleKey: 'rh' },
      { name: "Advertências", href: "/rh/advertencias", icon: AlertTriangle, pageKey: 'rh_advertencias', moduleKey: 'rh' },
      { name: "eSocial", href: "/rh/esocial", icon: FileText, pageKey: 'rh_esocial', moduleKey: 'rh' },
      { name: "Avaliações", href: "/rh/avaliacoes", icon: TrendingUp, pageKey: 'rh_avaliacoes', moduleKey: 'rh' },



      { name: "Documentos", href: "/rh/documentos", icon: FileText, pageKey: 'rh_documentos', moduleKey: 'rh' },
      { name: "Feriados", href: "/rh/feriados", icon: CalendarDays, pageKey: 'rh_feriados', moduleKey: 'rh' },
      { name: "Mapa", href: "/rh/mapa", icon: MapPin, pageKey: 'rh_mapa', moduleKey: 'rh' },
      { name: "Acessos App", href: "/rh/acessos", icon: Shield, pageKey: 'rh_acessos', moduleKey: 'rh' },
      { name: "Biometria Facial", href: "/rh/biometria", icon: ScanFace, pageKey: 'rh_biometria', moduleKey: 'rh' },
      { name: "Solicitações", href: "/rh/solicitacoes", icon: Inbox, pageKey: 'rh_solicitacoes', moduleKey: 'rh' },
      { name: "Uniformes/EPIs/Chaves", href: "/rh/itens", icon: Shirt, pageKey: 'rh_itens', moduleKey: 'rh' },
      { name: "Checklist Folha", href: "/rh/checklist-folha", icon: ClipboardList, pageKey: 'rh_checklist_folha', moduleKey: 'rh' },
      { name: "Rastreamento", href: "/rh/rastreamento", icon: Navigation, pageKey: 'rh_rastreamento', moduleKey: 'rh' },
      { name: "Logs & Erros", href: "/rh/logs", icon: Code, pageKey: 'rh_logs', moduleKey: 'rh' },
      { name: "Ajuda", href: "/rh/ajuda", icon: HelpCircle, pageKey: 'rh_ajuda', moduleKey: 'rh' },
      { name: "Documentação", href: "/rh/documentacao", icon: BookOpen, pageKey: 'rh_ajuda', moduleKey: 'rh' },
    ],
  },
  {
    title: "SmartRoute AI",
    icon: RouteIcon,
    items: [
      { name: "Dashboard", href: "/smartroute", icon: LayoutDashboard, pageKey: 'sr_dashboard' },
      { name: "Mapa ao Vivo", href: "/smartroute/mapa", icon: Map, pageKey: 'sr_mapa' },
      { name: "Torre de Controle", href: "/smartroute/monitoramento", icon: Radio, pageKey: 'sr_mapa' },
      { name: "Ocorrências & SLA", href: "/smartroute/ocorrencias", icon: AlertTriangle, pageKey: 'sr_mapa' },
      { name: "Análise Pós-Rota", href: "/smartroute/pos-analise", icon: Sparkles, pageKey: 'sr_ia' },

      { name: "Rotas Montadas", href: "/smartroute/rotas-montadas", icon: RouteIcon, pageKey: 'sr_rotas' },
      { name: "Rota do Dia", href: "/smartroute/rota-do-dia", icon: RouteIcon, pageKey: 'sr_rotas' },
      { name: "Simulador", href: "/smartroute/simulador", icon: RouteIcon, pageKey: 'sr_rotas' },
      { name: "Rotas (Legado)", href: "/smartroute/rotas", icon: RouteIcon, pageKey: 'sr_rotas' },
      { name: "Importar Romaneio", href: "/smartroute/importar-romaneio", icon: FileUp, pageKey: 'sr_rotas' },
      { name: "Planejador IA", href: "/smartroute/planejador", icon: Sparkles, pageKey: 'sr_rotas' },
      { name: "Pedidos", href: "/smartroute/pedidos", icon: Package, pageKey: 'sr_pedidos' },
      { name: "PDVs / Clientes", href: "/smartroute/pdvs", icon: Store, pageKey: 'sr_pdvs' },
      { name: "Frota", href: "/smartroute/frota", icon: Truck, pageKey: 'sr_frota' },
      { name: "Centros de Distribuição", href: "/smartroute/cds", icon: Store, pageKey: 'sr_cds' },
      { name: "Motoristas", href: "/smartroute/motoristas", icon: Users2, pageKey: 'sr_motoristas' },
      { name: "IA & Alertas", href: "/smartroute/ia", icon: Sparkles, pageKey: 'sr_ia' },
      { name: "Gestor IA", href: "/smartroute/gestor-ia", icon: Brain, pageKey: 'sr_gestor_ia' },
      { name: "Integrações", href: "/smartroute/integracoes", icon: Sparkles, pageKey: 'sr_integracoes' },
      { name: "Relatórios & BI", href: "/smartroute/relatorios", icon: BarChart3, pageKey: 'sr_relatorios' },
      { name: "Configurações", href: "/smartroute/configuracoes", icon: Settings, pageKey: 'sr_configuracoes' },
      { name: "Documentação", href: "/smartroute/documentacao", icon: BookOpen, pageKey: 'sr_dashboard' },
      { name: "Central de Apps", href: "/central-apps", icon: Smartphone, pageKey: 'sr_dashboard' },
    ],

  },
  {
    title: "Disparos",
    icon: Send,
    moduleKey: 'campaigns',
    items: [
      { name: "Listas", href: "/contatos", icon: Users, pageKey: 'listas' },
      { name: "Mensagens", href: "/mensagens", icon: MessageSquare, pageKey: 'mensagens' },
      { name: "Campanhas", href: "/campanhas", icon: Send, pageKey: 'campanhas' },
      { name: "Sequências", href: "/sequencias", icon: RefreshCw, pageKey: 'sequencias', adminOnly: true },
      { name: "Fluxos Externos", href: "/fluxos-externos", icon: FileText, pageKey: 'fluxos_externos', adminOnly: true },
      { name: "Webhooks", href: "/lead-webhooks", icon: Webhook, pageKey: 'webhooks', adminOnly: true },
      { name: "API Integração", href: "/api-docs", icon: Code, pageKey: 'api_docs', adminOnly: true },
      { name: "CTWA Analytics", href: "/ctwa-analytics", icon: MousePointerClick, pageKey: 'ctwa_analytics', adminOnly: true },
      { name: "Lead Gleego", href: "/lead-gleego", icon: BarChart4, pageKey: 'lead_gleego', moduleKey: 'lead_gleego' as const },
    ],
  },
  {
    title: "Minha Conta",
    icon: User,
    items: [
      { name: "Conexões", href: "/conexao", icon: Plug, pageKey: 'conexoes' },
      { name: "Templates Meta", href: "/meta-templates", icon: FileText, pageKey: 'meta_templates' },
      { name: "Assinaturas", href: "/assinaturas", icon: FileSignature, pageKey: 'assinaturas', moduleKey: 'doc_signatures' as const },
      { name: "Ajustes", href: "/configuracoes", icon: Settings, pageKey: 'ajustes' },
    ],
  },
  {
    title: "Administração",
    icon: Shield,
    adminOnly: true,
    items: [
      { name: "Cobrança", href: "/cobranca", icon: Receipt, pageKey: 'cobranca', moduleKey: 'billing' },
      { name: "Organizações", href: "/organizacoes", icon: Building2, pageKey: 'organizacoes' },
    ],
  },
];

interface SidebarContentProps {
  isExpanded: boolean;
  isSuperadmin: boolean;
  onNavigate?: () => void;
}

function SidebarContentComponent({ isExpanded, isSuperadmin, onNavigate }: SidebarContentProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user, modulesEnabled, pagePermissions } = useAuth();
  const { branding } = useBranding();
  // Start all sections collapsed; auto-open only the one with the active route
  const [openSections, setOpenSections] = useState<string[]>(["RH"]);

  // Helper to check if user has admin-level role
  const normalizedRole = (user?.role || '').toLowerCase();
  const userIsSuperadmin = isSuperadmin || user?.is_superadmin === true || normalizedRole === 'superadmin';
  const isAdminRole = (role?: string) => ['owner', 'admin', 'manager', 'superadmin'].includes((role || '').toLowerCase());
  const isOwnerRole = (role?: string) => ['owner', 'superadmin'].includes((role || '').toLowerCase());
  const userIsAdmin = userIsSuperadmin || isAdminRole(user?.role);
  const userIsOwner = userIsSuperadmin || isOwnerRole(user?.role);
  const hasConnections = user?.has_connections !== false; // default true if undefined
  const hasTemplate = !!pagePermissions; // User has a permission template assigned

  const navSections = getNavSections(hasConnections);

  // Filter sections and items based on modules enabled, role, AND permission template
  const filteredSections = navSections
    .filter(section => {
      // Check module access
      if (section.moduleKey && !modulesEnabled[section.moduleKey] && !userIsSuperadmin) return false;
      // If user has a permission template, don't filter by adminOnly for sections
      if (!hasTemplate) {
        if (section.adminOnly && !userIsAdmin) return false;
      }
      return true;
    })
    .map(section => ({
      ...section,
      items: section.items.filter(item => {
        // Check module access
        if (item.moduleKey && !modulesEnabled[item.moduleKey] && !userIsSuperadmin) return false;
        // Check superadmin-only item (always requires superadmin)
        if (item.superadminOnly && !userIsSuperadmin) return false;
        
        // If user has a permission template, it takes precedence for non-superadmins
        // (including admins) — the template is the source of truth.
        if (hasTemplate && item.pageKey && !userIsSuperadmin) {
          return pagePermissions[item.pageKey] === true;
        }

        // Admin-only items visible to admins when no template exists
        if (item.adminOnly && userIsAdmin) return true;
        
        // Fallback to role-based checks when no template
        if (item.adminOnly && !userIsAdmin) return false;
        if (item.ownerOnly && !userIsOwner) return false;
        return true;
      })
    }))
    .filter(section => section.items.length > 0);

  const handleLogout = () => {
    logout();
    navigate("/login");
    onNavigate?.();
  };

  const toggleSection = (title: string) => {
    setOpenSections(prev =>
      prev.includes(title)
        ? prev.filter(s => s !== title)
        : [...prev, title]
    );
  };

  const isActiveRoute = (href: string) => location.pathname === href;

  const isSectionActive = (section: NavSection) =>
    section.items.some(item => isActiveRoute(item.href));

  const renderNavItem = (item: NavItem, indent = false) => {
    const isActive = isActiveRoute(item.href);
    
    const linkContent = (
      <Link
        key={item.name}
        to={item.href}
        onClick={onNavigate}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200",
          indent && isExpanded && "ml-4",
          isExpanded ? "" : "justify-center",
          isActive
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        <item.icon className={cn("h-4 w-4 shrink-0", isActive && "text-primary")} />
        {isExpanded && <span className="whitespace-nowrap">{item.name}</span>}
      </Link>
    );

    if (!isExpanded) {
      return (
        <Tooltip key={item.name} delayDuration={0}>
          <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
          <TooltipContent side="right" className="font-medium">
            {item.name}
          </TooltipContent>
        </Tooltip>
      );
    }

    return linkContent;
  };

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div
        className={cn(
          "flex h-16 items-center gap-3 border-b border-border transition-all duration-300",
          isExpanded ? "px-6" : "px-3 justify-center"
        )}
      >
        {branding.logo_sidebar ? (
          <img 
            src={branding.logo_sidebar} 
            alt="Logo" 
            className="h-10 w-10 object-contain shrink-0 rounded-xl"
          />
        ) : (
          <img src={ayratechLogo} alt="Anatriello Gestão" className="h-10 w-10 object-contain shrink-0 rounded-xl" />
        )}
        {isExpanded && (
          <div className="overflow-hidden">
            <h1 className="text-lg font-bold text-foreground whitespace-nowrap">Anatriello Gestão</h1>
            <p className="text-xs text-muted-foreground whitespace-nowrap">Gestão corporativa</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-2 py-4 overflow-y-auto scrollbar-none hover:scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
        {/* Dashboard - always visible */}
        {renderNavItem({ name: "Dashboard", href: "/dashboard", icon: LayoutDashboard })}

        {/* Sections */}
        {filteredSections.map((section) => {
          const isOpen = openSections.includes(section.title);
          const sectionActive = isSectionActive(section);

          if (!isExpanded) {
            // When collapsed, show items directly with tooltips
            return (
              <div key={section.title} className="space-y-1 pt-2">
                {section.items.map(item => renderNavItem(item))}
              </div>
            );
          }

          return (
            <Collapsible
              key={section.title}
              open={isOpen}
              onOpenChange={() => toggleSection(section.title)}
              className="pt-2"
            >
              <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted transition-colors">
                <div className="flex items-center gap-3">
                  <section.icon className={cn("h-4 w-4", sectionActive && "text-primary")} />
                  <span>{section.title}</span>
                </div>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform duration-200",
                    isOpen && "rotate-180"
                  )}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1 pt-1 data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up overflow-hidden">
                {section.items.map((item, index) => (
                  <div 
                    key={item.name}
                    className="animate-fade-in"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    {renderNavItem(item, true)}
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          );
        })}

        {/* Superadmin Link */}
        {userIsSuperadmin && (
          <>
            {!isExpanded ? (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Link
                    to="/admin"
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center justify-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 mt-4 border border-primary/30",
                      location.pathname === "/admin"
                        ? "bg-primary/20 text-primary neon-glow"
                        : "text-primary hover:bg-primary/10"
                    )}
                  >
                    <Shield className="h-5 w-5 shrink-0" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" className="font-medium">
                  Superadmin
                </TooltipContent>
              </Tooltip>
            ) : (
              <Link
                to="/admin"
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 mt-4 border border-primary/30",
                  location.pathname === "/admin"
                    ? "bg-primary/20 text-primary neon-glow"
                    : "text-primary hover:bg-primary/10"
                )}
              >
                <Shield className="h-5 w-5 shrink-0" />
                <span className="whitespace-nowrap">Superadmin</span>
              </Link>
            )}
          </>
        )}
      </nav>

      {/* Footer */}
      <div
        className={cn(
          "border-t border-border p-3 space-y-2",
          !isExpanded && "flex flex-col items-center"
        )}
      >
        {user && isExpanded && (
          <div className="rounded-lg bg-accent/50 p-3">
            <p className="text-xs font-medium text-accent-foreground truncate">
              {user.name || user.email}
            </p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          </div>
        )}

        {!isExpanded ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={handleLogout}
                className="flex items-center justify-center rounded-lg p-2.5 text-destructive hover:bg-destructive/10 transition-all duration-200"
              >
                <LogOut className="h-5 w-5 shrink-0" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="font-medium">
              Sair
            </TooltipContent>
          </Tooltip>
        ) : (
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/10 transition-all duration-200"
          >
            <LogOut className="h-5 w-5 shrink-0" />
            <span className="whitespace-nowrap">Sair</span>
          </button>
        )}

        {isExpanded && (
          <div className="text-center space-y-0.5">
            <p className="text-xs font-medium text-primary">Anatriello Gestão</p>
            <p className="text-xs text-muted-foreground font-mono">v{APP_VERSION}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function Sidebar() {
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    checkSuperadmin();
  }, []);

  const checkSuperadmin = async () => {
    try {
      const token = getAuthToken();
      if (!token) return;

      const response = await fetch(`${API_URL}/api/admin/check`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setIsSuperadmin(data.isSuperadmin || data.isAdmin);
      }
    } catch {
      setIsSuperadmin(false);
    }
  };

  const collapsedWidth = "w-16";
  const expandedWidth = "w-64";

  return (
    <>
      {/* Mobile/Tablet Menu Button - visible until xl breakpoint */}
      <div className="fixed top-3 left-3 z-[80] xl:hidden" style={{ isolation: 'isolate' }}>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button 
              variant="outline" 
              size="icon" 
              className="h-10 w-10 bg-card border-border shadow-xl rounded-full ring-2 ring-background"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0 bg-card border-border z-[70]">
            <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
            <SidebarContentComponent
              isExpanded={true}
              isSuperadmin={isSuperadmin}
              onNavigate={() => setMobileOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 h-screen bg-card border-r border-border shadow-card transition-all duration-300 ease-in-out hidden xl:block",
          isHovered ? expandedWidth : collapsedWidth
        )}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <SidebarContentComponent isExpanded={isHovered} isSuperadmin={isSuperadmin} />
      </aside>
    </>
  );
}

export const SIDEBAR_COLLAPSED_WIDTH = 64;
export const SIDEBAR_EXPANDED_WIDTH = 256;
