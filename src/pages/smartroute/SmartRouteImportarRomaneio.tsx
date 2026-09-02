import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FileUp, Upload, Route as RouteIcon, AlertTriangle, CheckCircle2, HelpCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useSRParseRomaneio, useSRCommitRomaneio, useSRDrivers, useSRVehicles, useSRPdvs } from "@/hooks/use-smartroute";
import { useSRDepots } from "@/hooks/use-smartroute-depots";

type MatchType = "code" | "name_guess" | "none";

interface ParsedStop {
  seq: number;
  venda_number: string | null;
  client_code: string;
  client_name: string;
  fantasy_name: string | null;
  delivery_date: string | null;
  phone: string | null;
  address_raw: string;
  city: string | null;
  state: string | null;
  products: Array<{ description: string; qty: number; total_value: number; unit: string }>;
  value_total: number;
  matched_pdv_id: string | null;
  matched_pdv_name: string | null;
  match_type: MatchType;
}

const MATCH_BADGE: Record<MatchType, { label: string; hint: string; variant: "default" | "secondary" | "destructive"; icon: any }> = {
  code: { label: "Cliente já cadastrado", hint: "Reconhecido automaticamente pelo código — conectado ao PDV existente.", variant: "default", icon: CheckCircle2 },
  name_guess: { label: "Sugestão por nome — confira", hint: "Nome parecido com um PDV existente, mas o código não bateu. Confirme ou troque abaixo.", variant: "secondary", icon: HelpCircle },
  none: { label: "Cliente novo", hint: "Será cadastrado automaticamente com os dados deste romaneio. Nas próximas importações, esse código já conecta sozinho.", variant: "destructive", icon: AlertTriangle },
};

