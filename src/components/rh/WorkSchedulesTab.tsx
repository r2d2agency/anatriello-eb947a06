import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { useEmployees } from '@/hooks/use-rh';
import {
  useWorkSchedules, useCreateWorkSchedule, useUpdateWorkSchedule,
  useDeleteWorkSchedule, useAssignWorkSchedule,
} from '@/hooks/use-timeclock';
import { Plus, Pencil, Trash2, Users, Clock } from 'lucide-react';

const WEEKDAYS: Array<{ key: string; label: string }> = [
  { key: 'mon', label: 'Segunda' },
  { key: 'tue', label: 'Terça' },
  { key: 'wed', label: 'Quarta' },
  { key: 'thu', label: 'Quinta' },
  { key: 'fri', label: 'Sexta' },
  { key: 'sat', label: 'Sábado' },
  { key: 'sun', label: 'Domingo' },
];

const minToHHMM = (v: number) => `${String(Math.floor((v || 0) / 60)).padStart(2, '0')}:${String((v || 0) % 60).padStart(2, '0')}`;
const hhmmToMin = (v: string) => { const [h, m] = v.split(':').map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null; };

const KIND_LABEL: Record<string, string> = {
  fixa: 'Fixa semanal',
  escala_6x1: 'Escala 6x1',
  escala_12x36: 'Escala 12x36',
  escala_5x2: 'Escala 5x2',
  livre: 'Jornada livre',
};

function emptyForm() {
  return {
    name: '',
    kind: 'fixa',
    company_id: '',
    schedule_json: { mon: '08:00-12:00,13:00-17:00', tue: '08:00-12:00,13:00-17:00', wed: '08:00-12:00,13:00-17:00', thu: '08:00-12:00,13:00-17:00', fri: '08:00-12:00,13:00-17:00', sat: 'folga', sun: 'folga' } as Record<string, string>,
    cycle_pattern: null as any,
    cycle_start_date: '',
    tolerance_minutes: 10,
    night_bonus_pct: 20,
    sunday_bonus_pct: 100,
    holiday_bonus_pct: 100,
    overtime_weekday_pct: 50,
    overtime_weekend_pct: 100,
    night_start_min: 1320,
    night_end_min: 300,
    dsr_enabled: true,
    night_reduced_hour: true,
    active: true,
  };
}

