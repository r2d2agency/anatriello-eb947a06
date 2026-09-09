import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, Loader2, CheckCircle2, AlertCircle, Copy, ShieldCheck, Search } from "lucide-react";
import {
  getPublicWhistleblowerChannel, submitWhistleblowerReport, getWhistleblowerStatus,
  WhistleblowerCategory, PublicWhistleblowerChannel,
} from "@/hooks/use-rh-whistleblower";

const STATUS_LABELS: Record<string, string> = {
  nova: "Recebida, aguardando análise",
  em_analise: "Em análise pelo RH",
  concluida: "Concluída",
};

export default function DenunciaPublica() {
  const { slug } = useParams<{ slug: string }>();
  const [loading, setLoading] = useState(true);
  const [channel, setChannel] = useState<PublicWhistleblowerChannel | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    getPublicWhistleblowerChannel(slug).then(res => {
      if (!res) setNotFound(true);
      else setChannel(res);
      setLoading(false);
    });
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (notFound || !channel) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-4 bg-muted/30 text-center">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <p className="text-lg font-medium">Canal de denúncias não encontrado</p>
        <p className="text-sm text-muted-foreground">Verifique o link ou o QR Code utilizado.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="max-w-lg mx-auto space-y-4">
        <div className="text-center space-y-1">
          <ShieldAlert className="h-10 w-10 text-primary mx-auto" />
          <h1 className="text-xl font-bold">Canal de Denúncias</h1>
          <p className="text-sm text-muted-foreground">{channel.organization_name}</p>
        </div>

        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-3 flex gap-2 items-start text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <p>Este canal é 100% anônimo. Não pedimos e não registramos seu nome, e-mail, telefone ou qualquer dado que possa te identificar.</p>
          </CardContent>
        </Card>

        {!channel.active ? (
          <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Este canal está temporariamente desativado. Procure o RH por outro meio.</CardContent></Card>
        ) : (
          <Tabs defaultValue="nova">
            <TabsList className="w-full grid grid-cols-2">
              <TabsTrigger value="nova">Fazer denúncia</TabsTrigger>
              <TabsTrigger value="consultar">Consultar andamento</TabsTrigger>
            </TabsList>
            <TabsContent value="nova"><ReportForm slug={slug!} categories={channel.categories} /></TabsContent>
            <TabsContent value="consultar"><StatusCheck /></TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}

function ReportForm({ slug, categories }: { slug: string; categories: WhistleblowerCategory[] }) {
  const [category, setCategory] = useState(categories[0]?.key || "outro");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [involvesWhom, setInvolvesWhom] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [protocol, setProtocol] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError("");
    if (description.trim().length < 10) {
      setError("Descreva com mais detalhes o que aconteceu (mínimo 10 caracteres).");
      return;
    }
    setSubmitting(true);
    try {
      const res = await submitWhistleblowerReport(slug, {
        category, description: description.trim(),
        location: location.trim() || undefined,
        involves_whom: involvesWhom.trim() || undefined,
      });
      setProtocol(res.protocol);
    } catch (e: any) {
      setError(e.message || "Erro ao enviar denúncia. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  };

  const copyProtocol = () => {
    if (!protocol) return;
    navigator.clipboard.writeText(protocol);
  };

  if (protocol) {
    return (
      <Card className="mt-3">
        <CardContent className="p-6 text-center space-y-3">
          <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto" />
          <p className="font-semibold">Denúncia enviada com sucesso!</p>
          <p className="text-sm text-muted-foreground">
            Guarde o código abaixo para acompanhar a resposta do RH. Ele é a <b>única</b> forma de consultar o andamento — não será possível recuperá-lo depois.
          </p>
          <div className="flex items-center justify-center gap-2 p-3 rounded-lg border bg-muted/50">
            <span className="font-mono font-bold text-lg">{protocol}</span>
            <Button type="button" variant="ghost" size="icon" onClick={copyProtocol}><Copy className="h-4 w-4" /></Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-3">
      <CardContent className="p-4 space-y-4">
        <div>
          <Label className="text-sm">Tipo de ocorrência</Label>
          <RadioGroup value={category} onValueChange={setCategory} className="mt-2 space-y-1">
            {categories.map(c => (
              <label key={c.key} className="flex items-center gap-2 text-sm p-2 rounded-md border cursor-pointer hover:bg-muted/50">
                <RadioGroupItem value={c.key} />
                {c.label}
              </label>
            ))}
          </RadioGroup>
        </div>
        <div>
          <Label className="text-sm">Descreva o que aconteceu *</Label>
          <Textarea rows={6} value={description} onChange={e => setDescription(e.target.value)} placeholder="Conte com detalhes o que ocorreu, quando e onde (sem precisar se identificar)..." />
        </div>
        <div>
          <Label className="text-sm">Local / setor (opcional)</Label>
          <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="Ex: Filial Centro, setor de logística..." />
        </div>
        <div>
          <Label className="text-sm">Pessoas envolvidas (opcional)</Label>
          <Input value={involvesWhom} onChange={e => setInvolvesWhom(e.target.value)} placeholder="Você pode citar nomes/cargos sem se identificar" />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button className="w-full" onClick={handleSubmit} disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Enviar denúncia anônima
        </Button>
      </CardContent>
    </Card>
  );
}

function StatusCheck() {
  const [protocol, setProtocol] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof getWhistleblowerStatus>>>(null);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    if (!protocol.trim()) return;
    setLoading(true);
    setSearched(true);
    const res = await getWhistleblowerStatus(protocol);
    setResult(res);
    setLoading(false);
  };

  return (
    <Card className="mt-3">
      <CardContent className="p-4 space-y-4">
        <div>
          <Label className="text-sm">Código do protocolo</Label>
          <div className="flex gap-2 mt-1">
            <Input value={protocol} onChange={e => setProtocol(e.target.value.toUpperCase())} placeholder="DEN-XXXXX-XXXXX" className="font-mono" />
            <Button onClick={handleSearch} disabled={loading || !protocol.trim()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {searched && !loading && !result && (
          <p className="text-sm text-muted-foreground text-center py-4">Protocolo não encontrado. Verifique se digitou corretamente.</p>
        )}

        {result && (
          <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm">{result.protocol}</span>
              <Badge variant="outline">{STATUS_LABELS[result.status] || result.status}</Badge>
            </div>
            {result.rh_response ? (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">Resposta do RH</p>
                <p className="text-sm whitespace-pre-wrap">{result.rh_response}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Sua denúncia ainda está sendo analisada. Volte para consultar mais tarde.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
