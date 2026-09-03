import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, API_URL, getAuthToken } from '@/lib/api';

export interface PayrollEntry {
  id: string;
  employee_id: string;
  employee_name?: string;
  cpf?: string;
  registration_number?: string;
  company_id?: string;
  kind: 'deducao' | 'provento';
  category: string;
  description: string;
  amount: number;
  reference_month: string;
  installments_total: number;
  installment_number: number;
  status: 'pendente' | 'aplicada' | 'cancelada';
  notes?: string;
  created_at: string;
}

export function usePayrollEntries(filters?: { reference_month?: string; employee_id?: string; status?: string; kind?: string; category?: string }) {
  const p = new URLSearchParams();
  Object.entries(filters || {}).forEach(([k, v]) => { if (v) p.set(k, String(v)); });
  const qs = p.toString();
  return useQuery({
    queryKey: ['rh-payroll-entries', qs],
    queryFn: () => api<PayrollEntry[]>(`/api/rh/deductions${qs ? `?${qs}` : ''}`),
  });
}

export function useCreatePayrollEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api<any>('/api/rh/deductions', { method: 'POST', body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rh-payroll-entries'] }),
  });
}

export function useUpdatePayrollEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: any) => api<any>(`/api/rh/deductions/${id}`, { method: 'PUT', body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rh-payroll-entries'] }),
  });
}

export function useDeletePayrollEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<any>(`/api/rh/deductions/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rh-payroll-entries'] }),
  });
}

export interface PaymentSheetRow {
  employee_id: string;
  matricula: string; nome: string; cpf: string; cargo: string; company_id?: string;
  salario_base: number; proventos_avulsos: number; deducoes_avulsas: number;
  total_bruto: number; total_descontos: number; liquido_a_pagar: number;
  beneficios: number; total_geral: number;
  pix?: string; banco?: string; agencia?: string; conta?: string;
  lancamentos: Array<{ id: string; kind: string; category: string; description: string; amount: number }>;
}
export interface PaymentSheet {
  month: string; employees_count: number; rows: PaymentSheetRow[];
  totals: { salario_base: number; proventos_avulsos: number; deducoes_avulsas: number; total_bruto: number; total_descontos: number; liquido_a_pagar: number; beneficios: number; total_geral: number };
}

export function usePaymentSheet(params: { month?: string; company_id?: string }) {
  const p = new URLSearchParams();
  if (params.month) p.set('month', params.month);
  if (params.company_id) p.set('company_id', params.company_id);
  p.set('format', 'json');
  const qs = p.toString();
  return useQuery({
    queryKey: ['rh-payment-sheet', qs],
    queryFn: () => api<PaymentSheet>(`/api/rh/deductions/payment-sheet?${qs}`),
    enabled: !!params.month,
  });
}

export async function downloadPaymentSheet(params: { month: string; company_id?: string; format: 'csv' | 'html' }) {
  const p = new URLSearchParams();
  p.set('month', params.month);
  if (params.company_id) p.set('company_id', params.company_id);
  p.set('format', params.format);
  const token = getAuthToken();
  const url = `${API_URL.replace(/\/$/, '')}/api/rh/deductions/payment-sheet?${p.toString()}`;
  const r = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!r.ok) throw new Error(await r.text());
  if (params.format === 'csv') {
    const blob = await r.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl; a.download = `folha-${params.month}.csv`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(objUrl); a.remove(); }, 500);
  } else {
    const html = await r.text();
    const w = window.open('', '_blank');
    if (w) { w.document.open(); w.document.write(html); w.document.close(); }
  }
}
