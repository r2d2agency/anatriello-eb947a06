import { useState, useMemo, useCallback } from "react";
import { useTimeRecords, useSaveTimeRecord, useEmployees, useAppPunches, useConsolidatedTimesheet, usePunchDivergences } from "@/hooks/use-rh";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Clock, Smartphone, MapPin, CheckCircle2, AlertTriangle, Wifi, WifiOff,
  Download, FileSpreadsheet, CalendarDays, CalendarRange, Calendar, Filter,
  TrendingUp, UserX, ShieldAlert
} from "lucide-react";
import { OvertimeRequestsPanel, useOvertimePendingCount } from "@/components/rh/OvertimeRequestsPanel";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays, subMonths } from "date-fns";
import * as XLSX from "xlsx";

const STATUS_LABELS: Record<string, string> = {
  normal: "Normal", falta: "Falta", atestado: "Atestado", feriado: "Feriado", compensado: "Compensado",
};

const GEO_LABELS: Record<string, { label: string; variant: "default" | "destructive" | "outline" | "secondary" }> = {
  dentro_area: { label: "Dentro PDV", variant: "default" },
  fora_area: { label: "Fora PDV", variant: "destructive" },
  excecao: { label: "Exceção", variant: "secondary" },
  sem_gps: { label: "Sem GPS", variant: "outline" },
  sem_pdv: { label: "Sem PDV", variant: "outline" },
};

const PUNCH_LABELS: Record<string, string> = {
  entrada: '🟢 Entrada', saida_intervalo: '🟡 Saída Intervalo', retorno_intervalo: '🔵 Retorno', saida: '🔴 Saída', extraordinaria: '⚪ Extra', ajuste: '🔧 Ajuste'
};

const DIVERGENCE_ICONS: Record<string, { icon: typeof AlertTriangle; color: string }> = {
  sem_registro: { icon: AlertTriangle, color: 'text-destructive' },
  incompleto: { icon: Clock, color: 'text-primary' },
  fora_pdv: { icon: MapPin, color: 'text-accent-foreground' },
  atraso: { icon: Clock, color: 'text-amber-600' },
};

const DIVERGENCE_TYPE_LABELS: Record<string, string> = {
  sem_registro: 'Sem Registro',
  incompleto: 'Incompleto',
  fora_pdv: 'Fora PDV',
  atraso: 'Atraso',
};

type PeriodPreset = 'hoje' | 'semana' | 'mes' | 'mes_anterior' | 'personalizado';

function getPeriodDates(preset: PeriodPreset): { start: string; end: string } {
  const now = new Date();
  switch (preset) {
    case 'hoje':
      return { start: format(now, 'yyyy-MM-dd'), end: format(now, 'yyyy-MM-dd') };
    case 'semana':
      return { start: format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'), end: format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd') };
    case 'mes':
      return { start: format(startOfMonth(now), 'yyyy-MM-dd'), end: format(endOfMonth(now), 'yyyy-MM-dd') };
    case 'mes_anterior': {
      const prev = subMonths(now, 1);
      return { start: format(startOfMonth(prev), 'yyyy-MM-dd'), end: format(endOfMonth(prev), 'yyyy-MM-dd') };
    }
    default:
      return { start: format(subDays(now, 30), 'yyyy-MM-dd'), end: format(now, 'yyyy-MM-dd') };
  }
}

