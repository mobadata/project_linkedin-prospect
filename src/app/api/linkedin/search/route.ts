import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";
import { unipileClient, isUnipileConfigured } from "@/src/lib/unipile/client";

export const maxDuration = 180;

interface UnipilePeopleItem {
  type?: string;
  id?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  member_urn?: string;
  public_identifier?: string;
  public_profile_url?: string;
  profile_url?: string;
  profile_picture_url?: string;
  headline?: string;
  location?: string;
  industry?: string;
  current_positions?: Array<{ role?: string; company?: string; description?: string }>;
}

interface ProspectResult {
  full_name: string;
  job_title: string;
  company: string;
  linkedin_url: string;
  profile_photo: string | null;
  headline?: string;
  sectorMatch?: boolean;
  matchedTerms?: string[];
}

const TOP_SECTOR_COMPANIES: Record<string, string[]> = {
  "objet publicitaire": [
    "goodies", "objets promotionnels", "cadeaux entreprise",
    "marquage publicitaire", "textile promotionnel",
  ],
  "sante": ["hôpital", "pharmaceutique", "medical", "clinique", "biotech"],
  "santé": ["hôpital", "pharmaceutique", "medical", "clinique", "biotech"],
  "immobilier": ["agence immobilière", "promoteur immobilier", "foncier"],
  "finance": ["banque", "assurance", "fintech", "investissement"],
  "audiovisuel": ["production audiovisuelle", "cinéma", "post-production"],
  "tech": ["startup", "SaaS", "logiciel", "informatique"],
};

const INDUSTRY_TO_SECTOR: Record<string, string[]> = {
  "services de publicité": ["objet publicitaire", "publicité", "publicitaire"],
  "services de publicite": ["objet publicitaire", "publicité", "publicitaire"],
  "agriculture": ["agriculture", "agricole", "agroalimentaire"],
  "santé": ["santé", "médical", "healthcare"],
  "sante": ["santé", "médical", "healthcare"],
  "immobilier": ["immobilier", "real estate"],
  "finance": ["finance", "banque"],
  "technologies": ["tech", "informatique", "software"],
};

const TITLE_EQUIVALENCES: Record<string, string[]> = {
  "responsable": [
    "responsable", "directeur", "directrice", "manager", "chef",
    "cheffe", "head", "lead", "gérant", "gérante", "dirigeant",
    "dirigeante", "CEO", "fondateur", "fondatrice", "président",
    "présidente", "agent", "chargé", "chargée", "expert", "experte",
    "spécialiste", "coordinateur", "coordinatrice", "superviseur",
  ],
  "commercial": [
    "commercial", "commerciale", "commerciaux", "vente", "ventes",
    "sales", "business", "clientèle", "clients", "développement",
    "affaires", "account",
  ],
  "directeur": [
    "directeur", "directrice", "responsable", "manager", "head",
    "chef", "cheffe", "lead",
  ],
};

