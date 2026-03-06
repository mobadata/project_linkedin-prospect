import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";

/**
 * Arrête la campagne en arrière-plan en supprimant les invitations en attente.
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

    const { data, error } = await supabase
      .from("invitation_queue")
      .delete()
      .eq("user_id", user.id)
      .eq("status", "pending")
      .select("id");

    if (error) {
      return NextResponse.json(
        { error: "Erreur: " + error.message },
        { status: 500 }
      );
    }

    const cancelled = data?.length ?? 0;

    return NextResponse.json({
      success: true,
      cancelled,
      message: cancelled > 0
        ? `${cancelled} invitation(s) annulée(s). Campagne arrêtée.`
        : "Aucune invitation en attente.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
