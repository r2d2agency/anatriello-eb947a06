import { useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileSpreadsheet, Printer, Loader2, Receipt } from "lucide-react";
import { useCompanies } from "@/hooks/use-companies";
import { usePaymentSheet, downloadPaymentSheet } from "@/hooks/use-rh-deductions";

const brl = (v: number) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const currentMonth = () => new Date().toISOString().slice(0, 7);

export default function RHFolhaPagamento() {
  const [month, setMonth] = useState(currentMonth());
  const [companyId, setCompanyId] = useState<string>("all");
  const { companies = [] } = useCompanies();
  const { data: sheet, isFetching } = usePaymentSheet({
    month, company_id: companyId === "all" ? undefined : companyId,
  });

  const rows = useMemo(() => {
    if (!sheet) return [];
    return companyId === "all" ? sheet.rows : sheet.rows.filter(r => r.company_id === companyId);
  }, [sheet, companyId]);

  const totals = useMemo(() => rows.reduce((a, r) => ({
    base: a.base + r.salario_base,
    prov: a.prov + r.proventos_avulsos,
    ded: a.ded + r.deducoes_avulsas,
    liq: a.liq + r.liquido_a_pagar,
    ben: a.ben + r.beneficios,
    geral: a.geral + r.total_geral,
  }), { base: 0, prov: 0, ded: 0, liq: 0, ben: 0, geral: 0 }), [rows]);

  return (
    <MainLayout>
      <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Receipt className="h-6 w-6 text-primary" /> Folha de Pagamento
          </h1>
          <p className="text-xs text-muted-foreground">
            Consolidação mensal para envio ao financeiro. Inclui salário base, proventos, deduções avulsas e benefícios por colaborador.
          </p>
        </div>

        <Card>
          <CardContent className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>Competência</Label>
              <Input type="month" value={month} onChange={e => setMonth(e.target.value)} />
            </div>
            <div>
              <Label>Empresa</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {(companies as any[]).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Button variant="outline" className="gap-2" disabled={!rows.length}
                onClick={() => downloadPaymentSheet({ month, company_id: companyId === "all" ? undefined : companyId, format: "csv" })}>
                <FileSpreadsheet className="h-4 w-4" /> Planilha CSV
              </Button>
              <Button variant="outline" className="gap-2" disabled={!rows.length}
                onClick={() => downloadPaymentSheet({ month, company_id: companyId === "all" ? undefined : companyId, format: "html" })}>
                <Printer className="h-4 w-4" /> PDF / Imprimir
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Folha de Pagamento — {month}
              {sheet && <span className="ml-2 text-xs text-muted-foreground">({rows.length} colaboradores)</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isFetching ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
            ) : !rows.length ? (
              <div className="text-center py-10 text-sm text-muted-foreground">
                Nenhum colaborador ativo encontrado para os filtros selecionados.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Matr.</TableHead>
                      <TableHead>Colaborador</TableHead>
                      <TableHead>Cargo</TableHead>
                      <TableHead className="text-right">Sal. Base</TableHead>
                      <TableHead className="text-right">Proventos</TableHead>
                      <TableHead className="text-right">Descontos</TableHead>
                      <TableHead className="text-right">Líquido a Pagar</TableHead>
                      <TableHead className="text-right">Benefícios</TableHead>
                      <TableHead className="text-right">Total Geral</TableHead>
                      <TableHead>Pagamento</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map(r => (
                      <TableRow key={r.employee_id}>
                        <TableCell className="text-xs">{r.matricula || "—"}</TableCell>
                        <TableCell>
                          <div className="font-medium">{r.nome}</div>
                          <div className="text-[10px] text-muted-foreground">{r.cpf}</div>
                        </TableCell>
                        <TableCell className="text-xs">{r.cargo}</TableCell>
                        <TableCell className="text-right tabular-nums">{brl(r.salario_base)}</TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-700">
                          {r.proventos_avulsos > 0 ? "+ " + brl(r.proventos_avulsos) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-rose-700">
                          {r.deducoes_avulsas > 0 ? "− " + brl(r.deducoes_avulsas) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-bold">{brl(r.liquido_a_pagar)}</TableCell>
                        <TableCell className="text-right tabular-nums text-sky-700">
                          {r.beneficios > 0 ? brl(r.beneficios) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-bold">{brl(r.total_geral)}</TableCell>
                        <TableCell className="text-[10px] text-muted-foreground">
                          {r.pix ? `PIX: ${r.pix}` : [r.banco, r.agencia, r.conta].filter(Boolean).join(" / ") || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 border-foreground/60 bg-muted/40 font-bold">
                      <TableCell colSpan={3}>TOTAIS</TableCell>
                      <TableCell className="text-right tabular-nums">{brl(totals.base)}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-700">{brl(totals.prov)}</TableCell>
                      <TableCell className="text-right tabular-nums text-rose-700">{brl(totals.ded)}</TableCell>
                      <TableCell className="text-right tabular-nums">{brl(totals.liq)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sky-700">{brl(totals.ben)}</TableCell>
                      <TableCell className="text-right tabular-nums">{brl(totals.geral)}</TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
