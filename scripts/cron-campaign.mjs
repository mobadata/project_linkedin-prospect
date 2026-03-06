#!/usr/bin/env node
/**
 * Cron local pour traiter la file d'invitations (1 invitation toutes les 5 min).
 * Lancez en parallèle du serveur : npm run dev:cron
 *
 * En production, utilisez un cron externe (cron-job.org, Vercel Cron, etc.)
 * qui appelle GET /api/linkedin/campaign/process avec le header x-cron-secret
 */
import { readFileSync } from "fs";
import { resolve } from "path";

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

function loadEnv() {
  try {
    const envPath = resolve(process.cwd(), ".env.local");
    const content = readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m) {
        const key = m[1].trim();
        let val = m[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
      }
    }
  } catch {}
}

async function processOne() {
  const secret = process.env.CRON_SECRET || "dev";
  const url = `${BASE_URL.replace(/\/$/, "")}/api/linkedin/campaign/process`;
  try {
    const res = await fetch(url, {
      headers: { "x-cron-secret": secret },
    });
    const data = await res.json().catch(() => ({}));
    if (data.processed) {
      console.log(`[${new Date().toLocaleTimeString("fr-FR")}] ${data.message || "OK"}`);
    }
  } catch (err) {
    console.error(`[${new Date().toLocaleTimeString("fr-FR")}] Erreur:`, err.message);
  }
}

loadEnv();
console.log("Cron campagnes démarré. Traitement toutes les 5 min. Ctrl+C pour arrêter.\n");

processOne();
setInterval(processOne, INTERVAL_MS);