const AUTO_SECTOR_MAP: Record<string, string[]> = {
  "batiment": [
    "bâtiment", "batiment", "BTP", "construction", "chantier", "travaux",
    "rénovation", "plombier", "plomberie", "électricien", "electricien",
    "chauffagiste", "maçon", "macon", "carreleur", "peintre", "menuisier",
    "couvreur", "charpentier", "artisan", "installateur", "dépanneur", "maintenance",
  ],
  "services relatifs aux batiments": [
    "bâtiment", "batiment", "BTP", "construction", "chantier", "travaux",
    "rénovation", "plombier", "plomberie", "électricien", "chauffagiste", "artisan",
    "installateur", "maintenance", "entretien",
  ],
  "agriculture": [
    "agriculture", "agricole", "ferme", "élevage", "exploitation", "coopérative",
    "semence", "récolte", "tracteur", "agronomie", "agroalimentaire", "viticulteur", "viticole",
  ],
  "technologie": [
    "informatique", "développeur", "software", "tech", "startup", "SaaS", "cloud", "data", "digital", "numérique",
  ],
  "technologies et services de l'information": [
    "informatique", "développeur", "software", "tech", "IT", "SaaS", "cloud",
    "data", "digital", "numérique", "cybersécurité",
  ],
  "sante": [
    "médical", "hôpital", "clinique", "pharma", "santé", "healthcare", "biotech", "medtech", "infirmier", "médecin",
  ],
  "hopitaux et soins de sante": [
    "hôpital", "clinique", "santé", "médical", "soins", "patient", "infirmier", "médecin", "CHU",
  ],
  "immobilier": [
    "immobilier", "agence immobilière", "promoteur", "foncier", "logement", "construction", "transaction",
  ],
  "services financiers": [
    "banque", "finance", "assurance", "crédit", "investissement", "épargne", "patrimoine", "fintech",
  ],
  "enseignement": [
    "école", "université", "formation", "éducation", "enseignant", "professeur", "pédagogique", "campus",
  ],
  "enseignement superieur": [
    "université", "école", "campus", "master", "licence", "formation", "enseignant", "recherche",
  ],
  "transport": [
    "transport", "logistique", "livraison", "routier", "chauffeur", "fret", "expédition", "supply chain",
  ],
  "automobile": [
    "automobile", "voiture", "véhicule", "garage", "concessionnaire", "mécanique", "carrosserie", "auto",
  ],
  "restaurants": [
    "restaurant", "restauration", "chef", "cuisine", "traiteur", "hôtellerie", "brasserie", "gastronomie",
  ],
  "hotellerie": [
    "hôtel", "hôtellerie", "hébergement", "tourisme", "resort", "réception", "concierge",
  ],
  "vente au detail": [
    "commerce", "magasin", "boutique", "retail", "vente", "vendeur", "caissier", "enseigne",
  ],
  "industrie": [
    "usine", "production", "manufacture", "industriel", "fabrication", "atelier", "opérateur", "ingénieur production",
  ],
  "petrole et energie": [
    "énergie", "pétrole", "gaz", "électricité", "renouvelable", "solaire", "éolien", "nucléaire",
  ],
  "cabinets d'avocats": [
    "avocat", "juridique", "droit", "cabinet", "contentieux", "juriste", "notaire",
  ],
};

function generateAutoSynonyms(sectorQuery: string): string[] {
  const normalize = (str: string) =>
    str?.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") || "";

  const query = normalize(sectorQuery);
  const synonyms: string[] = [];

  for (const [key, syns] of Object.entries(AUTO_SECTOR_MAP)) {
    const keyNorm = normalize(key);
    if (query === keyNorm || keyNorm.split(/\s+/).some(w => w === query) || query.split(/\s+/).some(w => w === keyNorm)) {
      synonyms.push(...syns);
    }
  }

  if (synonyms.length === 0) {
    const stopWords = ["services", "relatifs", "autres", "divers"];
    const words = query.split(/\s+/).filter(
      (w) => w.length > 3 && !stopWords.includes(w)
    );
    synonyms.push(...words);
  }

  return [...new Set(synonyms)];
}

function getSectorVariants(sectorQuery: string | null): string[] {
  if (!sectorQuery) return [];
  const normalize = (str: string) =>
    str?.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") || "";
  const normalizedSector = normalize(sectorQuery);

  let variants =
    Object.entries(TOP_SECTOR_COMPANIES).find(
      ([key]) =>
        normalize(key) === normalizedSector ||
        normalizedSector.includes(normalize(key)) ||
        normalize(key).includes(normalizedSector)
    )?.[1] ?? [];

  if (variants.length === 0) {
    const relatedSectors =
      Object.entries(INDUSTRY_TO_SECTOR).find(
        ([key]) => normalize(key) === normalizedSector
      )?.[1] ?? [];

    for (const sector of relatedSectors) {
      const found =
        Object.entries(TOP_SECTOR_COMPANIES).find(
          ([key]) => normalize(key) === normalize(sector)
        )?.[1] ?? [];
      variants.push(...found);
    }
  }

  if (variants.length === 0) {
    const autoSyns = generateAutoSynonyms(sectorQuery);
    variants.push(...autoSyns);
  }

  return [...new Set(variants)];
}

