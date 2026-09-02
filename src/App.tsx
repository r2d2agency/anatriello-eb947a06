import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { useBranding } from "@/hooks/use-branding";
import ProtectedRoute from "@/components/ProtectedRoute";
import { PWAUpdateBanner } from "@/components/layout/PWAUpdateBanner";
import LandingPage from "./pages/LandingPage";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Cadastro from "./pages/Cadastro";
import Conexao from "./pages/Conexao";
import Contatos from "./pages/Contatos";
import Mensagens from "./pages/Mensagens";
import Campanhas from "./pages/Campanhas";
import Chat from "./pages/Chat";
import Cobranca from "./pages/Cobranca";
import Organizacoes from "./pages/Organizacoes";
import Admin from "./pages/Admin";
import Configuracoes from "./pages/Configuracoes";
import Agendamentos from "./pages/Agendamentos";
import Tags from "./pages/Tags";
import ContatosChat from "./pages/ContatosChat";
import Chatbots from "./pages/Chatbots";
import Fluxos from "./pages/Fluxos";
import Departamentos from "./pages/Departamentos";
import AgentesIA from "./pages/AgentesIA";
import CRMNegociacoes from "./pages/CRMNegociacoes";
import CRMProspects from "./pages/CRMProspects";
import CRMEmpresas from "./pages/CRMEmpresas";
import CRMTarefas from "./pages/CRMTarefas";
import CRMAgenda from "./pages/CRMAgenda";
import CRMConfiguracoes from "./pages/CRMConfiguracoes";
import CRMRelatorios from "./pages/CRMRelatorios";
import Mapa from "./pages/Mapa";
import PoliticaPrivacidade from "./pages/PoliticaPrivacidade";
import TermosServico from "./pages/TermosServico";
import ExclusaoDados from "./pages/ExclusaoDados";
import FluxosExternos from "./pages/FluxosExternos";
import PublicFormPage from "./pages/PublicFormPage";
import LeadWebhooks from "./pages/LeadWebhooks";
import SequenciasNurturing from "./pages/SequenciasNurturing";
import CTWAAnalytics from "./pages/CTWAAnalytics";
import RevenueIntelligence from "./pages/RevenueIntelligence";
import SecretariaGrupos from "./pages/SecretariaGrupos";
import ModuloFantasma from "./pages/ModuloFantasma";
import Projetos from "./pages/Projetos";
import TarefasKanban from "./pages/TarefasKanban";
import LeadGleego from "./pages/LeadGleego";
import AgentesIACliente from "./pages/AgentesIACliente";
import RespostasRapidas from "./pages/RespostasRapidas";
import ApiDocumentation from "./pages/ApiDocumentation";
import MetaTemplates from "./pages/MetaTemplates";
import Assinaturas from "./pages/Assinaturas";
import ModeloContrato from "./pages/ModeloContrato";
import AssinarDocumento from "./pages/AssinarDocumento";
import VerificarDocumento from "./pages/VerificarDocumento";
import RHColaboradores from "./pages/RHColaboradores";
import RHEmpresas from "./pages/RHEmpresas";
import RHHolding from "./pages/RHHolding";
import RHPontoV2 from "./pages/RHPontoV2";
import RHHolerite from "./pages/RHHolerite";
import RHDashboard from "./pages/RHDashboard";
import RHAnalytics from "./pages/RHAnalytics";
import RHFolhaExport from "./pages/RHFolhaExport";
import RHDeducoes from "./pages/RHDeducoes";
import RHFolhaPagamento from "./pages/RHFolhaPagamento";
import RHBancoHoras from "./pages/RHBancoHoras";
import RHEscalas from "./pages/RHEscalas";
import RHFeriasColetivas from "./pages/RHFeriasColetivas";
import RHDesligamento from "./pages/RHDesligamento";
import RHAdmissao from "./pages/RHAdmissao";
import RHAdvertencias from "./pages/RHAdvertencias";
import RHESocial from "./pages/RHESocial";
import RHAvaliacoes from "./pages/RHAvaliacoes";
import RHEspelhoDigital from "./pages/RHEspelhoDigital";



import RHDocumentos from "./pages/RHDocumentos";
import RHPontoMonitor from "./pages/RHPontoMonitor";
import RHPDVs from "./pages/RHPDVs";
import RHFeriados from "./pages/RHFeriados";
import RHAcessos from "./pages/RHAcessos";
import RHRastreamento from "./pages/RHRastreamento";
import RHBiometria from "./pages/RHBiometria";
import RHItens from "./pages/RHItens";
import RHChecklistFolha from "./pages/RHChecklistFolha";
import RHSolicitacoesAdmin from "./pages/RHSolicitacoesAdmin";
import RHMapaOperacional from "./pages/RHMapaOperacional";
import RHLogs from "./pages/RHLogs";
import RHAjuda from "./pages/RHAjuda";
import RHDocumentacao from "./pages/RHDocumentacao";
import RHRelogioPonto from "./pages/RHRelogioPonto";
import KioskLogin from "./pages/KioskLogin";
import KioskPage from "./pages/KioskPage";
import ManagerApp from "./pages/ManagerApp";
import ManagerLogin from "./pages/ManagerLogin";
import LiveMaps from "./pages/LiveMaps";
  import MerchDashboard from "./pages/MerchDashboard";
