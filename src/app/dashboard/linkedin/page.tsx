"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";

interface LinkedInStatus {
  connected: boolean;
  status: string;
  updated_at: string | null;
  account_restricted?: boolean;
}

export default function DashboardLinkedInPage() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [status, setStatus] = useState<LinkedInStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [disconnectLoading, setDisconnectLoading] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/linkedin/status");
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      } else {
        setStatus({ connected: false, status: "disconnected", updated_at: null });
      }
    } catch {
      setStatus({ connected: false, status: "disconnected", updated_at: null });
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    const statusParam = searchParams.get("status");
    if (statusParam === "success") {
      setMessage({
        type: "success",
        text: "Connexion LinkedIn réussie. Vérification du statut…",
      });
      window.history.replaceState({}, "", "/dashboard/linkedin");
      // Polling: le webhook Unipile peut mettre quelques secondes à mettre à jour la BDD
      setStatusLoading(true);
      let cancelled = false;
      (async () => {
        const maxAttempts = 10;
        const interval = 2000;
        for (let i = 0; i < maxAttempts && !cancelled; i++) {
          try {
            const res = await fetch("/api/linkedin/status");
            if (res.ok) {
              const data = await res.json();
              setStatus(data);
              if (data.connected) {
                setMessage({ type: "success", text: "Connexion LinkedIn réussie. Votre compte a été lié." });
                setStatusLoading(false);
                return;
              }
            }
          } catch { /* retry */ }
          await new Promise((r) => setTimeout(r, interval));
        }
        // Dernier essai après toutes les tentatives
        if (!cancelled) {
          await fetchStatus();
          setMessage({ type: "success", text: "Connexion LinkedIn réussie. Votre compte a été lié." });
        }
      })();
      return () => { cancelled = true; };
    } else if (statusParam === "error") {
      setMessage({
        type: "error",
        text: "La connexion LinkedIn a échoué ou a été annulée. Réessayez.",
      });
      window.history.replaceState({}, "", "/dashboard/linkedin");
    }
  }, [searchParams, fetchStatus]);

  const handleConnect = async () => {
    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/linkedin/connect", { method: "POST" });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        let errText = data.error || "Erreur lors de la génération du lien de connexion.";
        if (data.debug?.unipile) {
          errText += "\n\nDétails: " + JSON.stringify(data.debug.unipile, null, 2);
        }
        setMessage({ type: "error", text: errText });
        return;
      }

      if (data.url) {
        window.location.href = data.url;
        return;
      }

      setMessage({ type: "error", text: "Aucune URL de connexion reçue." });
    } catch {
      setMessage({ type: "error", text: "Erreur réseau ou serveur" });
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnectLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/linkedin/disconnect", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ type: "error", text: data.error || "Erreur lors de la déconnexion." });
        return;
      }
      setMessage({ type: "success", text: "Vous êtes déconnecté de LinkedIn." });
      await fetchStatus();
    } catch {
      setMessage({ type: "error", text: "Erreur réseau ou serveur." });
    } finally {
      setDisconnectLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Connexion LinkedIn</h1>
        <p className="mt-1 text-sm text-slate-500">
          Liez votre compte LinkedIn via le wizard Unipile pour automatiser la prospection.
        </p>
      </div>

      {!statusLoading && status?.account_restricted && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <h2 className="text-sm font-medium text-[#EF4444]">Compte restreint</h2>
          <p className="mt-1 text-sm text-[#FCA5A5]">
            LinkedIn a restreint votre compte. Vérifiez votre identité sur LinkedIn avant de continuer. Les invitations sont suspendues.
          </p>
          <button
            type="button"
            onClick={async () => {
              try {
                const res = await fetch("/api/linkedin/settings", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ reset_account_restricted: true }),
                });
                if (res.ok) {
                  setMessage({ type: "success", text: "Statut réinitialisé. Vous pouvez réessayer." });
                  await fetchStatus();
                }
              } catch {
                setMessage({ type: "error", text: "Erreur lors de la réinitialisation." });
              }
            }}
            className="mt-3 rounded-lg border border-[#EF4444]/50 bg-[#EF4444]/10 px-3 py-1.5 text-sm font-medium text-[#EF4444] transition hover:bg-[#EF4444]/20"
          >
            J&apos;ai vérifié mon identité — réinitialiser
          </button>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-medium text-slate-600">Statut LinkedIn</h2>
        {statusLoading ? (
          <p className="mt-2 text-sm text-slate-500">Chargement…</p>
        ) : status?.connected ? (
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-[#22C55E]">
              <span aria-hidden>✓</span> Connecté
            </p>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={disconnectLoading}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            >
              {disconnectLoading ? "Déconnexion…" : "Se déconnecter de LinkedIn"}
            </button>
          </div>
        ) : (
          <p className="mt-2 flex items-center gap-2 text-slate-500">
            <span aria-hidden>✗</span> Déconnecté
          </p>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {!status?.connected ? (
          <>
            <p className="text-sm text-slate-600">
              Cliquez sur le bouton ci-dessous pour être redirigé vers le wizard Unipile et connecter votre compte LinkedIn en toute sécurité.
            </p>
            <button
              type="button"
              onClick={handleConnect}
              disabled={loading}
              className="mt-4 w-full rounded-lg bg-[#EA580C] py-2.5 font-medium text-white transition hover:bg-[#C2410C] disabled:opacity-50"
            >
              {loading ? "Génération du lien…" : "Connecter mon LinkedIn"}
            </button>
          </>
        ) : null}

        {message && (
          <div
            className={`mt-4 rounded-lg px-3 py-2 text-sm ${
              message.type === "success"
                ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border border-red-200 bg-red-50 text-red-800"
            }`}
          >
            {message.text}
          </div>
        )}
      </div>
    </div>
  );
}
