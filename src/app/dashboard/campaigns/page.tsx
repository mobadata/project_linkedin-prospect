"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

interface Prospect {
  id: string;
  full_name: string;
  job_title: string | null;
  company: string | null;
  linkedin_url: string | null;
  profile_photo: string | null;
  status: string;
  invited_at: string | null;
  created_at: string;
}

interface Stats {
  sentToday: number;
  limit: number;
  remaining: number;
  account_restricted?: boolean;
}

interface LogEntry {
  time: string;
  message: string;
  prospectName: string;
  success: boolean;
}

interface CampaignStatus {
  pending: number;
  sent: number;
  failed: number;
  skipped: number;
  running: boolean;
  recent: Array<{
    prospect_id: string;
    full_name: string;
    status: string;
    error_message: string | null;
    processed_at: string | null;
    created_at: string;
  }>;
}

const MIN_DELAY_MS = 5 * 60 * 1000;
const MAX_DELAY_MS = 15 * 60 * 1000;

function randomDelay() {
  return Math.floor(MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
}

export default function DashboardCampaignsPage() {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [campaignRunning, setCampaignRunning] = useState(false);
  const [campaignPaused, setCampaignPaused] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [sendingMessageId, setSendingMessageId] = useState<string | null>(null);
  const [campaignStatus, setCampaignStatus] = useState<CampaignStatus | null>(null);
  const [startingBackground, setStartingBackground] = useState(false);
  const abortRef = useRef(false);
  const pausedRef = useRef(false);

  const checkConnectionStatus = async (prospectId: string, fullName: string) => {
    setCheckingId(prospectId);
    try {
      const res = await fetch("/api/linkedin/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prospectId }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success && data.alreadyConnected) {
        addLog(`${fullName} — Connecté`, fullName, true);
        await Promise.all([fetchProspects(), fetchStats()]);
      } else if (data.success) {
        addLog(`${fullName} — Toujours en attente`, fullName, true);
        await fetchProspects();
      } else {
        addLog(`${fullName} — ${data.error || data.message || "Erreur"}`, fullName, false);
      }
    } catch {
      addLog(`${fullName} — Erreur vérification`, fullName, false);
    } finally {
      setCheckingId(null);
    }
  };

  const handleSendMessage = async (prospectId: string, fullName: string) => {
    setSendingMessageId(prospectId);
    try {
      const res = await fetch("/api/linkedin/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prospectId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.message) {
        addLog(`Message envoyé à ${fullName}`, fullName, true);
        await fetchProspects();
      } else {
        addLog(`${fullName} — ${data.error || "Échec envoi message"}`, fullName, false);
      }
    } catch {
      addLog(`${fullName} — Erreur envoi message`, fullName, false);
    } finally {
      setSendingMessageId(null);
    }
  };

  const fetchProspects = async () => {
    try {
      const res = await fetch("/api/prospects/list");
      const data = await res.json().catch(() => ({}));
      if (res.ok) setProspects(data.prospects ?? []);
    } catch {
      setProspects([]);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch("/api/linkedin/invitations/stats");
      const data = await res.json().catch(() => ({}));
      if (res.ok) setStats(data);
    } catch {
      setStats(null);
    }
  };

  const fetchCampaignStatus = async () => {
    try {
      const res = await fetch("/api/linkedin/campaign/status");
      const data = await res.json().catch(() => ({}));
      if (res.ok) setCampaignStatus(data);
    } catch {
      setCampaignStatus(null);
    }
  };

  const startBackgroundCampaign = async () => {
    if (startingBackground) return;
    setStartingBackground(true);
    try {
      const res = await fetch("/api/linkedin/campaign/start", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        addLog(data.message ?? "Campagne lancée en arrière-plan", "", true);
        await fetchCampaignStatus();
        await fetchProspects();
        await fetchStats();
      } else {
        addLog(data.error ?? "Erreur", "", false);
      }
    } catch {
      addLog("Erreur réseau", "", false);
    } finally {
      setStartingBackground(false);
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [syncRes, statusRes] = await Promise.all([
        fetch("/api/linkedin/invite/sync-status", { method: "POST" }),
        fetch("/api/linkedin/campaign/status"),
      ]);
      await fetchProspects();
      await fetchStats();
      const syncData = await syncRes.json().catch(() => ({}));
      if (syncData?.success && syncData?.updated > 0) {
        await fetchProspects();
      }
      const statusData = await statusRes.json().catch(() => ({}));
      if (statusData?.running !== undefined) setCampaignStatus(statusData);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    pausedRef.current = campaignPaused;
  }, [campaignPaused]);

  useEffect(() => {
    if (!campaignStatus?.running) return;
    const interval = setInterval(async () => {
      await fetchCampaignStatus();
      await fetchProspects();
      await fetchStats();
    }, 10000);
    return () => clearInterval(interval);
  }, [campaignStatus?.running]);

  const addLog = (message: string, prospectName: string, success: boolean) => {
    setLog((prev) => [
      ...prev,
      { time: new Date().toLocaleTimeString("fr-FR"), message, prospectName, success },
    ]);
  };

  const runCampaign = async () => {
    if (campaignRunning) return;
    setCampaignRunning(true);
    abortRef.current = false;
    setLog((prev) => [...prev, { time: new Date().toLocaleTimeString("fr-FR"), message: "Démarrage de la campagne…", prospectName: "", success: true }]);

    while (!abortRef.current) {
      await fetchStats();
      const statsData = (await fetch("/api/linkedin/invitations/stats").then((r) => r.json()).catch(() => ({}))) as Stats;
      if (statsData.account_restricted) {
        addLog("Compte LinkedIn restreint. Campagne arrêtée.", "", false);
        break;
      }
      const { remaining } = statsData;
      if (remaining != null && remaining <= 0) {
        addLog("Limite quotidienne atteinte. Campagne arrêtée.", "", true);
        break;
      }

      const listRes = await fetch("/api/prospects/list?status=new");
      const listData = await listRes.json().catch(() => ({}));
      const newList = listData.prospects ?? [];
      if (newList.length === 0) {
        addLog("Aucun prospect « new » restant. Campagne terminée.", "", true);
        break;
      }

      while (pausedRef.current && !abortRef.current) {
        await new Promise((r) => setTimeout(r, 500));
      }
      if (abortRef.current) break;

      const prospect = newList[0];
      addLog("Envoi en cours…", prospect.full_name, true);
      try {
        const inviteRes = await fetch("/api/linkedin/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prospectId: prospect.id }),
        });
        const inviteData = await inviteRes.json().catch(() => ({}));
        if (inviteRes.ok && inviteData.success) {
          addLog(inviteData.message ?? "Invitation envoyée", prospect.full_name, true);
          await fetchProspects();
          await fetchStats();
        } else if (inviteRes.status === 403 && inviteData.error?.toLowerCase().includes("restreint")) {
          addLog(inviteData.error ?? "Compte restreint — campagne arrêtée.", prospect.full_name, false);
          abortRef.current = true;
          break;
        } else {
          addLog(inviteData.error ?? inviteData.message ?? "Échec", prospect.full_name, false);
        }
      } catch {
        addLog("Erreur réseau ou serveur", prospect.full_name, false);
      }

      if (abortRef.current) break;
      const delay = randomDelay();
      const delayMin = Math.round(delay / 60000);
      addLog(`Pause ${delayMin} min avant le prochain envoi…`, "", true);
      const deadline = Date.now() + delay;
      while (Date.now() < deadline && !abortRef.current) {
        await new Promise((r) => setTimeout(r, 500));
        if (pausedRef.current) {
          while (pausedRef.current && !abortRef.current) await new Promise((r) => setTimeout(r, 500));
          break;
        }
      }
    }

    setCampaignRunning(false);
    await fetchProspects();
    await fetchStats();
  };

  const stopCampaign = () => {
    abortRef.current = true;
    addLog("Campagne arrêtée par l'utilisateur.", "", true);
  };

  const statusLabel: Record<string, string> = {
    new: "Nouveau",
    invited: "En attente",
    connected: "Connecté",
    ignored: "Ignoré",
  };
  const statusClass: Record<string, string> = {
    new: "bg-slate-100 text-slate-600",
    invited: "bg-amber-100 text-amber-700",
    connected: "bg-emerald-100 text-emerald-700",
    ignored: "bg-slate-100 text-slate-500",
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Campagnes d&apos;invitations</h1>
        <p className="mt-1 text-sm text-slate-500">
          Envoyez des invitations LinkedIn aux prospects en statut « Nouveau ». Limite quotidienne respectée automatiquement.
          « Lancer en arrière-plan » : la campagne continue même si vous quittez la page. Configurez un cron (cron-job.org) sur votre URL + <code className="rounded bg-slate-100 px-1">/api/linkedin/campaign/process</code> toutes les 5 min.
        </p>
      </div>

      {stats?.account_restricted && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">
            Compte LinkedIn restreint. Vérifiez votre identité sur LinkedIn avant de continuer.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-600">Invitations envoyées aujourd&apos;hui :</span>
          <span className="text-xl font-bold text-slate-900">
            {stats ? `${stats.sentToday} / ${stats.limit}` : "—"}
          </span>
          {stats && stats.remaining >= 0 && (
            <span className="text-sm text-slate-500">(reste {stats.remaining})</span>
          )}
        </div>
        {campaignStatus?.running && (
          <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-1.5 text-sm text-amber-800">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500" />
            En cours : {campaignStatus.pending} en attente · {campaignStatus.sent} envoyées
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {!campaignRunning ? (
            <>
              <button
                type="button"
                onClick={startBackgroundCampaign}
                disabled={
                  loading ||
                  startingBackground ||
                  (stats != null && stats.remaining <= 0) ||
                  (stats?.account_restricted ?? false)
                }
                className="rounded-lg bg-[#EA580C] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#C2410C] disabled:opacity-50"
              >
                {startingBackground ? "Lancement…" : "Lancer en arrière-plan"}
              </button>
              <button
                type="button"
                onClick={runCampaign}
                disabled={
                  loading ||
                  (stats != null && stats.remaining <= 0) ||
                  (stats?.account_restricted ?? false)
                }
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Lancer immédiat (rester sur la page)
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setCampaignPaused((p) => !p)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              >
                {campaignPaused ? "Reprendre" : "Mettre en pause"}
              </button>
              <button
                type="button"
                onClick={stopCampaign}
                className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100"
              >
                Arrêter
              </button>
            </>
          )}
        </div>
      </div>

      {((log.length > 0) || (campaignStatus?.recent?.length ?? 0) > 0) && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-600">
            Journal des invitations
            {campaignStatus?.running && (
              <span className="ml-2 text-amber-600">· Arrière-plan actif</span>
            )}
          </h2>
          <ul className="max-h-64 overflow-y-auto p-4 font-mono text-sm">
            {log.map((entry, i) => (
              <li
                key={`log-${i}`}
                className={`border-b border-slate-200 py-1.5 last:border-0 ${
                  entry.success ? "text-slate-600" : "text-red-600"
                }`}
              >
                <span className="text-slate-500">[{entry.time}]</span>{" "}
                {entry.prospectName && <span className="font-medium text-slate-900">{entry.prospectName} — </span>}
                {entry.message}
              </li>
            ))}
            {campaignStatus?.recent?.map((r, i) => (
              <li
                key={`recent-${r.prospect_id}-${i}`}
                className={`border-b border-slate-200 py-1.5 last:border-0 ${
                  r.status === "sent" || r.status === "skipped" ? "text-slate-600" : "text-red-600"
                }`}
              >
                <span className="text-slate-500">
                  [{r.processed_at ? new Date(r.processed_at).toLocaleTimeString("fr-FR") : "—"}]
                </span>{" "}
                <span className="font-medium text-slate-900">{r.full_name} — </span>
                {r.status === "sent" && "Invitation envoyée"}
                {r.status === "skipped" && (r.error_message || "Déjà connecté")}
                {r.status === "failed" && (r.error_message || "Échec")}
                {r.status === "pending" && "En attente…"}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-600">
          Prospects sauvegardés ({prospects.length})
        </h2>
        {loading ? (
          <p className="p-4 text-sm text-slate-500">Chargement…</p>
        ) : prospects.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">
            Aucun prospect. Allez dans{" "}
            <Link href="/dashboard/prospects" className="text-[#EA580C] hover:underline">
              Recherche de prospects
            </Link>{" "}
            pour en ajouter.
          </p>
        ) : (
          <ul className="divide-y divide-slate-200">
            {prospects.map((p) => (
              <li key={p.id} className="flex items-center gap-4 px-4 py-3">
                {p.profile_photo ? (
                  <img src={p.profile_photo} alt="" className="h-10 w-10 rounded-full object-cover" width={40} height={40} />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-sm font-medium text-slate-600">
                    {p.full_name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">{p.full_name}</p>
                  <p className="truncate text-sm text-slate-600">
                    {p.job_title || "—"} {p.company ? `· ${p.company}` : ""}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusClass[p.status] ?? statusClass.new}`}>
                  {statusLabel[p.status] ?? p.status}
                </span>
                {p.status === "invited" && (
                  <button
                    type="button"
                    onClick={() => checkConnectionStatus(p.id, p.full_name)}
                    disabled={checkingId != null}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    {checkingId === p.id ? "Vérification…" : "Vérifier"}
                  </button>
                )}
                {p.status === "connected" && (
                  <button
                    type="button"
                    onClick={() => handleSendMessage(p.id, p.full_name)}
                    disabled={sendingMessageId != null}
                    className="rounded-lg bg-[#EA580C] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[#C2410C] disabled:opacity-50"
                  >
                    {sendingMessageId === p.id ? "Envoi…" : "Envoyer message"}
                  </button>
                )}
                {p.linkedin_url && (
                  <a
                    href={p.linkedin_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-[#EA580C] hover:underline"
                  >
                    Profil
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