export default function SmartRouteImportarRomaneio() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const parseMut = useSRParseRomaneio();
  const commitMut = useSRCommitRomaneio();
  const { data: drivers = [] } = useSRDrivers();
  const { data: vehicles = [] } = useSRVehicles();
  const { data: pdvs = [] } = useSRPdvs();
  const { data: depots = [] } = useSRDepots();

  const [preview, setPreview] = useState<any>(null);
  const [stops, setStops] = useState<ParsedStop[]>([]);
  const [plannedDate, setPlannedDate] = useState("");
  const [driverId, setDriverId] = useState<string>("");
  const [vehicleId, setVehicleId] = useState<string>("");
  const [depotId, setDepotId] = useState<string>("");
  const [forceReimport, setForceReimport] = useState(false);

  const handleFile = async (file: File) => {
    setPreview(null);
    setStops([]);
    try {
      const result = await parseMut.mutateAsync(file);
      setPreview(result);
      setStops(result.stops || []);
      setPlannedDate(result.romaneio_date || new Date().toISOString().slice(0, 10));
      setDriverId(result.matched_driver?.id || "");
      setVehicleId(result.matched_vehicle?.id || "");
      const def = depots.find((d: any) => d.is_default) || depots[0];
      setDepotId(def?.id || "");
      setForceReimport(false);
      if (result.existing_route) {
        toast.warning("Este romaneio já foi importado antes. Revise antes de continuar.");
      } else if (result.warnings?.length) {
        toast.warning(`${result.warnings.length} aviso(s) na leitura do PDF — revise as paradas antes de importar.`);
      } else {
        toast.success(`${result.stops?.length || 0} parada(s) reconhecida(s) no romaneio.`);
      }
    } catch (e: any) {
      toast.error(e.message || "Falha ao processar o PDF");
    }
  };

  const updateStopPdv = (seq: number, pdvId: string) => {
    setStops((prev) => prev.map((s) => {
      if (s.seq !== seq) return s;
      if (pdvId === "__new__") return { ...s, matched_pdv_id: null, matched_pdv_name: null, match_type: "none" };
      const pdv = pdvs.find((p: any) => p.id === pdvId);
      return { ...s, matched_pdv_id: pdvId, matched_pdv_name: pdv?.name || null, match_type: "code" };
    }));
  };

  const totals = useMemo(() => {
    const value = stops.reduce((s, st) => s + (st.value_total || 0), 0);
    const unmatched = stops.filter((s) => !s.matched_pdv_id).length;
    return { value, unmatched, count: stops.length };
  }, [stops]);

  const handleCommit = async () => {
    if (!stops.length) return;
    try {
      const result = await commitMut.mutateAsync({
        romaneio_number: preview.romaneio_number,
        romaneio_date: plannedDate,
        driver_id: driverId || null,
        vehicle_id: vehicleId || null,
        depot_id: depotId || null,
        force: forceReimport,
        stops: stops.map((s) => ({
          seq: s.seq,
          venda_number: s.venda_number,
          client_code: s.client_code,
          client_name: s.client_name,
          fantasy_name: s.fantasy_name,
          delivery_date: s.delivery_date,
          phone: s.phone,
          address_raw: s.address_raw,
          city: s.city,
          state: s.state,
          products: s.products,
          value_total: s.value_total,
          pdv_id: s.matched_pdv_id,
        })),
      });
      toast.success(`Rota criada com ${result.stops_created} parada(s)!`);
      navigate("/smartroute/rotas");
    } catch (e: any) {
      if (e?.response?.route_id) {
        toast.error("Este romaneio já foi importado. Marque para reimportar se realmente deseja duplicar.");
      } else {
        toast.error(e.message || "Falha ao importar romaneio");
      }
    }
  };

  return (
    <MainLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><FileUp className="w-6 h-6" /> Importar Romaneio</h1>
          <p className="text-sm text-muted-foreground">Envie o PDF do romaneio (Mega Online) e o sistema cria os pedidos e a rota automaticamente.</p>
        </div>

        {!preview && (
          <Card>
            <CardContent className="pt-6 flex flex-col items-center justify-center gap-4 py-16 border-2 border-dashed rounded-lg mx-6 mb-6">
              <Upload className="w-10 h-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground text-center max-w-sm">
                Selecione o arquivo PDF do romaneio exportado do Mega Online Software.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
              <Button onClick={() => fileInputRef.current?.click()} disabled={parseMut.isPending}>
                {parseMut.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processando...</> : <>Selecionar PDF</>}
              </Button>
            </CardContent>
          </Card>
        )}

        {preview && (
          <>
            {preview.existing_route && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Romaneio já importado</AlertTitle>
                <AlertDescription>
                  O romaneio {preview.romaneio_number} já gerou a rota <b>{preview.existing_route.code}</b> anteriormente.
                  Marque a opção abaixo somente se quiser importar duplicado mesmo assim.
                  <label className="flex items-center gap-2 mt-2 text-sm">
                    <input type="checkbox" checked={forceReimport} onChange={(e) => setForceReimport(e.target.checked)} />
                    Importar mesmo assim (vai criar uma nova rota duplicada)
                  </label>
                </AlertDescription>
              </Alert>
            )}

            {preview.warnings?.length > 0 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Avisos na leitura do PDF</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4 text-sm">
                    {preview.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {preview.debug_raw_text && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Texto extraído do PDF (nenhuma parada reconhecida)</AlertTitle>
                <AlertDescription>
                  <p className="text-sm mb-2">
                    Copie o texto abaixo e envie para o suporte ajustar a leitura deste layout de romaneio.
                  </p>
                  <div className="flex justify-end mb-1">
                    <Button
                      size="sm" variant="outline"
                      onClick={() => { navigator.clipboard.writeText(preview.debug_raw_text); toast.success("Texto copiado"); }}
                    >
                      Copiar texto
                    </Button>
                  </div>
                  <pre className="text-[10px] bg-muted p-2 rounded max-h-64 overflow-auto whitespace-pre-wrap">{preview.debug_raw_text}</pre>
                </AlertDescription>
              </Alert>
            )}

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Romaneio Nº {preview.romaneio_number}</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs">Data da rota</Label>
                  <Input type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs flex items-center gap-1">
                    Motorista
                    {!driverId && <Badge variant="outline" className="text-[10px]">não identificado ({preview.deliverer_name || "—"})</Badge>}
                  </Label>
                  <Select value={driverId} onValueChange={setDriverId}>
                    <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                    <SelectContent>
                      {drivers.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs flex items-center gap-1">
                    Veículo
                    {!vehicleId && <Badge variant="outline" className="text-[10px]">não identificado ({preview.plate || "—"})</Badge>}
                  </Label>
                  <Select value={vehicleId} onValueChange={setVehicleId}>
                    <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                    <SelectContent>
                      {vehicles.map((v: any) => <SelectItem key={v.id} value={v.id}>{v.plate} {v.model ? `— ${v.model}` : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Centro de distribuição</Label>
                  <Select value={depotId} onValueChange={setDepotId}>
                    <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                    <SelectContent>
                      {depots.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3 flex-row items-center justify-between">
                <CardTitle className="text-base">Paradas ({totals.count})</CardTitle>
                <div className="flex gap-2 text-xs text-muted-foreground">
                  <span>Total: <b className="text-foreground">R$ {totals.value.toFixed(2)}</b></span>
                  {totals.unmatched > 0 && <Badge variant="destructive">{totals.unmatched} cliente(s) novo(s)</Badge>}
                </div>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Seq</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Endereço</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead>Vínculo com PDV</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stops.map((s) => {
                      const badge = MATCH_BADGE[s.match_type];
                      const Icon = badge.icon;
                      return (
                        <TableRow key={s.seq}>
                          <TableCell className="font-mono text-sm">{s.seq}</TableCell>
                          <TableCell>
                            <div className="text-sm font-medium">{s.fantasy_name || s.client_name}</div>
                            <div className="text-xs text-muted-foreground">{s.client_code} · {s.client_name}</div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-xs truncate">{s.address_raw}</TableCell>
                          <TableCell className="text-right text-sm font-mono">R$ {s.value_total.toFixed(2)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Badge variant={badge.variant} className="text-[10px] gap-1"><Icon className="w-3 h-3" />{badge.label}</Badge>
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-0.5 max-w-56">{badge.hint}</p>
                            <Select value={s.matched_pdv_id || "__new__"} onValueChange={(v) => updateStopPdv(s.seq, v)}>
                              <SelectTrigger className="h-7 text-xs mt-1 w-56"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__new__">— Criar novo PDV —</SelectItem>
                                {pdvs.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setPreview(null); setStops([]); if (fileInputRef.current) fileInputRef.current.value = ""; }}>
                Cancelar / novo arquivo
              </Button>
              <Button onClick={handleCommit} disabled={commitMut.isPending || !stops.length || (preview.existing_route && !forceReimport)}>
                {commitMut.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Importando...</> : <><RouteIcon className="w-4 h-4 mr-2" /> Criar rota com {totals.count} parada(s)</>}
              </Button>
            </div>
          </>
        )}
      </div>
    </MainLayout>
  );
}
