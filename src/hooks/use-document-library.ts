import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface DocumentCategory {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  color: string;
  is_system: boolean;
  active: boolean;
  created_at: string;
}

export interface DocumentLibraryItem {
  id: string;
  organization_id: string;
  category_id: string | null;
  title: string;
  code: string | null;
  summary: string | null;
  tags: string[] | null;
  status: 'rascunho' | 'ativo' | 'arquivado';
  is_mandatory: boolean;
  current_version_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_updated_at: string;
  category_name?: string;
  category_color?: string;
  category_slug?: string;
  current_version_number?: number;
  current_file_url?: string;
  current_file_name?: string;
  current_published_at?: string;
}

export interface DocumentLibraryVersion {
  id: string;
  document_id: string;
  version_number: number;
  file_url: string;
  file_name: string | null;
  file_size: number | null;
  file_hash: string | null;
  change_reason: string | null;
  published_by: string | null;
  published_at: string;
  is_current: boolean;
}

export interface DocumentLibraryDetail extends DocumentLibraryItem {
  category_name?: string;
  category_color?: string;
  versions: DocumentLibraryVersion[];
}

export const useDocumentCategories = () => {
  return useQuery<DocumentCategory[]>({
    queryKey: ["document-categories"],
    queryFn: () => api("/api/rh/document-library/categories"),
  });
};

export const useCreateDocumentCategory = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<DocumentCategory>) => api("/api/rh/document-library/categories", { method: "POST", body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["document-categories"] }),
  });
};

export const useDocumentLibrary = (filters?: { search?: string; category_id?: string; status?: string; tag?: string }) => {
  const params = new URLSearchParams();
  if (filters?.search) params.set("search", filters.search);
  if (filters?.category_id) params.set("category_id", filters.category_id);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.tag) params.set("tag", filters.tag);
  const query = params.toString();
  return useQuery<DocumentLibraryItem[]>({
    queryKey: ["document-library", filters],
    queryFn: () => api(`/api/rh/document-library${query ? `?${query}` : ""}`),
  });
};

export const useDocumentLibraryDetail = (id?: string) => {
  return useQuery<DocumentLibraryDetail>({
    queryKey: ["document-library", id],
    queryFn: () => api(`/api/rh/document-library/${id}`),
    enabled: !!id,
  });
};

export const useCreateDocumentLibrary = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api("/api/rh/document-library", { method: "POST", body: data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["document-library"] });
    },
  });
};

export const useAddDocumentVersion = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api(`/api/rh/document-library/${id}/versions`, { method: "POST", body: data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["document-library"] });
      qc.invalidateQueries({ queryKey: ["document-library", id] });
    },
  });
};

export const useUpdateDocumentLibrary = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api(`/api/rh/document-library/${id}`, { method: "PATCH", body: data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["document-library"] });
      qc.invalidateQueries({ queryKey: ["document-library", id] });
    },
  });
};

export const useSendDocumentLibrary = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api(`/api/rh/document-library/${id}/send`, { method: "POST", body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["document-deliveries"] }),
  });
};

export const useDeleteDocumentLibrary = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/api/rh/document-library/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["document-library"] });
    },
  });
};

export const useUpdateDocumentCategory = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<DocumentCategory> }) => api(`/api/rh/document-library/categories/${id}`, { method: "PATCH", body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["document-categories"] }),
  });
};

export const useDeleteDocumentCategory = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/rh/document-library/categories/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["document-categories"] }),
  });
};

export const useUpdateDocumentLibraryById = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api(`/api/rh/document-library/${id}`, { method: "PATCH", body: data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["document-library"] });
    },
  });
};

export const useDeleteDocumentLibraryById = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/rh/document-library/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["document-library"] });
    },
  });
};
