import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";
import { unipileClient, isUnipileConfigured } from "@/src/lib/unipile/client";

export const maxDuration = 30;

/**
 * Génère un lien Hosted Auth Unipile pour connecter LinkedIn sans email/mot de passe.
 * L'utilisateur est redirigé vers le wizard Unipile, évitant les checkpoints LinkedIn.
 */
export async function POST() {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Non authentifié" },
        { status: 401 }
      );
    }

    if (!isUnipileConfigured()) {
      return NextResponse.json(
        {
          error: "UNIPILE_API_URL et UNIPILE_ACCESS_TOKEN doivent être configurés dans .env.local",
        },
        { status: 500 }
      );
    }

    const apiUrl = process.env.UNIPILE_API_URL!;
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

    if (baseUrl.includes("localhost") && !baseUrl.includes("ngrok")) {
      return NextResponse.json(
        {
          error: "Pour le Hosted Auth, utilisez une URL publique (ngrok ou déploiement). Lancez: npm run dev:ngrok",
        },
        { status: 400 }
      );
    }

    const expiresOn = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const response = await unipileClient.account.createHostedAuthLink({
      type: "create",
      api_url: apiUrl.startsWith("https://") ? apiUrl : `https://${apiUrl}`,
      providers: ["LINKEDIN"],
      expiresOn,
      name: user.id,
      success_redirect_url: `${baseUrl}/dashboard/linkedin?status=success`,
      failure_redirect_url: `${baseUrl}/dashboard/linkedin?status=error`,
      notify_url: `${baseUrl}/api/linkedin/webhook`,
    });

    if (!response?.url) {
      return NextResponse.json(
        { error: "Unipile n'a pas retourné d'URL Hosted Auth" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      url: response.url,
    });
  } catch (err) {
    console.error("[LinkedIn connect] Erreur Hosted Auth:", err);
    const errBody = err && typeof err === "object" && "body" in err ? (err as { body?: unknown }).body : undefined;
    console.error("[LinkedIn connect] Error body:", JSON.stringify(errBody));
    console.error("[LinkedIn connect] Env check:", {
      tokenDefined: !!process.env.UNIPILE_ACCESS_TOKEN,
      tokenLength: (process.env.UNIPILE_ACCESS_TOKEN ?? "").length,
      apiUrlDefined: !!process.env.UNIPILE_API_URL,
      apiUrl: process.env.UNIPILE_API_URL,
    });
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    const bodyObj = errBody && typeof errBody === "object" ? errBody as { msg?: string; message?: string; type?: string; title?: string } : undefined;
    const detail = bodyObj?.msg ?? bodyObj?.message;
    const errorType = bodyObj?.type;
    const fullError = detail ? `${message} — ${detail}` : message;

    if (errorType === "errors/no_client_session") {
      return NextResponse.json(
        {
          error:
            "Le Hosted Auth n'est pas disponible pour votre instance Unipile. Contactez le support Unipile pour activer cette fonctionnalité (erreur: no_client_session).",
          debug: { unipile: errBody },
        },
        { status: 503 }
      );
    }

    if (errorType === "errors/missing_credentials") {
      const title = bodyObj?.title ?? "";
      const bodyStr = JSON.stringify(errBody ?? "");
      const isCredits = /crédits|credits/i.test(title) || /crédits|credits/i.test(bodyStr);
      const errorMsg = isCredits
        ? "Votre compte Unipile n'a plus de crédits ou votre abonnement est inactif. Rechargez vos crédits ou activez votre abonnement sur le Dashboard Unipile."
        : "Identifiants Unipile manquants ou invalides. Vérifiez UNIPILE_ACCESS_TOKEN et UNIPILE_API_URL dans .env.local. Le token se trouve dans le Dashboard Unipile (Access Tokens).";
      return NextResponse.json(
        {
          error: errorMsg,
          debug: {
            tokenDefined: !!process.env.UNIPILE_ACCESS_TOKEN,
            tokenLength: (process.env.UNIPILE_ACCESS_TOKEN ?? "").length,
            apiUrlDefined: !!process.env.UNIPILE_API_URL,
            apiUrl: process.env.UNIPILE_API_URL,
            unipile: errBody,
          },
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        error: "Impossible de générer le lien de connexion: " + fullError,
        debug: { unipile: errBody },
      },
      { status: 500 }
    );
  }
}
