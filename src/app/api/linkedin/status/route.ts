import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";
import { unipileClient, isUnipileConfigured } from "@/src/lib/unipile/client";

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const { data: session, error } = await supabase
      .from("linkedin_sessions")
      .select("id, status, updated_at, account_restricted, unipile_account_id")
      .eq("user_id", user.id)
      .single();

    if (error && error.code !== "PGRST116") {
      const hint = error.code === "42703" || error.message?.includes("column")
        ? " Exécutez les migrations Supabase : supabase db push"
        : "";
      return NextResponse.json(
        { error: error.message + hint },
        { status: 500 }
      );
    }

    const connected = !!session && session.status === "connected" && !!session.unipile_account_id;

    // Si pas connecté en base, vérifier directement sur Unipile (le webhook a pu échouer)
    if (!connected && isUnipileConfigured()) {
      try {
        const accounts = await unipileClient.account.getAll() as {
          items?: Array<{ id?: string; name?: string; type?: string }>;
        };
        // Le champ "name" d'Unipile contient le nom LinkedIn, pas le user_id Supabase
        // On prend le dernier compte LinkedIn créé (le plus récent)
        const linkedinAccounts = (accounts.items ?? []).filter(
          (a) => a.type === "LINKEDIN" && a.id
        );
        // Chercher d'abord par name === user.id (le connect flow envoie name: user.id)
        const match = linkedinAccounts.find((a) => a.name === user.id)
          // Fallback: vérifier si le unipile_account_id stocké existe encore
          ?? (session?.unipile_account_id
            ? linkedinAccounts.find((a) => a.id === session.unipile_account_id)
            : undefined)
          // Dernier recours: dernier compte LinkedIn
          ?? linkedinAccounts[linkedinAccounts.length - 1];
        if (match?.id) {
          await supabase.from("linkedin_sessions").upsert(
            {
              user_id: user.id,
              unipile_account_id: match.id,
              status: "connected",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" }
          );
          return NextResponse.json({
            connected: true,
            status: "connected",
            updated_at: new Date().toISOString(),
            account_restricted: false,
          });
        }
      } catch (e) {
        console.error("[Status] Erreur vérification Unipile:", e);
      }
    }

    return NextResponse.json({
      connected,
      status: session?.status ?? "disconnected",
      updated_at: session?.updated_at ?? null,
      account_restricted: session?.account_restricted ?? false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur inconnue";
    return NextResponse.json(
      { error: "Erreur serveur: " + msg },
      { status: 500 }
    );
  }
}
