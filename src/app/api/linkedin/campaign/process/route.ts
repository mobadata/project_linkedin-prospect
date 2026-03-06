import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/src/lib/supabase/admin";
import { sendInvitationForProspect } from "@/src/lib/linkedin/send-invitation";

export const maxDuration = 60;

/**
 * Traite une invitation en attente dans la file.
 * Appelé par Vercel Cron toutes les 5 min (voir vercel.json).
 *
 * Vercel envoie automatiquement CRON_SECRET dans le header Authorization: Bearer <secret>.
 * En local ou cron externe : header x-cron-secret: VOTRE_SECRET
 */
export async function GET(request: Request) {
  try {
    const authHeader =
      request.headers.get("x-cron-secret") ??
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const secret = process.env.CRON_SECRET ?? "dev";

    if (authHeader !== secret) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }

    const supabase = createSupabaseAdmin();

    const { data: allPending } = await supabase
      .from("invitation_queue")
      .select("id, user_id, prospect_id")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(50);

    let pausedSet = new Set<string>();
    try {
      const { data: pausedUsers } = await supabase
        .from("campaign_paused")
        .select("user_id")
        .eq("paused", true);
      pausedSet = new Set((pausedUsers ?? []).map((p) => p.user_id));
    } catch {
      // Table campaign_paused peut ne pas exister
    }
    const item = (allPending ?? []).find((i) => !pausedSet.has(i.user_id));

    if (!item) {
      return NextResponse.json({
        processed: false,
        message: pausedSet.size > 0 ? "Campagnes en pause" : "Aucune invitation en attente",
      });
    }

    await supabase
      .from("invitation_queue")
      .update({ status: "processing" })
      .eq("id", item.id);

    const result = await sendInvitationForProspect(
      supabase,
      item.user_id,
      item.prospect_id
    );

    const processedAt = new Date().toISOString();

    if (result.success) {
      if (result.alreadyConnected) {
        await supabase
          .from("invitation_queue")
          .update({ status: "skipped", processed_at: processedAt, error_message: "Déjà connecté" })
          .eq("id", item.id);
      } else {
        await supabase
          .from("invitation_queue")
          .update({ status: "sent", processed_at: processedAt })
          .eq("id", item.id);
      }
    } else {
      const status = result.accountRestricted ? "failed" : "failed";
      await supabase
        .from("invitation_queue")
        .update({
          status,
          processed_at: processedAt,
          error_message: result.error ?? undefined,
        })
        .eq("id", item.id);

      if (result.accountRestricted) {
        return NextResponse.json({
          processed: true,
          success: false,
          accountRestricted: true,
          message: result.error,
        });
      }
    }

    return NextResponse.json({
      processed: true,
      success: result.success,
      message: result.message ?? result.error,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