function generateGenderVariants(title: string): string[] {
  const t = title.trim();
  if (!t) return [""];
  const variants = new Set<string>();
  variants.add(t);

  const rules: [RegExp, string][] = [
    [/ale\b/gi, "al"],
    [/al\b/gi, "ale"],
    [/ales\b/gi, "aux"],
    [/aux\b/gi, "ales"],
    [/iale\b/gi, "ial"],
    [/ial\b/gi, "iale"],
    [/eur\b/gi, "euse"],
    [/euse\b/gi, "eur"],
    [/teur\b/gi, "trice"],
    [/trice\b/gi, "teur"],
    [/ier\b/gi, "ière"],
    [/ière\b/gi, "ier"],
    [/é\b/gi, "ée"],
    [/ée\b/gi, "é"],
  ];

  for (const [pattern, replacement] of rules) {
    const variant = t.replace(pattern, replacement);
    if (variant !== t) variants.add(variant);
  }

  variants.add(t.replace(/\b(\w{4,})s\b/g, "$1"));

  return [...variants].filter(v => v.length >= 3);
}

function generateSearchQueries(
  jobTitle: string,
  sectorQuery: string | null,
  sectorVariants: string[],
  hasIndustryIds: boolean = false
): string[] {
  const queries: string[] = [];
  const titleVariants = jobTitle?.trim()
    ? generateGenderVariants(jobTitle.trim())
    : [""];

  // Collecter TOUS les synonymes du secteur
  const allSectorTerms: string[] = [];
  if (sectorQuery) {
    // Les phrases longues donnent de mauvais resultats sur LinkedIn
    const sectorWords = sectorQuery.split(/\s+/);
    const stopWords = ["de", "des", "du", "et", "les", "la", "le", "un", "une", "aux", "en", "par", "pour", "sur", "dans"];
    if (sectorWords.length <= 3) {
      allSectorTerms.push(sectorQuery);
    } else {
      // Splitter en mots significatifs > 4 chars
      const significantWords = sectorWords.filter(w => w.length > 4 && !stopWords.includes(w.toLowerCase()));
      allSectorTerms.push(...significantWords);
    }
    allSectorTerms.push(...sectorVariants);

    const normalize = (str: string) =>
      str?.toLowerCase().normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") || "";
    const normalizedQuery = normalize(sectorQuery);

    for (const [key, syns] of Object.entries(SECTOR_SYNONYMS)) {
      const keyNorm = normalize(key);
      if (normalizedQuery === keyNorm || keyNorm.split(/\s+/).some(w => w === normalizedQuery) || normalizedQuery.split(/\s+/).some(w => w === keyNorm)) {
        const multiWord = syns.filter((s) => s.includes(" "));
        const singleWord = syns.filter((s) => !s.includes(" ") && s.length > 5);
        allSectorTerms.push(...multiWord);
        allSectorTerms.push(...singleWord);
      }
    }

    allSectorTerms.push(
      ...generateAutoSynonyms(sectorQuery).filter((s) => s.length > 5)
    );
  }

  const uniqueSectorTerms = [...new Set(allSectorTerms)].slice(0, 15);

  if (hasIndustryIds) {
    // Mode A : industryIds résolus — keywords = titre uniquement.
    // LinkedIn filtre le secteur via ses IDs natifs.
    for (const title of titleVariants.slice(0, 3)) {
      if (title) queries.push(title);
    }
  } else if (titleVariants[0] && uniqueSectorTerms.length > 0) {
    // Mode B : pas d'industryIds — mélange titre + secteur dans keywords
    for (const sectorTerm of uniqueSectorTerms) {
      for (const title of titleVariants.slice(0, 2)) {
        queries.push(`${title} ${sectorTerm}`.trim());
      }
    }
    for (const title of titleVariants.slice(0, 2)) {
      queries.push(title);
    }
  } else if (titleVariants[0]) {
    for (const title of titleVariants.slice(0, 3)) {
      if (title) queries.push(title);
    }
  } else if (uniqueSectorTerms.length > 0) {
    for (const term of uniqueSectorTerms.slice(0, 8)) {
      queries.push(term);
    }
  }

  return [...new Set(queries.filter(Boolean))].slice(0, 20);
}

