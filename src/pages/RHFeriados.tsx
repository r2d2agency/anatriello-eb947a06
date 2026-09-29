import { useState, useCallback } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useHolidays, useCreateHoliday, useBulkImportHolidays, useDeleteHoliday, useUpdateHoliday } from "@/hooks/use-rh";
import { CalendarDays, Plus, Upload, Trash2, FileSpreadsheet, Loader2, Pencil } from "lucide-react";

import { formatCivilDateDisplay, excelSerialToCivilDate } from "@/lib/date-civil";
import * as XLSX from "xlsx";

const ESTADOS_BR = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'
];

const TYPE_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  nacional: { label: 'Nacional', variant: 'default' },
  estadual: { label: 'Estadual', variant: 'secondary' },
  municipal: { label: 'Municipal', variant: 'outline' },
};

const EMPTY_FORM = { name: '', holiday_date: '', type: 'nacional', state: '', city: '', recurring: true };

export default function RHFeriados() {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [typeFilter, setTypeFilter] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<any>({ ...EMPTY_FORM });
  const { toast } = useToast();

  const { data: holidays = [], isLoading } = useHolidays({ year: year || undefined, type: typeFilter || undefined });
  const createHoliday = useCreateHoliday();
  const updateHoliday = useUpdateHoliday();
  const bulkImport = useBulkImportHolidays();
  const deleteHoliday = useDeleteHoliday();

  const setField = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }));

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setDialogOpen(true);
  };

  const openEdit = (h: any) => {
    setEditingId(h.id);
    setForm({
      name: h.name || '',
      holiday_date: h.holiday_date ? String(h.holiday_date).slice(0, 10) : '',
      type: h.type || 'nacional',
      state: h.state || '',
      city: h.city || '',
      recurring: h.recurring !== false,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.holiday_date) {
      toast({ title: 'Preencha nome e data', variant: 'destructive' });
      return;
    }
    try {
      if (editingId) {
        await updateHoliday.mutateAsync({ id: editingId, ...form });
        toast({ title: 'Feriado atualizado!' });
      } else {
        await createHoliday.mutateAsync(form);
        toast({ title: 'Feriado adicionado!' });
      }
      setDialogOpen(false);
      setEditingId(null);
      setForm({ ...EMPTY_FORM });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este feriado?')) return;
    try {
      await deleteHoliday.mutateAsync(id);
      toast({ title: 'Feriado removido' });
    } catch {
      toast({ title: 'Erro ao remover', variant: 'destructive' });
    }
  };


  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);

      const parsed = rows.map(r => ({
        name: r.nome || r.name || r.Nome || r.Feriado || '',
        holiday_date: parseExcelDate(r.data || r.date || r.Data || r.holiday_date || ''),
        type: (r.tipo || r.type || r.Tipo || 'nacional').toLowerCase(),
        state: r.estado || r.state || r.UF || r.uf || '',
        city: r.cidade || r.city || r.Cidade || '',
        recurring: r.recorrente !== false && r.recurring !== false,
      })).filter(h => h.name && h.holiday_date);

      if (parsed.length === 0) {
        toast({ title: 'Nenhum feriado válido encontrado no arquivo', variant: 'destructive' });
        return;
      }

      const result = await bulkImport.mutateAsync(parsed);
      toast({ title: `${result.imported} feriados importados!` });
    } catch (err: any) {
      toast({ title: 'Erro na importação', description: err.message, variant: 'destructive' });
    }
    e.target.value = '';
  }, [bulkImport, toast]);

  const exportTemplate = () => {
    const template = [
      { nome: 'Ano Novo', data: '2026-01-01', tipo: 'nacional', estado: '', cidade: '', recorrente: true },
      { nome: 'Aniversário de São Paulo', data: '2026-01-25', tipo: 'municipal', estado: 'SP', cidade: 'São Paulo', recorrente: true },
      { nome: 'Revolução Constitucionalista', data: '2026-07-09', tipo: 'estadual', estado: 'SP', cidade: '', recorrente: true },
    ];
    const ws = XLSX.utils.json_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Feriados');
    XLSX.writeFile(wb, 'modelo_feriados.xlsx');
  };

  const nationalCount = holidays.filter((h: any) => h.type === 'nacional').length;
  const stateCount = holidays.filter((h: any) => h.type === 'estadual').length;
  const cityCount = holidays.filter((h: any) => h.type === 'municipal').length;

  return (
    <MainLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <CalendarDays className="h-6 w-6 text-primary" /> Feriados
            </h1>
            <p className="text-sm text-muted-foreground">Gerencie feriados nacionais, estaduais e municipais</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={exportTemplate} className="gap-2">
              <FileSpreadsheet className="h-4 w-4" /> Baixar Modelo
            </Button>
            <label>
              <Button variant="outline" className="gap-2" asChild>
                <span><Upload className="h-4 w-4" /> Importar Excel</span>
              </Button>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="hidden" />
            </label>
            <Button onClick={openCreate} className="gap-2">
              <Plus className="h-4 w-4" /> Novo Feriado
            </Button>

          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-3 text-center"><p className="text-2xl font-bold text-foreground">{holidays.length}</p><p className="text-xs text-muted-foreground">Total</p></CardContent></Card>
          <Card><CardContent className="p-3 text-center"><p className="text-2xl font-bold text-primary">{nationalCount}</p><p className="text-xs text-muted-foreground">Nacionais</p></CardContent></Card>
          <Card><CardContent className="p-3 text-center"><p className="text-2xl font-bold text-secondary-foreground">{stateCount}</p><p className="text-xs text-muted-foreground">Estaduais</p></CardContent></Card>
          <Card className="hidden md:block"><CardContent className="p-3 text-center"><p className="text-2xl font-bold text-muted-foreground">{cityCount}</p><p className="text-xs text-muted-foreground">Municipais</p></CardContent></Card>
        </div>

        {/* Filters */}
        <div className="flex gap-2 items-center flex-wrap">
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[2024, 2025, 2026, 2027, 2028].map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={typeFilter || '__all__'} onValueChange={v => setTypeFilter(v === '__all__' ? '' : v)}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Todos os tipos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos os tipos</SelectItem>
              <SelectItem value="nacional">Nacional</SelectItem>
              <SelectItem value="estadual">Estadual</SelectItem>
              <SelectItem value="municipal">Municipal</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="hidden md:table-cell">UF</TableHead>
                  <TableHead className="hidden md:table-cell">Cidade</TableHead>
                  <TableHead className="hidden md:table-cell">Recorrente</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></TableCell></TableRow>
                ) : holidays.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Nenhum feriado cadastrado</TableCell></TableRow>
                ) : holidays.map((h: any) => {
                  const cfg = TYPE_LABELS[h.type] || TYPE_LABELS.nacional;
                  return (
                    <TableRow key={h.id}>
                      <TableCell className="font-medium">{safeFormat(h.holiday_date, 'dd/MM/yyyy')}</TableCell>
                      <TableCell>{h.name}</TableCell>
                      <TableCell><Badge variant={cfg.variant}>{cfg.label}</Badge></TableCell>
                      <TableCell className="hidden md:table-cell">{h.state || '—'}</TableCell>
                      <TableCell className="hidden md:table-cell">{h.city || '—'}</TableCell>
                      <TableCell className="hidden md:table-cell">{h.recurring ? '✓ Sim' : 'Não'}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(h)}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(h.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </div>
                      </TableCell>

                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editingId ? 'Editar Feriado' : 'Novo Feriado'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome *</Label><Input value={form.name} onChange={e => setField('name', e.target.value)} placeholder="Ex: Natal" /></div>
            <div><Label>Data *</Label><Input type="date" value={form.holiday_date} onChange={e => setField('holiday_date', e.target.value)} /></div>
            <div><Label>Tipo</Label>
              <Select value={form.type} onValueChange={v => setField('type', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="nacional">Nacional</SelectItem>
                  <SelectItem value="estadual">Estadual</SelectItem>
                  <SelectItem value="municipal">Municipal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(form.type === 'estadual' || form.type === 'municipal') && (
              <div><Label>Estado (UF)</Label>
                <Select value={form.state || '__none__'} onValueChange={v => setField('state', v === '__none__' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{ESTADOS_BR.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {form.type === 'municipal' && (
              <div><Label>Cidade</Label><Input value={form.city} onChange={e => setField('city', e.target.value)} placeholder="Ex: São Paulo" /></div>
            )}
            <div className="flex items-center gap-2">
              <Switch checked={form.recurring} onCheckedChange={v => setField('recurring', v)} />
              <Label>Repete todo ano</Label>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={createHoliday.isPending || updateHoliday.isPending}>
              {(createHoliday.isPending || updateHoliday.isPending) ? 'Salvando...' : 'Salvar'}
            </Button>

          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}

// Helpers
function safeFormat(v: any, _fmt: string, fallback = '—') {
  return formatCivilDateDisplay(v) || fallback;
}

function parseExcelDate(v: any): string {
  if (!v) return '';
  if (typeof v === 'number') return excelSerialToCivilDate(v) || '';
  const s = String(v).trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}
