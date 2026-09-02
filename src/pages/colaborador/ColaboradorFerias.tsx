import { useState, useMemo } from "react";
import { ColaboradorLayout } from "./ColaboradorLayout";
import { useColabVacations, useColabRequestVacation, useColabMeFull } from "@/hooks/use-promotor";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ChevronRight } from "lucide-react";
import { format, differenceInDays, addYears } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export default function ColaboradorFerias() {
  const { data: vacations, isLoading } = useColabVacations();
  const { data: meFull } = useColabMeFull();
  const request = useColabRequestVacation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});

  const emp = meFull?.employee;
  const acquisition = useMemo(() => {
    if (!emp?.admission_date) return null;
    const adm = new Date(emp.admission_date);
    const now = new Date();
    const yearsWorked = Math.floor(differenceInDays(now, adm) / 365);
    const start = addYears(adm, yearsWorked);
    const end = addYears(start, 1);
    return { start, end };
  }, [emp]);

  const totais = { totais: 30, gozados: (vacations || []).reduce((s, v: any) => s + (v.days_taken || 0), 0), restantes: 0 };
  totais.restantes = totais.totais - totais.gozados;

  const proximas = (vacations || []).filter((v: any) => new Date(v.start_date) >= new Date());
  const historico = (vacations || []).filter((v: any) => new Date(v.end_date) < new Date());

  async function submit() {
    if (!form.start_date || !form.end_date) return;
    try {
      const days = differenceInDays(new Date(form.end_date), new Date(form.start_date)) + 1;
      await request.mutateAsync({ ...form, days_total: days });
      toast({ title: "Solicitação de férias enviada" });
      setOpen(false); setForm({});
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
  }

  return (
    <ColaboradorLayout bg="light" title="Férias" showBack>
      <div className="px-4 pt-4 space-y-4">
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>Período aquisitivo</span><span>Status</span>
          </div>
          <div className="flex justify-between items-center">
            <p className="text-sm font-semibold">
              {acquisition ? `${format(acquisition.start, "dd/MM/yyyy")} a ${format(acquisition.end, "dd/MM/yyyy")}` : "—"}
            </p>
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">Em andamento</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 shadow-sm grid grid-cols-3">
          <Metric value={totais.totais} label="Dias totais" />
          <Metric value={totais.gozados} label="Dias gozados" />
          <Metric value={totais.restantes} label="Dias restantes" />
        </div>

        <Button onClick={() => setOpen(true)} className="w-full bg-[#f97316] hover:bg-[#ea580c] rounded-xl h-12 font-bold">
          SOLICITAR FÉRIAS
        </Button>

        <Section title="Próximas férias">
          {proximas.length === 0 && <Empty />}
          {proximas.map((v: any) => <VacationRow key={v.id} v={v} />)}
        </Section>

        <Section title="Histórico de férias">
          {historico.length === 0 && <Empty />}
          {historico.map((v: any) => <VacationRow key={v.id} v={v} />)}
        </Section>

        {isLoading && <Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-400" />}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Solicitar férias</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Início</Label><Input type="date" value={form.start_date || ""} onChange={e => setForm({ ...form, start_date: e.target.value })} /></div>
            <div><Label>Fim</Label><Input type="date" value={form.end_date || ""} onChange={e => setForm({ ...form, end_date: e.target.value })} /></div>
          </div>
          <div><Label>Observações</Label><Textarea rows={2} value={form.notes || ""} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={request.isPending} className="bg-[#f97316] hover:bg-[#ea580c]">
              {request.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ColaboradorLayout>
  );
}

function Metric({ value, label }: any) {
  return <div className="text-center"><p className="text-2xl font-bold text-[#f97316]">{value}</p><p className="text-[10px] text-slate-500 mt-1">{label}</p></div>;
}
function Section({ title, children }: any) {
  return <div><p className="text-sm font-bold mb-2">{title}</p><div className="space-y-2">{children}</div></div>;
}
function Empty() { return <p className="text-xs text-slate-400 text-center py-3">Nenhum registro</p>; }
function VacationRow({ v }: any) {
  return (
    <div className="bg-white rounded-2xl p-3 shadow-sm flex justify-between items-center">
      <div>
        <p className="text-xs text-slate-500">Período</p>
        <p className="text-sm font-semibold">{safeDate(v.start_date)} a {safeDate(v.end_date)} ({v.days_total} dias)</p>
        <p className="text-[10px] text-slate-400 mt-0.5 capitalize">Status: {v.status}</p>
      </div>
      <ChevronRight className="h-4 w-4 text-slate-300" />
    </div>
  );
}
