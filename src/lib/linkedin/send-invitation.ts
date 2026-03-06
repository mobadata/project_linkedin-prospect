/**
 * Logique partagée pour envoyer une invitation LinkedIn.
 * Utilisée par l'API invite (frontend) et l'API campaign/process (cron).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { unipileClient, isUnipileConfigured } from "@/src/lib/unipile/client";
import { getDailyLimit } from "@/src/lib/linkedin/warmup";

function extractIdentifierFromUrl(linkedinUrl: string): string {
  const match = linkedinUrl?.match(/linkedin\.com\/in\/([^/?]+)/);
  return match ? match[1] : linkedinUrl;
}

export interface SendInvitationResult {
  success: boolean;
  message?: string;
  alreadyConnected?: boolean;
  accountRestricted?: boolean;
  error?: string;
}

export async function sendInvitationForProspect(
  supabase: SupabaseClient,
  userId: string,
  prospectId: string
): Promise<SendInvitationResult> {
  if (!isUnipileConfigured()) {
    return { success: false, error: "Unipile non configuré" };
  }

  const sessionRes = await supabase
    .from("linkedin_sessions")
    .select("unipile_account_id, status, account_restricted, first_invitation_at")
    .eq("user_id", userId)
    .single();

  if (
    sessionRes.error ||
    !sessionRes.data?.unipile_account_id ||
    sessionRes.data.status !== "connected"
  ) {
    return { success: false, error: "Session LinkedIn non connectée" };
  }

  if (sessionRes.data.account_restricted) {
    return { success: false, accountRestricted: true, error: "Compte LinkedIn restreint" };
  }

  const { data: prospect, error: prospectError } = await supabase
    .from("prospects")
    .select("id, user_id, full_name, linkedin_url, status")
    .eq("id", prospectId)
    .eq("user_id", userId)
    .single();

  if (prospectError || !prospect) {
    return { success: false, error: "Prospect introuvable" };
  }

  if (prospect.status !== "new" && prospect.status !== "invited") {
    return { success: false, error: `Prospect déjà traité (statut: ${prospect.status})` };
  }

  const wasNew = prospect.status === "new";

  if (wasNew) {
    const today = new Date().toISOString().slice(0, 10);
    const limit =
      Number(process.env.INVITATION_DAILY_LIMIT) ||
      getDailyLimit(sessionRes.data.first_invitation_at ?? null);
    const { data: invitedToday, error: countError } = await supabase
      .from("prospects")
      .select("id")
      .eq("user_id", userId)
      .not("invited_at", "is", null)
      .gte("invited_at", `${today}T00:00:00Z`)
      .lte("invited_at", `${today}T23:59:59.999Z`);

    if (countError) {
      return { success: false, error: "Erreur lecture limite" };
    }
    if ((invitedToday?.length ?? 0) >= limit) {
      return { success: false, error: `Limite quotidienne atteinte (${limit}/jour)` };
    }
  }

  if (!prospect.linkedin_url?.trim()) {
    return { success: false, error: "Prospect sans URL LinkedIn" };
  }

  const identifier = extractIdentifierFromUrl(prospect.linkedin_url.trim());
  const accountId = sessionRes.data.unipile_account_id;

  if (prospect.status === "invited") {
    let found = false;
    const slug = identifier.toLowerCase();

    try {
      let cursor: string | null = null;
      for (let page = 0; page < 5; page++) {
        const relationsRes = await unipileClient.users.getAllRelations({
          account_id: accountId,
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });

        const items =
          (relationsRes as { items?: Array<{ public_identifier?: string }> }).items ?? [];
        found = items.some((r) => (r.public_identifier ?? "").toLowerCase() === slug);
        if (found) break;

        cursor = (relationsRes as { cursor?: string | null }).cursor ?? null;
        if (!cursor) break;
      }
    } catch {
      // En cas d'erreur API, considérer comme en attente
    }

    if (found) {
      await supabase
        .from("prospects")
        .update({ status: "connected" })
        .eq("id", prospect.id)
        .eq("user_id", userId);

      return { success: true, message: "Connecté", alreadyConnected: true };
    }

    return { success: true, message: "Invitation en attente", alreadyConnected: false };
  }

  try {
    const profile = (await unipileClient.users.getProfile({
      account_id: accountId,
      identifier,
    })) as { provider_id?: string };

    const providerId = profile.provider_id;
    if (!providerId) {
      return { success: false, error: "Impossible de récupérer l'identifiant du profil" };
    }

    await unipileClient.users.sendInvitation({
      account_id: accountId,
      provider_id: providerId,
      message: "",
    });

    const invitedAt = new Date().toISOString();
    await supabase
      .from("prospects")
      .update({ status: "invited", invited_at: invitedAt })
      .eq("id", prospect.id)
      .eq("user_id", userId);

    if (!sessionRes.data.first_invitation_at) {
      await supabase
        .from("linkedin_sessions")
        .update({ first_invitation_at: invitedAt })
        .eq("user_id", userId);
    }

    return {
      success: true,
      message: "Invitation envoyée",
      alreadyConnected: false,
    };
  } catch (inviteErr) {
    const err = inviteErr as { body?: { type?: string; status?: number } };
    const errorType = err?.body?.type;
    if (
      errorType === "errors/disconnected_account" ||
      err?.body?.status === 403
    ) {
      await supabase
        .from("linkedin_sessions")
        .update({ account_restricted: true })
        .eq("user_id", userId);
      return {
        success: false,
        accountRestricted: true,
        error: "Compte LinkedIn restreint",
      };
    }
    const msg = inviteErr instanceof Error ? inviteErr.message : "Erreur inconnue";
    return { success: false, error: msg };
  }
}