function parseDateValue(value: unknown): Date | null {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? `${raw}T12:00:00`
    : raw.includes(' ') && !raw.includes('T')
      ? raw.replace(' ', 'T')
      : raw;

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateValue(value: unknown, mask: string, fallback = '—') {
  const parsed = parseDateValue(value);
  return parsed ? format(parsed, mask) : fallback;
}

function getPunchTimestamp(punch: any) {
  return punch?.punched_at || punch?.offline_local_time || punch?.created_at || null;
}

export function GestaoPontoTab() {
  const overtimePendingCount = useOvertimePendingCount();
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('mes');
  const [customStart, setCustomStart] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [customEnd, setCustomEnd] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("consolidated");
  const [reportType, setReportType] = useState<'todos' | 'horas_extras' | 'faltas'>('todos');
  const [form, setForm] = useState<any>({ employee_id: "", record_date: format(new Date(), "yyyy-MM-dd"), entry1: "08:00", exit1: "12:00", entry2: "13:00", exit2: "17:00", entry3: "", exit3: "", status: "normal", justification: "" });
  const { toast } = useToast();

  const { start: startDate, end: endDate } = useMemo(() => {
    if (periodPreset === 'personalizado') return { start: customStart, end: customEnd };
    return getPeriodDates(periodPreset);
  }, [periodPreset, customStart, customEnd]);

  const { data: records = [], isLoading } = useTimeRecords({ employee_id: employeeFilter || undefined, start_date: startDate, end_date: endDate });
  const { data: appPunches = [], isLoading: loadingPunches } = useAppPunches({ employee_id: employeeFilter || undefined, start_date: startDate, end_date: endDate });
  const { data: consolidated = [], isLoading: loadingConsolidated } = useConsolidatedTimesheet({ employee_id: employeeFilter || undefined, start_date: startDate, end_date: endDate });
  const { data: divergences = [] } = usePunchDivergences({ start_date: startDate, end_date: endDate });
  const { data: employees = [] } = useEmployees({ status: "ativo" });
  const saveMut = useSaveTimeRecord();

  const filteredDivergences = useMemo(() => {
    if (!employeeFilter) return divergences;
    return divergences.filter((d: any) => d.employee_id === employeeFilter);
  }, [divergences, employeeFilter]);

  const filteredConsolidated = useMemo(() => {
    if (reportType === 'todos') return consolidated;
    if (reportType === 'horas_extras') return consolidated.filter((c: any) => {
      const hours = c.raw_hours ? Number(c.raw_hours) : 0;
      return hours > 8;
    });
    // faltas
    return consolidated.filter((c: any) => {
      const hours = c.raw_hours ? Number(c.raw_hours) : 0;
      return hours < 8;
    });
  }, [consolidated, reportType]);

  const filteredRecords = useMemo(() => {
    if (reportType === 'todos') return records;
    if (reportType === 'horas_extras') return records.filter((r: any) => parseFloat(r.overtime_hours) > 0);
    return records.filter((r: any) => r.status === 'falta' || (r.total_hours && parseFloat(r.total_hours) < 8));
  }, [records, reportType]);

  const calcHours = (f: any) => {
    let total = 0;
    const calc = (entry: string, exit: string) => {
      if (!entry || !exit) return 0;
      const [eh, em] = entry.split(":").map(Number);
      const [xh, xm] = exit.split(":").map(Number);
      return (xh * 60 + xm - eh * 60 - em) / 60;
    };
    total += calc(f.entry1, f.exit1);
    total += calc(f.entry2, f.exit2);
    total += calc(f.entry3, f.exit3);
    return Math.round(total * 100) / 100;
  };

  const handleSave = async () => {
    if (!form.employee_id || !form.record_date) { toast({ title: "Selecione o colaborador e a data", variant: "destructive" }); return; }
    const totalH = calcHours(form);
    const overtime = Math.max(0, totalH - 8);
    try {
      await saveMut.mutateAsync({ ...form, total_hours: totalH, overtime_hours: overtime });
      toast({ title: "Ponto registrado!" });
      setDialogOpen(false);
    } catch {
      toast({ title: "Erro ao registrar ponto", variant: "destructive" });
    }
  };

  const setField = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }));

  const exportEmployeeXLS = useCallback((empId?: string) => {
    const empData = empId
      ? consolidated.filter((c: any) => c.employee_id === empId)
      : consolidated;

    if (!empData.length) {
      toast({ title: "Nenhum dado para exportar", variant: "destructive" });
      return;
    }

    const empName = empId ? empData[0]?.employee_name : 'Todos';
    const rows = empData.map((c: any) => {
      const punches = Array.isArray(c.punches) ? c.punches : [];
      const entrada = punches.find((p: any) => p.punch_type === 'entrada');
      const saidaInt = punches.find((p: any) => p.punch_type === 'saida_intervalo');
      const retorno = punches.find((p: any) => p.punch_type === 'retorno_intervalo');
      const saida = punches.find((p: any) => p.punch_type === 'saida');

      return {
        'Data': formatDateValue(c.record_date, 'dd/MM/yyyy', ''),
        'Colaborador': c.employee_name,
        'CPF': c.cpf || '',
        'Cargo': c.position || '',
        'Entrada': formatDateValue(getPunchTimestamp(entrada), 'HH:mm', ''),
        'Saída Intervalo': formatDateValue(getPunchTimestamp(saidaInt), 'HH:mm', ''),
        'Retorno Intervalo': formatDateValue(getPunchTimestamp(retorno), 'HH:mm', ''),
        'Saída': formatDateValue(getPunchTimestamp(saida), 'HH:mm', ''),
        'Total Registros': c.punch_count,
        'Horas Brutas': c.raw_hours ? Number(c.raw_hours).toFixed(2) : '',
        'Status Geo': punches.some((p: any) => p.geo_status === 'fora_area') ? 'FORA PDV' : 'OK',
        'Offline': punches.some((p: any) => p.is_offline) ? 'SIM' : 'NÃO',
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 12 }, { wch: 30 }, { wch: 15 }, { wch: 20 },
      { wch: 8 }, { wch: 14 }, { wch: 16 }, { wch: 8 },
      { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 8 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Folha de Ponto");

    const empDivs = empId ? divergences.filter((d: any) => d.employee_id === empId) : divergences;
    if (empDivs.length > 0) {
      const divRows = empDivs.map((d: any) => ({
        'Data': formatDateValue(d.date, 'dd/MM/yyyy', ''),
        'Colaborador': d.employee_name,
        'Tipo': DIVERGENCE_TYPE_LABELS[d.type] || d.type,
        'Descrição': d.description,
        'Severidade': d.severity === 'high' ? 'ALTA' : d.severity === 'medium' ? 'MÉDIA' : 'BAIXA',
      }));
      const wsDiv = XLSX.utils.json_to_sheet(divRows);
      wsDiv['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 15 }, { wch: 40 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wb, wsDiv, "Divergências");
    }

    const fileName = `folha_ponto_${String(empName || 'Todos').replace(/\s+/g, '_')}_${startDate}_${endDate}.xlsx`;
    XLSX.writeFile(wb, fileName);
    toast({ title: "Exportação concluída!", description: fileName });
  }, [consolidated, divergences, startDate, endDate, toast]);

  const totalOvertime = records.reduce((s: number, r: any) => s + (parseFloat(r.overtime_hours) || 0), 0);
  const offlinePunches = appPunches.filter((p: any) => p.is_offline);
  const outsidePdv = appPunches.filter((p: any) => p.geo_status === 'fora_area');
  const highDivergences = filteredDivergences.filter((d: any) => d.severity === 'high');

  const periodLabel = useMemo(() => {
    switch (periodPreset) {
      case 'hoje': return 'Hoje';
      case 'semana': return 'Esta Semana';
      case 'mes': return 'Este Mês';
      case 'mes_anterior': return 'Mês Anterior';
      default: return 'Personalizado';
    }
  }, [periodPreset]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2"><Clock className="h-5 w-5 text-primary" /> Gestão de Ponto</h2>
          <p className="text-sm text-muted-foreground">Controle de jornada, divergências e exportação</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => exportEmployeeXLS(employeeFilter || undefined)} className="gap-2">
            <FileSpreadsheet className="h-4 w-4" /> Exportar XLS
          </Button>
          <Button onClick={() => setDialogOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> Registrar Ponto</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Filter className="h-4 w-4 text-muted-foreground" />
        {([
          { key: 'hoje', label: 'Hoje', icon: Calendar },
          { key: 'semana', label: 'Semana', icon: CalendarDays },
          { key: 'mes', label: 'Mês', icon: CalendarRange },
          { key: 'mes_anterior', label: 'Mês Anterior', icon: CalendarRange },
          { key: 'personalizado', label: 'Personalizado', icon: CalendarDays },
        ] as const).map(({ key, label, icon: Icon }) => (
          <Button
            key={key}
            variant={periodPreset === key ? "default" : "outline"}
            size="sm"
            onClick={() => setPeriodPreset(key)}
            className="gap-1.5 text-xs"
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </Button>
        ))}
        {periodPreset === 'personalizado' && (
          <div className="flex gap-1 items-center">
            <Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="w-36 h-8 text-xs" />
            <span className="text-xs text-muted-foreground">até</span>
            <Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="w-36 h-8 text-xs" />
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
        <Select value={employeeFilter || "__all__"} onValueChange={v => setEmployeeFilter(v === "__all__" ? "" : v)}>
          <SelectTrigger className="w-60"><SelectValue placeholder="Todos os colaboradores" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os colaboradores</SelectItem>
            {employees.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Badge variant="outline" className="text-xs">
          {periodLabel}: {formatDateValue(startDate, 'dd/MM')} - {formatDateValue(endDate, 'dd/MM/yyyy')}
        </Badge>
        {employeeFilter && (
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => exportEmployeeXLS(employeeFilter)}>
            <Download className="h-3.5 w-3.5" /> Exportar Individual
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-muted-foreground font-medium">Relatório:</span>
        {([
          { key: 'todos' as const, label: 'Todos', icon: Clock },
          { key: 'horas_extras' as const, label: 'Horas Extras', icon: TrendingUp },
          { key: 'faltas' as const, label: 'Faltas / Horas Faltantes', icon: UserX },
        ]).map(({ key, label, icon: Icon }) => (
          <Button
            key={key}
            variant={reportType === key ? "default" : "outline"}
            size="sm"
            onClick={() => setReportType(key)}
            className="gap-1.5 text-xs"
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card><CardContent className="p-3 text-center"><p className="text-xl font-bold text-foreground">{consolidated.length}</p><p className="text-[10px] text-muted-foreground">Dias Registrados</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xl font-bold text-foreground">{appPunches.length}</p><p className="text-[10px] text-muted-foreground">Registros App</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xl font-bold text-primary">{totalOvertime.toFixed(1)}h</p><p className="text-[10px] text-muted-foreground">Horas Extras</p></CardContent></Card>
        <Card className={highDivergences.length > 0 ? 'border-destructive/50' : ''}>
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-destructive">{highDivergences.length}</p>
            <p className="text-[10px] text-muted-foreground">Faltas / Sem Registro</p>
          </CardContent>
        </Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xl font-bold text-primary">{offlinePunches.length}</p><p className="text-[10px] text-muted-foreground">Offline</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xl font-bold text-accent-foreground">{outsidePdv.length}</p><p className="text-[10px] text-muted-foreground">Fora PDV</p></CardContent></Card>
      </div>

      {filteredDivergences.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" /> Divergências ({filteredDivergences.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="max-h-48 overflow-y-auto space-y-1">
              {filteredDivergences.slice(0, 20).map((d: any, i: number) => {
                const cfg = DIVERGENCE_ICONS[d.type] || DIVERGENCE_ICONS.sem_registro;
                const DivIcon = cfg.icon;
                return (
                  <div key={i} className="flex items-center gap-3 text-sm p-2 bg-muted/30 rounded-lg">
                    <DivIcon className={`h-4 w-4 flex-shrink-0 ${cfg.color}`} />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{d.employee_name}</span>
                      <span className="text-muted-foreground mx-2">•</span>
                      <span className="text-xs text-muted-foreground">{formatDateValue(d.date, 'dd/MM/yyyy', '')}</span>
                    </div>
                    <span className="text-xs text-muted-foreground truncate max-w-48">{d.description}</span>
                    <Badge variant={d.severity === 'high' ? 'destructive' : d.severity === 'medium' ? 'secondary' : 'outline'} className="text-[10px]">
                      {d.severity === 'high' ? 'ALTA' : d.severity === 'medium' ? 'MÉDIA' : 'BAIXA'}
                    </Badge>
                  </div>
                );
              })}
              {filteredDivergences.length > 20 && (
                <p className="text-xs text-center text-muted-foreground py-1">+{filteredDivergences.length - 20} divergências</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="consolidated" className="gap-2"><CalendarDays className="h-4 w-4" /> Consolidado ({filteredConsolidated.length})</TabsTrigger>
          <TabsTrigger value="app" className="gap-2"><Smartphone className="h-4 w-4" /> App ({appPunches.length})</TabsTrigger>
          <TabsTrigger value="manual" className="gap-2"><Clock className="h-4 w-4" /> Manual ({filteredRecords.length})</TabsTrigger>
          <TabsTrigger value="overtime" className="gap-2">
            <ShieldAlert className="h-4 w-4" /> Horas Extras
            {overtimePendingCount > 0 && <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4 min-w-4">{overtimePendingCount}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overtime">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-purple-600" /> Solicitações de Hora Extra
              </CardTitle>
            </CardHeader>
            <CardContent>
              <OvertimeRequestsPanel statusFilter="all" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="consolidated">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Colaborador</TableHead>
                    <TableHead>Entrada</TableHead>
                    <TableHead className="hidden md:table-cell">Saída Int.</TableHead>
                    <TableHead className="hidden md:table-cell">Retorno</TableHead>
                    <TableHead>Saída</TableHead>
                    <TableHead>Horas</TableHead>
                    <TableHead>Registros</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingConsolidated ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
                  ) : filteredConsolidated.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Nenhum registro encontrado para o filtro selecionado</TableCell></TableRow>
                  ) : filteredConsolidated.map((c: any, idx: number) => {
                    const punches = Array.isArray(c.punches) ? c.punches : [];
                    const entrada = punches.find((p: any) => p.punch_type === 'entrada');
                    const saidaInt = punches.find((p: any) => p.punch_type === 'saida_intervalo');
                    const retorno = punches.find((p: any) => p.punch_type === 'retorno_intervalo');
                    const saida = punches.find((p: any) => p.punch_type === 'saida');
                    const hasGeoIssue = punches.some((p: any) => p.geo_status === 'fora_area');
                    const isIncomplete = punches.length % 2 !== 0;
                    const hours = c.raw_hours ? Number(c.raw_hours).toFixed(1) : '—';

                    return (
                      <TableRow key={idx} className={isIncomplete ? 'bg-yellow-50/50 dark:bg-yellow-950/10' : hasGeoIssue ? 'bg-orange-50/50 dark:bg-orange-950/10' : ''}>
                        <TableCell className="font-medium text-sm">
                          {formatDateValue(c.record_date, 'dd/MM/yyyy')}
                        </TableCell>
                        <TableCell className="text-sm">{c.employee_name}</TableCell>
                        <TableCell className="text-sm">{formatDateValue(getPunchTimestamp(entrada), 'HH:mm')}</TableCell>
                        <TableCell className="hidden md:table-cell text-sm">{formatDateValue(getPunchTimestamp(saidaInt), 'HH:mm')}</TableCell>
                        <TableCell className="hidden md:table-cell text-sm">{formatDateValue(getPunchTimestamp(retorno), 'HH:mm')}</TableCell>
                        <TableCell className="text-sm">{formatDateValue(getPunchTimestamp(saida), 'HH:mm')}</TableCell>
                        <TableCell className="font-medium text-sm">{hours}h</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Badge variant="outline" className="text-[10px]">{c.punch_count}x</Badge>
                            {isIncomplete && <Badge variant="secondary" className="text-[10px]">⚠ Ímpar</Badge>}
                            {hasGeoIssue && <Badge variant="destructive" className="text-[10px]">Fora PDV</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => exportEmployeeXLS(c.employee_id)}
                          >
                            <Download className="h-3 w-3" /> XLS
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="app">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data/Hora</TableHead>
                    <TableHead>Colaborador</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="hidden md:table-cell">PDV</TableHead>
                    <TableHead>Geo</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingPunches ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
                  ) : appPunches.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nenhum registro do app encontrado</TableCell></TableRow>
                  ) : appPunches.map((p: any) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium text-sm">
                        {formatDateValue(getPunchTimestamp(p), 'dd/MM/yyyy HH:mm:ss', 'Pendente')}
                      </TableCell>
                      <TableCell>{p.employee_name}</TableCell>
                      <TableCell><span className="text-sm">{PUNCH_LABELS[p.punch_type] || p.punch_type}</span></TableCell>
                      <TableCell className="hidden md:table-cell text-xs">
                        {p.pdv_name ? <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{p.pdv_name}</span> : "—"}
                      </TableCell>
                      <TableCell>
                        {p.geo_status && GEO_LABELS[p.geo_status] ? (
                          <Badge variant={GEO_LABELS[p.geo_status].variant} className="text-[10px]">
                            {p.geo_status === 'dentro_area' ? <CheckCircle2 className="h-3 w-3 mr-1" /> : p.geo_status === 'fora_area' ? <AlertTriangle className="h-3 w-3 mr-1" /> : null}
                            {GEO_LABELS[p.geo_status].label}
                          </Badge>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {p.is_offline ? (
                            <Badge variant="outline" className="text-[10px]"><WifiOff className="h-3 w-3 mr-1" />Offline</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]"><Wifi className="h-3 w-3 mr-1" />Online</Badge>
                          )}
                          <Badge variant={p.sync_status === 'synced' ? 'default' : 'secondary'} className="text-[10px]">
                            {p.sync_status === 'synced' ? '✓ Sync' : '⏳ Pendente'}
                          </Badge>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="manual">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Colaborador</TableHead>
                    <TableHead className="hidden md:table-cell">Entrada</TableHead>
                    <TableHead className="hidden md:table-cell">Almoço</TableHead>
                    <TableHead className="hidden md:table-cell">Retorno</TableHead>
                    <TableHead className="hidden md:table-cell">Saída</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>HE</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
                  ) : filteredRecords.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Nenhum registro encontrado para o filtro selecionado</TableCell></TableRow>
                  ) : filteredRecords.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{formatDateValue(r.record_date, 'dd/MM/yyyy')}</TableCell>
                      <TableCell>{r.employee_name}</TableCell>
                      <TableCell className="hidden md:table-cell">{r.entry1 || "—"}</TableCell>
                      <TableCell className="hidden md:table-cell">{r.exit1 || "—"}</TableCell>
                      <TableCell className="hidden md:table-cell">{r.entry2 || "—"}</TableCell>
                      <TableCell className="hidden md:table-cell">{r.exit2 || "—"}</TableCell>
                      <TableCell className="font-medium">{r.total_hours ? `${r.total_hours}h` : "—"}</TableCell>
                      <TableCell>{parseFloat(r.overtime_hours) > 0 ? <Badge variant="outline" className="text-primary">{r.overtime_hours}h</Badge> : "—"}</TableCell>
                      <TableCell><Badge variant="outline">{STATUS_LABELS[r.status] || r.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Registrar Ponto</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Colaborador *</Label>
              <Select value={form.employee_id} onValueChange={v => setField("employee_id", v)}>
                <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Data *</Label><Input type="date" value={form.record_date} onChange={e => setField("record_date", e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Entrada</Label><Input type="time" value={form.entry1} onChange={e => setField("entry1", e.target.value)} /></div>
              <div><Label>Saída Almoço</Label><Input type="time" value={form.exit1} onChange={e => setField("exit1", e.target.value)} /></div>
              <div><Label>Retorno</Label><Input type="time" value={form.entry2} onChange={e => setField("entry2", e.target.value)} /></div>
              <div><Label>Saída</Label><Input type="time" value={form.exit2} onChange={e => setField("exit2", e.target.value)} /></div>
            </div>
            <div><Label>Status</Label>
              <Select value={form.status} onValueChange={v => setField("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Justificativa</Label><Input value={form.justification} onChange={e => setField("justification", e.target.value)} /></div>
            <div className="text-sm text-muted-foreground">Total calculado: <strong>{calcHours(form)}h</strong></div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saveMut.isPending}>{saveMut.isPending ? "Salvando..." : "Salvar"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
