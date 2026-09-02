import { useState, useEffect, useRef } from "react";
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
import { Plus, Trash2, Route as RouteIcon, Wand2, Eye, Sparkles, FileText, PlayCircle, RefreshCw, Upload, ArrowUp, ArrowDown, PackagePlus, X, Map as MapIcon } from "lucide-react";
import { toast } from "sonner";
import { useSRRoutes, useSRSaveRoute, useSRDeleteRoute, useSRDrivers, useSRVehicles, useSROrders, useSROptimizeRoute, useSRRoute, useSRAddStops, useSRReorderStops, useSRRemoveStop, useSRRouteGeometry } from "@/hooks/use-smartroute";
import { useSROptimizeAdvanced } from "@/hooks/use-smartroute-ai";
import { useSRReoptimize } from "@/hooks/use-smartroute-planner";
import { useSRDepots } from "@/hooks/use-smartroute-depots";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { PageAssistant, ASSISTANT_CONTENT } from "@/components/smartroute/PageAssistant";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

function RouteMapPreview({ points, legs }: { points: any[]; legs: number[][][] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView([-23.55, -46.63], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !points?.length) return;
    const layer = L.layerGroup().addTo(map);
    (legs || []).forEach((leg) => {
      if (Array.isArray(leg) && leg.length) L.polyline(leg as [number, number][], { color: "#2563eb", weight: 4, opacity: 0.75 }).addTo(layer);
    });
    points.forEach((p: any) => {
      const isDepot = !!p.is_depot;
      const icon = L.divIcon({
        className: "",
        html: `<div style="background:${isDepot ? "#16a34a" : "#2563eb"};color:#fff;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)">${isDepot ? "CD" : p.sequence}</div>`,
        iconSize: [26, 26], iconAnchor: [13, 13],
      });
      L.marker([p.lat, p.lng], { icon })
        .bindTooltip(isDepot ? "Centro de Distribuição" : `#${p.sequence} · ${p.pdv_name || ""}`)
        .addTo(layer);
    });
    const bounds = points.map((p: any) => [p.lat, p.lng] as [number, number]);
    if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
    return () => { layer.remove(); };
  }, [points, legs]);

  return <div ref={containerRef} className="h-80 w-full rounded border" />;
}


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
  const [showMap, setShowMap] = useState(false);
  const { data: geometry, isLoading: geometryLoading } = useSRRouteGeometry(viewId || undefined, showMap);
  const addStops = useSRAddStops();
  const reorderStops = useSRReorderStops();
  const removeStop = useSRRemoveStop();
  const [addOrdersOpen, setAddOrdersOpen] = useState(false);
  const [ordersToAdd, setOrdersToAdd] = useState<string[]>([]);
  const routeEditable = viewRoute && !["concluida", "cancelada"].includes(viewRoute.status);

  const moveStop = (index: number, dir: -1 | 1) => {
    if (!viewRoute?.stops) return;
    const arr = [...viewRoute.stops];
    const target = index + dir;
    if (target < 0 || target >= arr.length) return;
    [arr[index], arr[target]] = [arr[target], arr[index]];
    reorderStops.mutate({ routeId: viewRoute.id, stop_ids: arr.map((s: any) => s.id) });
  };

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
        <Dialog open={!!viewId} onOpenChange={(v) => { if (!v) { setViewId(null); setAddOrdersOpen(false); setOrdersToAdd([]); setShowMap(false); } }}>
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

                <Button size="sm" variant="outline" onClick={() => setShowMap((v) => !v)}>
                  <MapIcon className="w-4 h-4 mr-1" /> {showMap ? "Esconder mapa" : "Ver traçado no mapa"}
                </Button>

                {showMap && (
                  geometryLoading ? (
                    <p className="text-sm text-muted-foreground text-center py-8">Calculando o traçado...</p>
                  ) : geometry?.points?.length ? (
                    <div className="space-y-1">
                      <RouteMapPreview points={geometry.points} legs={geometry.legs} />
                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                        <span>Distância pelo traçado: <b className="text-foreground">{geometry.total_km} km</b></span>
                        <span>Tempo estimado: <b className="text-foreground">{Math.floor(geometry.total_min / 60)}h{String(geometry.total_min % 60).padStart(2, "0")}</b></span>
                        {geometry.approximate && <span className="text-amber-600">Algum trecho usou linha reta (serviço de rotas indisponível no momento).</span>}
                        {geometry.missing_coords?.length > 0 && (
                          <span className="text-amber-600">{geometry.missing_coords.length} parada(s) sem coordenada, não aparecem no mapa.</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-8">Nenhuma parada com coordenada pra desenhar o mapa.</p>
                  )
                )}

                {routeEditable && (
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">Use as setas para reordenar por prioridade, ou remova/adicione paradas.</p>
                    <Button size="sm" variant="outline" onClick={() => setAddOrdersOpen((v) => !v)}>
                      <PackagePlus className="w-4 h-4 mr-1" /> Adicionar pedido
                    </Button>
                  </div>
                )}

                {addOrdersOpen && (
                  <div className="border rounded p-2 space-y-2">
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {pendingOrders.map((o: any) => (
                        <label key={o.id} className="flex items-center gap-2 text-sm p-1 hover:bg-muted rounded cursor-pointer">
                          <Checkbox checked={ordersToAdd.includes(o.id)} onCheckedChange={(v) => setOrdersToAdd((s) => v ? [...s, o.id] : s.filter((x) => x !== o.id))} />
                          <span className="flex-1">{o.pdv_name || "?"} · {o.order_number || o.id.slice(0, 6)}</span>
                          <span className="text-xs text-muted-foreground">{o.weight_kg} kg · {o.volume_m3} m³</span>
                        </label>
                      ))}
                      {!pendingOrders.length && <p className="text-xs text-muted-foreground text-center py-2">Nenhum pedido pendente.</p>}
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => { setAddOrdersOpen(false); setOrdersToAdd([]); }}>Cancelar</Button>
                      <Button
                        size="sm"
                        disabled={!ordersToAdd.length || addStops.isPending}
                        onClick={() => addStops.mutate({ routeId: viewRoute.id, order_ids: ordersToAdd }, {
                          onSuccess: (d: any) => { toast.success(`${d.added} pedido(s) adicionado(s) à rota`); setAddOrdersOpen(false); setOrdersToAdd([]); },
                          onError: (e: any) => toast.error(e.message),
                        })}
                      >
                        Adicionar {ordersToAdd.length > 0 ? `(${ordersToAdd.length})` : ""}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="border rounded max-h-96 overflow-y-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead className="w-12">#</TableHead><TableHead>ETA</TableHead><TableHead>PDV</TableHead><TableHead>Pedido</TableHead><TableHead>Peso</TableHead><TableHead>Status</TableHead>
                      {routeEditable && <TableHead className="text-right">Ações</TableHead>}
                    </TableRow></TableHeader>
                    <TableBody>
                      {viewRoute.stops?.map((s: any, idx: number) => (
                        <TableRow key={s.id}>
                          <TableCell>{s.sequence}</TableCell>
                          <TableCell className="font-mono text-xs">{s.eta_min != null ? `${String(Math.floor(s.eta_min/60)).padStart(2,'0')}:${String(s.eta_min%60).padStart(2,'0')}` : "—"}</TableCell>
                          <TableCell>{s.pdv_name}</TableCell>
                          <TableCell className="font-mono text-xs">{s.order_number}</TableCell>
                          <TableCell>{s.weight_kg} kg</TableCell>
                          <TableCell><Badge variant="outline">{s.status}</Badge></TableCell>
                          {routeEditable && (
                            <TableCell className="text-right whitespace-nowrap">
                              <Button size="icon" variant="ghost" className="h-6 w-6" disabled={idx === 0 || reorderStops.isPending} onClick={() => moveStop(idx, -1)} title="Subir prioridade">
                                <ArrowUp className="w-3.5 h-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-6 w-6" disabled={idx === viewRoute.stops.length - 1 || reorderStops.isPending} onClick={() => moveStop(idx, 1)} title="Descer prioridade">
                                <ArrowDown className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="icon" variant="ghost" className="h-6 w-6" title="Remover da rota"
                                onClick={() => { if (confirm("Remover esta parada da rota? O pedido volta para pendente.")) removeStop.mutate({ routeId: viewRoute.id, stopId: s.id }, { onError: (e: any) => toast.error(e.message) }); }}
                              >
                                <X className="w-3.5 h-3.5 text-red-500" />
                              </Button>
                            </TableCell>
                          )}
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
