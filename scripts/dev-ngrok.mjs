#!/usr/bin/env node
/**
 * Démarre ngrok + Next.js pour tester le webhook Unipile en local.
 * L'URL ngrok est utilisée comme NEXT_PUBLIC_APP_URL pour les redirects et le notify_url.
 *
 * Prérequis : ngrok config add-authtoken VOTRE_TOKEN (compte gratuit sur ngrok.com)
 */
import { spawn } from "child_process";
import { readFileSync } from "fs";
import { resolve } from "path";

// Charger .env.local pour que les variables (APOLLO_API_KEY, etc.) soient passées à Next.js
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
} catch {
  // .env.local optionnel
}
import { createInterface } from "readline";
import http from "http";

const PORT = 3000;
const NGROK_API = "http://127.0.0.1:4040";

function fetchNgrokUrl() {
  return new Promise((resolve, reject) => {
    const req = http.get(`${NGROK_API}/api/tunnels`, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const tunnel = json.tunnels?.find((t) => t.public_url?.startsWith("https://"));
          resolve(tunnel?.public_url || null);
        } catch {
          reject(new Error("Réponse ngrok invalide"));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error("Timeout ngrok API"));
    });
  });
}

async function waitForNgrok(maxAttempts = 30) {
  await new Promise((r) => setTimeout(r, 3000));
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const url = await fetchNgrokUrl();
      if (url) return url;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("Impossible d'obtenir l'URL ngrok. Vérifiez que ngrok est installé et configuré.");
}

async function main() {
  console.log("🔗 Démarrage de ngrok sur le port", PORT, "...");
  console.log("   (Assurez-vous qu'aucun autre processus n'utilise le port 3000)\n");
  const ngrokBin = process.env.NGROK_BIN || "/usr/local/bin/ngrok";
  const ngrokProcess = spawn(ngrokBin, ["http", String(PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  ngrokProcess.stdout?.on("data", (d) => process.stdout.write(d));
  ngrokProcess.stderr?.on("data", (d) => process.stderr.write(d));

  let url;
  try {
    url = await waitForNgrok();
    console.log("✅ ngrok actif:", url);
    console.log("   → Webhook Unipile:", url + "/api/linkedin/webhook");
  } catch (err) {
    ngrokProcess.kill();
    console.error("❌", err.message);
    process.exit(1);
  }

  console.log("\n🚀 Démarrage de Next.js avec NEXT_PUBLIC_APP_URL=" + url + "\n");
  const next = spawn("npx", ["next", "dev", "--webpack"], {
    stdio: "inherit",
    env: { ...process.env, NEXT_PUBLIC_APP_URL: url },
  });

  const cleanup = () => {
    ngrokProcess.kill();
    next.kill("SIGINT");
  };

  next.on("close", (code) => {
    cleanup();
    process.exit(code ?? 0);
  });

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

main();
