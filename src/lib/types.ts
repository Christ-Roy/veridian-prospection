export interface Lead {
  /**
   * Legacy key name. After the SIREN-centric refactor (2026-04-05), this field
   * carries a SIREN (9 digits) instead of a web domain. UI components may
   * display it as "Identifiant" or similar.
   */
  domain: string;
  /** SIREN de l'entreprise (alias du champ `domain`, nouvelle API). */
  siren?: string;
  /**
   * Domaine web réel de l'entreprise (entreprises.web_domain_normalized),
   * fourni par le backend depuis le refactor SIREN-centric. Optionnel car
   * beaucoup d'entreprises n'ont pas de site web.
   */
  web_domain?: string | null;
  /**
   * Tous les domaines web connus pour cette entreprise (JSONB array).
   * Chaque entrée contient {domain, cms, has_https, is_primary, tech_score, obsolescence_score}.
   * Utilisé dans la fiche prospect pour afficher plusieurs sites.
   */
  web_domains_all?: Array<{
    domain: string;
    cms?: string | null;
    has_https?: string | number | null;
    is_primary?: boolean;
    tech_score?: string | number | null;
    obsolescence_score?: string | number | null;
  }> | null;
  web_domain_count?: number | null;
  nom_entreprise: string;
  email: string | null;
  dirigeant_email: string | null;
  dirigeant_emails_all: string | null;
  aliases_found: string | null;
  is_catch_all: number | null;
  mail_provider: string | null;
  phone: string | null;
  dirigeant: string | null;
  qualite_dirigeant: string | null;
  ville: string | null;
  departement: string | null;
  code_postal: string | null;
  effectifs: string | null;
  ca: number | null;
  code_naf: string | null;
  forme_juridique: string | null;
  categorie: string | null;
  cms: string | null;
  copyright_year: number | null;
  has_responsive: number | null;
  has_https: number | null;
  niveau: string | null;
  enriched_via: string | null;
  phone_valid: number | null;
  phone_type: string | null;
  phone_test: number | null;
  phone_shared: number | null;
  phone_carrier: string | null;
  // PJ fields available in list view
  pj_url?: string | null;
  pj_website_url?: string | null;
  activites_pj?: string | null;
  rating_pj?: string | null;
  nb_avis_pj?: number | null;
  is_solocal?: number | null;
  solocal_tier?: string | null;
  pj_id?: string | null;
  honeypot_score?: number | null;
  honeypot_flag?: string | null;
  honeypot_reasons?: string | null;
  outreach_status: string;
  outreach_notes: string | null;
  contacted_date: string | null;
  contact_method: string | null;
  qualification: number | null;
  last_visited: string | null;
  // Segment extra fields (optional, only in segment views)
  best_adresse?: string | null;
  cnb_barreau?: string | null;
  cnb_specialite1?: string | null;
  cnb_date_serment?: string | null;
  est_encore_avocat?: number | null;
  obsolescence_score?: number | null;
  age_dirigeant?: number | null;
  // RGE certification
  rge_domaine?: string | null;
  rge_meta_domaine?: string | null;
  // Bilans financiers (bulk Etalab)
  bilan_ca?: number | null;
  bilan_rn?: number | null;
  bilan_marge_ebe?: number | null;
  bilan_endettement?: number | null;
  bilan_autonomie?: number | null;
  bilan_date_cloture?: string | null;
  // SIREN match method (tel_match, domain_name_cp, email_domain)
  siren_match_method?: string | null;
  // Overture Maps fields
  overture_category?: string | null;
  overture_website?: string | null;
  overture_social?: string | null;
  overture_confidence?: number | null;
  overture_brand?: string | null;
  overture_address?: string | null;
  is_overture_lead?: boolean;
  // Denomination (displayed as company name fallback when nom_entreprise is empty)
  denomination?: string | null;
}

export interface LeadDetail extends Lead {
  phones: string | null;
  emails: string | null;
  siret: string | null;
  tva_intracom: string | null;
  // Override: LeadDetail guarantees siren is non-null (it was looked up by SIREN)
  address: string | null;
  generator: string | null;
  platform_name: string | null;
  jquery_version: string | null;
  php_version: string | null;
  social_linkedin: string | null;
  social_facebook: string | null;
  social_instagram: string | null;
  social_twitter: string | null;
  final_url: string | null;
  title: string | null;
  meta_description: string | null;
  api_adresse: string | null;
  // CNB (annuaire avocats)
  cnb_nom: string | null;
  cnb_prenom: string | null;
  cnb_barreau: string | null;
  cnb_specialite1: string | null;
  cnb_specialite2: string | null;
  cnb_date_serment: string | null;
  est_encore_avocat: number | null;
  obsolescence_score: number | null;
  // PJ (Pages Jaunes)
  pj_id: string | null;
  pj_url: string | null;
  pj_website_url: string | null;
  activites_pj: string | null;
  pj_description: string | null;
  rating_pj: string | null;
  nb_avis_pj: number | null;
  is_solocal: number | null;
  solocal_tier: string | null;  // ESSENTIEL, PERFORMANCE, PRIVILEGE, EXTERNE, SOLOCAL_UNKNOWN, null
  honeypot_score: number | null;
  honeypot_flag: string | null;
  honeypot_reasons: string | null;
  // DataHub enrichment (optional — may not be present for all leads)
  chiffre_affaires?: number | null;
  resultat_net?: number | null;
  ebe?: number | null;
  marge_ebe?: number | null;
  charges_personnel?: number | null;
  annee_comptes?: number | null;
  secteur_final?: string | null;
  domaine_final?: string | null;
  prospect_tier?: string | null;
  confiance_secteur?: number | null;
  data_completeness?: number | null;
  est_rge?: boolean | null;
  est_qualiopi?: boolean | null;
  qualiopi_specialite?: string | null;
  est_bio?: boolean | null;
  est_epv?: boolean | null;
  est_finess?: boolean | null;
  est_ess?: boolean | null;
  est_bni?: boolean | null;
  est_sur_lbc?: boolean | null;
  nb_marches_publics?: number | null;
  montant_marches_publics?: number | null;
  decp_2024_plus?: number | null;
  bilan_date?: string | null;
  bodacc_status?: string | null;
  bodacc_nb_procedures?: number | null;
  date_creation?: string | null;
  categorie_datahub?: string | null;
  denomination?: string | null;
  // INPI v3.6 financial enrichment
  ca_last?: number | null;
  ca_last_year?: number | null;
  ca_trend_3y?: string | null;
  ca_growth_pct_3y?: number | null;
  marge_ebe_pct?: number | null;
  profitability_tag?: string | null;
  deficit_2y?: boolean | null;
  scaling_rh?: boolean | null;
  inpi_nb_exercices?: number | null;
  bilan_last_year?: number | null;
  bilan_confidentiality?: string | null;
  // INPI history (fetched separately via /api/leads/[siren]/history)
  inpi_history?: InpiHistoryEntry[] | null;
  is_pj_lead: boolean;
}

