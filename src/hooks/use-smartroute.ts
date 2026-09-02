import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, API_URL, getAuthToken } from '@/lib/api';

const BASE = '/api/smartroute';

export function useSRDashboard() {
  return useQuery<any>({ queryKey: ['sr-dashboard'], queryFn: () => api(`${BASE}/dashboard`), refetchInterval: 30000 });
}
export function useSRLive() {
  return useQuery<any>({ queryKey: ['sr-live'], queryFn: () => api(`${BASE}/live`), refetchInterval: 15000 });
}

// Vehicles
export function useSRVehicles() {
  return useQuery<any[]>({ queryKey: ['sr-vehicles'], queryFn: () => api(`${BASE}/vehicles`) });
}
export function useSRSaveVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: any) => id
      ? api(`${BASE}/vehicles/${id}`, { method: 'PUT', body })
      : api(`${BASE}/vehicles`, { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sr-vehicles'] }),
  });
}
export function useSRDeleteVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`${BASE}/vehicles/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sr-vehicles'] }),
  });
}

// Drivers
export function useSRDrivers() {
  return useQuery<any[]>({ queryKey: ['sr-drivers'], queryFn: () => api(`${BASE}/drivers`) });
}
export function useSRSaveDriver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: any) => id
      ? api(`${BASE}/drivers/${id}`, { method: 'PUT', body })
      : api(`${BASE}/drivers`, { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sr-drivers'] }),
  });
}
export function useSRDeleteDriver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`${BASE}/drivers/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sr-drivers'] }),
  });
}
export function useSRRHCandidates(enabled = true) {
  return useQuery<any[]>({
    queryKey: ['sr-drivers-rh-candidates'],
    queryFn: () => api(`${BASE}/drivers/rh-candidates`),
    enabled,
  });
}
export function useSRImportDriversFromRH() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (employee_ids: string[]) =>
      api(`${BASE}/drivers/import-rh`, { method: 'POST', body: { employee_ids } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sr-drivers'] });
      qc.invalidateQueries({ queryKey: ['sr-drivers-rh-candidates'] });
    },
  });
}

// PDVs
export function useSRPdvs() {
  return useQuery<any[]>({ queryKey: ['sr-pdvs'], queryFn: () => api(`${BASE}/pdvs`) });
}
export function useSRSavePdv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: any) => id
      ? api(`${BASE}/pdvs/${id}`, { method: 'PUT', body })
      : api(`${BASE}/pdvs`, { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sr-pdvs'] }),
  });
}
export function useSRDeletePdv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`${BASE}/pdvs/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sr-pdvs'] }),
  });
}

// Orders
export function useSROrders(filters?: { status?: string; date?: string }) {
  const qs = new URLSearchParams(Object.entries(filters || {}).filter(([, v]) => v).map(([k, v]) => [k, String(v)])).toString();
  return useQuery<any[]>({ queryKey: ['sr-orders', qs], queryFn: () => api(`${BASE}/orders${qs ? `?${qs}` : ''}`) });
}
export function useSRSaveOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: any) => id
      ? api(`${BASE}/orders/${id}`, { method: 'PUT', body })
      : api(`${BASE}/orders`, { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sr-orders'] }),
  });
}
export function useSRDeleteOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`${BASE}/orders/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sr-orders'] }),
  });
}