const SECTOR_SYNONYMS: Record<string, string[]> = {
  "objet publicitaire": [
    "goodies", "merchandising", "cadeau entreprise", "cadeaux entreprise",
    "objet promotionnel", "objets promotionnels", "textile promotionnel",
    "marquage", "sérigraphie", "personnalisation objet", "flocage",
    "broderie", "kakemono", "markitems", "mark items",
    "corporate gifts", "business gifts", "impression textile",
    "stand", "roll-up", "bâche", "bache",
    "objet publicitaire", "objets publicitaires",
    "cadeau publicitaire", "cadeaux publicitaires",
    "goodicom", "gift", "gifts",
  ],
  "santé": [
    "médical", "hôpital", "clinique", "pharma", "biotech", "CHU", "healthcare",
    "medtech", "santé", "dentaire", "laboratoire", "health", "medical",
  ],
  "immobilier": [
    "immobilier", "real estate", "promoteur", "foncier", "logement",
    "construction", "agence immobilière",
  ],
  "publicité": [
    "advertising", "publicité", "publicitaire", "agence de publicité",
    "régie publicitaire", "affichage",
    "DOOH", "OOH", "annonceur",
  ],
  "publicitaire": [
    "advertising", "publicitaire", "promotionnel", "goodies", "merchandising",
    "markitems", "marquage", "cadeau", "premium",
  ],
  "services de publicité": [
    "advertising", "publicité", "publicitaire", "goodies",
    "merchandising", "promotionnel", "marquage", "personnalisation",
    "signalétique", "markitems", "régie publicitaire", "affichage",
    "DOOH", "OOH", "agence de publicité", "annonceur",
  ],
  "objets publicitaires": [
    "goodies", "merchandising", "cadeau entreprise", "cadeaux entreprise",
    "objet promotionnel", "objets promotionnels", "textile promotionnel",
    "marquage", "sérigraphie", "personnalisation objet", "flocage",
    "broderie", "kakemono", "markitems", "mark items",
    "corporate gifts", "business gifts", "impression textile",
    "stand", "roll-up", "bâche", "bache",
    "objet publicitaire", "objets publicitaires",
    "cadeau publicitaire", "cadeaux publicitaires",
    "goodicom", "gift", "gifts",
  ],
};

function matchWholeWord(text: string, word: string): boolean {
  if (!word) return false;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    `(^|[\\s,;.|/()\\-])${escaped}([\\s,;.|/()\\-]|$)`,
    "i"
  );
  return regex.test(text);
}

function termMatchesText(text: string, term: string): boolean {
  if (!term || term.length < 2) return false;

  const variants = new Set<string>();
  variants.add(term);
  variants.add(term.replace(/s$/, ""));
  variants.add(term + "s");
  variants.add(term + "e");
  variants.add(term + "es");
  variants.add(term.replace(/e$/, ""));
  variants.add(term.replace(/es$/, ""));

  for (const variant of variants) {
    if (variant.length < 2) continue;
    if (matchWholeWord(text, variant)) return true;
  }
  return false;
}

