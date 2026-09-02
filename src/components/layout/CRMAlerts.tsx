import { useState, useEffect, useCallback, useRef } from "react";
import { Target, X, ExternalLink, BellRing, Bell, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useNotificationSound } from "@/hooks/use-notification-sound";

const safeFormatTime = (v: any, fmt: string, fallback = "—") => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? format(d, fmt, { locale: ptBR }) : fallback;
};

interface CRMAlert {
  id: string;
  type: string;
  title: string;
  message: string;
  metadata: {
    deal_id?: string;
    prospect_id?: string;
    source?: string;
    webhook_name?: string;
    form_name?: string;
    form_slug?: string;
    lead_name?: string;
    lead_phone?: string;
    lead_email?: string;
    task_id?: string;
    task_type?: string;
    priority?: string;
  };
  is_read: boolean;
  created_at: string;
}

export function CRMAlerts() {
  const [alerts, setAlerts] = useState<CRMAlert[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const previousCountRef = useRef(0);

  const { notify, settings } = useNotificationSound();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const failCountRef = useRef(0);

  const fetchAlerts = useCallback(async () => {
    // Stop polling after 3 consecutive failures to avoid spamming
    if (failCountRef.current >= 3) return;
    
    try {
      const data = await api<CRMAlert[]>("/api/chat/alerts");
      if (!Array.isArray(data)) return;
      
      failCountRef.current = 0; // Reset on success
      const crmAlerts = data.filter(a => a.type === 'new_lead' || a.type === 'task_reminder');
      
      if (crmAlerts.length > previousCountRef.current && previousCountRef.current > 0) {
        const newCount = crmAlerts.length - previousCountRef.current;
        const latestAlert = crmAlerts[0];
        
        if (settingsRef.current.soundEnabled) {
          notifyRef.current(
            latestAlert?.title || '🎯 Novo Lead',
            latestAlert?.message || `${newCount} novo(s) lead(s) no CRM!`,
            { playSound: true }
          );
        }
      }
      
      previousCountRef.current = crmAlerts.length;
      setAlerts(crmAlerts);
    } catch (error) {
      failCountRef.current += 1;
    }
  }, []);

  // Poll for alerts every 10 seconds
  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 10000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  const handleMarkAsRead = async (alertId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api("/api/chat/alerts/read", {
        method: "POST",
        body: { alert_ids: [alertId] }
      });
      setAlerts(prev => prev.filter(a => a.id !== alertId));
    } catch (error) {
      console.error("Error marking alert as read:", error);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await api("/api/chat/alerts/read-all", { method: "POST" });
      setAlerts([]);
    } catch (error) {
      console.error("Error marking all alerts as read:", error);
    }
  };

  const handleGoToAlert = (alert: CRMAlert) => {
    setIsOpen(false);
    if (alert.type === 'task_reminder') {
      window.location.href = "/crm/tarefas";
    } else if (alert.metadata.deal_id) {
      window.location.href = `/crm/negociacoes?deal=${alert.metadata.deal_id}`;
    } else if (alert.metadata.prospect_id) {
      window.location.href = `/crm/prospects`;
    }
  };

  const getSourceIcon = (alert: CRMAlert) => {
    if (alert.type === 'task_reminder') return '⏰';
    if (alert.metadata.source === 'webhook') return '🔗';
    if (alert.metadata.source === 'form') return '📝';
    return '🎯';
  };

  const getSourceLabel = (alert: CRMAlert) => {
    if (alert.type === 'task_reminder') {
      const typeLabels: Record<string, string> = { task: 'Tarefa', call: 'Ligação', email: 'Email', meeting: 'Reunião', follow_up: 'Follow-up' };
      return typeLabels[alert.metadata.task_type || ''] || 'Lembrete';
    }
    if (alert.metadata.source === 'webhook') {
      return alert.metadata.webhook_name || 'Webhook';
    }
    if (alert.metadata.source === 'form') {
      return alert.metadata.form_name || 'Formulário';
    }
    return 'CRM';
  };

  const taskReminderCount = alerts.filter(a => a.type === 'task_reminder').length;
  const leadCount = alerts.filter(a => a.type === 'new_lead').length;

  if (alerts.length === 0) {
    return <span className="hidden" />;
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9"
        >
          <Target className="h-5 w-5 text-primary animate-pulse" />
          <Badge
            variant="default"
            className="absolute -top-1 -right-1 h-5 min-w-[20px] px-1 text-[10px] font-bold bg-primary hover:bg-primary"
          >
            {alerts.length > 99 ? "99+" : alerts.length}
          </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[calc(100vw-1rem)] max-w-80 p-0 mx-2 sm:mx-0 sm:w-80"
        align="end"
        sideOffset={8}
      >
        <div className="flex items-center justify-between p-3 border-b">
          <h4 className="font-semibold text-sm flex items-center gap-2">
            <BellRing className="h-4 w-4 text-primary" />
            <span className="truncate">
              Alertas
              {leadCount > 0 && taskReminderCount > 0
                ? ` (${leadCount} leads, ${taskReminderCount} lembretes)`
                : leadCount > 0 ? ` (${leadCount} leads)` : ` (${taskReminderCount} lembretes)`}
            </span>
          </h4>
          {alerts.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={handleMarkAllAsRead}
            >
              Limpar tudo
            </Button>
          )}
        </div>

        <ScrollArea className="max-h-[60vh] sm:max-h-[300px]">
          <div className="divide-y">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className="p-3 hover:bg-muted/50 active:bg-muted/70 cursor-pointer transition-colors group"
                onClick={() => handleGoToAlert(alert)}
              >
                <div className="flex items-start gap-3">
                  <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-lg ${
                    alert.type === 'task_reminder' ? 'bg-primary/10' : 'bg-accent'
                  }`}>
                    {getSourceIcon(alert)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">
                        {alert.type === 'task_reminder' ? alert.title : (alert.metadata.lead_name || "Novo Lead")}
                      </p>
                      {alert.metadata.priority === 'urgent' && (
                        <Badge variant="destructive" className="text-[10px]">Urgente</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {alert.message}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <Badge variant="secondary" className="text-[10px]">
                        {getSourceLabel(alert)}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {safeFormatTime(alert.created_at, "HH:mm")}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleGoToAlert(alert);
                      }}
                      title="Abrir"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => handleMarkAsRead(alert.id, e)}
                      title="Dispensar"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        {alerts.length > 0 && (
          <div className="p-2 border-t">
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-sm h-9"
              onClick={() => {
                setIsOpen(false);
                window.location.href = "/crm/negociacoes";
              }}
            >
              Ver todas as negociações
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
