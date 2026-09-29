import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Clock, Loader2, ScanFace } from "lucide-react";

export default function KioskLogin() {
  const { login } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // Auto-redirect if already authenticated
  useEffect(() => {
    if (localStorage.getItem("auth_token")) {
      navigate("/kiosk", { replace: true });
    }
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await login(email.trim(), password);
      const accountType = user.account_type;
      if (accountType !== "timeclock_kiosk") {
        throw new Error("Esta conta não possui acesso ao modo quiosque");
      }
      localStorage.setItem("kiosk_mode", "1");
      navigate("/kiosk", { replace: true });
    } catch (err: any) {
      toast({ title: "Falha no login", description: err?.message || "Verifique as credenciais", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white flex items-center justify-center p-6">
      <Card className="w-full max-w-md bg-white/5 backdrop-blur border-white/10 p-8">
        <div className="flex flex-col items-center mb-8">
          <div className="h-16 w-16 rounded-2xl bg-primary/20 flex items-center justify-center mb-4">
            <ScanFace className="h-9 w-9 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Modo Quiosque</h1>
          <p className="text-sm text-white/60 mt-1 flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" /> Relógio de Ponto — Tablet
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="email" className="text-white/80">E-mail do responsável</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="rh@empresa.com"
              className="mt-1.5 bg-white/5 border-white/10 text-white h-12"
              required
            />
          </div>
          <div>
            <Label htmlFor="password" className="text-white/80">Senha</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 bg-white/5 border-white/10 text-white h-12"
              required
            />
          </div>
          <Button type="submit" disabled={loading} className="w-full h-12 text-base font-semibold">
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Ativar Quiosque"}
          </Button>
        </form>

        <div className="mt-6 pt-6 border-t border-white/10 text-xs text-white/50 space-y-1">
          <p><strong className="text-white/70">Como usar:</strong></p>
          <p>1. Faça login uma única vez com a conta do RH.</p>
          <p>2. A sessão fica ativa no tablet até você sair manualmente.</p>
          <p>3. Coloque o navegador em tela cheia (F11) e deixe ligado.</p>
          <p>4. Colaboradores usam apenas o rosto — sem senha.</p>
        </div>
      </Card>
    </div>
  );
}
