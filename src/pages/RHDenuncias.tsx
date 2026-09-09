import { useEffect, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ShieldAlert, Copy, RefreshCw, Loader2, Eye, MessageSquareReply, QrCode } from "lucide-react";
import { toast } from "sonner";
import {
  useWhistleblowerChannel, useRegenerateWhistleblowerSlug, useToggleWhistleblowerChannel,
  useWhistleblowerReports, useUpdateWhistleblowerReport, fetchWhistleblowerQrCodeObjectUrl,
  WhistleblowerReport,
} from "@/hooks/use-rh-whistleblower";

const CATEGORY_LABELS: Record<string, string> = {
  assedio_moral: "Assédio moral",
  assedio_sexual: "Assédio sexual",
  discriminacao: "Discriminação",
  riscos_psicossociais: "Sobrecarga / riscos psicossociais",
  seguranca_trabalho: "Condições inseguras / segurança do trabalho",
  conduta_etica: "Conduta antiética / fraude",
  outro: "Outro",
};

const STATUS_LABELS: Record<string, string> = {
  nova: "Nova",
  em_analise: "Em análise",
  concluida: "Concluída",
};

const STATUS_STYLE: Record<string, string> = {
  nova: "bg-red-100 text-red-700 border-red-200",
  em_analise: "bg-amber-100 text-amber-700 border-amber-200",
  concluida: "bg-green-100 text-green-700 border-green-200",
};

export default function RHDenuncias() {
  return (
    <MainLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <ShieldAlert className="h-6 w-6 text-primary" /> Canal de Denúncias
            </h1>
            <p className="text-sm text-muted-foreground">
              Canal interno anônimo (NR-1) — o denunciante não é identificado em nenhuma etapa.
            </p>
          </div>
        </div>

        <ChannelCard />
        <ReportsPanel />
      </div>
    </MainLayout>
  );
}

