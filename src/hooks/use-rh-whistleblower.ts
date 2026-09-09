import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, API_URL, getAuthToken } from "@/lib/api";

export interface WhistleblowerCategory {
  key: string;
  label: string;
}

export interface WhistleblowerChannel {
  id: string;
  organization_id: string;
  slug: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WhistleblowerReport {
  id: string;
  organization_id: string;
  protocol: string;
  category: string;
  description: string;
  location?: string;
  involves_whom?: string;
  status: "nova" | "em_analise" | "concluida";
  rh_response?: string;
  internal_notes?: string;
  responded_at?: string;
  created_at: string;
  updated_at: string;
}

// ============ RH (autenticado) ============

export function useWhistleblowerChannel() {
  return useQuery({
    queryKey: ["rh-whistleblower-channel"],
    queryFn: () => api<WhistleblowerChannel>("/api/rh/denuncias/channel"),
  });
}

export function useRegenerateWhistleblowerSlug() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<WhistleblowerChannel>("/api/rh/denuncias/channel/regenerate", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rh-whistleblower-channel"] }),
  });
}

export function useToggleWhistleblowerChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (active: boolean) => api<WhistleblowerChannel>("/api/rh/denuncias/channel", { method: "PUT", body: { active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rh-whistleblower-channel"] }),
  });
}

// Baixa o PNG do QR Code autenticado e devolve uma object URL para uso em <img src>
export async function fetchWhistleblowerQrCodeObjectUrl(publicUrl: string): Promise<string> {
  const token = getAuthToken();
  const base = (API_URL || "").replace(/\/$/, "");
  const url = `${base}/api/rh/denuncias/channel/qrcode?url=${encodeURIComponent(publicUrl)}`;
  const r = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!r.ok) throw new Error("Erro ao gerar QR Code");
  const blob = await r.blob();
  return URL.createObjectURL(blob);
}

export function useWhistleblowerReports(filters?: { status?: string }) {
  const p = new URLSearchParams();
  if (filters?.status) p.set("status", filters.status);
  const qs = p.toString();
  return useQuery({
    queryKey: ["rh-whistleblower-reports", qs],
    queryFn: () => api<WhistleblowerReport[]>(`/api/rh/denuncias/reports${qs ? `?${qs}` : ""}`),
  });
}

export function useWhistleblowerPendingCount() {
  const { data = [] } = useWhistleblowerReports({ status: "nova" });
  return data.length;
}

export function useUpdateWhistleblowerReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; status?: string; rh_response?: string; internal_notes?: string }) =>
      api<WhistleblowerReport>(`/api/rh/denuncias/reports/${id}`, { method: "PUT", body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rh-whistleblower-reports"] }),
  });
}

// ============ Público (sem autenticação) ============

export interface PublicWhistleblowerChannel {
  active: boolean;
  organization_name: string;
  categories: WhistleblowerCategory[];
}

export interface WhistleblowerStatusResult {
  protocol: string;
  category: string;
  status: string;
  rh_response?: string;
  responded_at?: string;
  created_at: string;
}

export async function getPublicWhistleblowerChannel(slug: string): Promise<PublicWhistleblowerChannel | null> {
  try {
    return await api<PublicWhistleblowerChannel>(`/api/denuncias-public/${slug}`, { auth: false, silent: true });
  } catch {
    return null;
  }
}

export async function submitWhistleblowerReport(slug: string, data: { category: string; description: string; location?: string; involves_whom?: string }): Promise<{ protocol: string }> {
  return api<{ protocol: string }>(`/api/denuncias-public/${slug}`, { method: "POST", body: data, auth: false });
}

export async function getWhistleblowerStatus(protocol: string): Promise<WhistleblowerStatusResult | null> {
  try {
    return await api<WhistleblowerStatusResult>(`/api/denuncias-public/status/${encodeURIComponent(protocol.trim())}`, { auth: false, silent: true });
  } catch {
    return null;
  }
}