export function WorkSchedulesTab() {
  const { toast } = useToast();
  const { data: schedules = [] } = useWorkSchedules();
  const { data: employees = [] } = useEmployees({ status: 'ativo' });
  const create = useCreateWorkSchedule();
  const update = useUpdateWorkSchedule();
  const del = useDeleteWorkSchedule();
  const assign = useAssignWorkSchedule();

  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [assignFor, setAssignFor] = useState<any | null>(null);
  const [selEmps, setSelEmps] = useState<string[]>([]);

  function openNew() {
    setEditing({ id: null });
    setForm(emptyForm());
  }
  function openEdit(s: any) {
    setEditing(s);
    setForm({
      name: s.name,
      kind: s.kind,
      company_id: s.company_id || '',
      schedule_json: s.schedule_json || {},
      cycle_pattern: s.cycle_pattern || null,
      cycle_start_date: s.cycle_start_date ? String(s.cycle_start_date).slice(0, 10) : '',
      tolerance_minutes: s.tolerance_minutes ?? 10,
      night_bonus_pct: s.night_bonus_pct ?? 20,
      sunday_bonus_pct: s.sunday_bonus_pct ?? 100,
      holiday_bonus_pct: s.holiday_bonus_pct ?? 100,
      overtime_weekday_pct: s.overtime_weekday_pct ?? 50,
      overtime_weekend_pct: s.overtime_weekend_pct ?? 100,
      night_start_min: s.night_start_min ?? 1320,
      night_end_min: s.night_end_min ?? 300,
      dsr_enabled: s.dsr_enabled !== false,
      night_reduced_hour: s.night_reduced_hour !== false,
      active: s.active !== false,
    });
  }

  async function save() {
    if (!form.name) { toast({ title: 'Nome obrigatório', variant: 'destructive' }); return; }
    const payload = { ...form, company_id: form.company_id || null, cycle_start_date: form.cycle_start_date || null };
    try {
      if (editing?.id) await update.mutateAsync({ id: editing.id, ...payload });
      else await create.mutateAsync(payload);
      toast({ title: 'Jornada salva' });
      setEditing(null);
    } catch (e: any) { toast({ title: e.message || 'Erro', variant: 'destructive' }); }
  }

  async function doAssign() {
    if (!selEmps.length) { toast({ title: 'Selecione ao menos um colaborador' }); return; }
    await assign.mutateAsync({ id: assignFor.id, employee_ids: selEmps });
    toast({ title: `${selEmps.length} colaborador(es) vinculado(s)` });
    setAssignFor(null); setSelEmps([]);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold">Jornadas de Trabalho</h3>
          <p className="text-sm text-muted-foreground">Modelos reutilizáveis com horários, tolerâncias e adicionais.</p>
        </div>
        <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />Nova jornada</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Tolerância</TableHead>
                <TableHead>Not.</TableHead>
                <TableHead>Dom.</TableHead>
                <TableHead>Fer.</TableHead>
                <TableHead>Vinculados</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedules.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Nenhuma jornada cadastrada</TableCell></TableRow>
              )}
              {schedules.map((s: any) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <div className="font-medium flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      {s.name}
                      {!s.active && <Badge variant="outline" className="ml-1">Inativa</Badge>}
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="secondary">{KIND_LABEL[s.kind] || s.kind}</Badge></TableCell>
                  <TableCell>{s.tolerance_minutes}min</TableCell>
                  <TableCell>+{s.night_bonus_pct}%</TableCell>
                  <TableCell>+{s.sunday_bonus_pct}%</TableCell>
                  <TableCell>+{s.holiday_bonus_pct}%</TableCell>
                  <TableCell>
                    <Button variant="link" size="sm" className="p-0 h-auto"
                      onClick={() => { setAssignFor(s); setSelEmps(employees.filter((e: any) => e.work_schedule_id === s.id).map((e: any) => e.id)); }}>
                      <Users className="h-3 w-3 mr-1" />{s.employees_count}
                    </Button>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(s)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Excluir jornada "${s.name}"?`)) del.mutate(s.id); }}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Editor */}
      <Dialog open={!!editing} onOpenChange={o => !o && setEditing(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? 'Editar' : 'Nova'} jornada</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Nome *</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ex: Administrativo 08-17" />
            </div>
            <div>
              <Label>Tipo</Label>
              <Select value={form.kind} onValueChange={v => setForm({ ...form, kind: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(KIND_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {form.kind === 'fixa' && (
            <div>
              <Label className="mb-2 block">Horários por dia da semana</Label>
              <div className="space-y-2">
                {WEEKDAYS.map(d => (
                  <div key={d.key} className="grid grid-cols-[100px_1fr] gap-2 items-center">
                    <span className="text-sm">{d.label}</span>
                    <Input
                      placeholder="08:00-12:00,13:00-17:00 ou folga"
                      value={form.schedule_json[d.key] || ''}
                      onChange={e => setForm({ ...form, schedule_json: { ...form.schedule_json, [d.key]: e.target.value } })}
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Formato: HH:MM-HH:MM, use vírgula para múltiplos períodos. Use "folga" para dia sem trabalho.</p>
            </div>
          )}

          {(form.kind === 'escala_6x1' || form.kind === 'escala_12x36' || form.kind === 'escala_5x2') && (
            <div className="space-y-2 border rounded-md p-3 bg-muted/30">
              <Label>Padrão de rotação (JSON)</Label>
              <Input
                placeholder='Ex: [{"h":"07:00-19:00"},{"h":"folga"}]'
                value={form.cycle_pattern ? JSON.stringify(form.cycle_pattern) : ''}
                onChange={e => {
                  try { setForm({ ...form, cycle_pattern: e.target.value ? JSON.parse(e.target.value) : null }); }
                  catch { setForm({ ...form, cycle_pattern: e.target.value as any }); }
                }}
              />
              <div>
                <Label>Data inicial do ciclo</Label>
                <Input type="date" value={form.cycle_start_date} onChange={e => setForm({ ...form, cycle_start_date: e.target.value })} />
              </div>
              <p className="text-xs text-muted-foreground">
                Ex 12x36: <code>[{'{"h":"07:00-19:00"}'},{'{"h":"folga"}'}]</code><br />
                Ex 6x1: 6 dias de trabalho + 1 folga.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 border-t pt-3">
            <div>
              <Label>Tolerância (min)</Label>
              <Input type="number" value={form.tolerance_minutes} onChange={e => setForm({ ...form, tolerance_minutes: +e.target.value })} />
            </div>
            <div>
              <Label>Adicional noturno (%)</Label>
              <Input type="number" value={form.night_bonus_pct} onChange={e => setForm({ ...form, night_bonus_pct: +e.target.value })} />
              <Label>Início janela noturna</Label>
              <Input type="time" value={minToHHMM(form.night_start_min)} onChange={e => setForm({ ...form, night_start_min: hhmmToMin(e.target.value) ?? 1320 })} />
              <Label>Fim janela noturna</Label>
              <Input type="time" value={minToHHMM(form.night_end_min)} onChange={e => setForm({ ...form, night_end_min: hhmmToMin(e.target.value) ?? 300 })} />
            </div>
            <div>
              <Label>HE dia útil (%)</Label>
              <Input type="number" value={form.overtime_weekday_pct} onChange={e => setForm({ ...form, overtime_weekday_pct: +e.target.value })} />
            </div>
            <div>
              <Label>HE fim de semana (%)</Label>
              <Input type="number" value={form.overtime_weekend_pct} onChange={e => setForm({ ...form, overtime_weekend_pct: +e.target.value })} />
              <Label>Adicional domingo (%)</Label>
              <Input type="number" value={form.sunday_bonus_pct} onChange={e => setForm({ ...form, sunday_bonus_pct: +e.target.value })} />
            </div>
            <div>
              <Label>HE feriado (%)</Label>
              <Input type="number" value={form.holiday_bonus_pct} onChange={e => setForm({ ...form, holiday_bonus_pct: +e.target.value })} />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch checked={form.dsr_enabled} onCheckedChange={v => setForm({ ...form, dsr_enabled: v })} />
              <Label>DSR habilitado</Label>
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch checked={form.night_reduced_hour} onCheckedChange={v => setForm({ ...form, night_reduced_hour: v })} />
              <Label>Hora noturna reduzida (52m30s)</Label>
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch checked={form.active} onCheckedChange={v => setForm({ ...form, active: v })} />
              <Label>Ativa</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={save}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign */}
      <Dialog open={!!assignFor} onOpenChange={o => !o && setAssignFor(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Vincular colaboradores — {assignFor?.name}</DialogTitle></DialogHeader>
          <div className="space-y-1">
            {employees.map((e: any) => (
              <label key={e.id} className="flex items-center gap-2 p-2 rounded hover:bg-muted cursor-pointer">
                <Checkbox
                  checked={selEmps.includes(e.id)}
                  onCheckedChange={c => setSelEmps(c ? [...selEmps, e.id] : selEmps.filter(x => x !== e.id))}
                />
                <span className="text-sm">{e.full_name}</span>
                {e.work_schedule_id && e.work_schedule_id !== assignFor?.id && (
                  <Badge variant="outline" className="ml-auto text-xs">Outra jornada</Badge>
                )}
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAssignFor(null)}>Cancelar</Button>
            <Button onClick={doAssign}>Vincular {selEmps.length}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
