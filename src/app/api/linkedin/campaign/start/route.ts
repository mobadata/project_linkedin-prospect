import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";

/**
 * Lance une campagne d'invitations en arrière-plan.
 * Ajoute tous les prospects "new" à la file d'attente.
 * La campagne continue même si l'utilisateur quitte la page.
 * Configurez un cron (ex: */5 * * * *) sur /api/linkedin/campaign/process
 */
export async function POST() {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const { data: prospects } = await supabase
      .from("prospects")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "new")
      .not("linkedin_url", "is", null);

    if (!prospects?.length) {
      return NextResponse.json({
        success: true,
        queued: 0,
        message: "Aucun prospect « new » à inviter.",
      });
    }

    const rows = prospects.map((p) => ({
      user_id: user.id,
      prospect_id: p.id,
      status: "pending",
    }));

    const { error } = await supabase.from("invitation_queue").insert(rows);

    if (error) {
      return NextResponse.json(
        { error: "Erreur création file: " + error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      queued: rows.length,
      message: `Campagne lancée. ${rows.length} invitation(s) en file d'attente. Elles seront envoyées en arrière-plan (toutes les 5 min).`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
