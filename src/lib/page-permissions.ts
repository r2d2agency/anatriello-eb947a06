// All available pages that can be controlled via permission templates
export const PAGE_PERMISSIONS = [
  // Atendimento
  { key: 'chat', label: 'Chat', section: 'Atendimento', icon: 'MessagesSquare' },
  { key: 'secretaria_ia', label: 'Secretária IA', section: 'Atendimento', icon: 'Bot' },
  { key: 'agentes_ia', label: 'Agentes IA', section: 'Atendimento', icon: 'Sparkles' },
  { key: 'ia_assistentes', label: 'IA Assistentes', section: 'Atendimento', icon: 'Bot' },
  { key: 'chatbots', label: 'Chatbots', section: 'Atendimento', icon: 'Bot' },
  { key: 'fluxos', label: 'Fluxos', section: 'Atendimento', icon: 'GitBranch' },
  { key: 'departamentos', label: 'Departamentos', section: 'Atendimento', icon: 'Building2' },
  { key: 'agendamentos', label: 'Agendamentos', section: 'Atendimento', icon: 'Bell' },
  { key: 'tags', label: 'Tags', section: 'Atendimento', icon: 'Receipt' },
  { key: 'contatos', label: 'Contatos', section: 'Atendimento', icon: 'Users' },
  
  // CRM
  { key: 'crm_negociacoes', label: 'Negociações', section: 'CRM', icon: 'Kanban' },
  { key: 'crm_prospects', label: 'Prospects', section: 'CRM', icon: 'UserPlus' },
  { key: 'crm_empresas', label: 'Empresas', section: 'CRM', icon: 'Building2' },
  { key: 'projetos', label: 'Projetos', section: 'CRM', icon: 'FolderKanban' },
  { key: 'mapa', label: 'Mapa', section: 'CRM', icon: 'Map' },
  { key: 'crm_agenda', label: 'Agenda', section: 'CRM', icon: 'CalendarDays' },
  { key: 'crm_tarefas', label: 'Tarefas', section: 'CRM', icon: 'ClipboardList' },
  { key: 'crm_relatorios', label: 'Relatórios', section: 'CRM', icon: 'BarChart3' },
  { key: 'revenue_intelligence', label: 'Revenue Intel', section: 'CRM', icon: 'Brain' },
  { key: 'modulo_fantasma', label: 'Módulo Fantasma', section: 'CRM', icon: 'Ghost' },
  { key: 'crm_configuracoes', label: 'Configurações CRM', section: 'CRM', icon: 'Settings' },
  
  // RH
  { key: 'rh_holding', label: 'Holding', section: 'RH', icon: 'Building2' },
  { key: 'rh_empresas', label: 'Empresas', section: 'RH', icon: 'Building2' },
  { key: 'rh_dashboard', label: 'Dashboard', section: 'RH', icon: 'LayoutDashboard' },
  { key: 'rh_colaboradores', label: 'Colaboradores', section: 'RH', icon: 'UserPlus' },
  { key: 'rh_ponto', label: 'Ponto', section: 'RH', icon: 'Clock' },
  { key: 'rh_relogio_ponto', label: 'Relógio de Ponto (Tablet)', section: 'RH', icon: 'ScanFace' },
  { key: 'rh_ajuda', label: 'Ajuda RH', section: 'RH', icon: 'HelpCircle' },
  { key: 'rh_holerite', label: 'Holerite', section: 'RH', icon: 'DollarSign' },
  { key: 'rh_documentos', label: 'Documentos', section: 'RH', icon: 'FileText' },
  { key: 'rh_feriados', label: 'Feriados', section: 'RH', icon: 'CalendarDays' },
  { key: 'rh_mapa', label: 'Mapa', section: 'RH', icon: 'MapPin' },
  { key: 'rh_acessos', label: 'Acessos App', section: 'RH', icon: 'Shield' },
  { key: 'rh_biometria', label: 'Biometria Facial', section: 'RH', icon: 'ScanFace' },
  { key: 'rh_solicitacoes', label: 'Solicitações', section: 'RH', icon: 'Inbox' },
  { key: 'rh_denuncias', label: 'Canal de Denúncias', section: 'RH', icon: 'ShieldAlert' },
  { key: 'rh_itens', label: 'Uniformes/EPIs/Chaves', section: 'RH', icon: 'Shirt' },
  { key: 'rh_checklist_folha', label: 'Checklist Folha', section: 'RH', icon: 'ClipboardList' },
  { key: 'rh_rastreamento', label: 'Rastreamento', section: 'RH', icon: 'Navigation' },
  { key: 'rh_logs', label: 'Logs & Erros', section: 'RH', icon: 'Code' },
  
  // Disparos
  { key: 'listas', label: 'Listas', section: 'Disparos', icon: 'Users' },
  { key: 'mensagens', label: 'Mensagens', section: 'Disparos', icon: 'MessageSquare' },
  { key: 'campanhas', label: 'Campanhas', section: 'Disparos', icon: 'Send' },
  { key: 'sequencias', label: 'Sequências', section: 'Disparos', icon: 'RefreshCw' },
  { key: 'fluxos_externos', label: 'Fluxos Externos', section: 'Disparos', icon: 'FileText' },
  { key: 'webhooks', label: 'Webhooks', section: 'Disparos', icon: 'Webhook' },
  { key: 'ctwa_analytics', label: 'CTWA Analytics', section: 'Disparos', icon: 'MousePointerClick' },
  { key: 'lead_gleego', label: 'Lead Gleego', section: 'Disparos', icon: 'BarChart4' },
  
  // Minha Conta
  { key: 'ajustes', label: 'Ajustes', section: 'Minha Conta', icon: 'Settings' },
  { key: 'meta_templates', label: 'Templates Meta', section: 'Minha Conta', icon: 'FileText' },
  { key: 'assinaturas', label: 'Assinaturas', section: 'Minha Conta', icon: 'FileSignature' },
  
  // Administração
  { key: 'cobranca', label: 'Cobrança', section: 'Administração', icon: 'Receipt' },
  { key: 'conexoes', label: 'Conexões', section: 'Administração', icon: 'Plug' },
  { key: 'organizacoes', label: 'Organizações', section: 'Administração', icon: 'Building2' },
] as const;

export type PageKey = typeof PAGE_PERMISSIONS[number]['key'];

// Get all unique sections
export const PAGE_SECTIONS = [...new Set(PAGE_PERMISSIONS.map(p => p.section))];

// Create a "full access" permissions object
export function createFullPermissions(): Record<string, boolean> {
  const perms: Record<string, boolean> = {};
  PAGE_PERMISSIONS.forEach(p => { perms[p.key] = true; });
  return perms;
}

// Create an empty permissions object
export function createEmptyPermissions(): Record<string, boolean> {
  const perms: Record<string, boolean> = {};
  PAGE_PERMISSIONS.forEach(p => { perms[p.key] = false; });
  return perms;
}