function ChannelCard() {
  const { data: channel, isLoading } = useWhistleblowerChannel();
  const regenerate = useRegenerateWhistleblowerSlug();
  const toggle = useToggleWhistleblowerChannel();
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);

  const publicUrl = channel ? `${window.location.origin}/denuncia/${channel.slug}` : "";

  useEffect(() => {
    let revoke: string | null = null;
    if (publicUrl) {
      setQrLoading(true);
      fetchWhistleblowerQrCodeObjectUrl(publicUrl)
        .then(url => { revoke = url; setQrUrl(url); })
        .catch(() => setQrUrl(null))
        .finally(() => setQrLoading(false));
    }
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [publicUrl]);

  const copyLink = () => {
    navigator.clipboard.writeText(publicUrl);
    toast.success("Link copiado!");
  };

  const handleRegenerate = async () => {
    if (!confirm("Gerar um novo link invalida o link/QR Code atual (quem tiver o antigo não conseguirá mais acessar). Continuar?")) return;
    await regenerate.mutateAsync();
    toast.success("Novo link gerado!");
  };

  if (isLoading) {
    return <Card><CardContent className="p-8 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><QrCode className="h-4 w-4" /> Link e QR Code do canal</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
          <Switch checked={!!channel?.active} onCheckedChange={v => toggle.mutate(v)} disabled={toggle.isPending} />
          <div className="flex-1">
            <p className="text-sm font-medium">{channel?.active ? "Canal ativo" : "Canal desativado"}</p>
            <p className="text-xs text-muted-foreground">Quando desativado, o link para de aceitar novas denúncias.</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 items-start">
          <div className="shrink-0 p-3 border rounded-lg bg-white flex items-center justify-center w-[160px] h-[160px]">
            {qrLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> :
              qrUrl ? <img src={qrUrl} alt="QR Code do canal de denúncias" className="w-full h-full object-contain" /> :
              <p className="text-xs text-muted-foreground text-center">QR indisponível</p>}
          </div>
          <div className="flex-1 space-y-2 min-w-0">
            <p className="text-xs text-muted-foreground">
              Compartilhe este link ou imprima o QR Code em murais, crachás ou materiais internos. Quem acessar pode enviar uma denúncia sem se identificar.
            </p>
            <div className="flex gap-2">
              <Input readOnly value={publicUrl} className="text-xs font-mono" />
              <Button variant="outline" size="icon" onClick={copyLink}><Copy className="h-4 w-4" /></Button>
            </div>
            <Button variant="outline" size="sm" className="gap-1" onClick={handleRegenerate} disabled={regenerate.isPending}>
              <RefreshCw className={`h-3.5 w-3.5 ${regenerate.isPending ? "animate-spin" : ""}`} /> Gerar novo link
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ReportsPanel() {
  const [status, setStatus] = useState("");
  const { data: reports = [], isLoading } = useWhistleblowerReports({ status: status || undefined });
  const update = useUpdateWhistleblowerReport();
  const [viewing, setViewing] = useState<WhistleblowerReport | null>(null);
  const [response, setResponse] = useState("");
  const [notes, setNotes] = useState("");

  const openView = (r: WhistleblowerReport) => {
    setViewing(r);
    setResponse(r.rh_response || "");
    setNotes(r.internal_notes || "");
  };

  const save = async (newStatus?: string) => {
    if (!viewing) return;
    try {
      await update.mutateAsync({ id: viewing.id, status: newStatus, rh_response: response, internal_notes: notes });
      toast.success("Denúncia atualizada");
      setViewing(null);
    } catch (e: any) {
      toast.error(e.message || "Erro ao atualizar");
    }
  };

  const pendingCount = reports.filter(r => r.status === "nova").length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between">
          <span>Denúncias recebidas</span>
          {pendingCount > 0 && <Badge className="bg-red-500/10 text-red-700 border border-red-200">{pendingCount} nova(s)</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Select value={status || "__all__"} onValueChange={v => setStatus(v === "__all__" ? "" : v)}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os status</SelectItem>
            <SelectItem value="nova">Novas</SelectItem>
            <SelectItem value="em_analise">Em análise</SelectItem>
            <SelectItem value="concluida">Concluídas</SelectItem>
          </SelectContent>
        </Select>

        <div className="grid gap-2">
          {isLoading && <p className="text-sm text-muted-foreground text-center py-4">Carregando…</p>}
          {!isLoading && reports.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8 border rounded-lg border-dashed">Nenhuma denúncia registrada</p>
          )}
          {reports.map(r => (
            <div key={r.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-muted-foreground">{r.protocol}</span>
                  <Badge variant="outline">{CATEGORY_LABELS[r.category] || r.category}</Badge>
                  <Badge className={STATUS_STYLE[r.status] || ""}>{STATUS_LABELS[r.status] || r.status}</Badge>
                </div>
                <p className="text-sm mt-1 line-clamp-2">{r.description}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Recebida em {format(new Date(r.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                </p>
              </div>
              <Button variant="outline" size="sm" className="gap-1" onClick={() => openView(r)}>
                <Eye className="h-4 w-4" /> Ver / Responder
              </Button>
            </div>
          ))}
        </div>
      </CardContent>

      <Dialog open={!!viewing} onOpenChange={o => !o && setViewing(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquareReply className="h-4 w-4" /> Denúncia {viewing?.protocol}
            </DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">{CATEGORY_LABELS[viewing.category] || viewing.category}</Badge>
                <Badge className={STATUS_STYLE[viewing.status] || ""}>{STATUS_LABELS[viewing.status] || viewing.status}</Badge>
              </div>
              <div className="p-3 rounded-lg bg-muted/30 border">
                <p className="text-xs font-semibold text-muted-foreground mb-1">Relato</p>
                <p className="whitespace-pre-wrap">{viewing.description}</p>
              </div>
              {viewing.location && (
                <p><span className="font-semibold">Local/setor informado:</span> {viewing.location}</p>
              )}
              {viewing.involves_whom && (
                <p><span className="font-semibold">Envolvidos (relatado pelo denunciante):</span> {viewing.involves_whom}</p>
              )}
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Resposta ao denunciante (visível na consulta anônima por protocolo)</label>
                <Textarea rows={4} value={response} onChange={e => setResponse(e.target.value)} placeholder="Explique o que foi apurado e/ou as providências tomadas..." />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Notas internas do RH (não aparecem para o denunciante)</label>
                <Textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={() => setViewing(null)}>Fechar</Button>
            <Button variant="outline" onClick={() => save()} disabled={update.isPending}>Salvar sem alterar status</Button>
            {viewing?.status !== "em_analise" && (
              <Button variant="secondary" onClick={() => save("em_analise")} disabled={update.isPending}>Salvar e marcar em análise</Button>
            )}
            {viewing?.status !== "concluida" && (
              <Button onClick={() => save("concluida")} disabled={update.isPending}>
                {update.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Salvar e concluir
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
