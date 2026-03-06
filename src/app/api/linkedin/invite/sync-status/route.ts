import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";
import { unipileClient, isUnipileConfigured } from "@/src/lib/unipile/client";

export const maxDuration = 60;

function extractIdentifierFromUrl(linkedinUrl: string): string {
  const match = linkedinUrl?.match(/linkedin\.com\/in\/([^/?]+)/);
  return match ? match[1] : linkedinUrl;
}

/**
 * Synchronise automatiquement le statut des prospects "invited" : si une invitation
 * a été acceptée (présence dans les relations LinkedIn), le prospect passe à "connected".
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

    if (!isUnipileConfigured()) {
      return NextResponse.json({ success: true, updated: 0 });
    }

    const sessionRes = await supabase
      .from("linkedin_sessions")
      .select("unipile_account_id")
      .eq("user_id", user.id)
      .eq("status", "connected")
      .single();

    if (
      sessionRes.error ||
      !sessionRes.data?.unipile_account_id
    ) {
      return NextResponse.json({
        success: true,
        updated: 0,
        message: "Pas de session LinkedIn connectée",
      });
    }

    const { data: invitedProspects } = await supabase
      .from("prospects")
      .select("id, linkedin_url")
      .eq("user_id", user.id)
      .eq("status", "invited")
      .not("linkedin_url", "is", null);

    if (!invitedProspects?.length) {
      return NextResponse.json({
        success: true,
        updated: 0,
      });
    }

    const slugToProspect = new Map<string | null, string>();
    for (const p of invitedProspects) {
      const slug = p.linkedin_url
        ? extractIdentifierFromUrl(p.linkedin_url).toLowerCase()
        : null;
      if (slug) slugToProspect.set(slug, p.id);
    }

    const accountId = sessionRes.data.unipile_account_id;
    const connectedSlugs = new Set<string>();
    let cursor: string | null = null;

    for (let page = 0; page < 10; page++) {
      const relationsRes = await unipileClient.users.getAllRelations({
        account_id: accountId,
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });

      const items = (relationsRes as { items?: Array<{ public_identifier?: string }> }).items ?? [];
      for (const r of items) {
        const slug = (r.public_identifier ?? "").toLowerCase();
        if (slug) connectedSlugs.add(slug);
      }

      cursor = (relationsRes as { cursor?: string | null }).cursor ?? null;
      if (!cursor) break;
    }

    let updated = 0;
    for (const slug of connectedSlugs) {
      const prospectId = slugToProspect.get(slug);
      if (!prospectId) continue;

      const { error } = await supabase
        .from("prospects")
        .update({ status: "connected" })
        .eq("id", prospectId)
        .eq("user_id", user.id);

      if (!error) updated++;
    }

    return NextResponse.json({
      success: true,
      updated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    console.warn("[sync-status]", message);
    return NextResponse.json({ success: true, updated: 0 });
  }
}
