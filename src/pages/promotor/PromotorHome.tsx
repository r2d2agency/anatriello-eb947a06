import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { usePromotorHome, usePromotorPunch, usePromotorOvertimeRequest } from "@/hooks/use-promotor";
import { useOfflineSync } from "@/hooks/use-offline-sync";
import { CameraCapture } from "@/components/promotor/CameraCapture";
import { FaceVerifyDialog } from "@/components/facial-recognition/FaceVerifyDialog";
import { LocalImage } from "@/components/promotor/LocalImage";
import { PromotorLayout } from "./PromotorLayout";
import {
  Clock, FileText, Bell, MapPin, Wifi, WifiOff, Navigation, AlertTriangle, CheckCircle2,
  Loader2, ShieldAlert, Timer, ChevronRight, PlayCircle, Package, Store, ScanFace,
  Download, Check, QrCode, Camera
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { logger } from "@/lib/logger";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { SyncStatusIndicator } from "@/components/promotor/SyncStatusIndicator";

const STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-blue-500/20 text-blue-700',
  confirmed: 'bg-cyan-500/20 text-cyan-700',
  in_progress: 'bg-orange-500/20 text-orange-700',
  completed: 'bg-green-500/20 text-green-700',
  not_done: 'bg-red-500/20 text-red-700',
  cancelled: 'bg-muted text-muted-foreground',
  awaiting_checkout: 'bg-yellow-500/20 text-yellow-700',
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Agendada', confirmed: 'Confirmada', in_progress: 'Em Andamento',
  completed: 'Concluída', not_done: 'Não Realizada', cancelled: 'Cancelada',
  awaiting_checkout: 'Aguardando Checkout',
};

