import { useState, useMemo } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useEmployees } from '@/hooks/use-rh';
import {
  useCartaoPonto, useEditCartaoPonto, useCartaoPontoAudit,
  useTimeBankSummary, useTimeBankEntries, useAddTimeBankManual,
  useHolidays, useCreateHoliday, useDeleteHoliday, useImportNationalHolidays,
  useAdjustmentRequests, useReviewAdjustmentRequest,
  useReportSummary, useReportAbsencesLates, useTimeBankStatement, downloadTimeclockCsv,
  useClosings, useCreateClosing, useDeleteClosing,
} from '@/hooks/use-timeclock';
import { useCompanies } from '@/hooks/use-companies';
import { WorkSchedulesTab } from '@/components/rh/WorkSchedulesTab';
import { RegistrosPontoTab } from '@/components/rh/RegistrosPontoTab';
import { GestaoPontoTab } from '@/components/rh/GestaoPontoTab';

import { format, startOfMonth, endOfMonth } from 'date-fns';
import { Calendar, Clock, TrendingUp, TrendingDown, CheckCircle2, XCircle, Pencil, History, Trash2, Plus, Download, FileText, AlertCircle } from 'lucide-react';


const STATUS_COLORS: Record<string, string> = {
  normal: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  extra: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  atraso: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  falta: 'bg-red-500/10 text-red-700 dark:text-red-300',
  feriado: 'bg-purple-500/10 text-purple-700 dark:text-purple-300',
  folga: 'bg-muted text-muted-foreground',
};

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const safeDate = (v: any): Date | null => {
  if (!v) return null;
  const d = new Date(typeof v === 'string' && !v.includes('T') ? v + 'T12:00:00' : v);
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

const safeFmt = (v: any, fmt: string, fallback = '—'): string => {
  const d = safeDate(v);
  return d ? format(d, fmt) : fallback;
};

function fmtMin(min?: number | null) {
  if (min == null) return '--:--';
  const sign = min < 0 ? '-' : (min > 0 ? '+' : '');
  const abs = Math.abs(Math.round(min));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ============ CARTÃO PONTO TAB ============
function CartaoPontoTab() {
  const { toast } = useToast();
  const { data: employees = [] } = useEmployees({ status: 'ativo' });
  const [employeeId, setEmployeeId] = useState<string>('');
  const [start, setStart] = useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [end, setEnd] = useState(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const { data, isLoading } = useCartaoPonto({ employee_id: employeeId, start, end });
  const [editDay, setEditDay] = useState<any | null>(null);
  const [auditDay, setAuditDay] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <Label>Colaborador</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {employees.map((e: any) => (
                  <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Início</Label>
            <Input type="date" value={start} onChange={e => setStart(e.target.value)} />
          </div>
          <div>
            <Label>Fim</Label>
            <Input type="date" value={end} onChange={e => setEnd(e.target.value)} />
          </div>
          <div className="flex items-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setStart(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
                setEnd(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
              }}
            >
              Mês atual
            </Button>
            <Button
              variant="default"
              disabled={!employeeId || generatingPdf}
              onClick={async () => {
                setGeneratingPdf(true);
                try {
                  const token = localStorage.getItem('token');
                  const url = `${(import.meta.env.VITE_API_URL || '').replace(/\/$/, '')}/api/timeclock/mirror.pdf?employee_id=${employeeId}&start=${start}&end=${end}`;
                  const r = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
                  if (!r.ok) {
                    let message = `Erro ao gerar espelho (HTTP ${r.status})`;
                    try {
                      const body = await r.json();
                      if (body?.error) message = body.error;
                    } catch { /* resposta não era JSON */ }
                    toast({ title: 'Falha ao gerar Espelho PDF', description: message, variant: 'destructive' });
                    return;
                  }
                  const blob = await r.blob();
                  const o = URL.createObjectURL(blob);
                  const a = document.createElement('a'); a.href = o; a.download = `espelho-${start}_${end}.pdf`;
                  document.body.appendChild(a); a.click(); a.remove();
                  setTimeout(() => URL.revokeObjectURL(o), 500);
                } catch (err: any) {
                  toast({ title: 'Falha ao gerar Espelho PDF', description: err?.message || 'Erro de rede', variant: 'destructive' });
                } finally {
                  setGeneratingPdf(false);
                }
              }}
            >
              {generatingPdf ? 'Gerando...' : 'Espelho PDF'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {data && (
        <>
          <Card>
            <CardContent className="pt-4 grid grid-cols-2 md:grid-cols-5 gap-4">
              <StatBox label="Trabalhado" value={fmtMin(data.totals.worked_min)} icon={Clock} />
              <StatBox label="Previsto" value={fmtMin(data.totals.expected_min)} icon={Calendar} />
              <StatBox label="Crédito" value={fmtMin(data.totals.credit_min)} icon={TrendingUp} color="text-emerald-600" />
              <StatBox label="Débito" value={fmtMin(data.totals.debit_min)} icon={TrendingDown} color="text-red-600" />
              <StatBox
                label="Saldo período"
                value={fmtMin(data.totals.balance_min)}
                icon={TrendingUp}
                color={data.totals.balance_min >= 0 ? 'text-emerald-600' : 'text-red-600'}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Cartão Ponto — {data.employee.full_name}</CardTitle></CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Ent 1</TableHead>
                    <TableHead>Saí 1</TableHead>
                    <TableHead>Ent 2</TableHead>
                    <TableHead>Saí 2</TableHead>
                    <TableHead>Ent 3</TableHead>
                    <TableHead>Saí 3</TableHead>
                    <TableHead>Normais</TableHead>
                    <TableHead className="text-emerald-600">BCred</TableHead>
                    <TableHead className="text-red-600">BDeb</TableHead>
                    <TableHead>BSaldo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.days.map((d: any) => {
                    const isWeekend = d.dow === 0 || d.dow === 6;
                    return (
                      <TableRow key={d.date} className={isWeekend ? 'bg-muted/30' : d.is_holiday ? 'bg-purple-500/5' : ''}>
                        <TableCell className="font-mono text-xs whitespace-nowrap">
                          {safeFmt(d.date, 'dd/MM')} - {WEEKDAYS[d.dow]}
                        </TableCell>
                        <TableCell className="font-mono">{d.entry1 || '--'}</TableCell>
                        <TableCell className="font-mono">{d.exit1 || '--'}</TableCell>
                        <TableCell className="font-mono">{d.entry2 || '--'}</TableCell>
                        <TableCell className="font-mono">{d.exit2 || '--'}</TableCell>
                        <TableCell className="font-mono">{d.entry3 || '--'}</TableCell>
                        <TableCell className="font-mono">{d.exit3 || '--'}</TableCell>
                        <TableCell className="font-mono">{fmtMin(d.total_worked_min)}</TableCell>
                        <TableCell className="font-mono text-emerald-600">{d.credit_min ? fmtMin(d.credit_min) : '--'}</TableCell>
                        <TableCell className="font-mono text-red-600">{d.debit_min ? fmtMin(d.debit_min) : '--'}</TableCell>
                        <TableCell className={`font-mono font-semibold ${d.balance_min > 0 ? 'text-emerald-600' : d.balance_min < 0 ? 'text-red-600' : ''}`}>
                          {fmtMin(d.balance_min)}
                        </TableCell>
                        <TableCell>
                          <Badge className={STATUS_COLORS[d.status] || ''} variant="secondary">{d.status}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" onClick={() => setEditDay(d)} title="Editar">
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => setAuditDay(d.date)} title="Histórico">
                              <History className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {editDay && (
        <EditDayDialog
          employeeId={employeeId}
          day={editDay}
          onClose={() => setEditDay(null)}
        />
      )}
      {auditDay && (
        <AuditDialog employeeId={employeeId} date={auditDay} onClose={() => setAuditDay(null)} />
      )}
      {isLoading && <p className="text-center text-muted-foreground">Carregando...</p>}
      {!employeeId && (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Selecione um colaborador para ver o cartão ponto.</CardContent></Card>
      )}
    </div>
  );
}

function StatBox({ label, value, icon: Icon, color = '' }: any) {
  return (
    <div className="flex items-center gap-3">
      <div className={`p-2 rounded-lg bg-muted ${color}`}><Icon className="h-5 w-5" /></div>
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-lg font-mono font-bold ${color}`}>{value}</div>
      </div>
    </div>
  );
}

function EditDayDialog({ employeeId, day, onClose }: any) {
  const { toast } = useToast();
  const edit = useEditCartaoPonto();
  const initial = [day.entry1, day.exit1, day.entry2, day.exit2, day.entry3, day.exit3].map((t: any) => t ? String(t).slice(0, 5) : '');
  const [times, setTimes] = useState<string[]>(initial);
  const [reason, setReason] = useState('');

  const save = async () => {
    if (!reason.trim()) { toast({ title: 'Informe o motivo do ajuste', variant: 'destructive' }); return; }
    const clean = times.filter(t => /^\d{1,2}:\d{2}$/.test(t));
    await edit.mutateAsync({ employee_id: employeeId, date: day.date, times: clean, reason });
    toast({ title: 'Batidas atualizadas' });
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Editar Batidas — {safeFmt(day.date, 'dd/MM/yyyy')}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {times.map((t, i) => (
              <div key={i}>
                <Label className="text-xs">{i % 2 === 0 ? `Entrada ${Math.floor(i / 2) + 1}` : `Saída ${Math.floor(i / 2) + 1}`}</Label>
                <Input type="time" value={t} onChange={e => {
                  const copy = [...times]; copy[i] = e.target.value; setTimes(copy);
                }} />
              </div>
            ))}
          </div>
          <div>
            <Label>Motivo do ajuste *</Label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Ex: Esqueceu de bater na saída, confirmado com testemunhas" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={edit.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AuditDialog({ employeeId, date, onClose }: any) {
  const { data = [] } = useCartaoPontoAudit(employeeId, date);
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Histórico de edições — {safeFmt(date, 'dd/MM/yyyy')}</DialogTitle></DialogHeader>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {data.length === 0 && <p className="text-muted-foreground text-sm">Nenhuma edição registrada.</p>}
          {data.map((a: any) => (
            <div key={a.id} className="border rounded p-3 text-sm">
              <div className="font-medium">{a.editor_name || 'Sistema'} — {safeFmt(a.edited_at, 'dd/MM/yyyy HH:mm')}</div>
              <div className="text-xs text-muted-foreground">Ação: {a.action}</div>
              {a.old_value && <div className="text-xs">De: <span className="font-mono">{a.old_value}</span></div>}
              {a.new_value && <div className="text-xs">Para: <span className="font-mono">{a.new_value}</span></div>}
              {a.reason && <div className="text-xs italic mt-1">"{a.reason}"</div>}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============ BANCO DE HORAS TAB ============
function BancoHorasTab() {
  const { toast } = useToast();
  const { data: summary = [] } = useTimeBankSummary();
  const [selected, setSelected] = useState<string>('');
  const [start, setStart] = useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [end, setEnd] = useState(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const { data: entries = [] } = useTimeBankEntries(selected, start, end);
  const addManual = useAddTimeBankManual();
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ entry_date: format(new Date(), 'yyyy-MM-dd'), minutes: 0, description: '' });

  const sorted = useMemo(() => [...summary].sort((a: any, b: any) => (b.balance_min || 0) - (a.balance_min || 0)), [summary]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-1">
        <CardHeader><CardTitle>Saldo por colaborador</CardTitle></CardHeader>
        <CardContent className="p-0 max-h-[600px] overflow-y-auto">
          {sorted.map((e: any) => (
            <button
              key={e.id}
              onClick={() => setSelected(e.id)}
              className={`w-full flex justify-between items-center px-4 py-2 hover:bg-muted text-left ${selected === e.id ? 'bg-muted' : ''}`}
            >
              <span className="text-sm">{e.full_name}</span>
              <span className={`font-mono font-bold ${e.balance_min > 0 ? 'text-emerald-600' : e.balance_min < 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                {fmtMin(e.balance_min)}
              </span>
            </button>
          ))}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Extrato do banco</CardTitle>
          {selected && <Button size="sm" onClick={() => setModal(true)}><Plus className="h-4 w-4 mr-1" /> Lançamento manual</Button>}
        </CardHeader>
        <CardContent>
          {!selected && <p className="text-muted-foreground text-sm">Selecione um colaborador</p>}
          {selected && (
            <>
              <div className="flex gap-2 mb-3">
                <Input type="date" value={start} onChange={e => setStart(e.target.value)} />
                <Input type="date" value={end} onChange={e => setEnd(e.target.value)} />
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-right">Minutos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e: any) => (
                    <TableRow key={e.id}>
                      <TableCell>{safeFmt(e.entry_date, 'dd/MM/yyyy')}</TableCell>
                      <TableCell><Badge variant={e.kind === 'credit' ? 'default' : 'destructive'}>{e.kind}</Badge></TableCell>
                      <TableCell><Badge variant="outline">{e.source}</Badge></TableCell>
                      <TableCell className="text-sm">{e.description}</TableCell>
                      <TableCell className={`text-right font-mono font-semibold ${e.minutes > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {fmtMin(e.minutes)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      {modal && (
        <Dialog open onOpenChange={() => setModal(false)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Lançamento manual</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Data</Label>
                <Input type="date" value={form.entry_date} onChange={e => setForm({ ...form, entry_date: e.target.value })} />
              </div>
              <div>
                <Label>Minutos (use negativo para débito)</Label>
                <Input type="number" value={form.minutes} onChange={e => setForm({ ...form, minutes: parseInt(e.target.value) || 0 })} />
              </div>
              <div>
                <Label>Descrição</Label>
                <Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setModal(false)}>Cancelar</Button>
              <Button onClick={async () => {
                await addManual.mutateAsync({ employee_id: selected, ...form });
                toast({ title: 'Lançamento adicionado' });
                setModal(false);
              }}>Salvar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ============ FERIADOS TAB ============
function FeriadosTab() {
  const { toast } = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const { data: holidays = [] } = useHolidays({ year });
  const create = useCreateHoliday();
  const del = useDeleteHoliday();
  const importNat = useImportNationalHolidays();
  const [form, setForm] = useState({ holiday_date: '', description: '', scope: 'nacional' });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 flex flex-wrap gap-2 items-end">
          <div>
            <Label>Ano</Label>
            <Input type="number" value={year} onChange={e => setYear(parseInt(e.target.value) || year)} className="w-28" />
          </div>
          <Button onClick={async () => {
            await importNat.mutateAsync({ year });
            toast({ title: 'Feriados nacionais importados' });
          }}>Importar feriados nacionais</Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle>Adicionar feriado</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Data</Label>
              <Input type="date" value={form.holiday_date} onChange={e => setForm({ ...form, holiday_date: e.target.value })} />
            </div>
            <div>
              <Label>Descrição</Label>
              <Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>
            <div>
              <Label>Abrangência</Label>
              <Select value={form.scope} onValueChange={v => setForm({ ...form, scope: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="nacional">Nacional</SelectItem>
                  <SelectItem value="estadual">Estadual</SelectItem>
                  <SelectItem value="municipal">Municipal</SelectItem>
                  <SelectItem value="empresa">Empresa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full"
              onClick={async () => {
                await create.mutateAsync(form);
                toast({ title: 'Feriado adicionado' });
                setForm({ holiday_date: '', description: '', scope: 'nacional' });
              }}
            >
              Salvar
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Feriados {year}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Abrangência</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {holidays.map((h: any) => (
                  <TableRow key={h.id}>
                    <TableCell>{safeFmt(h.holiday_date, 'dd/MM/yyyy')}</TableCell>
                    <TableCell>{h.description}</TableCell>
                    <TableCell><Badge variant="outline">{h.scope}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" onClick={() => del.mutate(h.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ============ SOLICITAÇÕES DE AJUSTE TAB ============
function SolicitacoesTab() {
  const { toast } = useToast();
  const [status, setStatus] = useState<string>('pending');
  const { data: reqs = [] } = useAdjustmentRequests(status);
  const review = useReviewAdjustmentRequest();
  const [reviewing, setReviewing] = useState<any | null>(null);
  const [note, setNote] = useState('');

  const act = async (kind: 'approved' | 'rejected') => {
    await review.mutateAsync({ id: reviewing.id, status: kind, review_note: note });
    toast({ title: kind === 'approved' ? 'Aprovado' : 'Reprovado' });
    setReviewing(null); setNote('');
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <Tabs value={status} onValueChange={setStatus}>
            <TabsList>
              <TabsTrigger value="pending">Pendentes</TabsTrigger>
              <TabsTrigger value="approved">Aprovadas</TabsTrigger>
              <TabsTrigger value="rejected">Reprovadas</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {reqs.length === 0 && <p className="text-muted-foreground text-center py-8">Nenhuma solicitação {status === 'pending' ? 'pendente' : ''}.</p>}
        {reqs.map((r: any) => (
          <Card key={r.id}>
            <CardContent className="pt-4 flex flex-col md:flex-row gap-4 justify-between">
              <div className="space-y-1 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{r.employee_name}</span>
                  {r.company_name && <Badge variant="outline">{r.company_name}</Badge>}
                  <Badge className={STATUS_COLORS[r.status === 'approved' ? 'normal' : r.status === 'rejected' ? 'falta' : 'extra']}>{r.status}</Badge>
                </div>
                <div className="text-sm">Data: <span className="font-mono">{safeFmt(r.punch_date, 'dd/MM/yyyy')}</span></div>
                {r.requested_times && <div className="text-sm">Horários: <span className="font-mono">{r.requested_times}</span></div>}
                <div className="text-sm text-muted-foreground">{r.justification}</div>
                {r.attachment_url && <a href={r.attachment_url} target="_blank" rel="noreferrer" className="text-xs text-primary underline">Ver anexo</a>}
                {r.review_note && <div className="text-xs italic mt-1">Nota RH: "{r.review_note}"</div>}
              </div>
              {r.status === 'pending' && (
                <div className="flex gap-2 md:flex-col">
                  <Button size="sm" onClick={() => setReviewing(r)}>Revisar</Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {reviewing && (
        <Dialog open onOpenChange={() => { setReviewing(null); setNote(''); }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Revisar solicitação — {reviewing.employee_name}</DialogTitle></DialogHeader>
            <div className="space-y-3 text-sm">
              <div>Data: <span className="font-mono">{safeFmt(reviewing.punch_date, 'dd/MM/yyyy')}</span></div>
              {reviewing.requested_times && <div>Horários solicitados: <span className="font-mono font-semibold">{reviewing.requested_times}</span></div>}
              <div className="p-3 bg-muted rounded">{reviewing.justification}</div>
              <div>
                <Label>Nota (opcional)</Label>
                <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Ex: OK, batidas ajustadas conforme escala" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="destructive" onClick={() => act('rejected')}><XCircle className="h-4 w-4 mr-1" /> Reprovar</Button>
              <Button onClick={() => act('approved')}><CheckCircle2 className="h-4 w-4 mr-1" /> Aprovar e aplicar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ============ RELATÓRIOS TAB ============
function RelatoriosTab() {
  const { toast } = useToast();
  const { companies } = useCompanies();
  const { data: employees = [] } = useEmployees({ status: 'ativo' });
  const [companyId, setCompanyId] = useState<string>('all');
  const [employeeId, setEmployeeId] = useState<string>('all');
  const [start, setStart] = useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [end, setEnd] = useState(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [sub, setSub] = useState<'consolidado' | 'faltas' | 'banco'>('consolidado');

  const filters = {
    start, end,
    company_id: companyId !== 'all' ? companyId : undefined,
    employee_id: employeeId !== 'all' ? employeeId : undefined,
  };

  const { data: summary, isLoading: loadSum } = useReportSummary(sub === 'consolidado' ? filters : {});
  const { data: absLates, isLoading: loadAbs } = useReportAbsencesLates(sub === 'faltas' ? filters : {});
  const { data: tbStmt, isLoading: loadTb } = useTimeBankStatement(
    sub === 'banco' && employeeId !== 'all' ? employeeId : undefined, start, end
  );

  const filteredEmployees = useMemo(
    () => employees.filter((e: any) => companyId === 'all' || e.company_id === companyId),
    [employees, companyId]
  );

  const runCsv = async (endpoint: string, fname: string) => {
    try { await downloadTimeclockCsv(endpoint, fname); }
    catch (e: any) { toast({ title: 'Erro', description: e?.message || 'Falha ao baixar', variant: 'destructive' }); }
  };

  const buildQs = () => new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v) as [string, string][]
  ).toString();

  const totals = useMemo(() => {
    if (!summary?.rows) return null;
    const acc = { worked: 0, expected: 0, overtime: 0, night: 0, absences: 0, lates: 0, tb: 0 };
    for (const r of summary.rows) {
      acc.worked += r.worked_min; acc.expected += r.expected_min;
      acc.overtime += r.overtime_min; acc.night += r.night_bonus_min;
      acc.absences += r.absences; acc.lates += r.lates; acc.tb += r.tb_balance_min;
    }
    return acc;
  }, [summary]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Relatórios Operacionais</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div>
              <Label className="text-xs">Empresa</Label>
              <Select value={companyId} onValueChange={(v) => { setCompanyId(v); setEmployeeId('all'); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {companies.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.trade_name || c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Colaborador</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {filteredEmployees.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Início</Label>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Fim</Label>
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button className="w-full" variant="outline" onClick={() => runCsv(`/api/timeclock/reports/payroll.csv?${buildQs()}`, `folha-${start}_${end}.csv`)}>
                <Download className="h-4 w-4 mr-1" /> CSV Folha
              </Button>
            </div>
          </div>

          <Tabs value={sub} onValueChange={(v) => setSub(v as any)}>
            <TabsList>
              <TabsTrigger value="consolidado">Consolidado</TabsTrigger>
              <TabsTrigger value="faltas">Faltas e Atrasos</TabsTrigger>
              <TabsTrigger value="banco">Extrato Banco de Horas</TabsTrigger>
            </TabsList>

            <TabsContent value="consolidado" className="mt-4 space-y-3">
              {totals && (
                <div className="grid grid-cols-2 md:grid-cols-7 gap-2 text-sm">
                  <div className="rounded border p-2"><div className="text-xs text-muted-foreground">Trabalhado</div><div className="font-semibold">{fmtMin(totals.worked)}</div></div>
                  <div className="rounded border p-2"><div className="text-xs text-muted-foreground">Previsto</div><div className="font-semibold">{fmtMin(totals.expected)}</div></div>
                  <div className="rounded border p-2"><div className="text-xs text-muted-foreground">Extras</div><div className="font-semibold text-blue-600">{fmtMin(totals.overtime)}</div></div>
                  <div className="rounded border p-2"><div className="text-xs text-muted-foreground">Adic. Noturno</div><div className="font-semibold">{fmtMin(totals.night)}</div></div>
                  <div className="rounded border p-2"><div className="text-xs text-muted-foreground">Faltas</div><div className="font-semibold text-red-600">{totals.absences}</div></div>
                  <div className="rounded border p-2"><div className="text-xs text-muted-foreground">Atrasos</div><div className="font-semibold text-amber-600">{totals.lates}</div></div>
                  <div className="rounded border p-2"><div className="text-xs text-muted-foreground">Saldo BH</div><div className="font-semibold">{fmtMin(totals.tb)}</div></div>
                </div>
              )}
              <div className="border rounded overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Colaborador</TableHead>
                      <TableHead className="text-right">Trab.</TableHead>
                      <TableHead className="text-right">Prev.</TableHead>
                      <TableHead className="text-right">Extras</TableHead>
                      <TableHead className="text-right">Adic. Not.</TableHead>
                      <TableHead className="text-right">Faltas</TableHead>
                      <TableHead className="text-right">Atrasos</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                      <TableHead className="text-right">BH</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadSum && <TableRow><TableCell colSpan={9} className="text-center py-6 text-muted-foreground">Calculando...</TableCell></TableRow>}
                    {!loadSum && summary?.rows?.length === 0 && (
                      <TableRow><TableCell colSpan={9} className="text-center py-6 text-muted-foreground">Nenhum colaborador no filtro.</TableCell></TableRow>
                    )}
                    {summary?.rows?.map((r: any) => (
                      <TableRow key={r.employee_id}>
                        <TableCell className="font-medium">{r.full_name}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMin(r.worked_min)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMin(r.expected_min)}</TableCell>
                        <TableCell className="text-right tabular-nums text-blue-600">{fmtMin(r.overtime_min)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMin(r.night_bonus_min)}</TableCell>
                        <TableCell className="text-right"><Badge variant={r.absences > 0 ? 'destructive' : 'secondary'}>{r.absences}</Badge></TableCell>
                        <TableCell className="text-right"><Badge variant={r.lates > 0 ? 'outline' : 'secondary'}>{r.lates}</Badge></TableCell>
                        <TableCell className={`text-right tabular-nums ${r.balance_min < 0 ? 'text-red-600' : r.balance_min > 0 ? 'text-emerald-600' : ''}`}>{fmtMin(r.balance_min)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${r.tb_balance_min < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmtMin(r.tb_balance_min)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="faltas" className="mt-4 space-y-3">
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => runCsv(`/api/timeclock/reports/absences-lates.csv?${buildQs()}`, `faltas-atrasos-${start}_${end}.csv`)}>
                  <Download className="h-4 w-4 mr-1" /> Exportar CSV
                </Button>
              </div>
              <div className="border rounded overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Colaborador</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Trabalhado</TableHead>
                      <TableHead className="text-right">Previsto</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadAbs && <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Calculando...</TableCell></TableRow>}
                    {!loadAbs && absLates?.items?.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Nenhuma ocorrência.</TableCell></TableRow>
                    )}
                    {absLates?.items?.map((it: any, i: number) => (
                      <TableRow key={`${it.employee_id}-${it.date}-${i}`}>
                        <TableCell className="tabular-nums">{safeFmt(it.date, 'dd/MM/yyyy')}</TableCell>
                        <TableCell className="font-medium">{it.full_name}</TableCell>
                        <TableCell>
                          <Badge className={STATUS_COLORS[it.status] || ''}>
                            {it.odd_punch && <AlertCircle className="h-3 w-3 mr-1 inline" />}
                            {it.status}{it.odd_punch ? ' (batidas ímpares)' : ''}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMin(it.worked_min)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMin(it.expected_min)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${it.balance_min < 0 ? 'text-red-600' : ''}`}>{fmtMin(it.balance_min)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="banco" className="mt-4 space-y-3">
              {employeeId === 'all' && (
                <div className="text-sm text-muted-foreground border rounded p-3 bg-muted/30">
                  Selecione um colaborador para ver o extrato do banco de horas.
                </div>
              )}
              {employeeId !== 'all' && (
                <>
                  <div className="text-sm">
                    Saldo anterior ao período: <span className="font-semibold tabular-nums">{fmtMin(tbStmt?.opening_min || 0)}</span>
                  </div>
                  <div className="border rounded overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Data</TableHead>
                          <TableHead>Tipo</TableHead>
                          <TableHead>Origem</TableHead>
                          <TableHead>Descrição</TableHead>
                          <TableHead>Por</TableHead>
                          <TableHead className="text-right">Minutos</TableHead>
                          <TableHead className="text-right">Saldo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {loadTb && <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Carregando...</TableCell></TableRow>}
                        {!loadTb && tbStmt?.entries?.length === 0 && (
                          <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Sem movimentações no período.</TableCell></TableRow>
                        )}
                        {(() => {
                          let running = tbStmt?.opening_min || 0;
                          return tbStmt?.entries?.map((e: any) => {
                            running += e.minutes;
                            return (
                              <TableRow key={e.id}>
                                <TableCell className="tabular-nums">{safeFmt(e.entry_date, 'dd/MM/yyyy')}</TableCell>
                                <TableCell><Badge variant={e.kind === 'credit' ? 'default' : 'destructive'}>{e.kind === 'credit' ? 'Crédito' : 'Débito'}</Badge></TableCell>
                                <TableCell><Badge variant="outline">{e.source}</Badge></TableCell>
                                <TableCell className="max-w-xs truncate">{e.description || '-'}</TableCell>
                                <TableCell className="text-xs text-muted-foreground">{e.created_by_name || '-'}</TableCell>
                                <TableCell className={`text-right tabular-nums ${e.minutes < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmtMin(e.minutes)}</TableCell>
                                <TableCell className="text-right tabular-nums font-semibold">{fmtMin(running)}</TableCell>
                              </TableRow>
                            );
                          });
                        })()}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

// ============ FECHAMENTO TAB ============
function FechamentoTab() {
  const { data: closings = [], isLoading } = useClosings();
  const { companies = [] } = useCompanies() as any;
  const createClosing = useCreateClosing();
  const deleteClosing = useDeleteClosing();
  const { toast } = useToast();
  const [periodStart, setPeriodStart] = useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [periodEnd, setPeriodEnd] = useState(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [companyId, setCompanyId] = useState<string>('all');
  const [notes, setNotes] = useState('');

  async function handleClose() {
    try {
      await createClosing.mutateAsync({
        period_start: periodStart, period_end: periodEnd,
        company_id: companyId === 'all' ? null : companyId,
        notes: notes || null,
      });
      toast({ title: 'Período fechado. Batidas travadas para edição.' });
      setNotes('');
    } catch (e: any) { toast({ title: e.message || 'Erro', variant: 'destructive' }); }
  }

  async function handleReopen(id: string) {
    if (!confirm('Reabrir este fechamento? Batidas voltam a ser editáveis.')) return;
    try {
      await deleteClosing.mutateAsync(id);
      toast({ title: 'Fechamento reaberto' });
    } catch (e: any) { toast({ title: e.message || 'Erro', variant: 'destructive' }); }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Fechar novo período</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div><Label>Início</Label><Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} /></div>
          <div><Label>Fim</Label><Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} /></div>
          <div>
            <Label>Empresa</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {companies.map((c: any) => (<SelectItem key={c.id} value={c.id}>{c.trade_name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2"><Label>Observações</Label><Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ex.: fechamento folha 06/2026" /></div>
          <div className="md:col-span-5">
            <Button onClick={handleClose} disabled={createClosing.isPending}>
              <CheckCircle2 className="h-4 w-4 mr-2" />Fechar período
            </Button>
            <p className="text-xs text-muted-foreground mt-2">Após o fechamento, RH e colaboradores não conseguem editar/solicitar ajustes dentro do intervalo até a reabertura.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Fechamentos recentes</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : closings.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum fechamento registrado.</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Período</TableHead><TableHead>Empresa</TableHead>
                <TableHead>Fechado em</TableHead><TableHead>Por</TableHead>
                <TableHead>Observações</TableHead><TableHead className="text-right">Ações</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {closings.map((c: any) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{safeFmt(c.period_start, 'dd/MM/yyyy')} – {safeFmt(c.period_end, 'dd/MM/yyyy')}</TableCell>
                    <TableCell>{c.company_name || <span className="text-muted-foreground">Todas</span>}</TableCell>
                    <TableCell>{safeFmt(c.closed_at, 'dd/MM/yyyy HH:mm')}</TableCell>
                    <TableCell>{c.closed_by_name || '—'}</TableCell>
                    <TableCell className="max-w-xs truncate">{c.notes || '—'}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => handleReopen(c.id)}>
                        <Trash2 className="h-4 w-4 mr-1" />Reabrir
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============ PÁGINA PRINCIPAL ============
// ============ COMPLIANCE TAB (AFD / AEJ - Portaria 671/2021) ============
function ComplianceTab() {
  const { toast } = useToast();
  const { companies } = useCompanies();
  const { data: employees = [] } = useEmployees({ status: 'ativo' });
  const [companyId, setCompanyId] = useState<string>('all');
  const [employeeId, setEmployeeId] = useState<string>('all');
  const [start, setStart] = useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [end, setEnd] = useState(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [loading, setLoading] = useState<'afd' | 'aej' | null>(null);

  const filteredEmployees = useMemo(
    () => employees.filter((e: any) => companyId === 'all' || e.company_id === companyId),
    [employees, companyId]
  );

  const download = async (kind: 'afd' | 'aej') => {
    setLoading(kind);
    try {
      const token = localStorage.getItem('token');
      const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
      const qs = new URLSearchParams({ start, end });
      if (companyId !== 'all') qs.set('company_id', companyId);
      if (employeeId !== 'all') qs.set('employee_id', employeeId);
      const url = `${base}/api/timeclock/${kind}.txt?${qs}`;
      const r = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!r.ok) throw new Error(await r.text().catch(() => 'Falha ao gerar'));
      const blob = await r.blob();
      const cd = r.headers.get('Content-Disposition') || '';
      const fname = /filename="([^"]+)"/.exec(cd)?.[1] || `${kind.toUpperCase()}_${start}_${end}.txt`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      a.click();
      URL.revokeObjectURL(a.href);
      toast({ title: `${kind.toUpperCase()} gerado`, description: fname });
    } catch (e: any) {
      toast({ title: 'Erro', description: e?.message || 'Falha', variant: 'destructive' });
    } finally { setLoading(null); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Compliance MTE — AFD & AEJ</CardTitle>
          <p className="text-xs text-muted-foreground">
            Arquivos oficiais conforme <strong>Portaria MTP 671/2021</strong>. AFD contém todas as marcações
            com NSR sequencial e assinatura. AEJ consolida a jornada apurada por dia (previsto x realizado) com hash SHA-256.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">Empresa</Label>
              <Select value={companyId} onValueChange={(v) => { setCompanyId(v); setEmployeeId('all'); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {companies.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.trade_name || c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Colaborador</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {filteredEmployees.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Início</Label>
              <Input type="date" value={start} onChange={e => setStart(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Fim</Label>
              <Input type="date" value={end} onChange={e => setEnd(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card>
              <CardContent className="pt-4 space-y-2">
                <div className="font-semibold">AFD — Arquivo Fonte de Dados</div>
                <p className="text-xs text-muted-foreground">
                  Registros tipo 1 (cabeçalho), 3 (marcações), 4 (ajustes RH), 5 (empregados) e 9 (trailer).
                  Formato ASCII fixo, CRLF, layout aceito por fiscalização MTE.
                </p>
                <Button className="w-full" onClick={() => download('afd')} disabled={loading !== null}>
                  <Download className="h-4 w-4 mr-1" /> {loading === 'afd' ? 'Gerando...' : 'Baixar AFD (.txt)'}
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 space-y-2">
                <div className="font-semibold">AEJ — Arquivo Eletrônico de Jornada</div>
                <p className="text-xs text-muted-foreground">
                  Consolidação diária: jornada prevista, realizada, extras, adicional noturno, faltas e atrasos por colaborador,
                  com assinatura SHA-256 no fim do arquivo.
                </p>
                <Button className="w-full" variant="secondary" onClick={() => download('aej')} disabled={loading !== null}>
                  <Download className="h-4 w-4 mr-1" /> {loading === 'aej' ? 'Gerando...' : 'Baixar AEJ (.txt)'}
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-900 dark:text-amber-200">
            <AlertCircle className="h-3.5 w-3.5 inline mr-1" />
            Antes de gerar para fiscalização, execute o fechamento do período na aba <strong>Fechamento</strong> para congelar as batidas.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function RHPontoV2() {
  return (
    <MainLayout>
      <div className="p-4 md:p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Ponto Eletrônico</h1>
          <p className="text-muted-foreground text-sm">Cartão ponto, banco de horas 1:1, feriados, ajustes, relatórios, fechamento e compliance MTE.</p>
        </div>

        <Tabs defaultValue="gestao">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="gestao">Gestão de Ponto</TabsTrigger>
            <TabsTrigger value="registros">Registros</TabsTrigger>
            <TabsTrigger value="cartao">Cartão Ponto</TabsTrigger>
            <TabsTrigger value="banco">Banco de Horas</TabsTrigger>
            <TabsTrigger value="jornadas">Jornadas</TabsTrigger>
            <TabsTrigger value="feriados">Feriados</TabsTrigger>
            <TabsTrigger value="ajustes">Solicitações</TabsTrigger>
            <TabsTrigger value="relatorios">Relatórios</TabsTrigger>
            <TabsTrigger value="fechamento">Fechamento</TabsTrigger>
            <TabsTrigger value="compliance">Compliance</TabsTrigger>
          </TabsList>
          <TabsContent value="gestao" className="mt-4"><GestaoPontoTab /></TabsContent>
          <TabsContent value="registros" className="mt-4"><RegistrosPontoTab /></TabsContent>
          <TabsContent value="cartao" className="mt-4"><CartaoPontoTab /></TabsContent>
          <TabsContent value="banco" className="mt-4"><BancoHorasTab /></TabsContent>
          <TabsContent value="jornadas" className="mt-4"><WorkSchedulesTab /></TabsContent>
          <TabsContent value="feriados" className="mt-4"><FeriadosTab /></TabsContent>
          <TabsContent value="ajustes" className="mt-4"><SolicitacoesTab /></TabsContent>
          <TabsContent value="relatorios" className="mt-4"><RelatoriosTab /></TabsContent>
          <TabsContent value="fechamento" className="mt-4"><FechamentoTab /></TabsContent>
          <TabsContent value="compliance" className="mt-4"><ComplianceTab /></TabsContent>
        </Tabs>

      </div>
    </MainLayout>
  );
}

