import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell, FileText, Calendar, Megaphone, DollarSign, Loader2, Camera, MapPin,
  ShieldOff, ScanFace, ChevronRight, QrCode, Clock, CheckCircle2, Navigation,
  ShieldCheck,
} from "lucide-react";
import { ColaboradorLayout } from "./ColaboradorLayout";
import { usePromotorHome, usePromotorPunch, usePromotorNotifications } from "@/hooks/use-promotor";
import { useColabAnnouncements, useColabMeFull, useColabAgenda } from "@/hooks/use-promotor";
import { useCaps } from "@/hooks/use-colab-capabilities";
import { FaceVerifyDialog } from "@/components/facial-recognition/FaceVerifyDialog";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { useBranding } from "@/hooks/use-branding";
import { SyncStatusIndicator } from "@/components/promotor/SyncStatusIndicator";
import { db } from "@/lib/offline-db";
import { useLiveQuery } from "dexie-react-hooks";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import anatrielloLogo from "@/assets/anatriello-logo.png.asset.json";

// Até 6 batidas por dia: entrada, café (15 min), almoço, saída
const PUNCH_ORDER = ["entrada", "saida_cafe", "retorno_cafe", "saida_intervalo", "retorno_intervalo", "saida"];
const MAX_PUNCHES_PER_DAY = 6;
const PUNCH_LABEL: Record<string, string> = {
  entrada: "Entrada",
  saida_cafe: "Início Café",
  retorno_cafe: "Fim Café",
  saida_intervalo: "Início Almoço",
  retorno_intervalo: "Fim Almoço",
  saida: "Saída",
};

function saoPauloDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function parsePunchDate(value: any) {
  if (!value) return null;
  if (typeof value === "number") {
    const numericDate = new Date(value);
    return Number.isNaN(numericDate.getTime()) ? null : numericDate;
  }
  const d = new Date(String(value).includes(" ") ? String(value).replace(" ", "T") : String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatPunchTime(value: any) {
  const d = parsePunchDate(value);
  return d ? d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }) : "—";
}

function normalizeFaceDescriptor(input: any): number[] {
  let parsed = input;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { return []; }
  }
  const source = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.descriptor)
      ? parsed.descriptor
      : Array.isArray(parsed?.face_descriptor)
        ? parsed.face_descriptor
        : [];
  return source.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n));
}

async function requestUserCameraOnce(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch {
    return false;
  }
}