import MerchMarcas from "./pages/MerchMarcas";
import MerchCategorias from "./pages/MerchCategorias";
import MerchProdutos from "./pages/MerchProdutos";
import MerchMixPDV from "./pages/MerchMixPDV";
import MerchRedes from "./pages/MerchRedes";
import MerchRelatorios from "./pages/MerchRelatorios";
import MerchRotas from "./pages/MerchRotas";
import MerchExecucao from "./pages/MerchExecucao";
import MerchChecklists from "./pages/MerchChecklists";
import MerchBookFotos from "./pages/MerchBookFotos";
import PublicPhotoBook from "./pages/PublicPhotoBook";
import MerchContratos from "./pages/MerchContratos";
import MerchAuditoria from "./pages/MerchAuditoria";
import MerchPerdas from "./pages/MerchPerdas";
import MerchEquipe from "./pages/MerchEquipe";
import MerchPesquisaPrecos from "./pages/MerchPesquisaPrecos";
import MerchPesquisaDashboard from "./pages/MerchPesquisaDashboard";
import PromotorLogin from "./pages/promotor/PromotorLogin";
import PromotorHome from "./pages/promotor/PromotorHome";
import PromotorAgenda from "./pages/promotor/PromotorAgenda";
import PromotorRota from "./pages/promotor/PromotorRota";
import PromotorAvarias from "./pages/promotor/PromotorAvarias";
import PromotorDocumentos from "./pages/promotor/PromotorDocumentos";
import PromotorPonto from "./pages/promotor/PromotorPonto";
import PromotorEnviar from "./pages/promotor/PromotorEnviar";
import PromotorConfig from "./pages/promotor/PromotorConfig";
import PromotorTrocarSenha from "./pages/promotor/PromotorTrocarSenha";
import PromotorEquipe from "./pages/promotor/PromotorEquipe";
import ColaboradorHome from "./pages/colaborador/ColaboradorHome";
import ColaboradorJornada from "./pages/colaborador/ColaboradorJornada";
import ColaboradorEspelho from "./pages/colaborador/ColaboradorEspelho";

import ColaboradorSolicitacoes from "./pages/colaborador/ColaboradorSolicitacoes";
import ColaboradorFerias from "./pages/colaborador/ColaboradorFerias";
import ColaboradorHolerite from "./pages/colaborador/ColaboradorHolerite";
import ColaboradorDocumentos from "./pages/colaborador/ColaboradorDocumentos";
import ColaboradorBeneficios from "./pages/colaborador/ColaboradorBeneficios";
import ColaboradorPerfil from "./pages/colaborador/ColaboradorPerfil";
import ColaboradorBiometria from "./pages/colaborador/ColaboradorBiometria";
import ColaboradorConfiguracoes from "./pages/colaborador/ColaboradorConfiguracoes";
import ColaboradorDados from "./pages/colaborador/ColaboradorDados";
import ColabProtectedRoute from "./components/ColabProtectedRoute";
import RequireCap from "./components/ColabRequireCap";
import AccessLogin from "./pages/promotor/AccessLogin";
import AccessOnlyHome from "./pages/promotor/AccessOnlyHome";
import NotFound from "./pages/NotFound";
import MaintenancePage from "./pages/MaintenancePage";
import SupermarketLandingPage from "./pages/SupermarketLandingPage";
import TotemAccess from "./pages/TotemAccess";
import AccessControlAdmin from "./pages/AccessControlAdmin";
import AyratechAIConfig from "./pages/admin/AyratechAIConfig";
import { AgencyAuthProvider } from "./contexts/AgencyAuthContext";
import AgencyLogin from "./pages/agency/AgencyLogin";
import AgencyLayout from "./pages/agency/AgencyLayout";
import AgencyDashboard from "./pages/agency/AgencyDashboard";
import AgencyPromoters from "./pages/agency/AgencyPromoters";
import AgencyBrands from "./pages/agency/AgencyBrands";
import AgencyAccessRules from "./pages/agency/AgencyAccessRules";
import AgencyVisitRequests from "./pages/agency/AgencyVisitRequests";
import AgencyLeaves from "./pages/agency/AgencyLeaves";
import AccessControlDashboard from "./pages/admin/AccessControlDashboard";
import { SupermarketAuthProvider } from "./contexts/SupermarketAuthContext";
import SupermarketLogin from "./pages/supermarket/SupermarketLogin";
import SupermarketLayout from "./pages/supermarket/SupermarketLayout";
import SupermarketDashboard from "./pages/supermarket/SupermarketDashboard";
import SupermarketHistory from "./pages/supermarket/SupermarketHistory";
import SupermarketVisitRequests from "./pages/supermarket/SupermarketVisitRequests";
import SupermarketIncidents from "./pages/supermarket/SupermarketIncidents";
import SupermarketContacts from "./pages/supermarket/SupermarketContacts";
import SupermarketAssistant from "./pages/supermarket/SupermarketAssistant";
import SupermarketSettings from "./pages/supermarket/SupermarketSettings";
import SupermarketAccessRequests from "./pages/supermarket/SupermarketAccessRequests";
import { NetworkAuthProvider } from "./contexts/NetworkAuthContext";
import NetworkLogin from "./pages/network/NetworkLogin";
import NetworkLayout from "./pages/network/NetworkLayout";
import NetworkDashboard from "./pages/network/NetworkDashboard";
import NetworkUnits from "./pages/network/NetworkUnits";
import NetworkPartners from "./pages/network/NetworkPartners";
import { NetworkBrands, NetworkBlocks, NetworkAudit, NetworkSettings } from "./pages/network/NetworkPages";
import NetworkAccessRequests from "./pages/network/NetworkAccessRequests";
import AgencyNetworkRequest from "./pages/agency/AgencyNetworkRequest";
import AgencySignup from "./pages/agency/AgencySignup";
import NetworkAgencySignups from "./pages/network/NetworkAgencySignups";
import NetworkPdvQrCodes from "./pages/network/NetworkPdvQrCodes";
import NetworkDocRequirements from "./pages/network/NetworkDocRequirements";

