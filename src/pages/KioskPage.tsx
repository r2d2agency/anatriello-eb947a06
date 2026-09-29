import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import RHRelogioPonto from "./RHRelogioPonto";
import { useAuth } from "@/contexts/AuthContext";

export default function KioskPage() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    setAuthed(!!token);
    if (token) localStorage.setItem("kiosk_mode", "1");
    setReady(true);
  }, []);

  if (!ready) return null;
  if (!authed || !user || user.account_type !== "timeclock_kiosk") {
    return <Navigate to="/kiosk/login" replace />;
  }

  return <RHRelogioPonto kiosk />;
}
