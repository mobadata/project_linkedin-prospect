import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";

/**
 * Met en pause ou reprend la campagne en arrière-plan.
 * Body: { paused: boolean }
 */
export async function POST(request: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const paused = Boolean(body.paused);

    const { error } = await supabase
      .from("campaign_paused")
      .upsert(
        { user_id: user.id, paused, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );

    if (error) {
      return NextResponse.json(
        { error: "Erreur: " + error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      paused,
      message: paused ? "Campagne mise en pause" : "Campagne reprise",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