import { PromoterAppAuthProvider } from "./contexts/PromoterAppAuthContext";
import PromoterAppLogin from "./pages/promoter-app/PromoterAppLogin";
import PromoterAppHome from "./pages/promoter-app/PromoterAppHome";
import PromoterAppScanner from "./pages/promoter-app/PromoterAppScanner";
import PromoterAppVisit from "./pages/promoter-app/PromoterAppVisit";
import PromoterAppHistory from "./pages/promoter-app/PromoterAppHistory";

// SmartRoute AI
import SmartRouteDashboard from "./pages/smartroute/SmartRouteDashboard";
import SmartRouteMapa from "./pages/smartroute/SmartRouteMapa";
import SmartRouteRotas from "./pages/smartroute/SmartRouteRotas";
import SmartRoutePedidos from "./pages/smartroute/SmartRoutePedidos";
import SmartRouteRotasMontadas from "./pages/smartroute/SmartRouteRotasMontadas";
import SmartRouteRotaDoDia from "./pages/smartroute/SmartRouteRotaDoDia";
import SmartRouteSimulador from "./pages/smartroute/SmartRouteSimulador";
import SmartRoutePDVs from "./pages/smartroute/SmartRoutePDVs";
import SmartRouteFrota from "./pages/smartroute/SmartRouteFrota";
import SmartRouteMotoristas from "./pages/smartroute/SmartRouteMotoristas";
import SmartRouteIA from "./pages/smartroute/SmartRouteIA";
import SmartRouteGestorIA from "./pages/smartroute/SmartRouteGestorIA";
import SmartRouteReplay from "./pages/smartroute/SmartRouteReplay";
import SmartRouteIntegracoes from "./pages/smartroute/SmartRouteIntegracoes";
import SmartRouteRelatorios from "./pages/smartroute/SmartRouteRelatorios";
import SmartRouteConfiguracoes from "./pages/smartroute/SmartRouteConfiguracoes";
import SmartRouteCDs from "./pages/smartroute/SmartRouteCDs";
import SmartRouteChecklists from "./pages/smartroute/SmartRouteChecklists";
import SmartRouteDocumentacao from "./pages/smartroute/SmartRouteDocumentacao";
import SmartRouteMonitoramento from "./pages/smartroute/SmartRouteMonitoramento";
import SmartRouteOcorrencias from "./pages/smartroute/SmartRouteOcorrencias";
import SmartRoutePosAnalise from "./pages/smartroute/SmartRoutePosAnalise";
import SmartRoutePrompts from "./pages/smartroute/SmartRoutePrompts";
import SmartRoutePlanejador from "./pages/smartroute/SmartRoutePlanejador";

import TrackingPage from "./pages/TrackingPage";
import { DriverAuthProvider } from "./contexts/DriverAuthContext";
import EntregadorLogin from "./pages/entregador/EntregadorLogin";
import EntregadorHome from "./pages/entregador/EntregadorHome";
import EntregadorRota from "./pages/entregador/EntregadorRota";
import EntregadorEntrega from "./pages/entregador/EntregadorEntrega";
import EntregadorPonto from "./pages/entregador/EntregadorPonto";
import EntregadorAvaria from "./pages/entregador/EntregadorAvaria";
import EntregadorDevolucao from "./pages/entregador/EntregadorDevolucao";
import EntregadorHistorico from "./pages/entregador/EntregadorHistorico";

import CentralApps from "./pages/CentralApps";



const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: any) => {
        if (error?.status === 401) return false;
        return failureCount < 1;
      },
    },
  },
});

// Component to handle favicon update
function FaviconUpdater() {
  const { branding } = useBranding();

  useEffect(() => {
    if (branding.favicon) {
      const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
      if (link) {
        link.href = branding.favicon;
      } else {
        const newLink = document.createElement('link');
        newLink.rel = 'icon';
        newLink.href = branding.favicon;
        document.head.appendChild(newLink);
      }
    }
  }, [branding.favicon]);

  return null;
}