function termMatchesTextLoose(text: string, term: string): boolean {
  if (!term || term.length < 4) return false;
  const variants = new Set<string>();
  variants.add(term);
  variants.add(term.replace(/s$/, ""));
  variants.add(term + "s");
  variants.add(term.replace(/e$/, ""));
  variants.add(term.replace(/es$/, ""));

  for (const variant of variants) {
    if (variant.length < 4) continue;
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(^|[\\s,;.|/()\\-])${escaped}`, "i");
    if (regex.test(text)) return true;
  }
  return false;
}

function matchesTitle(prospect: ProspectResult, jobTitle: string): boolean {
  if (!jobTitle?.trim()) return true;

  const normalize = (str: string) =>
    str?.toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[-_]/g, " ") || "";

  const prospectText = normalize(
    [prospect.job_title, prospect.headline, prospect.company]
      .filter(Boolean).join(" ")
  );

  const titleWords = normalize(jobTitle)
    .split(/\s+/)
    .filter((w) => w.length > 2);

  if (titleWords.length === 0) return true;

  const matchCount = titleWords.filter((word) => {
    // 1. Match direct (avec variantes genre)
    const variants = new Set<string>();
    variants.add(word);
    variants.add(word.replace(/s$/, ""));
    variants.add(word + "s");
    variants.add(word + "e");
    variants.add(word + "es");
    variants.add(word.replace(/e$/, ""));
    variants.add(word.replace(/es$/, ""));

    for (const variant of variants) {
      if (variant.length < 3) continue;
      if (matchWholeWord(prospectText, variant)) return true;
    }

    // 2. Match par équivalence
    // Chercher les équivalences pour le mot ET ses variantes
    let equivalences: string[] = [];
    const lookupVariants = [
      word,
      word.replace(/s$/, ""),
      word.replace(/e$/, ""),
      word.replace(/es$/, ""),
      word.replace(/aux$/, "al"),
      word.replace(/trice$/, "teur"),
      word.replace(/euse$/, "eur"),
    ];
    for (const variant of lookupVariants) {
      if (TITLE_EQUIVALENCES[variant]) {
        equivalences = TITLE_EQUIVALENCES[variant];
        break;
      }
    }
    for (const equiv of equivalences) {
      const equivNorm = normalize(equiv);
      if (equivNorm.length > 6) {
        if (prospectText.includes(equivNorm)) return true;
      } else {
        if (matchWholeWord(prospectText, equivNorm)) return true;
      }
    }

    return false;
  }).length;

  const threshold =
    titleWords.length <= 2
      ? titleWords.length
      : Math.ceil(titleWords.length * 0.6);

  return matchCount >= threshold;
}

function matchesSectorStrict(
  prospect: ProspectResult,
  sectorQuery: string
): { matches: boolean; matchedTerms: string[] } {
  if (!sectorQuery?.trim()) return { matches: true, matchedTerms: [] };

  const normalize = (str: string) =>
    str?.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") || "";

  const prospectText = normalize(
    [prospect.headline, prospect.company, prospect.job_title].filter(Boolean).join(" ")
  );

  const sectorWords = normalize(sectorQuery)
    .split(/\s+/)
    .filter((w) => w.length > 3);

  const directMatch = sectorWords.filter((w) => termMatchesText(prospectText, w));

  const normalizedQuery = normalize(sectorQuery);
  let synonyms: string[] = [];
  for (const [key, syns] of Object.entries(SECTOR_SYNONYMS)) {
    const keyNorm = normalize(key);
    if (normalizedQuery === keyNorm || keyNorm.split(/\s+/).some(w => w === normalizedQuery) || normalizedQuery.split(/\s+/).some(w => w === keyNorm)) {
      synonyms.push(...syns.filter((s) => normalize(s).length >= 4));
    }
  }

  const relatedSectors =
    Object.entries(INDUSTRY_TO_SECTOR).find(
      ([key]) => normalize(key) === normalizedQuery
    )?.[1] ?? [];

  for (const relatedSector of relatedSectors) {
    for (const [key, syns] of Object.entries(SECTOR_SYNONYMS)) {
      if (normalize(key) === normalize(relatedSector)) {
        synonyms.push(...syns.filter((s) => normalize(s).length >= 4));
      }
    }
  }
  synonyms = [...new Set(synonyms)];

  const synonymMatch = synonyms.filter((s) =>
    termMatchesText(prospectText, normalize(s))
  );

  const autoSynonyms = generateAutoSynonyms(sectorQuery);
  const autoMatch = autoSynonyms.filter((s) =>
    termMatchesText(prospectText, normalize(s))
  );

  const allMatched = [...new Set([...directMatch, ...synonymMatch, ...autoMatch])];
  const hasDirectMatch = directMatch.length > 0;

  // Prefix matching loose : "design" matche "Designer", "marketing" matche "Marketeur", etc.
  const looseDirectMatch = sectorWords.filter((w) => termMatchesTextLoose(prospectText, w));
  const looseSynonymMatch = synonyms.filter((s) => termMatchesTextLoose(prospectText, normalize(s)));
  const allLoose = [...new Set([...looseDirectMatch, ...looseSynonymMatch])];

  return {
    matches: hasDirectMatch || allMatched.length >= 2 || allLoose.length > 0,
    matchedTerms: [...new Set([...allMatched, ...allLoose])],
  };
}

function filterProspectStrict(
  prospect: ProspectResult,
  jobTitle: string,
  sectorQuery: string | null
): {
  passes: boolean;
  titleMatch: boolean;
  sectorMatch: boolean;
  matchedTerms: string[];
} {
  const titleMatch = matchesTitle(prospect, jobTitle);
  const sectorResult = sectorQuery
    ? matchesSectorStrict(prospect, sectorQuery)
    : { matches: true, matchedTerms: [] as string[] };

  return {
    passes: titleMatch && sectorResult.matches,
    titleMatch,
    sectorMatch: sectorResult.matches,
    matchedTerms: sectorResult.matchedTerms,
  };
}

function extractSlugFromProfileUrl(url: string): string {
  const match = url?.match(/linkedin\.com\/in\/([^/?]+)/);
  return match ? match[1] : "";
}

function toProspectResult(item: UnipilePeopleItem): ProspectResult | null {
  const name = item.name ?? ([item.first_name, item.last_name].filter(Boolean).join(" ") || "Inconnu");
  const profileUrl = (item.public_profile_url ?? item.profile_url) ?? "";
  const slug = extractSlugFromProfileUrl(profileUrl);
  const linkedinUrl = slug ? `https://www.linkedin.com/in/${slug}/` : profileUrl;
  if (!linkedinUrl) return null;

  let jobTitle = "";
  let company = "";
  if (item.current_positions?.[0]) {
    jobTitle = item.current_positions[0].role ?? "";
    company = item.current_positions[0].company ?? "";
  }
  if (!jobTitle && item.headline) {
    const parts = item.headline.split(/\s*[·•@]\s*/);
    jobTitle = parts[0]?.trim() ?? "";
    company = parts[1]?.trim() ?? "";
  }

  if (!company && jobTitle) {
    const chezMatch = jobTitle.match(/chez\s+(.+)$/i);
    if (chezMatch) {
      company = chezMatch[1].trim();
      jobTitle = jobTitle.replace(/\s*chez\s+.+$/i, "").trim();
    }
  }

  const desc = item.current_positions?.[0]?.description ?? "";
  const headline = [item.headline, item.industry, desc].filter(Boolean).join(" ");

  return {
    full_name: name,
    job_title: jobTitle,
    company,
    linkedin_url: linkedinUrl,
    profile_photo: item.profile_picture_url ?? null,
    headline: headline || undefined,
  };
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    if (!isUnipileConfigured()) {
      return NextResponse.json(
        { error: "Unipile non configuré (UNIPILE_API_URL, UNIPILE_ACCESS_TOKEN)" },
        { status: 500 }
      );
    }

    const sessionRes = await supabase
      .from("linkedin_sessions")
      .select("unipile_account_id, status")
      .eq("user_id", user.id)
      .single();

    if (sessionRes.error || !sessionRes.data?.unipile_account_id || sessionRes.data.status !== "connected") {
      return NextResponse.json(
        { error: "Connectez d'abord votre compte LinkedIn dans Paramètres LinkedIn." },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const jobTitle = (body.jobTitle ?? body.job_title ?? "").trim();
    const locationIds: number[] = body.locationIds ?? [];
    const industryIds: number[] = body.industryIds ?? [];
    const sectorQuery = (body.sectorQuery ?? body.sector_query ?? "").trim() || null;
    const sectorOriginalText = (body.sectorOriginalText ?? "").trim();
    const sectorForMatching = sectorOriginalText || sectorQuery;
    const hasIndustryIds = industryIds.length > 0;
    const sectorForFilter = sectorForMatching || sectorQuery;
    const sectorVariants = hasIndustryIds ? [] : getSectorVariants(sectorForMatching || sectorQuery);
    const queries = generateSearchQueries(jobTitle, sectorQuery, sectorVariants, hasIndustryIds);

    // Recherche par localisation/industrie seule : utiliser un keyword générique
    if (queries.length === 0 && (locationIds.length > 0 || industryIds.length > 0)) {
      queries.push("*");
    }

    const TARGET = 50;
    const MAX_API_CALLS = 15;
    const MAX_DURATION_MS = 150_000; // 150s max (marge de 30s avant timeout Vercel 180s)
    const searchStartTime = Date.now();
    const RESULTS_PER_PAGE = 50;
    const seenUrls = new Set<string>();
    const strictResults: ProspectResult[] = [];
    const otherResults: ProspectResult[] = [];
    let totalScraped = 0;
    let apiCallCount = 0;
    let lastUnipileError: string | null = null;

    const existing = await supabase
      .from("prospects")
      .select("linkedin_url")
      .eq("user_id", user.id);

    const existingUrls = new Set(
      (existing.data ?? []).map((p) => p.linkedin_url?.toLowerCase()).filter(Boolean)
    );

    for (const query of queries) {
      let start = 0;

      while (strictResults.length < TARGET && apiCallCount < MAX_API_CALLS && (Date.now() - searchStartTime) < MAX_DURATION_MS) {
        try {
          const searchBody: Record<string, unknown> = {
            api: "classic",
            category: "people",
            keywords: query,
          };
          if (locationIds.length > 0) searchBody.location = locationIds;
          if (industryIds.length > 0) searchBody.industry = { include: industryIds.map(String) };

          console.log(
            `[Search] "${query}" start=${start} | stricts=${strictResults.length}/${TARGET} | calls=${apiCallCount}`
          );

          apiCallCount++;
          const response = await unipileClient.request.send({
            method: "POST",
            path: ["linkedin", "search"],
            parameters: {
              account_id: sessionRes.data.unipile_account_id,
              limit: String(RESULTS_PER_PAGE),
              start: String(start),
            },
            headers: { "Content-Type": "application/json" },
            body: searchBody,
            options: { validateRequestPayload: false },
          }) as { items?: UnipilePeopleItem[] };

          const newItems = response.items ?? [];
          if (newItems.length === 0) break;

          totalScraped += newItems.length;

          const prospects: ProspectResult[] = [];
          for (const item of newItems) {
            if (item.type !== "PEOPLE") continue;
            const prospect = toProspectResult(item);
            if (!prospect) continue;
            const url = prospect.linkedin_url?.toLowerCase();
            if (!url || seenUrls.has(url) || existingUrls.has(url)) continue;
            seenUrls.add(url);
            prospects.push(prospect);
          }

          if (prospects.length === 0) {
            console.log(`[Search] 0 nouveaux résultats, passage à la requête suivante`);
            break;
          }

          if (sectorForFilter && prospects.length > 0) {
            const candidates = prospects.filter((p) => {
              const titleOk = matchesTitle(p, jobTitle);
              const sectorOk = matchesSectorStrict(p, sectorForFilter);
              return titleOk && !sectorOk.matches;
            });
            const needEnrich = candidates.slice(0, 3); // Max 3 enrichissements par page (evite timeout Vercel 180s)

            console.log(`[Enrichissement] ${candidates.length} candidats, enrichissement de ${needEnrich.length}`);

            for (const prospect of needEnrich) {
              if ((Date.now() - searchStartTime) > MAX_DURATION_MS) break;
              try {
                const slug = prospect.linkedin_url.match(/linkedin\.com\/in\/([^/?]+)/)?.[1];
                if (!slug) continue;

                const profile = (await unipileClient.users.getProfile({
                  account_id: sessionRes.data.unipile_account_id,
                  identifier: slug,
                  linkedin_sections: "*" as never,
                })) as {
                  work_experience?: Array<{ company?: string; description?: string }>;
                  current_positions?: Array<{ company?: string; description?: string }>;
                  industry?: string;
                  summary?: string;
                };

                const enrichedParts: string[] = [];
                const workExp = profile.work_experience ?? profile.current_positions ?? [];
                const currentPos = workExp[0];
                if (currentPos?.company) {
                  prospect.company = currentPos.company;
                  enrichedParts.push(currentPos.company);
                }
                if (currentPos?.description) enrichedParts.push(currentPos.description);
                if (profile.industry) enrichedParts.push(profile.industry);
                if (profile.summary) enrichedParts.push(profile.summary);

                for (const pos of workExp.slice(0, 3)) {
                  if (pos.company) enrichedParts.push(pos.company);
                  if ("description" in pos && pos.description) enrichedParts.push(pos.description);
                }

                prospect.headline = [prospect.headline, ...enrichedParts].filter(Boolean).join(" ");

                const sectorAfter = matchesSectorStrict(prospect, sectorForFilter);
                if (sectorAfter.matches) {
                  console.log(`[Enrichi+Match] ${prospect.full_name} → ${prospect.company} → ${sectorAfter.matchedTerms.join(", ")}`);
                }

                await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1000));
              } catch {
                // Continue
              }
            }
          }

          for (const prospect of prospects) {
            const result = filterProspectStrict(prospect, jobTitle, sectorForFilter);
            const enriched = {
              ...prospect,
              sectorMatch: result.sectorMatch,
              matchedTerms: result.matchedTerms.length > 0 ? result.matchedTerms : undefined,
            };
            if (result.passes) {
              strictResults.push(enriched);
            } else {
              otherResults.push(enriched);
            }
          }

          console.log(`[Search] → ${prospects.length} nouveaux, stricts=${strictResults.length}`);

          if (strictResults.length >= TARGET) break;
          if (newItems.length < RESULTS_PER_PAGE) break;

          start += RESULTS_PER_PAGE;
          await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
        } catch (e) {
          const status = (e as { body?: { status?: number }; status?: number })?.body?.status ?? (e as { status?: number })?.status;
          if (status === 502 || status === 503 || status === 429) {
            console.log(`[Search] Erreur ${status}, pause 5s puis retry...`);
            await new Promise((r) => setTimeout(r, 5000));
            start += RESULTS_PER_PAGE;
            continue;
          }
          let errDetail = e instanceof Error ? e.message : String(e);
          const errBody = (e as { body?: unknown })?.body;
          if (errBody instanceof Blob) {
            try {
              const text = await errBody.text();
              try {
                const parsed = JSON.parse(text) as { message?: string; detail?: string };
                const msg = parsed.message ?? parsed.detail;
                if (msg) errDetail = msg; else errDetail += ` | Body: ${text.substring(0, 500)}`;
              } catch {
                errDetail += ` | Body: ${text.substring(0, 500)}`;
              }
            } catch {
              errDetail += " | Body: [Blob non lisible]";
            }
          } else if (errBody && typeof errBody === "object") {
            const msg = (errBody as { message?: string }).message ?? (errBody as { detail?: string }).detail;
            if (msg) errDetail += ` | ${msg}`;
          }
          lastUnipileError = errDetail;
          console.error(`[Search] Erreur:`, errDetail);
          break;
        }
      }

      if (strictResults.length >= TARGET) break;
      if ((Date.now() - searchStartTime) > MAX_DURATION_MS) {
        console.log(`[Search] Temps limite atteint (${Math.round((Date.now() - searchStartTime) / 1000)}s), arrêt avec ${strictResults.length} stricts`);
        break;
      }
      await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
    }

    strictResults.sort(
      (a, b) => (b.matchedTerms?.length ?? 0) - (a.matchedTerms?.length ?? 0)
    );

    const cleanResults = [...strictResults.slice(0, TARGET), ...otherResults];

    console.log(
      `[Search] FINAL: ${strictResults.length} stricts, ${otherResults.length} partiels, ${apiCallCount} appels API, ${totalScraped} profils scrapés`
    );

    return NextResponse.json({
      prospects: cleanResults.slice(0, 100),
      sectorQuery: sectorQuery || undefined,
      totalFound: strictResults.length + otherResults.length,
      totalRelevant: Math.min(strictResults.length, TARGET),
      totalOthers: otherResults.length,
      debug: {
        scraped: totalScraped,
        apiCalls: apiCallCount,
        strictCount: strictResults.length,
        queries,
        unipileError: lastUnipileError ?? undefined,
      },
    });
  } catch (err) {
    console.error("[LinkedIn search] Erreur complète:", err);
    const unipileBody = (err as { body?: unknown })?.body;
    let unipileMsg: string | undefined;
    if (unipileBody instanceof Blob) {
      try {
        const text = await unipileBody.text();
        try {
          const parsed = JSON.parse(text) as { message?: string; detail?: string };
          unipileMsg = parsed.message ?? parsed.detail;
        } catch {
          unipileMsg = text.substring(0, 300);
        }
      } catch {
        unipileMsg = "[Blob non lisible]";
      }
    } else if (unipileBody && typeof unipileBody === "object") {
      const b = unipileBody as { message?: string; type?: string; title?: string };
      unipileMsg = b.message ?? b.type ?? b.title;
    }
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    const detail = unipileMsg ? `${message} (Unipile: ${unipileMsg})` : message;
    console.error("[LinkedIn search] Detail:", detail, "Body:", unipileMsg ?? JSON.stringify(unipileBody));

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
        console.error("[LinkedIn search] Erreur mise à jour session:", e);
      }
      return NextResponse.json(
        { error: "Votre session LinkedIn a expiré. Veuillez vous reconnecter depuis la page LinkedIn." },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: "Recherche échouée: " + detail },
      { status: 500 }
    );
  }
}
