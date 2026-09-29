import { useState, useMemo } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Users, UserPlus, UserMinus, TrendingUp, Clock, AlertTriangle,
  Cake, Filter, Loader2, Download, Calendar,
} from "lucide-react";
import { useRhAnalytics } from "@/hooks/use-rh-analytics";
import { useCompanies } from "@/hooks/use-companies";
import { useRhDepartments } from "@/hooks/use-rh";
import { format } from "date-fns";
import { formatCivilDate, formatCivilDateDisplay, todayInSaoPaulo } from "@/lib/date-civil";

const COLORS = ["#6366f1", "#ec4899", "#10b981", "#f59e0b", "#06b6d4", "#8b5cf6", "#ef4444", "#84cc16"];

function firstOfMonth() {
  const today = todayInSaoPaulo();
  return formatCivilDate(`${today.year}-${String(today.month).padStart(2, '0')}-01`) || '';
}
function todayIso() {
  const today = todayInSaoPaulo();
  return formatCivilDate(`${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`) || '';
}

function Kpi({ label, value, icon: Icon, hint, color = "text-primary" }: any) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground truncate">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
            {hint && <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p>}
          </div>
          <Icon className={`h-5 w-5 ${color} shrink-0`} />
        </div>
      </CardContent>
    </Card>
  );
}

