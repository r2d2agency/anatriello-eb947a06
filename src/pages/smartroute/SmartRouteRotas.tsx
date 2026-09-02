import { useState } from "react";
import { Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, Route as RouteIcon, Wand2, Eye, Sparkles, FileText, PlayCircle, RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";
import { useSRRoutes, useSRSaveRoute, useSRDeleteRoute, useSRDrivers, useSRVehicles, useSROrders, useSROptimizeRoute, useSRRoute } from "@/hooks/use-smartroute";
import { useSROptimizeAdvanced } from "@/hooks/use-smartroute-ai";
import { useSRReoptimize } from "@/hooks/use-smartroute-planner";
import { useSRDepots } from "@/hooks/use-smartroute-depots";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { PageAssistant, ASSISTANT_CONTENT } from "@/components/smartroute/PageAssistant";


const statusColor: Record<string, string> = { planejada: "bg-slate-200", em_andamento: "bg-blue-200", concluida: "bg-emerald-200", cancelada: "bg-red-200" };

export default function SmartRouteRotas() {
  const [filter, setFilter] = useState<any>({});
  const { data = [] } = useSRRoutes(filter);
  const { data: drivers = [] } = useSRDrivers();
  const { data: vehicles = [] } = useSRVehicles();
  const { data: pendingOrders = [] } = useSROrders({ status: "pendente" });
  const save = useSRSaveRoute();
  const del = useSRDeleteRoute();
  const optimize = useSROptimizeRoute();
  const optimizeAdv = useSROptimizeAdvanced();
  const reopt = useSRReoptimize();
  const { data: depots = [] } = useSRDepots();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [viewId, setViewId] = useState<string | null>(null);
  const { data: viewRoute } = useSRRoute(viewId || undefined);

  const onSave = async () => {
    try {
      await save.mutateAsync({ ...form, order_ids: selectedOrders });
      toast.success("Rota criada");
      setOpen(false); setForm({}); setSelectedOrders([]);
    } catch (e: any) { toast.error(e.message); }
  };

  const romaneioPDF = async (r: any) => {
    const mod = await import("@/lib/api");
    const full: any = await mod.api(`/api/smartroute/routes/${r.id}`);
    const doc = new jsPDF();
    doc.setFontSize(14); doc.text(`Romaneio · Rota ${full.code}`, 14, 15);
    doc.setFontSize(9);
    doc.text(`Data: ${full.planned_date?.slice(0, 10)}   Motorista: ${full.driver_name || "—"}   Veículo: ${full.vehicle_plate || "—"}`, 14, 22);
    const km = full.total_distance_km ? `${full.total_distance_km} km` : "—";
    const dur = full.estimated_duration_min ? `${Math.floor(full.estimated_duration_min/60)}h${String(full.estimated_duration_min%60).padStart(2,'0')}` : "—";
    const cost = full.estimated_cost_brl ? `R$ ${Number(full.estimated_cost_brl).toFixed(2)}` : "—";
    doc.text(`Distância: ${km}   Duração estimada: ${dur}   Custo combustível: ${cost}`, 14, 27);
    const etaTxt = (m: number | null) => m == null ? "—" : `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
    autoTable(doc, {
      startY: 33, styles: { fontSize: 8 },
      head: [["#", "ETA", "PDV", "Endereço", "Pedido", "Peso (kg)", "Volume (m³)", "Assinatura"]],
      body: (full.stops || []).map((s: any) => [
        s.sequence, etaTxt(s.eta_min), s.pdv_name || "", s.pdv_address || "", s.order_number || "",
        s.weight_kg || 0, s.volume_m3 || 0, "________________",
      ]),
    });
    doc.save(`romaneio-${full.code}.pdf`);
  };

  const shareTrackingLinks = async (r: any) => {
    const mod = await import("@/lib/api");
    const full: any = await mod.api(`/api/smartroute/routes/${r.id}`);
    const base = window.location.origin;
    const lines: string[] = [];
    for (const s of full.stops || []) {
      if (!s.order_id) continue;
      const t: any = await mod.api(`/api/smartroute/orders/${s.order_id}/tracking-token`, { method: "POST", body: {} });
      lines.push(`#${s.sequence} ${s.pdv_name}: ${base}/track/${t.token}`);
    }
    await navigator.clipboard.writeText(lines.join("\n"));
    toast.success(`${lines.length} links copiados`);
  };



  return (
    <MainLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><RouteIcon className="w-6 h-6" /> Rotas</h1>
            <p className="text-sm text-muted-foreground">Planejamento e execução de rotas de entrega.</p>
          </div>
          <div className="flex gap-2 items-end">
            <div>
              <Label className="text-xs">Data</Label>
              <Input type="date" value={filter.date || ""} onChange={(e) => setFilter({ ...filter, date: e.target.value || undefined })} className="w-44" />
            </div>
            <Button variant="outline" asChild>
              <Link to="/smartroute/importar-romaneio"><Upload className="w-4 h-4 mr-1" /> Importar Romaneio</Link>
            </Button>
            <Button onClick={() => {
              const def = depots.find((d: any) => d.is_default) || depots[0];
              setForm({ planned_date: new Date().toISOString().slice(0, 10), depot_id: def?.id || null });
              setSelectedOrders([]); setOpen(true);
            }}><Plus className="w-4 h-4 mr-1" /> Nova rota</Button>
          </div>
        </div>

        <Card><CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Código</TableHead><TableHead>Data</TableHead><TableHead>Motorista</TableHead>
              <TableHead>Veículo</TableHead><TableHead>Paradas</TableHead><TableHead>Km</TableHead><TableHead>Duração</TableHead><TableHead>Custo</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono">{r.code}</TableCell>
                  <TableCell>{r.planned_date?.slice(0, 10)}</TableCell>
                  <TableCell>{r.driver_name || "—"}</TableCell>
                  <TableCell>{r.vehicle_plate || "—"}</TableCell>
                  <TableCell>{r.completed_stops}/{r.total_stops}</TableCell>
                  <TableCell className="text-xs">{r.total_distance_km ? `${r.total_distance_km} km` : "—"}</TableCell>
                  <TableCell className="text-xs">{r.estimated_duration_min ? `${Math.floor(r.estimated_duration_min/60)}h${String(r.estimated_duration_min%60).padStart(2,'0')}` : "—"}</TableCell>
                  <TableCell className="text-xs font-medium">{r.estimated_cost_brl ? `R$ ${Number(r.estimated_cost_brl).toFixed(2)}` : "—"}</TableCell>
                  <TableCell><Badge className={statusColor[r.status] || ""}>{r.status}</Badge></TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button size="icon" variant="ghost" onClick={() => setViewId(r.id)}><Eye className="w-4 h-4" /></Button>
                    <Button size="icon" variant="ghost" title="Otimizar (rápido)" onClick={() => optimize.mutate(r.id, { onSuccess: () => toast.success("Sequência otimizada") })}><Wand2 className="w-4 h-4" /></Button>
                    <Button size="icon" variant="ghost" title="Otimizar IA" onClick={() => optimizeAdv.mutate(r.id, { onSuccess: (d: any) => toast.success(`IA: ${d.sequenced} paradas · ${d.total_km}km${d.estimated_cost_brl ? ` · R$ ${d.estimated_cost_brl}` : ""}`, { description: d.warnings?.length ? d.warnings.join(" | ") : undefined }) })}><Sparkles className="w-4 h-4 text-primary" /></Button>
                    <Button size="icon" variant="ghost" title="Re-otimizar em tempo real (mantém concluídas)" onClick={() => reopt.mutate(r.id, { onSuccess: (d: any) => toast.success(`Re-otimizada · ${d.resequenced} pendentes${d.warnings?.length ? ` · ${d.warnings.length} avisos` : ""}`, { description: `Mantidas ${d.kept_completed} concluídas` }) })}><RefreshCw className="w-4 h-4" /></Button>
                    <Button size="icon" variant="ghost" title="Romaneio PDF" onClick={() => romaneioPDF(r)}><FileText className="w-4 h-4" /></Button>
                    <Button size="icon" variant="ghost" title="Copiar links de rastreio" onClick={() => shareTrackingLinks(r)}>🔗</Button>
                    <Link to={`/smartroute/replay/${r.id}`}><Button size="icon" variant="ghost" title="Replay"><PlayCircle className="w-4 h-4" /></Button></Link>
                    <Button size="icon" variant="ghost" onClick={() => { if (confirm("Excluir?")) del.mutate(r.id); }}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                  </TableCell>

                </TableRow>
              ))}
              {!data.length && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">Nenhuma rota.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent></Card>

        {/* Create dialog */}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Nova rota</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Data</Label><Input type="date" value={form.planned_date || ""} onChange={(e) => setForm({ ...form, planned_date: e.target.value })} /></div>
              <div><Label>Código (opcional)</Label><Input value={form.code || ""} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
              <div>
                <Label>Motorista</Label>
                <Select value={form.driver_id || "none"} onValueChange={(v) => setForm({ ...form, driver_id: v === "none" ? null : v })}>
                  <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Não atribuído</SelectItem>
                    {drivers.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Veículo</Label>
                <Select value={form.vehicle_id || "none"} onValueChange={(v) => setForm({ ...form, vehicle_id: v === "none" ? null : v })}>
                  <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Não atribuído</SelectItem>
                    {vehicles.map((v: any) => <SelectItem key={v.id} value={v.id}>{v.plate} — {v.model}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>Centro de Distribuição (partida)</Label>
                {depots.length === 0 ? (
                  <div className="text-xs text-amber-600 border border-amber-300 bg-amber-50 rounded p-2">
                    Nenhum CD cadastrado. <a href="/smartroute/cds" className="underline font-medium">Cadastrar agora →</a>
                  </div>
                ) : (
                  <Select value={form.depot_id || "none"} onValueChange={(v) => setForm({ ...form, depot_id: v === "none" ? null : v })}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem CD (usar 1º PDV como partida)</SelectItem>
                      {depots.map((d: any) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}{d.is_default ? " ⭐" : ""} {d.city ? `· ${d.city}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
            <div>
              <Label className="mb-2 block">Pedidos pendentes ({selectedOrders.length} selecionados)</Label>
              <div className="max-h-56 overflow-y-auto border rounded p-2 space-y-1">
                {pendingOrders.map((o: any) => (
                  <label key={o.id} className="flex items-center gap-2 text-sm p-1 hover:bg-muted rounded cursor-pointer">
                    <Checkbox checked={selectedOrders.includes(o.id)} onCheckedChange={(v) => setSelectedOrders((s) => v ? [...s, o.id] : s.filter((x) => x !== o.id))} />
                    <span className="flex-1">{o.pdv_name || "?"} · {o.order_number || o.id.slice(0, 6)}</span>
                    <span className="text-xs text-muted-foreground">{o.weight_kg} kg · {o.volume_m3} m³</span>
                  </label>
                ))}
                {!pendingOrders.length && <p className="text-xs text-muted-foreground text-center py-2">Nenhum pedido pendente.</p>}
              </div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={onSave} disabled={save.isPending}>Criar rota</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* View dialog */}
        <Dialog open={!!viewId} onOpenChange={(v) => !v && setViewId(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader><DialogTitle>Rota {viewRoute?.code}</DialogTitle></DialogHeader>
            {viewRoute && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div><span className="text-muted-foreground">Motorista:</span> {viewRoute.driver_name || "—"}</div>
                  <div><span className="text-muted-foreground">Veículo:</span> {viewRoute.vehicle_plate || "—"}</div>
                  <div><span className="text-muted-foreground">Status:</span> <Badge className={statusColor[viewRoute.status] || ""}>{viewRoute.status}</Badge></div>
                  <div><span className="text-muted-foreground">Distância:</span> {viewRoute.total_distance_km ? `${viewRoute.total_distance_km} km` : "—"}</div>
                  <div><span className="text-muted-foreground">Duração est.:</span> {viewRoute.estimated_duration_min ? `${Math.floor(viewRoute.estimated_duration_min/60)}h${String(viewRoute.estimated_duration_min%60).padStart(2,'0')}` : "—"}</div>
                  <div><span className="text-muted-foreground">Custo combustível:</span> {viewRoute.estimated_cost_brl ? <span className="font-semibold">R$ {Number(viewRoute.estimated_cost_brl).toFixed(2)}</span> : "—"}{viewRoute.estimated_fuel_liters ? <span className="text-xs text-muted-foreground"> · {viewRoute.estimated_fuel_liters}L</span> : null}</div>
                </div>
                <div className="border rounded max-h-96 overflow-y-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead className="w-12">#</TableHead><TableHead>ETA</TableHead><TableHead>PDV</TableHead><TableHead>Pedido</TableHead><TableHead>Peso</TableHead><TableHead>Status</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {viewRoute.stops?.map((s: any) => (
                        <TableRow key={s.id}>
                          <TableCell>{s.sequence}</TableCell>
                          <TableCell className="font-mono text-xs">{s.eta_min != null ? `${String(Math.floor(s.eta_min/60)).padStart(2,'0')}:${String(s.eta_min%60).padStart(2,'0')}` : "—"}</TableCell>
                          <TableCell>{s.pdv_name}</TableCell>
                          <TableCell className="font-mono text-xs">{s.order_number}</TableCell>
                          <TableCell>{s.weight_kg} kg</TableCell>
                          <TableCell><Badge variant="outline">{s.status}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
      <PageAssistant content={ASSISTANT_CONTENT.rotasLegado} />
    </MainLayout>
  );
}
