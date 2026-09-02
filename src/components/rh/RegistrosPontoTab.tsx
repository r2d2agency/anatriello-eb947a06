import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { format, startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ArrowLeft, Building2, Clock, Users } from 'lucide-react';
import { useCompanies } from '@/hooks/use-companies';
import { usePunchesDailyGrid } from '@/hooks/use-timeclock';

function fmtMinutes(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}h${String(m).padStart(2, '0')}`;
}

function initials(name?: string) {
  if (!name) return '?';
  return name.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
}

function safeParseISO(d: string): Date | null {
  if (!d) return null;
  try {
    const parsed = parseISO(d);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
}

export function RegistrosPontoTab() {
  const { companies = [] } = useCompanies();
  const [companyId, setCompanyId] = useState<string>('all');
  const [start, setStart] = useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [end, setEnd] = useState(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [selectedEmp, setSelectedEmp] = useState<string | null>(null);

  const { data, isLoading } = usePunchesDailyGrid({
    start, end,
    company_id: companyId !== 'all' ? companyId : undefined,
    employee_id: selectedEmp || undefined,
  });

  const days = data?.days || [];
  const employees = data?.employees || [];

  const selected = useMemo(
    () => selectedEmp ? employees.find(e => e.employee_id === selectedEmp) : null,
    [selectedEmp, employees]
  );

  // Totais por dia (agregado)
  const dayTotals = useMemo(() => {
    const acc: Record<string, { minutes: number; count: number }> = {};
    employees.forEach(e => {
      Object.entries(e.days).forEach(([d, v]) => {
        if (!acc[d]) acc[d] = { minutes: 0, count: 0 };
        acc[d].minutes += v.minutes;
        if (v.punch_count > 0) acc[d].count += 1;
      });
    });
    return acc;
  }, [employees]);

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <Card>
        <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <Label className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" /> Empresa</Label>
            <Select value={companyId} onValueChange={(v) => { setCompanyId(v); setSelectedEmp(null); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as empresas</SelectItem>
                {companies.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.trade_name || c.name}</SelectItem>
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
          <div className="flex items-end gap-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5 rounded-md border px-3 py-2">
              <Users className="h-4 w-4" /> {employees.length} colaboradores
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Modo lista consolidada */}
      {!selectedEmp && (
        <Card>
          <CardContent className="pt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[220px]">Colaborador</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead className="text-center">Dias c/ ponto</TableHead>
                  <TableHead className="text-center">Batidas</TableHead>
                  <TableHead className="text-right">Total no período</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
                )}
                {!isLoading && employees.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Nenhum colaborador encontrado.</TableCell></TableRow>
                )}
                {employees.map(emp => {
                  const daysWithPunch = Object.values(emp.days).filter(d => d.punch_count > 0).length;
                  const totalPunches = Object.values(emp.days).reduce((s, d) => s + d.punch_count, 0);
                  return (
                    <TableRow
                      key={emp.employee_id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedEmp(emp.employee_id)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={emp.photo_url} />
                            <AvatarFallback>{initials(emp.full_name)}</AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{emp.full_name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{emp.company_name || '—'}</TableCell>
                      <TableCell className="text-center">{daysWithPunch}</TableCell>
                      <TableCell className="text-center">{totalPunches}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        <Badge variant="secondary" className="font-mono">
                          <Clock className="h-3 w-3 mr-1" />
                          {fmtMinutes(emp.total_minutes)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Modo detalhado — visão por colaborador (dia a dia) */}
      {selectedEmp && selected && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" onClick={() => setSelectedEmp(null)}>
                  <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
                </Button>
                <Avatar className="h-10 w-10">
                  <AvatarImage src={selected.photo_url} />
                  <AvatarFallback>{initials(selected.full_name)}</AvatarFallback>
                </Avatar>
                <div>
                  <div className="font-semibold text-lg">{selected.full_name}</div>
                  <div className="text-sm text-muted-foreground">{selected.company_name || '—'}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground uppercase">Total no período</div>
                <div className="text-2xl font-mono font-bold text-primary">{fmtMinutes(selected.total_minutes)}</div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-32">Data</TableHead>
                    <TableHead>Batidas</TableHead>
                    <TableHead className="text-center w-24">Qtd.</TableHead>
                    <TableHead className="text-right w-32">Total do dia</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {days.map(d => {
                    const info = selected.days[d];
                    const times = info?.times || [];
                    const minutes = info?.minutes || 0;
                    const dayDate = safeParseISO(d);
                    const isWeekend = dayDate ? [0, 6].includes(dayDate.getDay()) : false;
                    return (
                      <TableRow key={d} className={isWeekend ? 'bg-muted/30' : ''}>
                        <TableCell className="font-mono text-sm">
                          <div>{dayDate ? format(dayDate, 'dd/MM') : '—'}</div>
                          <div className="text-xs text-muted-foreground capitalize">{dayDate ? format(dayDate, 'EEE', { locale: ptBR }) : ''}</div>
                        </TableCell>
                        <TableCell>
                          {times.length === 0 ? (
                            <span className="text-muted-foreground text-sm">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {times.map((t, i) => (
                                <Badge key={i} variant="outline" className="font-mono">{t}</Badge>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-center">{times.length || '—'}</TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          {minutes > 0 ? fmtMinutes(minutes) : '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Resumo por dia (quando lista consolidada) */}
      {!selectedEmp && employees.length > 0 && (
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm font-semibold mb-3 text-muted-foreground">Total por dia (todos os colaboradores)</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
              {days.map(d => {
                const t = dayTotals[d];
                const dayDate = safeParseISO(d);
                return (
                  <div key={d} className="rounded-lg border p-2 text-center">
                    <div className="text-xs text-muted-foreground capitalize">{dayDate ? format(dayDate, "dd/MM · EEE", { locale: ptBR }) : '—'}</div>
                    <div className="font-mono font-semibold text-sm mt-1">{t ? fmtMinutes(t.minutes) : '—'}</div>
                    <div className="text-[10px] text-muted-foreground">{t ? `${t.count} colab.` : '·'}</div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