export interface InpiHistoryEntry {
  annee: number;
  ca_net: number | null;
  resultat_net: number | null;
  ebe: number | null;
  charges_personnel: number | null;
  total_actif: number | null;
}

export interface Stats {
  total: number;
  enriched: number;
  with_email: number;
  with_phone: number;
  with_dirigeant: number;
  dirigeant_emails: number;
  with_aliases: number;
  contacted: number;
}

export type ClaudeActivityType = "analysis" | "recommendation" | "email_draft" | "note" | "action" | "call_summary";

export interface ClaudeActivity {
  id: number;
  siren: string;
  // Legacy alias — UI may still read `domain` for backward compat.
  domain?: string;
  activity_type: ClaudeActivityType;
  title: string | null;
  content: string;
  metadata: string | null;
  created_at: string;
}

export interface ClaudeStats {
  total_analyzed: number;
  total_drafts: number;
  total_recommendations: number;
  recent_activity: ClaudeActivity[];
}

export const CLAUDE_ACTIVITY_COLORS: Record<ClaudeActivityType, string> = {
  analysis: "bg-blue-100 text-blue-700 border-blue-200",
  recommendation: "bg-green-100 text-green-700 border-green-200",
  email_draft: "bg-purple-100 text-purple-700 border-purple-200",
  note: "bg-gray-100 text-gray-700 border-gray-200",
  action: "bg-orange-100 text-orange-700 border-orange-200",
  call_summary: "bg-teal-100 text-teal-700 border-teal-200",
};

export const CLAUDE_ACTIVITY_LABELS: Record<ClaudeActivityType, string> = {
  analysis: "Analyse",
  recommendation: "Recommandation",
  email_draft: "Draft email",
  note: "Note",
  action: "Action",
  call_summary: "Resume appel",
};

export interface Followup {
  id: number;
  siren: string;
  // Legacy alias — UI may still read `domain` for backward compat.
  domain?: string;
  scheduled_at: string;
  status: "pending" | "done" | "cancelled";
  note: string | null;
  created_at: string;
}

export const EFFECTIFS_LABELS: Record<string, string> = {
  NN: "Non renseigné",
  "00": "0 salarié",
  "01": "1-2",
  "02": "3-5",
  "03": "6-9",
  "11": "10-19",
  "12": "20-49",
  "21": "50-99",
  "22": "100-199",
  "31": "200-249",
  "32": "250-499",
  "41": "500-999",
  "42": "1000-1999",
  "51": "2000-4999",
  "52": "5000-9999",
  "53": "10000+",
};

export const STATUS_OPTIONS = [
  { value: "a_contacter", label: "A contacter", color: "bg-gray-100 text-gray-700" },
  { value: "fiche_ouverte", label: "Fiche ouverte", color: "bg-indigo-100 text-indigo-700" },
  { value: "appele", label: "Appele", color: "bg-sky-100 text-sky-700" },
  { value: "interesse", label: "Interesse", color: "bg-green-100 text-green-700" },
  { value: "pas_interesse", label: "Pas interesse", color: "bg-red-100 text-red-700" },
  { value: "rappeler", label: "A rappeler", color: "bg-orange-100 text-orange-700" },
  { value: "rdv", label: "RDV", color: "bg-purple-100 text-purple-700" },
  { value: "client", label: "Client", color: "bg-yellow-100 text-yellow-800 font-bold" },
  { value: "hors_cible", label: "Hors cible", color: "bg-gray-200 text-gray-500" },
] as const;

export function getStatusInfo(status: string) {
  return STATUS_OPTIONS.find((s) => s.value === status) ?? STATUS_OPTIONS[0];
}

export function formatCA(n: number | null): string {
  if (n == null) return "-";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M€";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "K€";
  return n.toLocaleString("fr-FR") + "€";
}

export function formatEffectifs(code: string | null): string {
  if (!code) return "-";
  return EFFECTIFS_LABELS[code] ?? code;
}

export function formatTimeAgo(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const date = new Date(dateStr.replace(" ", "T") + "Z");
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "A l'instant";
  if (diffMin < 60) return `Il y a ${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `Il y a ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `Il y a ${diffD}j`;
  if (diffD < 30) return `Il y a ${Math.floor(diffD / 7)} sem.`;
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
