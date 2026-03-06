import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";
import { unipileClient, isUnipileConfigured } from "@/src/lib/unipile/client";

export const maxDuration = 30;

/**
 * Résout un texte libre (ex: "publicitaire", "Paris") en IDs LinkedIn
 * via l'endpoint Unipile GET /linkedin/search/parameters.
 *
 * Query params:
 *   type: "INDUSTRY" | "LOCATION" | "COMPANY" | "SCHOOL" | "FUNCTION"
 *   keywords: texte à rechercher
 *   limit: nombre max de résultats (défaut 10)
 */
export async function GET(request: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    if (!isUnipileConfigured()) {
      return NextResponse.json({ error: "Unipile non configuré" }, { status: 500 });
    }

    const sessionRes = await supabase
      .from("linkedin_sessions")
      .select("unipile_account_id, status")
      .eq("user_id", user.id)
      .single();

    if (sessionRes.error || !sessionRes.data?.unipile_account_id || sessionRes.data.status !== "connected") {
      return NextResponse.json({ error: "LinkedIn non connecté" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const type = (searchParams.get("type") ?? "").toUpperCase();
    const keywords = (searchParams.get("keywords") ?? "").trim();
    const limit = parseInt(searchParams.get("limit") ?? "10", 10);

    if (!type || !keywords) {
      return NextResponse.json({ error: "type et keywords requis" }, { status: 400 });
    }

    const validTypes = ["INDUSTRY", "LOCATION", "COMPANY", "SCHOOL", "FUNCTION"];
    if (!validTypes.includes(type)) {
      return NextResponse.json({ error: `type invalide. Valeurs: ${validTypes.join(", ")}` }, { status: 400 });
    }

    const response = await unipileClient.request.send({
      method: "GET",
      path: ["linkedin", "search", "parameters"],
      parameters: {
        account_id: sessionRes.data.unipile_account_id,
        type,
        keywords,
        limit: String(limit),
      },
      options: { validateRequestPayload: false },
    }) as { items?: Array<{ id: string; title: string }> };

    const items = (response.items ?? []).map((item) => ({
      id: item.id,
      title: item.title,
    }));

    console.log(`[search-params] type=${type} keywords="${keywords}" → ${items.length} résultat(s)`, items.map(i => `${i.id}:${i.title}`).join(", "));

    return NextResponse.json({ items });
  } catch (err) {
    const unipileBody = (err as { body?: unknown })?.body;
    const unipileStatus = (err as { status?: number })?.status;
    let unipileMsg: string | null = null;
    if (unipileBody instanceof Blob) {
      try {
        const text = await unipileBody.text();
        try {
          const parsed = JSON.parse(text) as { message?: string; detail?: string; type?: string };
          unipileMsg = parsed.message ?? parsed.detail ?? parsed.type ?? text.substring(0, 500);
        } catch {
          unipileMsg = text.substring(0, 500);
        }
      } catch {
        unipileMsg = "[Blob non lisible]";
      }
    } else if (typeof unipileBody === "object" && unipileBody !== null) {
      if ("message" in unipileBody) unipileMsg = String((unipileBody as { message?: string }).message);
      else if ("type" in unipileBody) unipileMsg = String((unipileBody as { type?: string }).type);
    }

    console.error("[search-params] Erreur:", err);
    console.error("[search-params] Unipile status:", unipileStatus, "body:", unipileMsg ?? JSON.stringify(unipileBody));

    // Si le compte Unipile n'existe plus, marquer la session comme déconnectée
    if (unipileMsg?.includes("resource_not_found")) {
      try {
        const supabase = await createServerSupabaseClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from("linkedin_sessions").update({
            status: "disconnected",
            unipile_account_id: null,
            updated_at: new Date().toISOString(),
          }).eq("user_id", user.id);
        }
      } catch (e) {
        console.error("[search-params] Erreur mise à jour session:", e);
      }

      return NextResponse.json(
        {
          items: [],
          error: "Votre session LinkedIn a expiré. Veuillez vous reconnecter depuis la page LinkedIn.",
          expired: true,
        },
        { status: 401 }
      );
    }

    const message = err instanceof Error ? err.message : "Erreur inconnue";
    const detail = unipileMsg ? `${message} (Unipile: ${unipileMsg})` : message;

    return NextResponse.json(
      {
        items: [],
        error: detail,
        unipileStatus: unipileStatus ?? null,
        unipileMessage: unipileMsg,
      },
      { status: 200 }
    );
  }
}