export default function ColaboradorHome() {
  const nav = useNavigate();
  const { toast } = useToast();
  const { data, isLoading } = usePromotorHome();
  const { data: meFull } = useColabMeFull();
  const { data: announcements } = useColabAnnouncements();
  const { data: notifications } = usePromotorNotifications();
  const { data: agenda } = useColabAgenda();
  const punch = usePromotorPunch();
  const caps = useCaps();
  const { branding } = useBranding() as any;
  const can = (c: string) => caps.includes(c);
  const [now, setNow] = useState(new Date());
  const [showFace, setShowFace] = useState(false);
  const [gps, setGps] = useState<{ lat: number; lng: number; acc: number } | null>(null);
  const pendingPunches = useLiveQuery(async () => {
    const calls = await db.pending_api_calls.where("status").anyOf("pending", "processing", "failed").toArray();
    return calls
      .filter((call) => call.url === "/api/promotor/punch")
      .map((call) => ({
        id: call.body?.local_id || `pending-${call.id}`,
        local_id: call.body?.local_id,
        punch_type: call.body?.punch_type,
        punched_at: call.body?.offline_local_time || call.timestamp,
        offline_local_time: call.body?.offline_local_time || call.timestamp,
        latitude: call.body?.latitude ?? null,
        longitude: call.body?.longitude ?? null,
        accuracy_meters: call.body?.accuracy_meters ?? null,
        is_offline: true,
        sync_status: call.status === "failed" ? "failed" : "pending",
        pending_local: true,
      }));
  }, [], [] as any[]);

  const { data: faceStatus } = useQuery({
    queryKey: ["colab-face-status"],
    queryFn: async () => {
      const token = localStorage.getItem("promotor_token");
      const url = `${(import.meta.env.VITE_API_URL || "").replace(/\/$/, "")}/api/promotor/face-enrollment`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return null;
      return r.json() as Promise<{ can_enroll: boolean; enrolled: boolean; collection_requested: boolean; face_descriptor?: number[] | null }>;
    },
    refetchInterval: 60000,
  });

  useEffect(() => { const i = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(i); }, []);
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      p => setGps({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      () => {},
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  const employeeBase = data?.employee || meFull?.employee || {};
  const employeeFull = meFull?.employee || {};
  // Merge: home é fonte principal, mas complementa com meFull p/ campos ausentes (face_descriptor, facial_required, etc.)
  const employee: any = { ...employeeFull, ...employeeBase };
  // Normaliza descriptor (pode vir como array, objeto { descriptor } ou string JSON do Postgres JSONB)
  let faceDescriptor = normalizeFaceDescriptor(employee.face_descriptor);
  if (!faceDescriptor.length && employeeFull.face_descriptor) {
    faceDescriptor = normalizeFaceDescriptor(employeeFull.face_descriptor);
  }
  if (!faceDescriptor.length && faceStatus?.face_descriptor) faceDescriptor = normalizeFaceDescriptor(faceStatus.face_descriptor);
  const todayKey = saoPauloDateKey(now);
  const punches = useMemo(() => {
    const merged = [...(data?.today_punches || []), ...(pendingPunches || [])];
    const unique = new Map<string, any>();
    merged.forEach((p: any) => {
      const ts = p.punched_at || p.offline_local_time || p.created_at;
      const date = parsePunchDate(ts);
      if (date && saoPauloDateKey(date) !== todayKey) return;
      unique.set(String(p.id || p.local_id || ts), p);
    });
    return Array.from(unique.values()).sort((a: any, b: any) => {
      const da = parsePunchDate(a.punched_at || a.offline_local_time || a.created_at)?.getTime() || 0;
      const dbt = parsePunchDate(b.punched_at || b.offline_local_time || b.created_at)?.getTime() || 0;
      return da - dbt;
    });
  }, [data?.today_punches, pendingPunches, todayKey]);
  const nextType = PUNCH_ORDER[punches.length] || "extraordinaria";
  const jornadaEncerrada = punches.length >= MAX_PUNCHES_PER_DAY
    || punches.some((p: any) => p.punch_type === "saida");
  const lastType = punches[punches.length - 1]?.punch_type;
  const situacao = punches.length === 0 ? "Início de jornada"
    : jornadaEncerrada ? "Jornada encerrada"
    : lastType === "saida_intervalo" ? "Em almoço"
    : lastType === "saida_cafe" ? "Em café"
    : "Em jornada";
  const unreadCount = (notifications || []).filter((n: any) => !n.read).length;
  const facialRequired = (data as any)?.facial_config?.required === true
    || employee?.facial_required_resolved === true
    || employee?.facial_required === true
    || can("punch.facial_required");
  const canPunch = can("punch.register");

  // Compute schedule / status pill — prioriza schedule_status do backend (já parseado)
  const ss: any = (data as any)?.schedule_status;
  const schedule = (ss?.schedule_start && ss?.schedule_end)
    ? { start: ss.schedule_start, end: ss.schedule_end }
    : (employee?.schedule || null);
  const scheduleText = schedule?.start && schedule?.end ? `${schedule.start} - ${schedule.end}` : "—";
  const hourNow = now.getHours() + now.getMinutes() / 60;
  const [sh, sm] = String(schedule?.start || "08:00").split(":").map(Number);
  const [eh, em] = String(schedule?.end || "17:00").split(":").map(Number);
  const withinWork = hourNow >= (sh + (sm||0)/60) && hourNow <= (eh + (em||0)/60);

  const nextPaymentDate = data?.next_payment?.date || "25/07";
  const nextPaymentLabel = data?.next_payment?.label || "Salário";
  const nextPaymentPeriod = data?.next_payment?.period || format(now, "MMMM/yyyy", { locale: ptBR });
  const daysToPay = (() => {
    try {
      const [d, m] = String(nextPaymentDate).split("/").map(Number);
      const target = new Date(now.getFullYear(), (m || (now.getMonth() + 1)) - 1, d || 25);
      if (target < now) target.setMonth(target.getMonth() + 1);
      const diff = Math.ceil((target.getTime() - now.getTime()) / 86400000);
      return diff;
    } catch { return 10; }
  })();

  const compromissos: any[] = (data as any)?.today_events || [];

  async function doPunch(facialVerified = false, selfieDataUrl?: string) {
    try {
      const created: any = await punch.mutateAsync({
        punch_type: nextType,
        latitude: gps?.lat ?? null, longitude: gps?.lng ?? null, accuracy_meters: gps?.acc ?? null,
        facial_verified: facialVerified,
        selfie_url: selfieDataUrl,
      });
      toast({
        title: `${PUNCH_LABEL[nextType] || "Ponto"} registrada`,
        description: created?.pending_local ? "Sem conexão: ficou salvo no aparelho e será sincronizado." : undefined,
      });
    } catch (e: any) { toast({ title: e.message || "Erro ao registrar", variant: "destructive" }); }
  }

  async function handlePunchClick() {
    if (jornadaEncerrada) { toast({ title: "Jornada concluída" }); return; }
    if (facialRequired) {
      if (faceDescriptor.length < 64) {
        toast({
          title: "Biometria facial não cadastrada",
          description: "Cadastre sua biometria facial em Perfil › Configurações › Reconhecimento facial.",
          variant: "destructive",
        });
        return;
      }
      const cameraReady = await requestUserCameraOnce();
      if (!cameraReady) {
        toast({ title: "Câmera não autorizada", description: "Permita o acesso à câmera para confirmar a facial.", variant: "destructive" });
        return;
      }
      setShowFace(true);
    } else {
      doPunch(false);
    }
  }

  const firstName = employee?.full_name?.split(" ")[0] || "Colaborador";
  const role = employee?.worker_profile || employee?.role || "colaborador";
  const logo = branding?.logo_topbar || branding?.logo || anatrielloLogo.url;

  return (
    <ColaboradorLayout bg="light" hideTopBar>
      {/* HERO — deep navy with subtle radial glow */}
      <div
        className="relative overflow-hidden text-white px-5 pt-[calc(env(safe-area-inset-top)+18px)] pb-8 rounded-b-[28px]"
        style={{
          background:
            "radial-gradient(120% 80% at 100% 0%, rgba(59,130,246,0.18) 0%, rgba(10,17,40,0) 55%), linear-gradient(180deg, #0a1128 0%, #0d1a3d 100%)",
        }}
      >
        {/* Decorative rings */}
        <div className="absolute -top-16 -right-16 h-64 w-64 rounded-full border border-white/5" />
        <div className="absolute -top-8 -right-8 h-40 w-40 rounded-full border border-white/5" />

        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-white/10 backdrop-blur flex items-center justify-center overflow-hidden ring-1 ring-white/15">
              <img src={logo} alt="Logo" className="h-8 w-8 object-contain" />
            </div>
            <span className="text-[15px] font-semibold">{branding?.company_name || "Anatriello"}</span>
          </div>
          <button
            onClick={() => nav("/colaborador/perfil")}
            className="relative h-10 w-10 rounded-full bg-white/8 hover:bg-white/12 flex items-center justify-center ring-1 ring-white/10"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[#3b82f6] ring-2 ring-[#0a1128]" />
            )}
          </button>
        </div>
        <div className="relative mt-3 flex justify-end">
          <SyncStatusIndicator className="border-white/20 bg-white/10 text-white" />
        </div>

        <div className="relative mt-6 flex items-start justify-between">
          <div>
            <h1 className="text-[26px] font-bold leading-tight">Olá, {firstName}! <span className="inline-block">👋</span></h1>
            <p className="text-sm text-white/60 mt-0.5 capitalize">{role}</p>
            <div className="flex items-center gap-2 mt-4">
              <span className={cn(
                "inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full border",
                withinWork ? "border-emerald-400/40 text-emerald-300 bg-emerald-400/10" : "border-white/15 text-white/70 bg-white/5"
              )}>
                <CheckCircle2 className="h-3.5 w-3.5" /> {withinWork ? "OK" : "Fora"}
              </span>
              <span className={cn(
                "inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full border",
                gps ? "border-emerald-400/40 text-emerald-300 bg-emerald-400/10" : "border-white/15 text-white/60 bg-white/5"
              )}>
                <Navigation className="h-3.5 w-3.5" /> GPS
              </span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-white/60 capitalize">{format(now, "EEEE", { locale: ptBR })}</p>
            <p className="text-lg font-bold">{format(now, "dd 'de' MMMM", { locale: ptBR })}</p>
            <button
              onClick={() => nav("/colaborador/biometria")}
              className="mt-3 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-[12px] font-semibold"
            >
              <QrCode className="h-4 w-4" /> Escanear QR
            </button>
          </div>
        </div>
      </div>

      {/* CONTENT (overlaps hero) */}
      <div className="px-4 mt-4 space-y-4 pb-6">
        {/* Horário card */}
        <div className="bg-white rounded-2xl p-4 shadow-[0_10px_30px_-15px_rgba(15,23,42,0.15)] flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-orange-50 text-[#f97316] flex items-center justify-center">
            <Clock className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <p className="text-[15px] font-bold text-slate-800">Horário: {scheduleText}</p>
            <p className={cn("text-[12px] flex items-center gap-1 mt-0.5", withinWork ? "text-emerald-600" : "text-slate-500")}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              {withinWork ? "Dentro do horário de trabalho" : "Fora do horário de trabalho"}
            </p>
          </div>
        </div>

        {/* Ponto card — dark with facial ring */}
        {canPunch ? (
          <div className="rounded-2xl p-5 text-white shadow-[0_20px_40px_-20px_rgba(10,17,40,0.6)]"
               style={{ background: "linear-gradient(160deg, #0d1a3d 0%, #0a1128 100%)" }}>
            <div className="grid grid-cols-[1fr_1.1fr] gap-3 items-center">
              {/* Facial ring */}
              <div className="flex flex-col items-center text-center">
                <div className="relative h-32 w-32 rounded-full flex items-center justify-center"
                     style={{ background: "conic-gradient(from 90deg, #22d3ee 0%, #3b82f6 60%, transparent 60% 100%)" }}>
                  <div className="absolute inset-1.5 rounded-full bg-[#0a1128] flex flex-col items-center justify-center">
                    <ScanFace className="h-8 w-8 text-cyan-300" />
                    <p className="text-[11px] font-bold mt-1">Bater ponto</p>
                    <p className="text-[9px] text-white/60">{jornadaEncerrada ? "Encerrado" : "Início de jornada"}</p>
                  </div>
                </div>
                <p className="text-[10px] text-white/60 mt-3 leading-tight">Use reconhecimento facial<br/>ou geolocalização</p>
              </div>

              {/* Copy + CTA */}
              <div className="border-l border-white/10 pl-4">
                <p className="text-[13.5px] leading-snug text-white/90">
                  {jornadaEncerrada ? "Sua jornada de hoje foi concluída." :
                   punches.length === 0 ? "Ainda não registramos seu ponto hoje. Inicie sua jornada para começar a contar seu dia."
                   : `${situacao}. Próximo: ${PUNCH_LABEL[nextType]}.`}
                </p>
                <button
                  onClick={handlePunchClick}
                  disabled={punch.isPending || jornadaEncerrada}
                  className="w-full mt-3 bg-gradient-to-r from-[#fb923c] to-[#f97316] text-white font-bold text-[15px] py-3 rounded-xl active:scale-[.98] transition disabled:opacity-60 flex items-center justify-center gap-2 shadow-lg shadow-orange-500/30"
                >
                  {punch.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> :
                   facialRequired ? <Camera className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
                  {jornadaEncerrada ? "Jornada encerrada" : "Bater Ponto"}
                </button>
                <p className="flex items-center justify-center gap-1.5 text-[11px] text-emerald-300 mt-2">
                  <ShieldCheck className="h-3.5 w-3.5" /> Seguro e certificado
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white border border-slate-100 rounded-2xl p-4 flex items-start gap-3 shadow-sm">
            <div className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
              <ShieldOff className="h-5 w-5 text-slate-500" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-700">Seu perfil não bate ponto pelo app</p>
              <p className="text-xs text-slate-500 mt-0.5">Registre a entrada na portaria ou fale com seu gestor.</p>
            </div>
          </div>
        )}

        {/* Registros de ponto do dia */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-slate-500" />
              <p className="text-[15px] font-bold text-slate-800">Registros de hoje</p>
            </div>
            <span className="text-[11px] font-semibold text-slate-400">{punches.length}/4</span>
          </div>
          {punches.length === 0 ? (
            <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">Nenhum ponto registrado hoje.</div>
          ) : (
            <div className="space-y-2">
              {punches.map((p: any, idx: number) => {
                const pending = p.pending_local || p.sync_status === "pending";
                const failed = p.sync_status === "failed";
                return (
                  <div key={p.id || p.local_id || idx} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                    <div className={cn(
                      "h-8 w-8 rounded-full flex items-center justify-center",
                      failed ? "bg-red-100 text-red-600" : pending ? "bg-amber-100 text-amber-600" : "bg-emerald-100 text-emerald-600"
                    )}>
                      {failed ? <ShieldOff className="h-4 w-4" /> : pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{PUNCH_LABEL[p.punch_type] || p.punch_type || "Ponto"}</p>
                      <p className="text-[11px] text-slate-500">
                        {pending ? "Aguardando sincronização" : failed ? "Falha — toque em sincronizar quando estiver online" : "Sincronizado no sistema"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold tabular-nums text-slate-800">{formatPunchTime(p.punched_at || p.offline_local_time || p.created_at)}</p>
                      {p.is_offline && <p className="text-[10px] font-semibold text-amber-600">Offline</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Coleta biometria opcional */}
        {faceStatus?.can_enroll && (
          <button
            onClick={() => nav("/colaborador/biometria")}
            className="w-full bg-gradient-to-br from-[#0ea5e9] to-[#0369a1] rounded-2xl p-4 text-left text-white shadow-lg shadow-sky-500/20 active:scale-[.99] transition"
          >
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-white/15 flex items-center justify-center flex-shrink-0">
                <ScanFace className="h-6 w-6" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] uppercase font-bold opacity-80">Biometria facial</p>
                <p className="text-sm font-bold truncate">
                  {faceStatus.collection_requested && faceStatus.enrolled ? "RH pediu nova coleta" : "Cadastre sua biometria facial"}
                </p>
                <p className="text-[11px] opacity-90 mt-0.5">2 capturas + teste rápido. Leva menos de 1 minuto.</p>
              </div>
              <ChevronRight className="h-5 w-5 opacity-80" />
            </div>
          </button>
        )}

        {/* Acesso rápido — 4 grandes cards */}
        <div>
          <p className="text-[15px] font-bold text-slate-800 mb-3">Acesso rápido</p>
          <div className="grid grid-cols-4 gap-3">
            {can("documents.view") && (
              <BigAction icon={FileText} label="Enviar ao RH" sub="Atestados, comprovantes" onClick={() => nav("/colaborador/documentos")} />
            )}
            {can("journey.view") && (
              <BigAction icon={Calendar} label="Agenda" sub="Compromissos" onClick={() => nav("/colaborador/jornada")} />
            )}
            {can("announcements.view") && (
              <BigAction icon={Megaphone} label="Comunicados" sub="Avisos e notícias" onClick={() => nav("/colaborador/perfil")} />
            )}
            {can("payslip.view") && (
              <BigAction icon={DollarSign} label="Pagamentos" sub="Holerites e recibos" onClick={() => nav("/colaborador/holerite")} />
            )}
          </div>
        </div>

        {/* Próximos pagamentos */}
        {can("payslip.view") && (
          <button
            onClick={() => nav("/colaborador/holerite")}
            className="w-full text-left rounded-2xl p-4 text-white shadow-[0_20px_40px_-25px_rgba(10,17,40,0.7)] flex items-center gap-4"
            style={{ background: "linear-gradient(160deg, #0d1a3d 0%, #0a1128 100%)" }}
          >
            <div className="h-12 w-12 rounded-full border-2 border-emerald-400/50 flex items-center justify-center text-emerald-300">
              <DollarSign className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-bold">Próximos pagamentos</p>
              <p className="text-[12px] text-white/70">{nextPaymentLabel}</p>
              <p className="text-[11px] text-white/50 capitalize">{nextPaymentPeriod}</p>
            </div>
            <div className="text-right">
              <p className="text-[20px] font-bold text-emerald-300">{nextPaymentDate}</p>
              <p className="text-[11px] text-white/60">Em {daysToPay} dias</p>
            </div>
            <ChevronRight className="h-5 w-5 text-white/60" />
          </button>
        )}

        {/* Compromissos de hoje */}
        <div>
          <div className="flex items-center gap-2 mb-2 px-1">
            <Calendar className="h-4 w-4 text-slate-500" />
            <p className="text-[15px] font-bold text-slate-800">Compromissos de hoje</p>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            {compromissos.length === 0 ? (
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
                  <Calendar className="h-5 w-5 text-slate-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-700">Nenhum compromisso para hoje</p>
                  <p className="text-xs text-slate-500">Aproveite seu dia! 💪</p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {compromissos.slice(0, 4).map((c: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                    <div className="h-9 w-9 rounded-lg bg-orange-50 text-[#f97316] flex items-center justify-center">
                      <Calendar className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{c.title || c.name}</p>
                      {c.time && <p className="text-xs text-slate-500">{c.time}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Minha agenda — férias, folgas, escalas */}
        <div>
          <div className="flex items-center gap-2 mb-2 px-1">
            <Calendar className="h-4 w-4 text-slate-500" />
            <p className="text-[15px] font-bold text-slate-800">Minha agenda</p>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            {scheduleText && scheduleText !== "—" && (
              <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Clock className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-slate-800">Escala de trabalho</p>
                  <p className="text-xs text-slate-500">{scheduleText} • Todos os dias úteis</p>
                </div>
              </div>
            )}
            {(agenda || []).length === 0 ? (
              <div className="pt-3">
                <p className="text-sm text-slate-500">Nenhuma férias ou folga agendada.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {(agenda || []).map((a: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 py-2.5 first:pt-3">
                    <div className={cn(
                      "h-10 w-10 rounded-xl flex items-center justify-center",
                      a.type === "ferias" ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
                    )}>
                      <Calendar className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{a.label}</p>
                      <p className="text-xs text-slate-500">
                        {safeDateBR(a.date)}
                        {a.end_date ? ` — ${safeDateBR(a.end_date)}` : ""}
                      </p>
                    </div>
                    <span className={cn(
                      "text-[10px] font-bold uppercase px-2 py-1 rounded-full",
                      a.type === "ferias" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                    )}>
                      {a.type === "ferias" ? "Férias" : "Folga"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Comunicados recentes */}
        {can("announcements.view") && !!announcements?.length && (
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[15px] font-bold text-slate-800">Comunicados</p>
              <button className="text-xs text-[#f97316] font-semibold" onClick={() => nav("/colaborador/perfil")}>Ver todos</button>
            </div>
            {(announcements || []).slice(0, 2).map((a: any) => (
              <div key={a.id} className="flex items-start gap-3 py-2 border-t border-slate-100 first:border-0">
                <div className="h-10 w-10 rounded-full bg-orange-100 text-[#f97316] flex items-center justify-center flex-shrink-0">
                  <Megaphone className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{a.title}</p>
                  <p className="text-xs text-slate-500 truncate">{a.body}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{safeDateTimeBR(a.published_at)}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {isLoading && <Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-400" />}
      </div>

      {showFace && faceDescriptor.length >= 64 && (
        <FaceVerifyDialog
          open={showFace}
          onOpenChange={setShowFace}
          storedDescriptor={faceDescriptor}
          onResult={(r) => { setShowFace(false); if (r.match) doPunch(true, r.imageDataUrl); else toast({ title: "Falha na validação facial", variant: "destructive" }); }}
        />
      )}
    </ColaboradorLayout>
  );
}

function BigAction({ icon: Icon, label, sub, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className="bg-white rounded-2xl p-3 flex flex-col items-center gap-1.5 shadow-sm hover:shadow-md border border-slate-100 active:scale-[.97] transition"
    >
      <div className="h-11 w-11 rounded-2xl bg-orange-50 text-[#f97316] flex items-center justify-center">
        <Icon className="h-6 w-6" strokeWidth={1.8} />
      </div>
      <span className="text-[12px] font-bold text-slate-800 text-center leading-tight">{label}</span>
      <span className="text-[10px] text-slate-500 text-center leading-tight line-clamp-1">{sub}</span>
    </button>
  );
}
