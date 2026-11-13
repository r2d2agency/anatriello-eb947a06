import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import {
  Copy, Check, MessageCircle, Mail, QrCode, ExternalLink,
  Users, Truck, Briefcase, Smartphone, Pencil, Save, X, Loader2,
} from "lucide-react";

interface AppInfo {
  key: string;
  title: string;
  description: string;
  defaultPath: string;
  icon: any;
  color: string;
  audience: string;
}

const APPS: AppInfo[] = [
  {
    key: "colaborador",
    title: "App do Colaborador",
    description: "Ponto, holerite, férias, documentos e solicitações para funcionários.",
    defaultPath: "https://colaborador.r2d2.agency/colaborador/",
    icon: Users,
    color: "bg-blue-500/10 text-blue-600 border-blue-500/30",
    audience: "Funcionários CLT / RH",
  },
  {
    key: "entregador",
    title: "App do Entregador",
    description: "Jornada SmartRoute: rotas, check-in, checklists e entregas.",
    defaultPath: "/entregador/login",
    icon: Truck,
    color: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
    audience: "Motoristas / Entregadores",
  },
  {
    key: "gestor",
    title: "App do Gestor (Supervisor)",
    description: "Painel de supervisão: equipe, aprovações e acompanhamento em campo.",
    defaultPath: "/gestor/login",
    icon: Briefcase,
    color: "bg-purple-500/10 text-purple-600 border-purple-500/30",
    audience: "Supervisores / Gerentes",
  },
];

const DEFAULT_LINKS: Record<string, string> = Object.fromEntries(
  APPS.map((a) => [a.key, a.defaultPath])
);

