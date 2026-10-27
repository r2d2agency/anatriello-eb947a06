import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useEmployees } from "@/hooks/use-rh";
import { useDocumentDeliveries, useSendDocumentDelivery, useInboundDocumentsRH, useDocumentTypes, useSendNotice } from "@/hooks/use-promotor";
import { useDocumentCategories, useDocumentLibrary, useCreateDocumentLibrary, useAddDocumentVersion, useSendDocumentLibrary, useCreateDocumentCategory, useUpdateDocumentLibrary } from "@/hooks/use-document-library";
import { FileUploadInput } from "@/components/ui/file-upload-input";
import { FileText, Send, Search, Megaphone, Loader2, Users, Plus, LibraryBig, History, Tag, FolderOpen, Upload, RefreshCw, Archive, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";

const STATUS_MAP: Record<string, { label: string; variant: string }> = {
  criado: { label: 'Criado', variant: 'secondary' },
  pendente: { label: 'Pendente', variant: 'outline' },
  enviado: { label: 'Enviado', variant: 'default' },
  entregue: { label: 'Entregue', variant: 'default' },
  visualizado: { label: 'Visualizado', variant: 'outline' },
  confirmado: { label: 'Confirmado', variant: 'default' },
  assinado: { label: 'Assinado', variant: 'default' },
  recusado: { label: 'Recusado', variant: 'destructive' },
  expirado: { label: 'Expirado', variant: 'secondary' },
  cancelado: { label: 'Cancelado', variant: 'secondary' },
};

function parseSafe(val: unknown, mask: string) {
  if (!val) return '—';
  try {
    const d = new Date(String(val));
    return isNaN(d.getTime()) ? '—' : format(d, mask);
  } catch { return '—'; }
}

export default function RHDocumentos() {
  const [tab, setTab] = useState("enviados");
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [showNoticeDialog, setShowNoticeDialog] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const { data: deliveries } = useDocumentDeliveries({ status: statusFilter || undefined });
  const { data: inboundDocs } = useInboundDocumentsRH();
  const { data: employees } = useEmployees();
  const { data: docTypes } = useDocumentTypes();
  const sendDelivery = useSendDocumentDelivery();
  const sendNotice = useSendNotice();
  const { toast } = useToast();

  // Central de POPs
  const { data: docCategories } = useDocumentCategories();
  const { data: libraryDocs, isLoading: loadingLibrary } = useDocumentLibrary();
  const createLibraryDoc = useCreateDocumentLibrary();
  const createCategory = useCreateDocumentCategory();
  const addVersion = useAddDocumentVersion("");
  const sendLibraryDoc = useSendDocumentLibrary("");
  const updateLibraryDoc = useUpdateDocumentLibrary("");
  const [showNewLibraryDoc, setShowNewLibraryDoc] = useState(false);
  const [showNewVersion, setShowNewVersion] = useState(false);
  const [showLibrarySend, setShowLibrarySend] = useState(false);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [selectedLibraryDoc, setSelectedLibraryDoc] = useState<any>(null);
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryCategoryFilter, setLibraryCategoryFilter] = useState("");
  const [libraryStatusFilter, setLibraryStatusFilter] = useState("");
  const [newLibForm, setNewLibForm] = useState({ title: '', code: '', category_id: '', summary: '', tags: '', is_mandatory: false, file_url: '' });
  const [newVersionForm, setNewVersionForm] = useState({ file_url: '', change_reason: '' });
  const [newCategoryForm, setNewCategoryForm] = useState({ name: '', color: '#6366f1' });
  const [libSendForm, setLibSendForm] = useState({ employee_ids: [] as string[], sendToAll: false, requires_confirmation: true, requires_signature: false, description: '' });
  const [libEmpSearch, setLibEmpSearch] = useState("");

  // Send Document form
  const [sendForm, setSendForm] = useState({ title: '', description: '', employee_ids: [] as string[], sendToAll: false, file_url: '', requires_confirmation: true, requires_signature: false, document_type_id: '' });
  const [empSearch, setEmpSearch] = useState('');

  // Send Notice form
  const [noticeForm, setNoticeForm] = useState({ title: '', message: '', employee_ids: [] as string[], type: 'info', sendToAll: false });

  const activeEmployees = (employees || []).filter((e: any) => e.status === 'ativo');

  const DEFAULT_DOC_TYPES = [
    { id: '__atestado', name: 'Atestado Médico' },
    { id: '__contrato', name: 'Contrato' },
    { id: '__holerite', name: 'Holerite' },
    { id: '__comprovante', name: 'Comprovante' },
    { id: '__aviso', name: 'Aviso / Comunicado' },
    { id: '__outro', name: 'Outro' },
  ];
  const availableDocTypes = (docTypes && docTypes.length > 0) ? docTypes : DEFAULT_DOC_TYPES;

  const filteredEmployeesForSend = activeEmployees.filter((e: any) =>
    !empSearch || e.full_name?.toLowerCase().includes(empSearch.toLowerCase())
  );

  const toggleSendEmployee = (id: string) => {
    setSendForm(f => ({
      ...f,
      employee_ids: f.employee_ids.includes(id) ? f.employee_ids.filter(x => x !== id) : [...f.employee_ids, id]
    }));
  };

  const handleSend = async () => {
    const ids = sendForm.sendToAll ? activeEmployees.map((e: any) => e.id) : sendForm.employee_ids;
    if (!sendForm.title || ids.length === 0) { toast({ title: 'Preencha título e selecione ao menos um colaborador', variant: 'destructive' }); return; }
    try {
      const payload: any = {
        title: sendForm.title,
        description: sendForm.description,
        file_url: sendForm.file_url,
        requires_confirmation: sendForm.requires_confirmation,
        requires_signature: sendForm.requires_signature,
        employee_ids: ids,
      };
      if (sendForm.document_type_id && !sendForm.document_type_id.startsWith('__')) {
        payload.document_type_id = sendForm.document_type_id;
      }
      await sendDelivery.mutateAsync(payload);
      toast({ title: `Documento enviado para ${ids.length} colaborador(es)!` });
      setShowSendDialog(false);
      setSendForm({ title: '', description: '', employee_ids: [], sendToAll: false, file_url: '', requires_confirmation: true, requires_signature: false, document_type_id: '' });
      setEmpSearch('');
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  const handleSendNotice = async () => {
    const ids = noticeForm.sendToAll ? activeEmployees.map((e: any) => e.id) : noticeForm.employee_ids;
    if (!noticeForm.title || ids.length === 0) { toast({ title: 'Preencha o título e selecione ao menos um colaborador', variant: 'destructive' }); return; }
    try {
      await sendNotice.mutateAsync({ title: noticeForm.title, message: noticeForm.message, employee_ids: ids, type: noticeForm.type });
      toast({ title: `Recado enviado para ${ids.length} colaborador(es)!` });
      setShowNoticeDialog(false);
      setNoticeForm({ title: '', message: '', employee_ids: [], type: 'info', sendToAll: false });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  const toggleEmployee = (id: string) => {
    setNoticeForm(f => ({
      ...f,
      employee_ids: f.employee_ids.includes(id) ? f.employee_ids.filter(x => x !== id) : [...f.employee_ids, id]
    }));
  };

  const filteredDeliveries = (deliveries || []).filter((d: any) =>
    !search || d.employee_name?.toLowerCase().includes(search.toLowerCase()) || d.title?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <MainLayout>
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <h1 className="text-xl font-bold flex items-center gap-2"><FileText className="h-5 w-5" /> Central de Documentos</h1>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowNoticeDialog(true)} className="gap-2">
              <Megaphone className="h-4 w-4" /> Enviar Recado
            </Button>
            <Button onClick={() => setShowSendDialog(true)} className="gap-2">
              <Send className="h-4 w-4" /> Enviar Documento
            </Button>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="enviados">Enviados ao Colaborador</TabsTrigger>
            <TabsTrigger value="recebidos">Recebidos do Colaborador</TabsTrigger>
            <TabsTrigger value="biblioteca">Central de POPs</TabsTrigger>
          </TabsList>

          <TabsContent value="enviados" className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar..." className="pl-9" />
              </div>
              <Select value={statusFilter || "__all__"} onValueChange={v => setStatusFilter(v === "__all__" ? "" : v)}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todos</SelectItem>
                  <SelectItem value="enviado">Enviado</SelectItem>
                  <SelectItem value="visualizado">Visualizado</SelectItem>
                  <SelectItem value="confirmado">Confirmado</SelectItem>
                  <SelectItem value="assinado">Assinado</SelectItem>
                  <SelectItem value="recusado">Recusado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Documento</TableHead>
                    <TableHead>Colaborador</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Enviado em</TableHead>
                    <TableHead>Visualizado</TableHead>
                    <TableHead>Assinado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDeliveries.map((d: any) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.title}</TableCell>
                      <TableCell>{d.employee_name}</TableCell>
                      <TableCell><Badge variant={STATUS_MAP[d.status]?.variant as any || 'outline'}>{STATUS_MAP[d.status]?.label || d.status}</Badge></TableCell>
                      <TableCell className="text-xs">{parseSafe(d.sent_at, 'dd/MM/yy HH:mm')}</TableCell>
                      <TableCell className="text-xs">{parseSafe(d.viewed_at, 'dd/MM/yy HH:mm')}</TableCell>
                      <TableCell className="text-xs">{parseSafe(d.signed_at, 'dd/MM/yy HH:mm')}</TableCell>
                    </TableRow>
                  ))}
                  {filteredDeliveries.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhum documento encontrado</TableCell></TableRow>}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          <TabsContent value="recebidos" className="space-y-3">
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Colaborador</TableHead>
                    <TableHead>Título</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Recebido em</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(inboundDocs || []).map((d: any) => (
                    <TableRow key={d.id}>
                      <TableCell><Badge variant="outline">{d.category}</Badge></TableCell>
                      <TableCell>{d.employee_name}</TableCell>
                      <TableCell>{d.title}</TableCell>
                      <TableCell><Badge variant="outline">{d.status}</Badge></TableCell>
                      <TableCell className="text-xs">{parseSafe(d.created_at, 'dd/MM/yy HH:mm')}</TableCell>
                    </TableRow>
                  ))}
                  {(inboundDocs || []).length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Nenhum documento recebido</TableCell></TableRow>}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          <TabsContent value="biblioteca" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Buscar por título/código..." value={librarySearch} onChange={e => setLibrarySearch(e.target.value)} className="pl-8 w-[260px]" />
                </div>
                <Select value={libraryCategoryFilter || "all"} onValueChange={v => setLibraryCategoryFilter(v === "all" ? "" : v)}>
                  <SelectTrigger className="w-[200px]"><SelectValue placeholder="Categoria" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as categorias</SelectItem>
                    {(docCategories || []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={libraryStatusFilter || "all"} onValueChange={v => setLibraryStatusFilter(v === "all" ? "" : v)}>
                  <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="ativo">Ativo</SelectItem>
                    <SelectItem value="rascunho">Rascunho</SelectItem>
                    <SelectItem value="arquivado">Arquivado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowNewCategory(true)}><FolderOpen className="h-4 w-4 mr-2" /> Gerenciar categorias</Button>
                <Button size="sm" onClick={() => setShowNewLibraryDoc(true)}><Plus className="h-4 w-4 mr-2" /> Novo documento oficial</Button>
              </div>
            </div>
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Documento</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Versão</TableHead>
                    <TableHead>Última atualização</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(libraryDocs || [])
                    .filter((d: any) => (!librarySearch || d.title?.toLowerCase().includes(librarySearch.toLowerCase()) || d.code?.toLowerCase().includes(librarySearch.toLowerCase())))
                    .filter((d: any) => (!libraryCategoryFilter || d.category_id === libraryCategoryFilter))
                    .filter((d: any) => (!libraryStatusFilter || d.status === libraryStatusFilter))
                    .map((d: any) => (
                    <TableRow key={d.id}>
                      <TableCell className="text-xs">{d.code || '—'}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <LibraryBig className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="font-medium">{d.title}</p>
                            {d.is_mandatory && <p className="text-xs text-amber-600">Obrigatório</p>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{d.category_name ? <Badge style={{ backgroundColor: d.category_color || '#6366f1', color: 'white' }}>{d.category_name}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>{d.current_version_number ? `v${d.current_version_number}` : '—'}</TableCell>
                      <TableCell className="text-xs">{parseSafe(d.last_updated_at || d.updated_at, 'dd/MM/yy HH:mm')}</TableCell>
                      <TableCell><Badge variant={d.status === 'ativo' ? 'default' : d.status === 'arquivado' ? 'secondary' : 'outline'}>{d.status}</Badge></TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button variant="ghost" size="sm" onClick={() => { setSelectedLibraryDoc(d); setNewVersionForm({ file_url: '', change_reason: '' }); setShowNewVersion(true); }}><History className="h-4 w-4 mr-1" /> Nova versão</Button>
                        <Button variant="ghost" size="sm" onClick={() => { setSelectedLibraryDoc(d); setLibSendForm({ employee_ids: [], sendToAll: false, requires_confirmation: true, requires_signature: false, description: '' }); setShowLibrarySend(true); }} disabled={d.status !== 'ativo'}><Send className="h-4 w-4 mr-1" /> Enviar</Button>
                        {d.status === 'rascunho' && <Button variant="ghost" size="sm" onClick={async () => { try { await updateLibraryDoc.mutateAsync({ status: 'ativo' } as any); toast({ title: 'Documento publicado como ativo' }); } catch(e:any){ toast({ title: 'Erro', description: e.message, variant: 'destructive' }); } }}><CheckCircle2 className="h-4 w-4 mr-1" /> Publicar</Button>}
                        {d.status === 'ativo' && <Button variant="ghost" size="sm" onClick={async () => { try { await updateLibraryDoc.mutateAsync({ status: 'arquivado' } as any); toast({ title: 'Documento arquivado' }); } catch(e:any){ toast({ title: 'Erro', description: e.message, variant: 'destructive' }); } }}><Archive className="h-4 w-4 mr-1" /> Arquivar</Button>}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(libraryDocs || []).length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nenhum documento no acervo. Crie o primeiro POP/procedimento.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Send Document Dialog */}
      <Dialog open={showSendDialog} onOpenChange={setShowSendDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Send className="h-5 w-5" /> Enviar Documento</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label className="flex items-center gap-2"><Users className="h-4 w-4" /> Destinatários *</Label>
              <div className="flex items-center gap-2 pb-1">
                <Checkbox
                  id="docSendAll"
                  checked={sendForm.sendToAll}
                  onCheckedChange={(v) => setSendForm(f => ({ ...f, sendToAll: !!v, employee_ids: [] }))}
                />
                <label htmlFor="docSendAll" className="text-sm font-medium cursor-pointer">Enviar para todos ({activeEmployees.length})</label>
              </div>
              {!sendForm.sendToAll && (
                <>
                  <Input
                    placeholder="Buscar colaborador..."
                    value={empSearch}
                    onChange={e => setEmpSearch(e.target.value)}
                    className="h-8"
                  />
                  <div className="max-h-40 overflow-y-auto border rounded-lg p-2 space-y-1">
                    {filteredEmployeesForSend.map((e: any) => (
                      <div key={e.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`doc-emp-${e.id}`}
                          checked={sendForm.employee_ids.includes(e.id)}
                          onCheckedChange={() => toggleSendEmployee(e.id)}
                        />
                        <label htmlFor={`doc-emp-${e.id}`} className="text-sm cursor-pointer">{e.full_name}</label>
                      </div>
                    ))}
                    {filteredEmployeesForSend.length === 0 && <p className="text-xs text-muted-foreground text-center py-2">Nenhum colaborador</p>}
                  </div>
                  {sendForm.employee_ids.length > 0 && (
                    <p className="text-xs text-muted-foreground">{sendForm.employee_ids.length} selecionado(s)</p>
                  )}
                </>
              )}
            </div>

            <div className="space-y-1"><Label>Título *</Label><Input value={sendForm.title} onChange={e => setSendForm(f => ({ ...f, title: e.target.value }))} placeholder="Ex: Holerite Janeiro/2026" /></div>
            <div className="space-y-1"><Label>Descrição</Label><Textarea value={sendForm.description} onChange={e => setSendForm(f => ({ ...f, description: e.target.value }))} rows={2} /></div>

            <div className="space-y-1">
              <Label>Tipo de Documento</Label>
              <Select value={sendForm.document_type_id || undefined} onValueChange={v => setSendForm(f => ({ ...f, document_type_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione (opcional)..." /></SelectTrigger>
                <SelectContent>{availableDocTypes.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Arquivo</Label>
              <FileUploadInput
                value={sendForm.file_url}
                onChange={(url) => setSendForm(f => ({ ...f, file_url: url }))}
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                placeholder="Selecione, cole (Ctrl+V) ou arraste o arquivo"
                previewType="file"
              />
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sendForm.requires_confirmation} onChange={e => setSendForm(f => ({ ...f, requires_confirmation: e.target.checked }))} /> Confirmar recebimento</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sendForm.requires_signature} onChange={e => setSendForm(f => ({ ...f, requires_signature: e.target.checked }))} /> Assinatura obrigatória</label>
            </div>
            <Button onClick={handleSend} className="w-full" disabled={sendDelivery.isPending}>
              {sendDelivery.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              Enviar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Send Notice/Recado Dialog */}
      <Dialog open={showNoticeDialog} onOpenChange={setShowNoticeDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Megaphone className="h-5 w-5" /> Enviar Recado</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Título *</Label><Input value={noticeForm.title} onChange={e => setNoticeForm(f => ({ ...f, title: e.target.value }))} placeholder="Ex: Reunião amanhã às 8h" /></div>
            <div className="space-y-1"><Label>Mensagem</Label><Textarea value={noticeForm.message} onChange={e => setNoticeForm(f => ({ ...f, message: e.target.value }))} rows={3} placeholder="Detalhes do recado..." /></div>
            <div className="space-y-1"><Label>Tipo</Label>
              <Select value={noticeForm.type} onValueChange={v => setNoticeForm(f => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">ℹ️ Informativo</SelectItem>
                  <SelectItem value="alert">⚠️ Alerta</SelectItem>
                  <SelectItem value="document">📄 Documento</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Destinatários</Label>
              <div className="flex items-center gap-2 pb-1">
                <Checkbox
                  id="sendAll"
                  checked={noticeForm.sendToAll}
                  onCheckedChange={(v) => setNoticeForm(f => ({ ...f, sendToAll: !!v, employee_ids: [] }))}
                />
                <label htmlFor="sendAll" className="text-sm font-medium cursor-pointer">Enviar para todos ({activeEmployees.length})</label>
              </div>
              {!noticeForm.sendToAll && (
                <div className="max-h-40 overflow-y-auto border rounded-lg p-2 space-y-1">
                  {activeEmployees.map((e: any) => (
                    <div key={e.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`emp-${e.id}`}
                        checked={noticeForm.employee_ids.includes(e.id)}
                        onCheckedChange={() => toggleEmployee(e.id)}
                      />
                      <label htmlFor={`emp-${e.id}`} className="text-sm cursor-pointer">{e.full_name}</label>
                    </div>
                  ))}
                </div>
              )}
              {!noticeForm.sendToAll && noticeForm.employee_ids.length > 0 && (
                <p className="text-xs text-muted-foreground">{noticeForm.employee_ids.length} selecionado(s)</p>
              )}
            </div>

            <Button onClick={handleSendNotice} className="w-full" disabled={sendNotice.isPending}>
              {sendNotice.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Megaphone className="h-4 w-4 mr-2" />}
              Enviar Recado
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Novo documento na Central de POPs */}
      <Dialog open={showNewLibraryDoc} onOpenChange={setShowNewLibraryDoc}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><LibraryBig className="h-5 w-5" /> Novo documento oficial (POP/Procedimento)</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Título *</Label><Input value={newLibForm.title} onChange={e => setNewLibForm(f => ({...f, title: e.target.value}))} placeholder="Ex: POP - Abertura de Caixa" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label>Código</Label><Input value={newLibForm.code} onChange={e => setNewLibForm(f => ({...f, code: e.target.value}))} placeholder="Ex: POP-001" /></div>
              <div className="space-y-1"><Label>Categoria</Label>
                <Select value={newLibForm.category_id} onValueChange={v => setNewLibForm(f => ({...f, category_id: v}))}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {(docCategories || []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1"><Label>Resumo/Descrição</Label><Textarea value={newLibForm.summary} onChange={e => setNewLibForm(f => ({...f, summary: e.target.value}))} rows={2} /></div>
            <div className="space-y-1"><Label>Tags (separadas por vírgula)</Label><Input value={newLibForm.tags} onChange={e => setNewLibForm(f => ({...f, tags: e.target.value}))} placeholder="segurança, atendimento" /></div>
            <div className="flex items-center gap-2"><Checkbox id="lib-mandatory" checked={newLibForm.is_mandatory} onCheckedChange={(v)=>setNewLibForm(f=>({...f, is_mandatory: !!v}))} /><label htmlFor="lib-mandatory" className="text-sm">Documento obrigatório</label></div>
            <div className="space-y-1"><Label>Arquivo *</Label><FileUploadInput value={newLibForm.file_url} onChange={(url)=>setNewLibForm(f=>({...f, file_url: url}))} accept=".pdf,.doc,.docx,.xls,.xlsx,.txt" placeholder="Selecione ou arraste o arquivo" previewType="file" /></div>
            <Button className="w-full" disabled={createLibraryDoc.isPending} onClick={async ()=>{
              if(!newLibForm.title || !newLibForm.file_url){ toast({ title:'Preencha título e arquivo', variant:'destructive'}); return; }
              try {
                const tags = newLibForm.tags ? newLibForm.tags.split(',').map(t=>t.trim()).filter(Boolean) : null;
                await createLibraryDoc.mutateAsync({ title: newLibForm.title, code: newLibForm.code || null, category_id: newLibForm.category_id || null, summary: newLibForm.summary || null, tags, is_mandatory: newLibForm.is_mandatory, file_url: newLibForm.file_url } as any);
                toast({ title: 'Documento criado em rascunho' });
                setShowNewLibraryDoc(false);
                setNewLibForm({ title:'', code:'', category_id:'', summary:'', tags:'', is_mandatory:false, file_url:'' });
              } catch(e:any){ toast({ title:'Erro', description: e.message, variant:'destructive' }); }
            }}>{createLibraryDoc.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />} Criar documento</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Nova versão */}
      <Dialog open={showNewVersion} onOpenChange={setShowNewVersion}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><History className="h-5 w-5" /> Adicionar nova versão</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Documento: <span className="font-medium text-foreground">{selectedLibraryDoc?.title}</span></p>
            <div className="space-y-1"><Label>Arquivo *</Label><FileUploadInput value={newVersionForm.file_url} onChange={(url)=>setNewVersionForm(f=>({...f, file_url: url}))} accept=".pdf,.doc,.docx,.xls,.xlsx,.txt" placeholder="Novo arquivo da versão" previewType="file" /></div>
            <div className="space-y-1"><Label>Motivo da alteração</Label><Textarea value={newVersionForm.change_reason} onChange={e=>setNewVersionForm(f=>({...f, change_reason: e.target.value}))} rows={2} placeholder="Ex: Atualização de procedimento conforme revisão..." /></div>
            <Button className="w-full" disabled={addVersion.isPending || !selectedLibraryDoc} onClick={async ()=>{
              if(!selectedLibraryDoc || !newVersionForm.file_url){ toast({ title:'Selecione o arquivo', variant:'destructive'}); return; }
              try {
                await addVersion.mutateAsync({ file_url: newVersionForm.file_url, change_reason: newVersionForm.change_reason || null } as any);
                toast({ title: 'Nova versão criada' });
                setShowNewVersion(false);
                setNewVersionForm({ file_url:'', change_reason:'' });
              } catch(e:any){ toast({ title:'Erro', description: e.message, variant:'destructive' }); }
            }}>{addVersion.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />} Criar versão</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Enviar da Central de POPs */}
      <Dialog open={showLibrarySend} onOpenChange={setShowLibrarySend}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Send className="h-5 w-5" /> Enviar documento da Central</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Documento: <span className="font-medium text-foreground">{selectedLibraryDoc?.title}</span> {selectedLibraryDoc?.current_version_number ? `(v${selectedLibraryDoc.current_version_number})` : ''}</p>
            <div className="space-y-2">
              <Label className="flex items-center gap-2"><Users className="h-4 w-4" /> Destinatários *</Label>
              <div className="flex items-center gap-2 pb-1">
                <Checkbox id="libSendAll" checked={libSendForm.sendToAll} onCheckedChange={(v)=>setLibSendForm(f=>({...f, sendToAll: !!v, employee_ids: []}))} />
                <label htmlFor="libSendAll" className="text-sm font-medium cursor-pointer">Enviar para todos ({activeEmployees.length})</label>
              </div>
              {!libSendForm.sendToAll && (
                <>
                  <Input placeholder="Buscar colaborador..." value={libEmpSearch} onChange={e=>setLibEmpSearch(e.target.value)} className="h-8" />
                  <div className="max-h-40 overflow-y-auto border rounded-lg p-2 space-y-1">
                    {activeEmployees.filter((e:any)=>!libEmpSearch || e.full_name?.toLowerCase().includes(libEmpSearch.toLowerCase())).map((e:any)=>(
                      <div key={e.id} className="flex items-center gap-2">
                        <Checkbox id={`lib-emp-${e.id}`} checked={libSendForm.employee_ids.includes(e.id)} onCheckedChange={()=>setLibSendForm(f=>({...f, employee_ids: f.employee_ids.includes(e.id)?f.employee_ids.filter(x=>x!==e.id):[...f.employee_ids, e.id]}))} />
                        <label htmlFor={`lib-emp-${e.id}`} className="text-sm cursor-pointer">{e.full_name}</label>
                      </div>
                    ))}
                  </div>
                  {libSendForm.employee_ids.length > 0 && <p className="text-xs text-muted-foreground">{libSendForm.employee_ids.length} selecionado(s)</p>}
                </>
              )}
            </div>
            <div className="space-y-1"><Label>Observação para o envio</Label><Textarea value={libSendForm.description} onChange={e=>setLibSendForm(f=>({...f, description: e.target.value}))} rows={2} /></div>
            <div className="flex items-center gap-4 flex-wrap">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={libSendForm.requires_confirmation} onChange={e=>setLibSendForm(f=>({...f, requires_confirmation: e.target.checked}))} /> Confirmar recebimento</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={libSendForm.requires_signature} onChange={e=>setLibSendForm(f=>({...f, requires_signature: e.target.checked}))} /> Assinatura obrigatória</label>
            </div>
            <Button className="w-full" disabled={sendLibraryDoc.isPending || !selectedLibraryDoc} onClick={async ()=>{
              if(!selectedLibraryDoc){ return; }
              const ids = libSendForm.sendToAll ? activeEmployees.map((e:any)=>e.id) : libSendForm.employee_ids;
              if(ids.length === 0){ toast({ title:'Selecione ao menos um colaborador', variant:'destructive'}); return; }
              try {
                await sendLibraryDoc.mutateAsync({ employee_ids: ids, sendToAll: libSendForm.sendToAll, requires_confirmation: libSendForm.requires_confirmation, requires_signature: libSendForm.requires_signature, description: libSendForm.description } as any);
                toast({ title: `Documento enviado para ${ids.length} colaborador(es)` });
                setShowLibrarySend(false);
                setLibSendForm({ employee_ids:[], sendToAll:false, requires_confirmation:true, requires_signature:false, description:'' });
              } catch(e:any){ toast({ title:'Erro', description: e.message, variant:'destructive' }); }
            }}>{sendLibraryDoc.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />} Enviar</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Gerenciar categorias */}
      <Dialog open={showNewCategory} onOpenChange={setShowNewCategory}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><FolderOpen className="h-5 w-5" /> Categorias da Central de POPs</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-5 gap-2">
              <div className="col-span-4 space-y-1"><Label>Nome da categoria</Label><Input value={newCategoryForm.name} onChange={e=>setNewCategoryForm(f=>({...f, name: e.target.value}))} placeholder="Ex: Norma" /></div>
              <div className="space-y-1"><Label>Cor</Label><Input type="color" value={newCategoryForm.color} onChange={e=>setNewCategoryForm(f=>({...f, color: e.target.value}))} className="h-9 p-1" /></div>
            </div>
            <Button size="sm" disabled={createCategory.isPending || !newCategoryForm.name} onClick={async ()=>{
              try {
                await createCategory.mutateAsync({ name: newCategoryForm.name, color: newCategoryForm.color } as any);
                toast({ title: 'Categoria criada/atualizada' });
                setNewCategoryForm({ name:'', color:'#6366f1' });
              } catch(e:any){ toast({ title:'Erro', description: e.message, variant:'destructive' }); }
            }}>{createCategory.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />} Adicionar categoria</Button>
            <div className="border rounded-lg divide-y">
              {(docCategories || []).map((c:any)=>(
                <div key={c.id} className="flex items-center justify-between p-2">
                  <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{ backgroundColor: c.color }} /><span className="text-sm">{c.name}</span>{c.is_system && <Badge variant="outline" className="text-xs">padrão</Badge>}</div>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