// Smart redirect based on hostname and auth state
function SmartRedirect() {
  const { isAuthenticated, isLoading } = useAuth();
  const hostname = window.location.hostname;
  const isPWA = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as any).standalone === true;
  const isPromotorDomain = hostname.startsWith('promotor.');
  const isSupermarketDomain = hostname.startsWith('supermercado.') || hostname.startsWith('acesso.');
  const isAccessPromotorDomain = hostname.startsWith('parceiro.') || hostname.startsWith('acesso-promotor.');
  const isColaboradorDomain = hostname.startsWith('colaborador.');
  const isGestorDomain = hostname.startsWith('gestor.');
  
  // Subdomain specific redirects
  if (isPromotorDomain) return <Navigate to="/promotor/login" replace />;
  if (isAccessPromotorDomain) return <Navigate to="/acesso/promotor/login" replace />;
  if (isSupermarketDomain) return <Navigate to="/acesso-supermercado" replace />;
  if (isColaboradorDomain) {
    const hasColabToken = typeof window !== 'undefined' && !!localStorage.getItem('promotor_token');
    return <Navigate to={hasColabToken ? '/colaborador/home' : '/colaborador/login'} replace />;
  }
  if (isGestorDomain) return <Navigate to="/gestor" replace />;
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return <Navigate to="/login" replace />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <FaviconUpdater />
      <PWAUpdateBanner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/gestor/login" element={<ManagerLogin />} />
            <Route path="/cadastro" element={<Cadastro />} />
            <Route path="/" element={<SmartRedirect />} />
            <Route path="/landing" element={<LandingPage />} />
            <Route path="/supermercado" element={<SupermarketLandingPage />} />
            <Route path="/dashboard" element={<ProtectedRoute><Index /></ProtectedRoute>} />
            <Route path="/central-apps" element={<ProtectedRoute><CentralApps /></ProtectedRoute>} />
            <Route path="/merch/dashboard" element={<ProtectedRoute><MerchDashboard /></ProtectedRoute>} />
            <Route path="/conexao" element={<ProtectedRoute><Conexao /></ProtectedRoute>} />
            <Route path="/contatos" element={<ProtectedRoute><Contatos /></ProtectedRoute>} />
            <Route path="/mensagens" element={<ProtectedRoute><Mensagens /></ProtectedRoute>} />
            <Route path="/campanhas" element={<ProtectedRoute><Campanhas /></ProtectedRoute>} />
            <Route path="/chat" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
            <Route path="/agendamentos" element={<ProtectedRoute><Agendamentos /></ProtectedRoute>} />
            <Route path="/tags" element={<ProtectedRoute><Tags /></ProtectedRoute>} />
            <Route path="/contatos-chat" element={<ProtectedRoute><ContatosChat /></ProtectedRoute>} />
            <Route path="/cobranca" element={<ProtectedRoute><Cobranca /></ProtectedRoute>} />
            <Route path="/organizacoes" element={<ProtectedRoute><Organizacoes /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
            <Route path="/admin/ayratech-ai" element={<ProtectedRoute><AyratechAIConfig /></ProtectedRoute>} />
            <Route path="/admin/access-control/dashboard" element={<ProtectedRoute><AccessControlDashboard /></ProtectedRoute>} />
            <Route path="/configuracoes" element={<ProtectedRoute><Configuracoes /></ProtectedRoute>} />
            <Route path="/chatbots" element={<ProtectedRoute><Chatbots /></ProtectedRoute>} />
            <Route path="/fluxos" element={<ProtectedRoute><Fluxos /></ProtectedRoute>} />
            <Route path="/departamentos" element={<ProtectedRoute><Departamentos /></ProtectedRoute>} />
            <Route path="/agentes-ia" element={<ProtectedRoute><AgentesIA /></ProtectedRoute>} />
            <Route path="/crm/negociacoes" element={<ProtectedRoute><CRMNegociacoes /></ProtectedRoute>} />
            <Route path="/crm/prospects" element={<ProtectedRoute><CRMProspects /></ProtectedRoute>} />
            <Route path="/crm/empresas" element={<ProtectedRoute><CRMEmpresas /></ProtectedRoute>} />
            <Route path="/crm/tarefas" element={<ProtectedRoute><CRMTarefas /></ProtectedRoute>} />
            <Route path="/crm/agenda" element={<ProtectedRoute><CRMAgenda /></ProtectedRoute>} />
            <Route path="/crm/configuracoes" element={<ProtectedRoute><CRMConfiguracoes /></ProtectedRoute>} />
            <Route path="/crm/relatorios" element={<ProtectedRoute><CRMRelatorios /></ProtectedRoute>} />
            <Route path="/mapa" element={<ProtectedRoute><Mapa /></ProtectedRoute>} />
            <Route path="/fluxos-externos" element={<ProtectedRoute><FluxosExternos /></ProtectedRoute>} />
            <Route path="/lead-webhooks" element={<ProtectedRoute><LeadWebhooks /></ProtectedRoute>} />
            <Route path="/sequencias" element={<ProtectedRoute><SequenciasNurturing /></ProtectedRoute>} />
            <Route path="/ctwa-analytics" element={<ProtectedRoute><CTWAAnalytics /></ProtectedRoute>} />
            <Route path="/revenue-intelligence" element={<ProtectedRoute><RevenueIntelligence /></ProtectedRoute>} />
            <Route path="/secretaria-grupos" element={<ProtectedRoute><SecretariaGrupos /></ProtectedRoute>} />
            <Route path="/modulo-fantasma" element={<ProtectedRoute><ModuloFantasma /></ProtectedRoute>} />
            <Route path="/projetos" element={<ProtectedRoute><Projetos /></ProtectedRoute>} />
            <Route path="/tarefas" element={<ProtectedRoute><TarefasKanban /></ProtectedRoute>} />
            <Route path="/lead-gleego" element={<ProtectedRoute><LeadGleego /></ProtectedRoute>} />
            <Route path="/agentes-ia-cliente" element={<ProtectedRoute><AgentesIACliente /></ProtectedRoute>} />
            <Route path="/respostas-rapidas" element={<ProtectedRoute><RespostasRapidas /></ProtectedRoute>} />
            <Route path="/meta-templates" element={<ProtectedRoute><MetaTemplates /></ProtectedRoute>} />
            <Route path="/assinaturas" element={<ProtectedRoute><Assinaturas /></ProtectedRoute>} />
            <Route path="/modelo-contrato" element={<ProtectedRoute><ModeloContrato /></ProtectedRoute>} />
            <Route path="/rh/colaboradores" element={<ProtectedRoute><RHColaboradores /></ProtectedRoute>} />
            <Route path="/rh/empresas" element={<ProtectedRoute><RHEmpresas /></ProtectedRoute>} />
            <Route path="/rh/holding" element={<ProtectedRoute><RHHolding /></ProtectedRoute>} />
            <Route path="/rh/dashboard" element={<ProtectedRoute><RHDashboard /></ProtectedRoute>} />
            <Route path="/rh/analytics" element={<ProtectedRoute><RHAnalytics /></ProtectedRoute>} />
            <Route path="/rh/ponto" element={<ProtectedRoute><RHPontoV2 /></ProtectedRoute>} />
            <Route path="/gestor/*" element={<ProtectedRoute loginPath="/gestor/login"><ManagerApp /></ProtectedRoute>} />
            <Route path="/rh/ponto-legacy" element={<Navigate to="/rh/ponto" replace />} />
            <Route path="/rh/holerite" element={<ProtectedRoute><RHHolerite /></ProtectedRoute>} />
            <Route path="/rh/folha-export" element={<ProtectedRoute><RHFolhaExport /></ProtectedRoute>} />
            <Route path="/rh/deducoes" element={<ProtectedRoute><RHDeducoes /></ProtectedRoute>} />
            <Route path="/rh/folha-pagamento" element={<ProtectedRoute><RHFolhaPagamento /></ProtectedRoute>} />
            <Route path="/rh/banco-horas" element={<ProtectedRoute><RHBancoHoras /></ProtectedRoute>} />
            <Route path="/rh/escalas" element={<ProtectedRoute><RHEscalas /></ProtectedRoute>} />
            <Route path="/rh/ferias-coletivas" element={<ProtectedRoute><RHFeriasColetivas /></ProtectedRoute>} />
            <Route path="/rh/desligamento" element={<ProtectedRoute><RHDesligamento /></ProtectedRoute>} />
            <Route path="/rh/admissao" element={<ProtectedRoute><RHAdmissao /></ProtectedRoute>} />
            <Route path="/rh/advertencias" element={<ProtectedRoute><RHAdvertencias /></ProtectedRoute>} />
            <Route path="/rh/esocial" element={<ProtectedRoute><RHESocial /></ProtectedRoute>} />
            <Route path="/rh/avaliacoes" element={<ProtectedRoute><RHAvaliacoes /></ProtectedRoute>} />
            <Route path="/rh/espelho-digital" element={<ProtectedRoute><RHEspelhoDigital /></ProtectedRoute>} />



            <Route path="/rh/documentos" element={<ProtectedRoute><RHDocumentos /></ProtectedRoute>} />
            <Route path="/rh/ponto-monitor" element={<ProtectedRoute><RHPontoMonitor /></ProtectedRoute>} />
            <Route path="/rh/pdvs" element={<ProtectedRoute><RHPDVs /></ProtectedRoute>} />
            <Route path="/rh/feriados" element={<ProtectedRoute><RHFeriados /></ProtectedRoute>} />
            <Route path="/rh/acessos" element={<ProtectedRoute><RHAcessos /></ProtectedRoute>} />
            <Route path="/rh/biometria" element={<ProtectedRoute><RHBiometria /></ProtectedRoute>} />
            <Route path="/rh/itens" element={<ProtectedRoute><RHItens /></ProtectedRoute>} />
            <Route path="/rh/checklist-folha" element={<ProtectedRoute><RHChecklistFolha /></ProtectedRoute>} />
            <Route path="/rh/solicitacoes" element={<ProtectedRoute><RHSolicitacoesAdmin /></ProtectedRoute>} />
            <Route path="/rh/rastreamento" element={<ProtectedRoute><RHRastreamento /></ProtectedRoute>} />
            <Route path="/rh/mapa" element={<ProtectedRoute><RHMapaOperacional /></ProtectedRoute>} />
            <Route path="/rh/logs" element={<ProtectedRoute><RHLogs /></ProtectedRoute>} />
            <Route path="/rh/ajuda" element={<ProtectedRoute><RHAjuda /></ProtectedRoute>} />
            <Route path="/rh/documentacao" element={<ProtectedRoute><RHDocumentacao /></ProtectedRoute>} />
            <Route path="/rh/relogio-ponto" element={<ProtectedRoute><RHRelogioPonto /></ProtectedRoute>} />
            <Route path="/kiosk/login" element={<KioskLogin />} />
            <Route path="/kiosk" element={<KioskPage />} />
            <Route path="/live-maps" element={<ProtectedRoute><LiveMaps /></ProtectedRoute>} />
            <Route path="/merch/marcas" element={<ProtectedRoute><MerchMarcas /></ProtectedRoute>} />
            <Route path="/merch/categorias" element={<ProtectedRoute><MerchCategorias /></ProtectedRoute>} />
            <Route path="/merch/produtos" element={<ProtectedRoute><MerchProdutos /></ProtectedRoute>} />
            <Route path="/merch/mix" element={<ProtectedRoute><MerchMixPDV /></ProtectedRoute>} />
            <Route path="/merch/redes" element={<ProtectedRoute><MerchRedes /></ProtectedRoute>} />
            <Route path="/merch/relatorios" element={<ProtectedRoute><MerchRelatorios /></ProtectedRoute>} />
            <Route path="/merch/contratos" element={<ProtectedRoute><MerchContratos /></ProtectedRoute>} />
            <Route path="/merch/equipe" element={<ProtectedRoute><MerchEquipe /></ProtectedRoute>} />
            <Route path="/merch/rotas" element={<ProtectedRoute><MerchRotas /></ProtectedRoute>} />
            <Route path="/merch/execucao" element={<ProtectedRoute><MerchExecucao /></ProtectedRoute>} />
            <Route path="/merch/checklists" element={<ProtectedRoute><MerchChecklists /></ProtectedRoute>} />
            <Route path="/merch/book-fotos" element={<ProtectedRoute><MerchBookFotos /></ProtectedRoute>} />
            <Route path="/merch/auditoria" element={<ProtectedRoute><MerchAuditoria /></ProtectedRoute>} />
            <Route path="/merch/perdas" element={<ProtectedRoute><MerchPerdas /></ProtectedRoute>} />

            <Route path="/merch/pesquisa-precos" element={<ProtectedRoute><MerchPesquisaPrecos /></ProtectedRoute>} />
            <Route path="/merch/pesquisa-dashboard" element={<ProtectedRoute><MerchPesquisaDashboard /></ProtectedRoute>} />
            <Route path="/controle-acesso" element={<ProtectedRoute><AccessControlAdmin /></ProtectedRoute>} />
            <Route path="/totem" element={<TotemAccess />} />
            <Route path="/acesso-supermercado" element={<SupermarketLandingPage />} />
            {/* Agency Portal */}
            <Route path="/agencia/login" element={<AgencyAuthProvider><AgencyLogin /></AgencyAuthProvider>} />
            <Route path="/agencia/cadastro" element={<AgencySignup />} />
            <Route path="/agencia" element={<AgencyAuthProvider><AgencyLayout /></AgencyAuthProvider>}>
              <Route path="dashboard" element={<AgencyDashboard />} />
              <Route path="promotores" element={<AgencyPromoters />} />
              <Route path="marcas" element={<AgencyBrands />} />
              <Route path="visitas" element={<AgencyVisitRequests />} />
              <Route path="afastamentos" element={<AgencyLeaves />} />
              <Route path="regras" element={<AgencyAccessRules />} />
              <Route path="solicitar-acesso" element={<AgencyNetworkRequest />} />
            </Route>
            {/* Supermarket Portal */}
            <Route path="/supermercado/login" element={<SupermarketAuthProvider><SupermarketLogin /></SupermarketAuthProvider>} />
            <Route path="/supermercado" element={<SupermarketAuthProvider><SupermarketLayout /></SupermarketAuthProvider>}>
              <Route path="dashboard" element={<SupermarketDashboard />} />
              <Route path="ocorrencias" element={<SupermarketIncidents />} />
              <Route path="visitas" element={<SupermarketVisitRequests />} />
              <Route path="acessos" element={<SupermarketAccessRequests />} />
              <Route path="contatos" element={<SupermarketContacts />} />
              <Route path="assistente" element={<SupermarketAssistant />} />
              <Route path="historico" element={<SupermarketHistory />} />
              <Route path="configuracoes" element={<SupermarketSettings />} />
            </Route>
            {/* Network Portal (Visão 360°) */}
            <Route path="/rede/login" element={<NetworkAuthProvider><NetworkLogin /></NetworkAuthProvider>} />
            <Route path="/rede" element={<NetworkAuthProvider><NetworkLayout /></NetworkAuthProvider>}>
              <Route path="dashboard" element={<NetworkDashboard />} />
              <Route path="pdvs" element={<NetworkUnits />} />
              <Route path="parceiros" element={<NetworkPartners />} />
              <Route path="marcas" element={<NetworkBrands />} />
              <Route path="bloqueios" element={<NetworkBlocks />} />
              <Route path="solicitacoes" element={<NetworkUnits />} />
              <Route path="solicitacoes-acesso" element={<NetworkAccessRequests />} />
              <Route path="cadastros-agencia" element={<NetworkAgencySignups />} />
              <Route path="qrcodes" element={<NetworkPdvQrCodes />} />
              <Route path="documentos-exigidos" element={<NetworkDocRequirements />} />

              <Route path="auditoria" element={<NetworkAudit />} />
              <Route path="configuracoes" element={<NetworkSettings />} />
            </Route>
            {/* External Promoter PWA (agencies without Ayratech) */}
            <Route path="/p" element={<PromoterAppAuthProvider><PromoterAppHome /></PromoterAppAuthProvider>} />
            <Route path="/p/login" element={<PromoterAppAuthProvider><PromoterAppLogin /></PromoterAppAuthProvider>} />
            <Route path="/p/home" element={<PromoterAppAuthProvider><PromoterAppHome /></PromoterAppAuthProvider>} />
            <Route path="/p/scanner" element={<PromoterAppAuthProvider><PromoterAppScanner /></PromoterAppAuthProvider>} />
            <Route path="/p/visit" element={<PromoterAppAuthProvider><PromoterAppVisit /></PromoterAppAuthProvider>} />
            <Route path="/p/history" element={<PromoterAppAuthProvider><PromoterAppHistory /></PromoterAppAuthProvider>} />
            {/* Promotor App */}
            <Route path="/promotor/login" element={<PromotorLogin />} />
            <Route path="/promotor/home" element={<PromotorHome />} />
            <Route path="/promotor/agenda" element={<PromotorAgenda />} />
            <Route path="/promotor/rota/:id" element={<PromotorRota />} />
            <Route path="/promotor/avarias" element={<PromotorAvarias />} />
            <Route path="/promotor/documentos" element={<PromotorDocumentos />} />
            <Route path="/promotor/ponto" element={<PromotorPonto />} />
            <Route path="/promotor/enviar" element={<PromotorEnviar />} />
            <Route path="/promotor/configuracoes" element={<PromotorConfig />} />
            <Route path="/promotor/trocar-senha" element={<PromotorTrocarSenha />} />
            <Route path="/promotor/equipe" element={<PromotorEquipe />} />
            {/* App do Colaborador (Anatriello Gestão) */}
            <Route path="/colaborador/login" element={<PromotorLogin />} />
            <Route path="/colaborador" element={<Navigate to="/colaborador/home" replace />} />
            <Route path="/colaborador/home" element={<ColabProtectedRoute><ColaboradorHome /></ColabProtectedRoute>} />
            <Route path="/colaborador/jornada" element={<ColabProtectedRoute><RequireCap cap="journey.view"><ColaboradorJornada /></RequireCap></ColabProtectedRoute>} />
            <Route path="/colaborador/espelho" element={<ColabProtectedRoute><ColaboradorEspelho /></ColabProtectedRoute>} />

            <Route path="/colaborador/solicitacoes" element={<ColabProtectedRoute><RequireCap cap="requests.view"><ColaboradorSolicitacoes /></RequireCap></ColabProtectedRoute>} />
            <Route path="/colaborador/ferias" element={<ColabProtectedRoute><RequireCap cap="vacations.view"><ColaboradorFerias /></RequireCap></ColabProtectedRoute>} />
            <Route path="/colaborador/holerite" element={<ColabProtectedRoute><RequireCap cap="payslip.view"><ColaboradorHolerite /></RequireCap></ColabProtectedRoute>} />
            <Route path="/colaborador/documentos" element={<ColabProtectedRoute><RequireCap cap="documents.view"><ColaboradorDocumentos /></RequireCap></ColabProtectedRoute>} />
            <Route path="/colaborador/beneficios" element={<ColabProtectedRoute><RequireCap cap="benefits.view"><ColaboradorBeneficios /></RequireCap></ColabProtectedRoute>} />
            <Route path="/colaborador/perfil" element={<ColabProtectedRoute><RequireCap cap="profile.view"><ColaboradorPerfil /></RequireCap></ColabProtectedRoute>} />
            <Route path="/colaborador/biometria" element={<ColabProtectedRoute><ColaboradorBiometria /></ColabProtectedRoute>} />
            <Route path="/colaborador/configuracoes" element={<ColabProtectedRoute><ColaboradorConfiguracoes /></ColabProtectedRoute>} />
            <Route path="/colaborador/dados" element={<ColabProtectedRoute><ColaboradorDados /></ColabProtectedRoute>} />
            {/* Compat: rotas antigas /app/* redirecionam para /colaborador/* */}
            <Route path="/app" element={<Navigate to="/colaborador/home" replace />} />
            <Route path="/app/*" element={<Navigate to="/colaborador/home" replace />} />
            <Route path="/app/login" element={<Navigate to="/colaborador/login" replace />} />



            {/* Ayratech Access (Access Only App) */}
            <Route path="/acesso/promotor/login" element={<AccessLogin />} />
            <Route path="/acesso/promotor/home" element={<AccessOnlyHome />} />
            {/* SmartRoute AI - Admin */}
            <Route path="/smartroute" element={<ProtectedRoute><SmartRouteDashboard /></ProtectedRoute>} />
            <Route path="/smartroute/mapa" element={<ProtectedRoute><SmartRouteMapa /></ProtectedRoute>} />
            <Route path="/smartroute/rotas" element={<ProtectedRoute><SmartRouteRotas /></ProtectedRoute>} />
            <Route path="/smartroute/rotas-montadas" element={<ProtectedRoute><SmartRouteRotasMontadas /></ProtectedRoute>} />
            <Route path="/smartroute/rota-do-dia" element={<ProtectedRoute><SmartRouteRotaDoDia /></ProtectedRoute>} />
            <Route path="/smartroute/simulador" element={<ProtectedRoute><SmartRouteSimulador /></ProtectedRoute>} />
            <Route path="/smartroute/pedidos" element={<ProtectedRoute><SmartRoutePedidos /></ProtectedRoute>} />
            <Route path="/smartroute/pdvs" element={<ProtectedRoute><SmartRoutePDVs /></ProtectedRoute>} />
            <Route path="/smartroute/frota" element={<ProtectedRoute><SmartRouteFrota /></ProtectedRoute>} />
            <Route path="/smartroute/cds" element={<ProtectedRoute><SmartRouteCDs /></ProtectedRoute>} />
            <Route path="/smartroute/motoristas" element={<ProtectedRoute><SmartRouteMotoristas /></ProtectedRoute>} />
            <Route path="/smartroute/ia" element={<ProtectedRoute><SmartRouteIA /></ProtectedRoute>} />
            <Route path="/smartroute/gestor-ia" element={<ProtectedRoute><SmartRouteGestorIA /></ProtectedRoute>} />
            <Route path="/smartroute/prompts" element={<ProtectedRoute><SmartRoutePrompts /></ProtectedRoute>} />
            <Route path="/smartroute/replay/:id" element={<ProtectedRoute><SmartRouteReplay /></ProtectedRoute>} />
            <Route path="/smartroute/integracoes" element={<ProtectedRoute><SmartRouteIntegracoes /></ProtectedRoute>} />
            <Route path="/smartroute/relatorios" element={<ProtectedRoute><SmartRouteRelatorios /></ProtectedRoute>} />
            <Route path="/smartroute/configuracoes" element={<ProtectedRoute><SmartRouteConfiguracoes /></ProtectedRoute>} />
            <Route path="/smartroute/checklists" element={<ProtectedRoute><SmartRouteChecklists /></ProtectedRoute>} />
            <Route path="/smartroute/documentacao" element={<ProtectedRoute><SmartRouteDocumentacao /></ProtectedRoute>} />
            <Route path="/smartroute/monitoramento" element={<ProtectedRoute><SmartRouteMonitoramento /></ProtectedRoute>} />
            <Route path="/smartroute/ocorrencias" element={<ProtectedRoute><SmartRouteOcorrencias /></ProtectedRoute>} />
            <Route path="/smartroute/pos-analise" element={<ProtectedRoute><SmartRoutePosAnalise /></ProtectedRoute>} />
            <Route path="/smartroute/planejador" element={<ProtectedRoute><SmartRoutePlanejador /></ProtectedRoute>} />

            <Route path="/track/:token" element={<TrackingPage />} />

            {/* SmartRoute AI - Driver App */}
            <Route path="/entregador/login" element={<DriverAuthProvider><EntregadorLogin /></DriverAuthProvider>} />
            <Route path="/entregador" element={<DriverAuthProvider><EntregadorHome /></DriverAuthProvider>} />
            <Route path="/entregador/home" element={<DriverAuthProvider><EntregadorHome /></DriverAuthProvider>} />
            <Route path="/entregador/rota/:id" element={<DriverAuthProvider><EntregadorRota /></DriverAuthProvider>} />
            <Route path="/entregador/entrega/:id" element={<DriverAuthProvider><EntregadorEntrega /></DriverAuthProvider>} />
            <Route path="/entregador/ponto" element={<DriverAuthProvider><EntregadorPonto /></DriverAuthProvider>} />
            <Route path="/entregador/avaria" element={<DriverAuthProvider><EntregadorAvaria /></DriverAuthProvider>} />
            <Route path="/entregador/devolucao" element={<DriverAuthProvider><EntregadorDevolucao /></DriverAuthProvider>} />
            <Route path="/entregador/historico" element={<DriverAuthProvider><EntregadorHistorico /></DriverAuthProvider>} />

            <Route path="/api-docs" element={<ApiDocumentation />} />
            <Route path="/f/:slug" element={<PublicFormPage />} />
            <Route path="/assinar/:token" element={<AssinarDocumento />} />
            <Route path="/book/:token" element={<PublicPhotoBook />} />
            <Route path="/verificar/:documentId" element={<VerificarDocumento />} />
            <Route path="/politica-privacidade" element={<PoliticaPrivacidade />} />
            <Route path="/termos-servico" element={<TermosServico />} />
            <Route path="/exclusao-dados" element={<ExclusaoDados />} />
            <Route path="/maintenance" element={<MaintenancePage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