function resolveUrl(path: string): string {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const base = window.location.origin.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

function AppCard({
  app,
  link,
  canEdit,
  editing,
  draft,
  onDraftChange,
  onStartEdit,
  onSave,
  onCancel,
  saving,
}: {
  app: AppInfo;
  link: string;
  canEdit: boolean;
  editing: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  onStartEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const Icon = app.icon;

  const url = resolveUrl(link);
  const msg = `Olá! Acesse o *${app.title}* aqui:\n${url}\n\nDica: no celular, use "Adicionar à tela de início" para instalar como aplicativo.`;

  const copy = () => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
    toast({ title: "Link copiado!", description: url });
  };

  const copyMsg = () => {
    if (!url) return;
    navigator.clipboard.writeText(msg);
    toast({ title: "Mensagem copiada!" });
  };

  const sendWhats = () => window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  const sendEmail = () => {
    window.location.href = `mailto:?subject=${encodeURIComponent(app.title)}&body=${encodeURIComponent(msg)}`;
  };

  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(url)}`;

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className={`h-11 w-11 rounded-xl border flex items-center justify-center ${app.color}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">{app.audience}</Badge>
            {canEdit && !editing && (
              <Button size="icon" variant="ghost" onClick={onStartEdit} title="Editar link" className="h-8 w-8">
                <Pencil className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <CardTitle className="text-base mt-2">{app.title}</CardTitle>
        <p className="text-xs text-muted-foreground">{app.description}</p>
      </CardHeader>
      <CardContent className="space-y-3 mt-auto">
        {editing ? (
          <div className="space-y-2">
            <Input
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              placeholder="https://... ou /caminho"
              className="font-mono text-xs"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={onSave} disabled={saving} className="gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Salvar
              </Button>
              <Button size="sm" variant="outline" onClick={onCancel} disabled={saving} className="gap-1.5">
                <X className="h-4 w-4" /> Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Input value={url} readOnly className="font-mono text-xs" />
              <Button size="icon" variant="outline" onClick={copy} title="Copiar link" disabled={!url}>
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" size="sm" onClick={sendWhats} className="gap-1.5" disabled={!url}>
                <MessageCircle className="h-4 w-4" /> WhatsApp
              </Button>
              <Button variant="secondary" size="sm" onClick={sendEmail} className="gap-1.5" disabled={!url}>
                <Mail className="h-4 w-4" /> E-mail
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setQrOpen(true)} className="gap-1.5" disabled={!url}>
                <QrCode className="h-4 w-4" /> QR Code
              </Button>
              <Button variant="default" size="sm" onClick={() => window.open(url, "_blank")} className="gap-1.5" disabled={!url}>
                <ExternalLink className="h-4 w-4" /> Abrir
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={copyMsg} className="w-full text-xs" disabled={!url}>
              Copiar mensagem pronta
            </Button>
          </>
        )}
      </CardContent>

      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-center">{app.title}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3">
            {url ? <img src={qrSrc} alt={`QR Code do ${app.title}`} className="rounded-lg border" /> : null}
            <p className="text-xs text-center text-muted-foreground break-all">{url}</p>
            <Button size="sm" variant="outline" onClick={copy} className="gap-1.5" disabled={!url}>
              <Copy className="h-3.5 w-3.5" /> Copiar link
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function CentralApps() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.is_superadmin || user?.role === "admin" || user?.role === "owner";

  const [q, setQ] = useState("");
  const [links, setLinks] = useState<Record<string, string>>({ ...DEFAULT_LINKS });
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      const orgId = user?.organization_id;
      if (!orgId) {
        setLinks({ ...DEFAULT_LINKS });
        setLoading(false);
        return;
      }
      try {
        const data = await api<{ app_links: Record<string, string> | null }>(
          `/api/organizations/${orgId}/app-links`
        );
        const saved = data?.app_links && typeof data.app_links === "object" ? data.app_links : {};
        setLinks({ ...DEFAULT_LINKS, ...saved });
      } catch {
        setLinks({ ...DEFAULT_LINKS });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user?.organization_id]);

  const startEdit = (key: string) => {
    setEditingKey(key);
    setDraft(links[key] || DEFAULT_LINKS[key] || "");
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setDraft("");
  };

  const saveEdit = async () => {
    if (!editingKey) return;
    const orgId = user?.organization_id;
    if (!orgId) {
      toast({ title: "Organização não encontrada", variant: "destructive" });
      return;
    }
    const value = draft.trim();
    if (!value) {
      toast({ title: "Informe um link válido", variant: "destructive" });
      return;
    }
    const next = { ...links, [editingKey]: value };
    setSaving(true);
    try {
      const res = await api<{ app_links?: Record<string, string> }>(`/api/organizations/${orgId}/app-links`, {
        method: "PUT",
        body: { app_links: next },
      });
      const saved = res?.app_links && typeof res.app_links === "object" ? res.app_links : next;
      setLinks({ ...DEFAULT_LINKS, ...saved });
      setEditingKey(null);
      setDraft("");
      toast({ title: "Link salvo com sucesso!" });
    } catch (err: any) {
      toast({
        title: "Erro ao salvar link",
        description: err?.message || "Tente novamente",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(
    () =>
      APPS.filter((a) =>
        (a.title + a.description + a.audience).toLowerCase().includes(q.toLowerCase())
      ),
    [q]
  );

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-start gap-3">
        <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Smartphone className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Central de Apps</h1>
          <p className="text-sm text-muted-foreground">
            Links diretos, QR Code e mensagens prontas para compartilhar com sua equipe.
            Todos os apps funcionam no navegador do celular e podem ser instalados na tela de início.
          </p>
          {isAdmin && (
            <p className="text-xs text-muted-foreground mt-1">
              Como administrador, você pode editar e salvar os links de cada app para sua organização.
            </p>
          )}
        </div>
      </div>

      <Input
        placeholder="Buscar app..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="max-w-sm"
      />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando links...
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
          {filtered.map((app) => (
            <AppCard
              key={app.key}
              app={app}
              link={links[app.key] || app.defaultPath}
              canEdit={!!isAdmin}
              editing={editingKey === app.key}
              draft={editingKey === app.key ? draft : links[app.key] || app.defaultPath}
              onDraftChange={setDraft}
              onStartEdit={() => startEdit(app.key)}
              onSave={saveEdit}
              onCancel={cancelEdit}
              saving={saving}
            />
          ))}
        </div>
      )}

      <Card className="bg-muted/30">
        <CardHeader>
          <CardTitle className="text-sm">Como instalar no celular?</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1">
          <p><strong>Android (Chrome):</strong> menu ⋮ → "Adicionar à tela inicial" ou "Instalar app".</p>
          <p><strong>iPhone (Safari):</strong> botão Compartilhar → "Adicionar à Tela de Início".</p>
          <p>Depois de instalado, o app abre em tela cheia como um aplicativo nativo.</p>
        </CardContent>
      </Card>
    </div>
  );
}