export default function RHAnalytics() {
  const [start, setStart] = useState(firstOfMonth());
  const [end, setEnd] = useState(todayIso());
  const [companyId, setCompanyId] = useState<string>("all");
  const [departmentId, setDepartmentId] = useState<string>("all");

  const { companies = [] } = useCompanies();
  const { data: departments = [] } = useRhDepartments();

  const { data, isLoading, refetch } = useRhAnalytics({
    start, end,
    company_id: companyId === "all" ? undefined : companyId,
    department_id: departmentId === "all" ? undefined : departmentId,
  });

  const k = data?.kpis || {};

  const turnoverSeries = useMemo(
    () => (data?.turnover_monthly || []).map((r: any) => ({
      month: r.month,
      Admissões: Number(r.admissions || 0),
      Desligamentos: Number(r.dismissals || 0),
    })),
    [data]
  );

  const overtimeSeries = useMemo(
    () => (data?.overtime_by_department || []).map((r: any) => ({
      department: r.department,
      horas: Number(r.overtime_hours || 0),
    })),
    [data]
  );

  const latesSeries = useMemo(
    () => (data?.lates_by_day || []).map((r: any) => ({
      day: String(r.day).slice(5),
      atrasos: Number(r.lates || 0),
    })),
    [data]
  );

  const deptPie = useMemo(
    () => (data?.by_department || []).slice(0, 8).map((r: any) => ({
      name: r.name, value: Number(r.count || 0),
    })),
    [data]
  );

  const absenceTranslate: Record<string, string> = {
    falta: "Faltas", atestado: "Atestados",
    licenca: "Licenças", afastamento: "Afastamentos",
  };
  const absencePie = useMemo(
    () => (data?.absences_by_type || []).map((r: any) => ({
      name: absenceTranslate[r.type] || r.type,
      value: Number(r.n || 0),
    })),
    [data]
  );

  function exportCsv() {
    const rows = [
      ["Métrica", "Valor"],
      ["Headcount ativo", k.headcount_active],
      ["Em férias", k.on_vacation],
      ["Afastados", k.on_leave],
      ["Admissões", k.admissions],
      ["Desligamentos", k.dismissals],
      ["Turnover %", k.turnover_pct],
      ["Horas extras", k.overtime_hours],
      ["Absenteísmo %", k.absenteeism_pct],
      ["Faltas totais", k.absences_total],
      ["Atrasos totais", k.lates_total],
    ];
    const csv = rows.map(r => r.join(";")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics-rh-${start}-a-${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <MainLayout>
      <div className="p-4 md:p-6 space-y-4 max-w-[1600px] mx-auto">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <TrendingUp className="h-6 w-6 text-primary" /> Analytics RH
            </h1>
            <p className="text-xs text-muted-foreground">
              KPIs operacionais, turnover, absenteísmo, horas extras e atrasos
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="h-4 w-4 mr-1" /> Exportar CSV
          </Button>
        </div>

        {/* Filtros */}
        <Card>
          <CardContent className="p-3">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
              <div>
                <Label className="text-[10px]">Início</Label>
                <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-9" />
              </div>
              <div>
                <Label className="text-[10px]">Fim</Label>
                <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="h-9" />
              </div>
              <div>
                <Label className="text-[10px]">Empresa</Label>
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    {(companies as any[]).map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px]">Departamento</Label>
                <Select value={departmentId} onValueChange={setDepartmentId}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {(departments as any[]).map((d: any) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button onClick={() => refetch()} className="w-full h-9">
                  <Filter className="h-4 w-4 mr-1" /> Aplicar
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {isLoading && (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <Kpi label="Headcount ativo" value={k.headcount_active ?? 0} icon={Users} color="text-indigo-600" />
          <Kpi label="Admissões" value={k.admissions ?? 0} icon={UserPlus} color="text-green-600" hint="no período" />
          <Kpi label="Desligamentos" value={k.dismissals ?? 0} icon={UserMinus} color="text-red-600" hint="no período" />
          <Kpi label="Turnover" value={`${k.turnover_pct ?? 0}%`} icon={TrendingUp} color="text-orange-600" hint="média rotatividade" />
          <Kpi label="Horas extras" value={`${k.overtime_hours ?? 0}h`} icon={Clock} color="text-purple-600" />
          <Kpi label="Absenteísmo" value={`${k.absenteeism_pct ?? 0}%`} icon={AlertTriangle} color="text-pink-600" hint={`${k.absences_total ?? 0} faltas`} />
          <Kpi label="Atrasos" value={k.lates_total ?? 0} icon={Clock} color="text-amber-600" />
          <Kpi label="Em férias" value={k.on_vacation ?? 0} icon={Calendar} color="text-cyan-600" />
          <Kpi label="Afastados" value={k.on_leave ?? 0} icon={AlertTriangle} color="text-slate-600" />
        </div>

        {/* Gráficos linha 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Turnover mensal (últimos 12 meses)</CardTitle></CardHeader>
            <CardContent className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={turnoverSeries}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="month" fontSize={10} />
                  <YAxis fontSize={10} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="Admissões" stroke="#10b981" strokeWidth={2} />
                  <Line type="monotone" dataKey="Desligamentos" stroke="#ef4444" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Horas extras por departamento</CardTitle></CardHeader>
            <CardContent className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={overtimeSeries}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="department" fontSize={10} />
                  <YAxis fontSize={10} />
                  <Tooltip />
                  <Bar dataKey="horas" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Gráficos linha 2 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Atrasos por dia</CardTitle></CardHeader>
            <CardContent className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={latesSeries}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="day" fontSize={9} />
                  <YAxis fontSize={10} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="atrasos" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Colaboradores por departamento</CardTitle></CardHeader>
            <CardContent className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={deptPie} dataKey="value" nameKey="name" outerRadius={80} label={(e: any) => e.name}>
                    {deptPie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Ausências por tipo</CardTitle></CardHeader>
            <CardContent className="h-[240px]">
              {absencePie.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={absencePie} dataKey="value" nameKey="name" outerRadius={80} label={(e: any) => `${e.name}: ${e.value}`}>
                      {absencePie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-xs text-muted-foreground text-center pt-16">Sem ausências no período</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Listas */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" /> Top 5 colaboradores com mais faltas
            </CardTitle></CardHeader>
            <CardContent className="space-y-1.5">
              {(data?.top_absentees || []).map((e: any) => (
                <div key={e.id} className="flex items-center justify-between text-sm border-b py-1 last:border-0">
                  <span className="truncate">{e.full_name}</span>
                  <Badge variant="destructive">{e.absences}</Badge>
                </div>
              ))}
              {!data?.top_absentees?.length && (
                <p className="text-xs text-muted-foreground text-center py-4">Nenhuma falta no período</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2">
              <Cake className="h-4 w-4 text-pink-500" /> Aniversariantes do mês
            </CardTitle></CardHeader>
            <CardContent className="space-y-1.5 max-h-[220px] overflow-y-auto">
              {(data?.birthdays || []).map((e: any) => (
                <div key={e.id} className="flex items-center justify-between text-sm border-b py-1 last:border-0">
                  <div className="min-w-0">
                    <p className="truncate">{e.full_name}</p>
                    <p className="text-[10px] text-muted-foreground">{e.position || ""}</p>
                  </div>
                  <Badge variant="secondary">{e.birth_date ? formatCivilDateDisplay(e.birth_date)?.slice(0, 5) || '—' : '—'}</Badge>
                </div>
              ))}
              {!data?.birthdays?.length && (
                <p className="text-xs text-muted-foreground text-center py-4">Nenhum aniversariante</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </MainLayout>
  );
}
