import { useState } from "react";
import { ColaboradorLayout } from "./ColaboradorLayout";
import { usePromotorPayslips } from "@/hooks/use-promotor";
import { Download, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

export default function ColaboradorHolerite() {
  const { data, isLoading } = usePromotorPayslips();
  const [tab, setTab] = useState<"ultimos" | "anuais">("ultimos");

  return (
    <ColaboradorLayout bg="light" title="Holerite" showBack>
      <div className="px-4 pt-4">
        <div className="flex gap-6 border-b border-slate-200">
          {(["ultimos", "anuais"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn("pb-2 text-sm font-semibold border-b-2 -mb-px", tab === t ? "border-[#f97316] text-[#f97316]" : "border-transparent text-slate-400")}
            >
              {t === "ultimos" ? "Últimos holerites" : "Anuais"}
            </button>
          ))}
        </div>

        <div className="space-y-2 mt-4">
          {isLoading && <Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-400" />}
          {(data || []).map((p: any) => {
            const [y, m] = String(p.reference_month || "").split("-");
            const mesLabel = MESES[Number(m) - 1] || "—";
            return (
              <div key={p.id} className="bg-white rounded-2xl p-3 shadow-sm flex items-center gap-3">
                <div className="h-14 w-14 rounded-xl bg-orange-50 text-[#f97316] flex flex-col items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold">{mesLabel}</span>
                  <span className="text-[10px] font-semibold">{y}</span>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold">{mesLabel === "—" ? p.reference_month : `${mesLabel}/${y}`}</p>
                  <p className="text-sm font-semibold text-slate-800">R$ {Number(p.net_salary || p.gross_salary || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
                  {p.payment_date && !Number.isNaN(new Date(p.payment_date).getTime()) && (
                    <p className="text-[10px] text-slate-400">Pago em {format(new Date(p.payment_date), "dd/MM/yyyy")}</p>
                  )}
                </div>
                {p.pdf_url && (
                  <a href={p.pdf_url} target="_blank" rel="noopener noreferrer" className="h-9 w-9 rounded-full flex items-center justify-center text-[#f97316] hover:bg-orange-50">
                    <Download className="h-4 w-4" />
                  </a>
                )}
              </div>
            );
          })}
          {!isLoading && !data?.length && <p className="text-center text-xs text-slate-400 py-8">Nenhum holerite disponível</p>}
        </div>
      </div>
    </ColaboradorLayout>
  );
}