// Routes
export function useSRRoutes(filters?: { date?: string; status?: string }) {
  const qs = new URLSearchParams(Object.entries(filters || {}).filter(([, v]) => v).map(([k, v]) => [k, String(v)])).toString();
  return useQuery<any[]>({ queryKey: ['sr-routes', qs], queryFn: () => api(`${BASE}/routes${qs ? `?${qs}` : ''}`) });
}
export function useSRRoute(id?: string) {
  return useQuery<any>({ queryKey: ['sr-route', id], queryFn: () => api(`${BASE}/routes/${id}`), enabled: !!id });
}
export function useSRRouteGeometry(id?: string, enabled = false) {
  return useQuery<any>({ queryKey: ['sr-route-geometry', id], queryFn: () => api(`${BASE}/routes/${id}/geometry`), enabled: !!id && enabled });
}
export function useSRSaveRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: any) => id
      ? api(`${BASE}/routes/${id}`, { method: 'PUT', body })
      : api(`${BASE}/routes`, { method: 'POST', body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sr-routes'] }); qc.invalidateQueries({ queryKey: ['sr-orders'] }); },
  });
}
export function useSRDeleteRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`${BASE}/routes/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sr-routes'] }); qc.invalidateQueries({ queryKey: ['sr-orders'] }); },
  });
}
export function useSROptimizeRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`${BASE}/routes/${id}/optimize`, { method: 'POST', body: {} }),
    onSuccess: (_, id) => qc.invalidateQueries({ queryKey: ['sr-route', id] }),
  });
}
export function useSRAddStops() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ routeId, order_ids }: { routeId: string; order_ids: string[] }) =>
      api(`${BASE}/routes/${routeId}/stops`, { method: 'POST', body: { order_ids } }),
    onSuccess: (_, { routeId }) => {
      qc.invalidateQueries({ queryKey: ['sr-route', routeId] });
      qc.invalidateQueries({ queryKey: ['sr-routes'] });
      qc.invalidateQueries({ queryKey: ['sr-orders'] });
    },
  });
}
export function useSRReorderStops() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ routeId, stop_ids }: { routeId: string; stop_ids: string[] }) =>
      api(`${BASE}/routes/${routeId}/stops/reorder`, { method: 'PUT', body: { stop_ids } }),
    onSuccess: (_, { routeId }) => qc.invalidateQueries({ queryKey: ['sr-route', routeId] }),
  });
}
export function useSRRemoveStop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ routeId, stopId }: { routeId: string; stopId: string }) =>
      api(`${BASE}/routes/${routeId}/stops/${stopId}`, { method: 'DELETE' }),
    onSuccess: (_, { routeId }) => {
      qc.invalidateQueries({ queryKey: ['sr-route', routeId] });
      qc.invalidateQueries({ queryKey: ['sr-routes'] });
      qc.invalidateQueries({ queryKey: ['sr-orders'] });
    },
  });
}

// Importação de Romaneio (PDF)
export function useSRParseRomaneio() {
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const token = getAuthToken();
      const res = await fetch(`${API_URL}${BASE}/romaneio/parse`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Falha ao processar o PDF');
      return data;
    },
  });
}
export function useSRCommitRomaneio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: any) => api(`${BASE}/romaneio/commit`, { method: 'POST', body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sr-routes'] }); qc.invalidateQueries({ queryKey: ['sr-orders'] }); qc.invalidateQueries({ queryKey: ['sr-pdvs'] }); },
  });
}

// Phase 4
export function useSRReplay(id?: string) {
  return useQuery<any>({ queryKey: ['sr-replay', id], queryFn: () => api(`${BASE}/routes/${id}/replay`), enabled: !!id });
}
export function useSRAlerts() {
  return useQuery<any[]>({ queryKey: ['sr-alerts'], queryFn: () => api(`${BASE}/alerts`), refetchInterval: 30000 });
}
export function useSRResolveAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`${BASE}/alerts/${id}/resolve`, { method: 'POST', body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sr-alerts'] }),
  });
}
export function useSRWebhookToken() {
  return useQuery<{ token: string }>({ queryKey: ['sr-webhook-token'], queryFn: () => api(`${BASE}/webhook-token`) });
}
export function useSRRotateWebhookToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api(`${BASE}/webhook-token/rotate`, { method: 'POST', body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sr-webhook-token'] }),
  });
}
export function useSROrderTrackingToken() {
  return useMutation({
    mutationFn: (id: string) => api(`${BASE}/orders/${id}/tracking-token`, { method: 'POST', body: {} }) as Promise<{ token: string }>,
  });
}

