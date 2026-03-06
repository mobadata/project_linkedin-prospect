import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";

/**
 * Retourne le statut de la file d'attente pour l'utilisateur connecté.
 */
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const { data: items } = await supabase
      .from("invitation_queue")
      .select("id, prospect_id, status, error_message, created_at, processed_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);

    const prospectIds = [...new Set((items ?? []).map((i) => i.prospect_id))];
    const { data: prospects } =
      prospectIds.length > 0
        ? await supabase.from("prospects").select("id, full_name").in("id", prospectIds)
        : { data: [] };

    const prospectMap = new Map((prospects ?? []).map((p) => [p.id, p.full_name]));

    const pending = items?.filter((i) => i.status === "pending") ?? [];
    const sent = items?.filter((i) => i.status === "sent") ?? [];
    const failed = items?.filter((i) => i.status === "failed") ?? [];
    const skipped = items?.filter((i) => i.status === "skipped") ?? [];

    const recent = (items?.slice(0, 20) ?? []).map((i) => ({
      ...i,
      full_name: prospectMap.get(i.prospect_id) ?? "—",
    }));

    return NextResponse.json({
      pending: pending.length,
      sent: sent.length,
      failed: failed.length,
      skipped: skipped.length,
      total: items?.length ?? 0,
      running: pending.length > 0,
      recent,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