export default function PromotorHome() {
  const { data, isLoading } = usePromotorHome();
  const punch = usePromotorPunch();
  const overtimeReq = usePromotorOvertimeRequest();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { isOnline, isSyncing, queueApiCall } = useOfflineSync();
  const [gpsStatus, setGpsStatus] = useState<'checking' | 'active' | 'denied' | 'off'>('checking');
  const [currentPos, setCurrentPos] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [punchLoading, setPunchLoading] = useState(false);
  const [overtimeDialog, setOvertimeDialog] = useState(false);
  const [otForm, setOtForm] = useState({ reason: '', requested_start: '', requested_end: '' });
  const [showPdvCheckout, setShowPdvCheckout] = useState(false);
  const [pdvCheckoutPhoto, setPdvCheckoutPhoto] = useState('');
  const [pdvCheckoutNotes, setPdvCheckoutNotes] = useState('');
  const [pdvCheckoutLoading, setPdvCheckoutLoading] = useState(false);
  const [showPdvCheckin, setShowPdvCheckin] = useState(false);
  const [pdvCheckinPhoto, setPdvCheckinPhoto] = useState('');
  const [pdvCheckinLoading, setPdvCheckinLoading] = useState(false);
  const [actionPdv, setActionPdv] = useState<{ pdv_id: string; pdv_name: string } | null>(null);
  const [showFaceVerify, setShowFaceVerify] = useState(false);
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);
  const [isPreloading, setIsPreloading] = useState(false);
  const [preloadProgress, setPreloadProgress] = useState(0);
  const pdvCheckinRunningRef = useRef(false);
  const queryClient = useQueryClient();

  // Fetch facial config for this promotor
  const promotorToken = localStorage.getItem('promotor_token');
  const { data: facialConfig } = useQuery({
    queryKey: ['promotor-facial-config'],
    queryFn: async () => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (promotorToken) headers['Authorization'] = `Bearer ${promotorToken}`;
      const url = `${(import.meta.env.VITE_API_URL || '').replace(/\/$/, '')}/api/promotor/facial-config`;
      const res = await fetch(url, { headers });
      if (!res.ok) return null;
      return res.json();
    },
    retry: false,
    staleTime: 300000,
  });

  const isFacialActive = facialConfig?.enabled && 
    facialConfig?.use_for_attendance && 
    facialConfig?.has_enrollment && 
    facialConfig?.verification_enabled !== false;

  const employee = data?.employee;
  const todayPunches = data?.today_punches || [];
  const pendingDocs = data?.pending_docs_count || 0;
  const notifications = data?.notifications || [];
  const dailyAssignment = data?.daily_assignment;
  const availablePdvs = data?.available_pdvs || [];
  const scheduleStatus = data?.schedule_status;
  const todayRoutes = data?.today_routes || [];
  const activeRoute = data?.active_route;
  const nextRoute = data?.next_route;
  const hasRoutesToday = data?.has_routes_today || false;
  const completedRoutesCount = data?.completed_routes_count || 0;
  const pendingRoutesCount = data?.pending_routes_count || 0;
  const pdvVisits = data?.pdv_visits || [];

  // Auto-preload data whenever we have routes and are online
  useEffect(() => {
    if (isOnline && todayRoutes.length > 0 && !isPreloading) {
      const hasUncachedRoutes = todayRoutes.some((r: any) => {
        const state = queryClient.getQueryState(['promotor-route', r.id]);
        return !state || state.status === 'error';
      });

      if (hasUncachedRoutes) {
        logger.info('[Auto-Preload] Iniciando pré-carregamento automático de rotas');
        handlePreloadData();
      }
    }
  }, [isOnline, todayRoutes.length, queryClient]);

  // Detect PDVs where all routes are completed but no checkout was done
  const pdvsNeedingCheckout = useMemo(() => {
    if (!todayRoutes.length) return [];
    const pdvMap: Record<string, { pdv_id: string; pdv_name: string; routes: any[] }> = {};
    todayRoutes.forEach((r: any) => {
      if (!pdvMap[r.pdv_id]) pdvMap[r.pdv_id] = { pdv_id: r.pdv_id, pdv_name: r.pdv_name, routes: [] };
      pdvMap[r.pdv_id].routes.push(r);
    });
    return Object.values(pdvMap).filter(p => {
      const allCompleted = p.routes.length > 0 && p.routes.every((r: any) => r.status === 'completed');
      const hasCheckout = pdvVisits.some((v: any) => v.pdv_id === p.pdv_id && v.checkout_at);
      return allCompleted && !hasCheckout;
    });
  }, [todayRoutes, pdvVisits]);

  // PDV Check-in handler
  const handlePdvCheckin = useCallback(async (pdvId: string, photoOverride?: string) => {
    const effectivePhoto = photoOverride || pdvCheckinPhoto;
    if (pdvCheckinRunningRef.current) return;
    if (!effectivePhoto) {
      toast({ title: 'Foto obrigatória', description: 'Tire uma foto da fachada da loja para o check-in.', variant: 'destructive' });
      return;
    }
    pdvCheckinRunningRef.current = true;
    setPdvCheckinLoading(true);
    try {
      logger.info('[handlePdvCheckin] Iniciando check-in da loja', { pdvId });
      
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { 
          enableHighAccuracy: true, 
          timeout: 15000,
          maximumAge: 0
        })
      ).catch(err => {
        logger.error('[handlePdvCheckin] Erro de GPS', { err, pdvId });
        throw new Error('Não foi possível obter sua localização. Verifique se o GPS está ativado.');
      });

      const baseUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
      
      // Buscamos a rota ativa do PDV para usar o id correto.
      const activeRouteForPdv = todayRoutes.find((r: any) => r.pdv_id === pdvId && r.status !== 'completed');
      if (!activeRouteForPdv?.id) {
        logger.warn('[handlePdvCheckin] Nenhuma rota ativa encontrada', { pdvId, todayRoutes });
        throw new Error('Nenhuma rota ativa encontrada para este PDV.');
      }
      
      const url = `${baseUrl}/api/merch/promotor/routes/${activeRouteForPdv.id}/checkin`;
      
      logger.info('[handlePdvCheckin] Chamando API', { url, pdvId, routeId: activeRouteForPdv.id });

      const body = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        photo_url: effectivePhoto,
        all_routes_at_pdv: true
      };

      const markPdvRoutesCheckedIn = () => {
        todayRoutes
          .filter((r: any) => r.pdv_id === pdvId && r.status !== 'completed')
          .forEach((r: any) => {
            queryClient.setQueryData(['promotor-route', r.id], (old: any) => old ? {
              ...old,
              status: 'in_progress',
              checkin_at: old.checkin_at || new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }),
              checkin_photo_url: old.checkin_photo_url || effectivePhoto,
            } : old);
          });
        queryClient.invalidateQueries({ queryKey: ['promotor-route'] });
        queryClient.invalidateQueries({ queryKey: ['promotor-home'] });
      };

      if (!isOnline) {
        await queueApiCall({
          url: `/api/merch/promotor/routes/${activeRouteForPdv.id}/checkin`,
          method: 'POST',
          body,
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('promotor_token') || localStorage.getItem('auth_token')}`
          },
          dependsOnUploadId: effectivePhoto.startsWith('local-file://') ? effectivePhoto.replace('local-file://', '') : undefined
        });

        // toast({ title: 'Check-in salvo offline!', description: 'Será sincronizado automaticamente.' });
        markPdvRoutesCheckedIn();
        setShowPdvCheckin(false);
        setPdvCheckinPhoto('');
        setTimeout(() => navigate(`/promotor/rota/${activeRouteForPdv.id}`), 100);
        return;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(localStorage.getItem('promotor_token') || localStorage.getItem('auth_token') 
              ? { 'Authorization': `Bearer ${localStorage.getItem('promotor_token') || localStorage.getItem('auth_token')}` } 
              : {})
        },
        body: JSON.stringify(body),
      });

      let result;
      const rawResponse = await response.text();
      try {
        result = rawResponse ? JSON.parse(rawResponse) : {};
      } catch (e) {
        logger.error('[handlePdvCheckin] Erro ao processar JSON da API', { e, pdvId, status: response.status, raw: rawResponse.slice(0, 500) });
        throw new Error(`Erro na resposta do servidor (${response.status})`);
      }

      if (!response.ok) {
        logger.warn('[handlePdvCheckin] API retornou erro', { result, pdvId, status: response.status });
        throw new Error(result?.error || result?.message || 'Erro ao realizar check-in');
      }

      logger.info('[handlePdvCheckin] Check-in realizado com sucesso', { pdvId, routeId: activeRouteForPdv.id });
      toast({ title: 'Check-in da loja realizado!' });
      
      // Limpa estados e navega
      markPdvRoutesCheckedIn();
      setShowPdvCheckin(false);
      setPdvCheckinPhoto('');
      
      // Pequeno delay para garantir que o estado local foi limpo antes de navegar
      setTimeout(() => {
        navigate(`/promotor/rota/${activeRouteForPdv.id}`);
      }, 100);
      
    } catch (err: any) {
      logger.error('[handlePdvCheckin] Erro fatal no check-in', { message: err.message, pdvId }, err);
      toast({ 
        title: 'Erro no check-in', 
        description: err.message || 'Erro desconhecido', 
        variant: 'destructive' 
      });
    } finally {
      setPdvCheckinLoading(false);
      pdvCheckinRunningRef.current = false;
    }
  }, [pdvCheckinPhoto, todayRoutes, navigate, toast, isOnline, queueApiCall, queryClient]);

  const handlePdvCheckout = useCallback(async (pdvId: string) => {
    setPdvCheckoutLoading(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 })
      );
      const token = localStorage.getItem('promotor_token') || localStorage.getItem('auth_token') || '';
      const headers: Record<string, string> = { 
        'Content-Type': 'application/json'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const url = `${(import.meta.env.VITE_API_URL || '').replace(/\/$/, '')}/api/merch/promotor/pdv-checkout`;
      const body = {
        pdv_id: pdvId,
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        photo_url: pdvCheckoutPhoto || undefined,
        notes: pdvCheckoutNotes || undefined,
        status_override: !pdvCheckoutPhoto ? 'awaiting_photo' : 'completed'
      };

      if (!isOnline) {
        await queueApiCall({
          url: '/api/merch/promotor/pdv-checkout',
          method: 'POST',
          body,
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
          dependsOnUploadId: pdvCheckoutPhoto.startsWith('local-file://') ? pdvCheckoutPhoto.replace('local-file://', '') : undefined
        });

        // toast({ title: 'Checkout salvo offline!', description: 'Será sincronizado automaticamente.' });
        setShowPdvCheckout(false);
        setPdvCheckoutPhoto('');
        setPdvCheckoutNotes('');
        setPunchLoading(false); // Reset loading state
        return;
      }

      const response = await fetch(url, {
        method: 'POST', headers,
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'Erro');
      toast({ title: 'Checkout do PDV realizado!' });
      setShowPdvCheckout(false);
      setPdvCheckoutPhoto('');
      setPdvCheckoutNotes('');
    } catch (err: any) {
      toast({ title: 'Erro no checkout', description: err.message, variant: 'destructive' });
    } finally {
      setPdvCheckoutLoading(false);
    }
  }, [pdvCheckoutPhoto, pdvCheckoutNotes, toast]);

  const handleQrScan = async (scannedId: string) => {
    setQrLoading(true);
    try {
      logger.info('[handleQrScan] Processando scan de QR Code', { scannedId });
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 })
      );
      
      const res = await api<any>('/api/access-control/qr-scan', {
        method: 'POST',
        body: {
          unit_id: scannedId,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude
        }
      });
      
      toast({ title: 'Solicitação enviada!', description: 'Aguarde a liberação do supermercado.' });
      setShowQrScanner(false);
      // Invalida o home para ver se alguma nova rota apareceu ou se o status mudou
      queryClient.invalidateQueries({ queryKey: ['promotor-home'] });
    } catch (err: any) {
      toast({ title: 'Erro no scan', description: err.message, variant: 'destructive' });
    } finally {
      setQrLoading(false);
    }
  };

  // Offline handling is now centralized in useOfflineSync hook
  /*
  useEffect(() => {
    const onOn = () => setIsOnline(true);
    const onOff = () => setIsOnline(false);
    window.addEventListener('online', onOn);
    window.addEventListener('offline', onOff);
    return () => { window.removeEventListener('online', onOn); window.removeEventListener('offline', onOff); };
  }, []);
  */

  useEffect(() => {
    if (!navigator.geolocation) { setGpsStatus('off'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { 
        setCurrentPos({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }); 
        setGpsStatus('active'); 
      },
      (err) => { 
        console.warn('[GPS] Background check failed:', err);
        setGpsStatus(err.code === 1 ? 'denied' : 'off'); 
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, []);

  const getNextPunchType = () => {
    const types = ['entrada', 'saida_intervalo', 'retorno_intervalo', 'saida'];
    return types[todayPunches.length] || 'extraordinaria';
  };

  const PUNCH_LABELS: Record<string, string> = {
    entrada: '🟢 Entrada', saida_intervalo: '🟡 Saída Intervalo', retorno_intervalo: '🔵 Retorno Intervalo', saida: '🔴 Saída', extraordinaria: '⚪ Extra'
  };

  const canPunch = scheduleStatus?.is_within_schedule || scheduleStatus?.has_overtime_approval;
  const isOutsideSchedule = scheduleStatus && !scheduleStatus.is_within_schedule;

  const handlePunch = async (facialVerified = false) => {
    if (gpsStatus !== 'active' || !currentPos) {
      toast({ title: 'GPS necessário', description: 'Ative a localização para bater o ponto', variant: 'destructive' });
      return;
    }
    // If facial is active, require verification first
    if (isFacialActive && !facialVerified) {
      setShowFaceVerify(true);
      return;
    }
    setPunchLoading(true);
    try {
      const pdvId = dailyAssignment?.pdv_id || availablePdvs[0]?.id;
      const punchType = getNextPunchType();
      const body = {
        punch_type: punchType,
        latitude: currentPos.lat,
        longitude: currentPos.lng,
        accuracy_meters: currentPos.accuracy,
        pdv_id: pdvId,
        facial_verified: facialVerified || undefined,
        offline_timestamp: !isOnline ? new Date().toISOString() : undefined,
      };

      if (!isOnline) {
        await queueApiCall({
          url: '/api/rh/ponto/punch',
          method: 'POST',
          body,
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('promotor_token') || localStorage.getItem('auth_token')}`
          }
        });

        /* toast({ 
          title: 'Ponto salvo offline!', 
          description: `Bateu: ${PUNCH_LABELS[punchType]}. Será sincronizado ao voltar a internet.` 
        }); */

        return;
      }

      await punch.mutateAsync(body);
      toast({ title: 'Ponto registrado!', description: PUNCH_LABELS[punchType] });
    } catch (err: any) {
      if (err.message?.includes('horário de trabalho') || err.message?.includes('OUTSIDE_SCHEDULE')) {
        setOvertimeDialog(true);
      }
      toast({ title: 'Erro ao registrar ponto', description: err.message, variant: 'destructive' });
    } finally {
      setPunchLoading(false);
    }
  };

  const handleFaceVerifyResult = (result: { match: boolean; score: number; imageDataUrl: string }) => {
    setShowFaceVerify(false);
    if (result.match) {
      toast({ title: '✅ Identidade confirmada', description: `Similaridade: ${result.score.toFixed(1)}%` });
      // Trigger punch after successful facial
      setTimeout(() => {
        handlePunch(true);
      }, 300);
    } else {
      toast({ title: '❌ Identidade não confirmada', description: `Similaridade: ${result.score.toFixed(1)}%. Ponto bloqueado.`, variant: 'destructive' });
    }
  };

  const handleOvertimeRequest = async () => {
    if (!otForm.reason.trim()) {
      toast({ title: 'Informe o motivo', variant: 'destructive' });
      return;
    }
    try {
      await overtimeReq.mutateAsync({
        reason: otForm.reason,
        requested_start: otForm.requested_start || undefined,
        requested_end: otForm.requested_end || undefined,
      });
      toast({ title: 'Solicitação enviada!', description: 'Aguarde a aprovação do supervisor' });
      setOvertimeDialog(false);
      setOtForm({ reason: '', requested_start: '', requested_end: '' });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  const handlePreloadData = async () => {
    if (!todayRoutes.length) {
      toast({ title: 'Sem rotas', description: 'Não há rotas para baixar hoje.' });
      return;
    }
    
    setIsPreloading(true);
    setPreloadProgress(0);
    logger.info('[Preload] Iniciando download de dados para uso offline', { routeCount: todayRoutes.length });
    
    try {
      let completed = 0;
      const total = todayRoutes.length;
      
      for (const route of todayRoutes) {
        // Prefetch each route detail. React Query will store this in its cache.
        await queryClient.prefetchQuery({
          queryKey: ['promotor-route', route.id],
          queryFn: async () => {
            const token = localStorage.getItem('promotor_token') || localStorage.getItem('auth_token');
            const url = `${(import.meta.env.VITE_API_URL || '').replace(/\/$/, '')}/api/merch/promotor/routes/${route.id}`;
            const res = await fetch(url, {
              headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Falha ao baixar rota');
            return res.json();
          },
          staleTime: 1000 * 60 * 60 * 24,
        });
        
        completed++;
        setPreloadProgress(Math.round((completed / total) * 100));
      }
      
      toast({ 
        title: 'Dados baixados!', 
        description: `${total} rotas e checklists preparados para uso offline.`,
        className: "bg-green-50 border-green-200"
      });
    } catch (err: any) {
      logger.error('[Preload] Erro ao baixar dados', { error: err.message });
      toast({ title: 'Erro no download', description: 'Não foi possível baixar todos os dados. Tente novamente.', variant: 'destructive' });
    } finally {
      setIsPreloading(false);
    }
  };

  if (isLoading) return <PromotorLayout><div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></PromotorLayout>;

  return (
    <PromotorLayout>
      <div className="space-y-4 p-4 max-w-lg mx-auto">
        {/* Status bar */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <SyncStatusIndicator />
            {gpsStatus === 'active' ? (
              <Badge variant="outline" className="text-green-600 border-green-300 py-1 px-2 h-7">
                <Navigation className="h-3 w-3 mr-1" />GPS
              </Badge>
            ) : (
              <Badge variant="destructive" className="py-1 px-2 h-7">
                <AlertTriangle className="h-3 w-3 mr-1" />GPS {gpsStatus === 'denied' ? 'Negado' : 'Desligado'}
              </Badge>
            )}
          </div>
          <span className="text-muted-foreground">{format(new Date(), "EEEE, dd 'de' MMMM", { locale: ptBR })}</span>
        </div>

        {/* GPS Warning */}
        {gpsStatus !== 'active' && (
          <Card className="border-destructive bg-destructive/5">
            <CardContent className="p-3 flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-destructive">GPS está desligado</p>
                <p className="text-xs text-muted-foreground">Ative a localização para registrar o ponto</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Offline Warning */}
        {!isOnline && (
          <Card className="border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20">
            <CardContent className="p-3 flex items-center gap-3">
              <WifiOff className="h-5 w-5 text-yellow-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium">Você está sem internet</p>
                <p className="text-xs text-muted-foreground">Os dados serão salvos e enviados quando a conexão voltar</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Welcome */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-bold">Olá, {employee?.full_name?.split(' ')[0]}! 👋</h1>
            <p className="text-sm text-muted-foreground">{employee?.position || employee?.worker_profile}</p>
          </div>
          {isOnline && (
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                className="h-8 text-[10px] gap-1.5 border-primary/30 text-primary"
                onClick={() => setShowQrScanner(true)}
              >
                <QrCode className="h-3 w-3" />
                Escanear QR
              </Button>
              {hasRoutesToday && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  className={cn(
                    "h-8 text-[10px] gap-1.5",
                    isPreloading && "border-primary text-primary"
                  )}
                  onClick={handlePreloadData}
                  disabled={isPreloading}
                >
                  {isPreloading ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {preloadProgress}%
                    </>
                  ) : (
                    <>
                      <Download className="h-3 w-3" />
                      Baixar Offline
                    </>
                  )}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* ======= SCENARIO 1: HAS ROUTES TODAY ======= */}
        {hasRoutesToday && (
          <>
            {/* Route summary */}
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">
                📋 {todayRoutes.length} rota{todayRoutes.length > 1 ? 's' : ''} hoje
              </Badge>
              {completedRoutesCount > 0 && (
                <Badge className="bg-green-500/20 text-green-700 text-xs">
                  ✅ {completedRoutesCount} concluída{completedRoutesCount > 1 ? 's' : ''}
                </Badge>
              )}
              {pendingRoutesCount > 0 && (
                <Badge className="bg-blue-500/20 text-blue-700 text-xs">
                  ⏳ {pendingRoutesCount} pendente{pendingRoutesCount > 1 ? 's' : ''}
                </Badge>
              )}
            </div>

            {/* Active route - primary focus */}
            {activeRoute && (
              <Card className="border-orange-400/50 bg-orange-50/50 dark:bg-orange-950/10 cursor-pointer active:scale-[0.98]"
                onClick={() => navigate(`/promotor/rota/${activeRoute.id}`)}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <Badge className="bg-orange-500/20 text-orange-700 text-[10px]">🔥 EM ANDAMENTO</Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <h3 className="font-bold text-base">{activeRoute.pdv_name}</h3>
                  <p className="text-sm text-muted-foreground">{activeRoute.brand_name}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2">
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{activeRoute.pdv_city || activeRoute.pdv_address?.slice(0, 30)}</span>
                    <span className="flex items-center gap-1"><Package className="h-3 w-3" />{activeRoute.products_done || 0}/{activeRoute.product_count || 0} itens</span>
                  </div>
                  {(activeRoute.progress_pct > 0) && (
                    <div className="mt-2">
                      <div className="flex justify-between text-xs mb-0.5">
                        <span>Progresso</span>
                        <span className="font-mono font-bold">{Math.round(activeRoute.progress_pct || 0)}%</span>
                      </div>
                      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${activeRoute.progress_pct || 0}%` }} />
                      </div>
                    </div>
                  )}
                  <Button className="w-full mt-3" size="sm">
                    <PlayCircle className="h-4 w-4 mr-2" /> Continuar Execução
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Next route */}
            {!activeRoute && nextRoute && (
              <Card className="border-primary/30 bg-primary/5 cursor-pointer active:scale-[0.98]"
                onClick={() => {
                  const hasCheckin = pdvVisits.some((v: any) => v.pdv_id === nextRoute.pdv_id && v.checkin_at);
                  if (!hasCheckin) {
                    setActionPdv({ pdv_id: nextRoute.pdv_id, pdv_name: nextRoute.pdv_name });
                    setShowPdvCheckin(true);
                  } else {
                    navigate(`/promotor/rota/${nextRoute.id}`);
                  }
                }}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <Badge className="bg-blue-500/20 text-blue-700 text-[10px]">📍 PRÓXIMA ROTA</Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <h3 className="font-bold text-base">{nextRoute.pdv_name}</h3>
                  <p className="text-sm text-muted-foreground">{nextRoute.brand_name}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2">
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{nextRoute.scheduled_time?.slice(0, 5) || '--:--'}</span>
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{nextRoute.pdv_city || nextRoute.pdv_address?.slice(0, 30)}</span>
                    <span className="flex items-center gap-1"><Package className="h-3 w-3" />{nextRoute.product_count || 0} itens</span>
                  </div>
                  <Button className="w-full mt-3" size="sm" variant="outline">
                    {pdvVisits.some((v: any) => v.pdv_id === nextRoute.pdv_id && v.checkin_at) ? (
                      <><PlayCircle className="h-4 w-4 mr-2" /> Iniciar Rota</>
                    ) : (
                      <><MapPin className="h-4 w-4 mr-2" /> Fazer Check-in na Loja</>
                    )}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* All today's routes */}
            <div>
              <h3 className="text-sm font-semibold mb-2">Rotas do Dia</h3>
              <div className="space-y-2">
                {todayRoutes.map((r: any) => {
                  // Determine if the route should show as "Awaiting Checkout"
                  const isAwaitingCheckout = r.status === 'completed' && pdvVisits && !pdvVisits.some((v: any) => v.pdv_id === r.pdv_id && v.checkout_at);
                  const displayStatus = isAwaitingCheckout ? 'awaiting_checkout' : r.status;
                  
                  return (
                    <Card key={r.id}
                      className={`cursor-pointer active:scale-[0.98] transition-all ${
                        r.id === activeRoute?.id ? 'border-orange-400/50' :
                        r.status === 'completed' && !isAwaitingCheckout ? 'opacity-60' : 'hover:border-primary/30'
                      }`}
                      onClick={() => {
                        if (r.status !== 'cancelled' && r.status !== 'not_done') {
                          navigate(`/promotor/rota/${r.id}`);
                        }
                      }}>

                    <CardContent className="p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">{r.pdv_name}</span>
                            <Badge className={`${STATUS_COLORS[displayStatus] || 'bg-muted'} text-[9px]`}>
                              {STATUS_LABELS[displayStatus] || displayStatus}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                            <span>{r.brand_name}</span>
                            <span>{r.scheduled_time?.slice(0, 5) || '--:--'}</span>
                            <span>{r.product_count || 0} itens</span>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      </div>
                    </CardContent>
                  </Card>
                ); })}
              </div>
            </div>
          </>
        )}

        {/* ======= SCENARIO 2: NO ROUTES TODAY ======= */}
        {!hasRoutesToday && (
          <>
            {/* Schedule Status */}
            {scheduleStatus && (
              <Card className={isOutsideSchedule && !scheduleStatus.has_overtime_approval ? 'border-destructive/50 bg-destructive/5' : 'border-primary/20 bg-primary/5'}>
                <CardContent className="p-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Timer className={`h-5 w-5 ${isOutsideSchedule && !scheduleStatus.has_overtime_approval ? 'text-destructive' : 'text-primary'}`} />
                    <div>
                      <p className="text-sm font-medium">
                        Horário: {(() => {
                          const start = scheduleStatus.schedule_start;
                          const end = scheduleStatus.schedule_end;
                          try {
                            const parsed = typeof start === 'string' && start.startsWith('{') ? JSON.parse(start) : null;
                            if (parsed?.entry) return `${parsed.entry} - ${parsed.exit || end}`;
                          } catch {}
                          return `${String(start || '08:00').slice(0, 5)} - ${String(end || '17:00').slice(0, 5)}`;
                        })()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {scheduleStatus.is_within_schedule
                          ? '✅ Dentro do horário de trabalho'
                          : scheduleStatus.has_overtime_approval
                            ? '✅ Hora extra autorizada'
                            : '🚫 Fora do horário de trabalho'}
                      </p>
                    </div>
                  </div>
                  {isOutsideSchedule && !scheduleStatus.has_overtime_approval && (
                    <Button size="sm" variant="outline" onClick={() => setOvertimeDialog(true)} className="text-xs gap-1">
                      <ShieldAlert className="h-3.5 w-3.5" /> HE
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}

            {/* No routes message */}
            <Card className="border-dashed">
              <CardContent className="p-6 text-center">
                <Clock className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-sm font-medium">Sem rotas para hoje</p>
                <p className="text-xs text-muted-foreground mt-1">Verifique sua agenda para os próximos dias</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate('/promotor/agenda')}>
                  Ver Agenda
                </Button>
              </CardContent>
            </Card>

            {/* PUNCH BUTTON - prominent when no routes */}
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <Button
                  onClick={() => void handlePunch()}
                  disabled={punchLoading || gpsStatus !== 'active' || (!canPunch && isOutsideSchedule)}
                  className={`w-full h-24 rounded-none text-lg font-bold ${
                    !canPunch && isOutsideSchedule
                      ? 'bg-muted text-muted-foreground cursor-not-allowed'
                      : 'bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70'
                  }`}
                >
                  {punchLoading ? <Loader2 className="h-6 w-6 animate-spin mr-2" /> : <Clock className="h-6 w-6 mr-2" />}
                  {!canPunch && isOutsideSchedule
                    ? '🔒 Fora do Horário'
                    : PUNCH_LABELS[getNextPunchType()] || 'Bater Ponto'}
                </Button>
                {!canPunch && isOutsideSchedule && (
                  <div className="p-3 border-t bg-destructive/5 text-center">
                    <p className="text-xs text-destructive font-medium">Ponto bloqueado fora do horário</p>
                    <Button variant="link" size="sm" className="text-xs h-6 p-0" onClick={() => setOvertimeDialog(true)}>
                      Solicitar hora extra ao supervisor →
                    </Button>
                  </div>
                )}
                {todayPunches.length > 0 && (
                  <div className="p-3 border-t space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Registros de hoje:</p>
                    {todayPunches.map((p: any) => (
                      <div key={p.id} className="flex items-center justify-between text-xs">
                        <span>{PUNCH_LABELS[p.punch_type] || p.punch_type}</span>
                        <span className="text-muted-foreground">{safeTime(p.punched_at || p.offline_local_time || p.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {/* PDV Checkout Pending */}
        {pdvsNeedingCheckout.length > 0 && (
          <div className="space-y-2">
            {pdvsNeedingCheckout.map(pdv => (
              <Card key={pdv.pdv_id} className="border-primary/40 bg-primary/5">
                <CardContent className="p-3 flex items-center gap-3">
                  <Store className="h-6 w-6 text-primary flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{pdv.pdv_name}</p>
                    <p className="text-[10px] text-muted-foreground">Todas as rotas concluídas — checkout pendente</p>
                  </div>
                  <Button size="sm" onClick={() => { setShowPdvCheckout(true); setActionPdv(pdv); }}>
                    Checkout
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-3">
          <Card className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => navigate('/promotor/documentos')}>
            <CardContent className="p-4 text-center">
              <FileText className="h-6 w-6 mx-auto mb-1 text-primary" />
              <p className="text-sm font-medium">Documentos</p>
              {pendingDocs > 0 && <Badge variant="destructive" className="mt-1">{pendingDocs} pendentes</Badge>}
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => navigate('/promotor/agenda')}>
            <CardContent className="p-4 text-center">
              <Clock className="h-6 w-6 mx-auto mb-1 text-primary" />
              <p className="text-sm font-medium">Agenda</p>
              <p className="text-xs text-muted-foreground">{todayRoutes.length} rotas hoje</p>
            </CardContent>
          </Card>
        </div>

        {/* Punch button - only when has routes (no-routes scenario already has its own) */}
        {hasRoutesToday && (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            {isFacialActive && (
              <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border-b text-xs text-primary">
                <ScanFace className="h-4 w-4" />
                <span className="font-medium">Verificação facial ativa para ponto</span>
              </div>
            )}
            <Button
              onClick={() => void handlePunch()}
              disabled={punchLoading || gpsStatus !== 'active' || (!canPunch && isOutsideSchedule)}
              className={`w-full h-20 rounded-none text-lg font-bold ${
                !canPunch && isOutsideSchedule
                  ? 'bg-muted text-muted-foreground cursor-not-allowed'
                  : 'bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70'
              }`}
            >
              {punchLoading ? <Loader2 className="h-6 w-6 animate-spin mr-2" /> : isFacialActive ? <ScanFace className="h-6 w-6 mr-2" /> : <Clock className="h-6 w-6 mr-2" />}
              {!canPunch && isOutsideSchedule
                ? '🔒 Fora do Horário'
                : PUNCH_LABELS[getNextPunchType()] || 'Bater Ponto'}
            </Button>
            {!canPunch && isOutsideSchedule && (
              <div className="p-3 border-t bg-destructive/5 text-center">
                <p className="text-xs text-destructive font-medium">Ponto bloqueado fora do horário</p>
                <Button variant="link" size="sm" className="text-xs h-6 p-0" onClick={() => setOvertimeDialog(true)}>
                  Solicitar hora extra ao supervisor →
                </Button>
              </div>
            )}
            {todayPunches.length > 0 && (
              <div className="p-3 border-t space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Registros de hoje:</p>
                {todayPunches.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between text-xs">
                    <span>{PUNCH_LABELS[p.punch_type] || p.punch_type}</span>
                    <span className="text-muted-foreground">{safeTime(p.punched_at || p.offline_local_time || p.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        )}

        {/* Notifications */}
        {notifications.length > 0 && (
          <Card>
            <CardHeader className="p-3 pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Bell className="h-4 w-4" /> Notificações</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 space-y-2">
              {notifications.slice(0, 3).map((n: any) => (
                <div key={n.id} className="flex items-start gap-2 text-xs p-2 bg-muted/50 rounded-lg">
                  <CheckCircle2 className="h-3 w-3 text-primary mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">{n.title}</p>
                    <p className="text-muted-foreground">{n.message}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Overtime Request Dialog */}
      <Dialog open={overtimeDialog} onOpenChange={setOvertimeDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-primary" /> Solicitar Hora Extra
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Seu horário de trabalho é <b>{scheduleStatus?.schedule_start || '--:--'} - {scheduleStatus?.schedule_end || '--:--'}</b>.
              Para registrar ponto fora desse horário, solicite autorização.
            </p>
            <div>
              <Label>Motivo *</Label>
              <Textarea
                value={otForm.reason}
                onChange={e => setOtForm(f => ({ ...f, reason: e.target.value }))}
                placeholder="Ex: Finalizar relatório urgente..."
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Início previsto</Label>
                <Input type="time" value={otForm.requested_start} onChange={e => setOtForm(f => ({ ...f, requested_start: e.target.value }))} />
              </div>
              <div>
                <Label>Fim previsto</Label>
                <Input type="time" value={otForm.requested_end} onChange={e => setOtForm(f => ({ ...f, requested_end: e.target.value }))} />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <Button variant="outline" onClick={() => setOvertimeDialog(false)}>Cancelar</Button>
            <Button onClick={handleOvertimeRequest} disabled={overtimeReq.isPending}>
              {overtimeReq.isPending ? 'Enviando...' : 'Enviar Solicitação'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* PDV Check-in Dialog */}
      <Dialog open={showPdvCheckin} onOpenChange={(open) => { if (!open) { setShowPdvCheckin(false); setActionPdv(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Store className="h-5 w-5 text-primary" /> Check-in da Loja
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-3">
                <p className="text-sm font-medium">{actionPdv?.pdv_name}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Tire uma foto da fachada da loja para iniciar seu trabalho neste PDV.
                </p>
              </CardContent>
            </Card>

            <div className="space-y-2">
              <Label className="text-xs">Foto da Fachada (obrigatória)</Label>
              {pdvCheckinPhoto ? (
                <div className="space-y-2">
                  <LocalImage src={pdvCheckinPhoto} alt="Check-in" className="w-full rounded-lg border max-h-48 object-cover" />
                  <p className="text-xs text-muted-foreground text-center">Registrando check-in...</p>
                </div>
              ) : (
                <CameraCapture
                  onCapture={(url) => {
                    setPdvCheckinPhoto(url);
                    if (actionPdv?.pdv_id) setTimeout(() => { void handlePdvCheckin(actionPdv.pdv_id, url); }, 0);
                  }}
                  watermark={{ pdvName: actionPdv?.pdv_name || '', brandName: '', photoType: 'Check-in PDV' }}
                  customTokenGetter={() => localStorage.getItem('promotor_token')}
                  buttonLabel="Tirar foto da fachada da loja"
                  disabled={pdvCheckinLoading}
                />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowPdvCheckin(false); setActionPdv(null); }} disabled={pdvCheckinLoading}>Cancelar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PDV Checkout Dialog */}
      <Dialog open={showPdvCheckout} onOpenChange={(open) => { if (!open) { setShowPdvCheckout(false); setActionPdv(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Store className="h-5 w-5 text-primary" /> Checkout da Loja
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-3">
                <p className="text-sm font-medium">{actionPdv?.pdv_name}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Todas as rotas foram concluídas. Faça o checkout para encerrar a visita.
                </p>
              </CardContent>
            </Card>

            <div className="space-y-2">
              <Label className="text-xs">Foto de saída (opcional)</Label>
              {pdvCheckoutPhoto ? (
                <div className="space-y-2">
                  <LocalImage src={pdvCheckoutPhoto} alt="Checkout" className="w-full rounded-lg border max-h-48 object-cover" />
                  <Button variant="outline" size="sm" onClick={() => setPdvCheckoutPhoto('')}>Tirar outra foto</Button>
                </div>
              ) : (
                <CameraCapture
                  onCapture={setPdvCheckoutPhoto}
                  watermark={{ pdvName: actionPdv?.pdv_name || '', brandName: '', photoType: 'Checkout PDV' }}
                  customTokenGetter={() => localStorage.getItem('promotor_token')}
                  buttonLabel="Tirar foto de saída da loja"
                />
              )}
            </div>

            <div>
              <Label className="text-xs">Observação</Label>
              <Textarea rows={2} placeholder="Observações sobre a visita..." value={pdvCheckoutNotes} onChange={e => setPdvCheckoutNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => {
              if (actionPdv) handlePdvCheckout(actionPdv.pdv_id);
            }} disabled={pdvCheckoutLoading}>
              Pular Foto
            </Button>
            <Button onClick={() => actionPdv && handlePdvCheckout(actionPdv.pdv_id)} disabled={pdvCheckoutLoading || !pdvCheckoutPhoto}>
              {pdvCheckoutLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Finalizar Checkout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Facial Verification Dialog for Punch */}
      <FaceVerifyDialog
        open={showFaceVerify}
        onOpenChange={setShowFaceVerify}
        storedDescriptor={facialConfig?.descriptor || []}
        storedPhotoUrl={facialConfig?.photo_url}
        personName={employee?.full_name}
        threshold={facialConfig?.min_confidence || 70}
        onResult={handleFaceVerifyResult}
      />
      <Dialog open={showQrScanner} onOpenChange={setShowQrScanner}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Escanear QR Code da Loja</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="w-full aspect-square bg-slate-900 rounded-2xl flex flex-col items-center justify-center relative overflow-hidden">
              {!qrLoading ? (
                <div className="text-center p-6 space-y-4">
                  <QrCode className="h-16 w-16 text-primary mx-auto opacity-50" />
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-white">Posicione o código QR da loja</p>
                    <p className="text-xs text-slate-400">Aponte sua câmera para o código QR afixado na entrada do supermercado.</p>
                  </div>
                  <div className="pt-4">
                    <Button size="sm" onClick={() => handleQrScan('simulated-unit-id')}>
                      <Camera className="h-4 w-4 mr-2" /> Simular Leitura
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-slate-300">Processando acesso...</p>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="w-full" onClick={() => setShowQrScanner(false)} disabled={qrLoading}>
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PromotorLayout>
  );
}