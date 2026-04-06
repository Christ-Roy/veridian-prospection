// Segment configuration — smart (filter-based) vs manual (lead_segments table)

export interface SegmentConfig {
  id: string;
  label: string;
  icon: string; // lucide icon name
  type: "smart" | "manual" | "pj" | "overture";
  // Smart segment filters
  filters?: {
    departement?: string;
    nafCodes?: string[]; // list of NAF codes or prefixes (e.g. "43" matches all 43.*)
    nafExact?: string[]; // exact NAF codes only
  };
  // PJ segment filters
  pjFilters?: {
    departement?: string;          // single dept filter
    departements?: string[];       // multi-dept IN filter
    excludeDepartements?: string[];// exclude these depts
  };
  // Overture segment filters
  overtureFilters?: {
    departement?: string;
    departements?: string[];
    excludeDepartements?: string[];
    categories?: string[];         // overture_category IN (...)
    hasPhone?: boolean;
    noWebsite?: boolean;           // phone sans site = prospects chauds
  };
  // Default sort
  defaultSort?: string;
  defaultSortDir?: "asc" | "desc";
  children?: SegmentConfig[];
}

// NAF groups for dept 69 — grouped intelligently by sector
export const NAF_GROUPS: Record<string, { label: string; codes: string[] }> = {
  btp: {
    label: "BTP / Construction",
    codes: [
      "41.10A", "41.10B", "41.10C", "41.10D", "41.20A", "41.20B",
      "43.11Z", "43.12A", "43.12B", "43.13Z",
      "43.21A", "43.21B", "43.22A", "43.22B",
      "43.29A", "43.29B",
      "43.31Z", "43.32A", "43.32B", "43.32C",
      "43.33Z", "43.34Z", "43.39Z",
      "43.91A", "43.91B",
      "43.99A", "43.99B", "43.99C", "43.99D", "43.99E",
    ],
  },
  nettoyage: {
    label: "Nettoyage / Entretien",
    codes: [
      "81.21Z", "81.22Z", "81.29A", "81.29B",
      "81.10Z", // Activités combinées de soutien lié aux bâtiments
    ],
  },
  ingenierie: {
    label: "Ingénierie / Architecture",
    codes: [
      "71.11Z", "71.12A", "71.12B", "71.20A", "71.20B",
    ],
  },
  immobilier: {
    label: "Immobilier",
    codes: [
      "68.10Z", "68.20A", "68.20B", "68.31Z", "68.32A", "68.32B",
    ],
  },
  sante: {
    label: "Santé / Paramédical",
    codes: [
      "86.10Z", "86.21Z", "86.22A", "86.22B", "86.22C",
      "86.23Z", "86.90A", "86.90B", "86.90C", "86.90D", "86.90E", "86.90F",
    ],
  },
  beaute: {
    label: "Beauté / Bien-être",
    codes: [
      "96.02A", "96.02B", "96.04Z", "96.09Z",
    ],
  },
  restauration: {
    label: "Restauration / Hôtellerie",
    codes: [
      "56.10A", "56.10B", "56.10C", "56.21Z", "56.29A", "56.29B", "56.30Z",
      "55.10Z", "55.20Z", "55.30Z",
    ],
  },
  commerce: {
    label: "Commerce de détail",
    codes: [
      "47.11A", "47.11B", "47.11C", "47.11D", "47.11E", "47.11F",
      "47.19A", "47.19B",
      "47.21Z", "47.22Z", "47.23Z", "47.24Z", "47.25Z", "47.26Z",
      "47.29Z",
      "47.41Z", "47.42Z", "47.43Z",
      "47.51Z", "47.52A", "47.52B", "47.53Z", "47.54Z",
      "47.59A", "47.59B",
      "47.61Z", "47.62Z", "47.63Z", "47.64Z", "47.65Z",
      "47.71Z", "47.72A", "47.72B", "47.73Z", "47.74Z", "47.75Z", "47.76Z", "47.77Z", "47.78A", "47.78B", "47.78C",
      "47.79Z",
      "47.81Z", "47.82Z", "47.89Z",
      "47.91A", "47.91B", "47.99A", "47.99B",
    ],
  },
  auto: {
    label: "Auto / Garage",
    codes: [
      "45.11Z", "45.19Z", "45.20A", "45.20B",
      "45.31Z", "45.32Z", "45.40Z",
    ],
  },
  formation: {
    label: "Formation / Enseignement",
    codes: [
      "85.41Z", "85.42Z", "85.51Z", "85.52Z", "85.53Z",
      "85.59A", "85.59B",
    ],
  },
  conseil: {
    label: "Conseil / Services entreprises",
    codes: [
      "70.10Z", "70.21Z", "70.22Z",
      "73.11Z", "73.12Z", "73.20Z", // Publicité, études de marché
      "74.10Z", "74.20Z", "74.30Z", "74.90B", // Design, photo, traduction
      "78.10Z", "78.20Z", "78.30Z", // Recrutement, intérim
      "82.11Z", "82.19Z", "82.20Z", "82.30Z", "82.91Z", "82.92Z", "82.99Z", // Services admin
    ],
  },
  reparation: {
    label: "Réparation / Maintenance",
    codes: [
      "33.11Z", "33.12Z", "33.13Z", "33.14Z", "33.19Z", "33.20A", "33.20B", "33.20C", "33.20D",
      "95.11Z", "95.12Z", "95.21Z", "95.22Z", "95.23Z", "95.24Z", "95.25Z", "95.29Z",
    ],
  },
  informatique: {
    label: "Informatique / Digital",
    codes: [
      "62.01Z", "62.02A", "62.02B", "62.03Z", "62.09Z",
      "63.11Z", "63.12Z", "63.91Z", "63.99Z",
      "58.21Z", "58.29A", "58.29B", "58.29C",
    ],
  },
  droit: {
    label: "Droit / Comptabilité",
    codes: [
      "69.10Z", "69.20Z",
    ],
  },
  transport: {
    label: "Transport / Logistique",
    codes: [
      "49.10Z", "49.20Z", "49.31Z", "49.32Z", "49.39A", "49.39B", "49.39C",
      "49.41A", "49.41B", "49.41C", "49.42Z",
      "52.10A", "52.10B", "52.21Z", "52.22Z", "52.24A", "52.24B", "52.29A", "52.29B",
      "53.10Z", "53.20Z",
    ],
  },
  industrie: {
    label: "Industrie / Fabrication",
    codes: [
      "10.", "11.", "13.", "14.", "15.", "16.", "17.", "18.",
      "20.", "21.", "22.", "23.", "24.", "25.", "26.", "27.", "28.", "29.", "30.", "31.", "32.",
    ],
  },
  agriculture: {
    label: "Agriculture / Paysagisme",
    codes: [
      "01.", "02.", "03.",
      "81.30Z", // Services d'aménagement paysager
    ],
  },
  sport: {
    label: "Sport / Loisirs",
    codes: [
      "93.11Z", "93.12Z", "93.13Z", "93.19Z",
      "93.21Z", "93.29Z",
    ],
  },
  assurance: {
    label: "Assurance / Finance",
    codes: [
      "64.11Z", "64.19Z", "64.20Z", "64.30Z", "64.91Z", "64.92Z", "64.99Z",
      "65.11Z", "65.12Z", "65.20Z", "65.30Z",
      "66.11Z", "66.12Z", "66.19A", "66.19B", "66.21Z", "66.22Z", "66.29Z", "66.30Z",
    ],
  },
};

// Build the segment trees
export const SEGMENTS_TREE: SegmentConfig = {
  id: "69",
  label: "Rhône (69)",
  icon: "MapPin",
  type: "smart",
  filters: { departement: "69" },
  defaultSort: "tech_score",
  defaultSortDir: "desc",
  children: [
    // Generate children from NAF_GROUPS
    ...Object.entries(NAF_GROUPS).map(([id, group]) => ({
      id: `69/${id}`,
      label: group.label,
      icon: getNafGroupIcon(id),
      type: "smart" as const,
      filters: {
        departement: "69",
        nafExact: group.codes.filter(c => c.length >= 5), // exact codes
        nafCodes: group.codes.filter(c => c.length < 5),  // prefixes like "10."
      },
      defaultSort: "tech_score",
      defaultSortDir: "desc" as const,
    })),
    // Manual audit segment within 69
    {
      id: "69/audit",
      label: "Audit",
      icon: "ClipboardCheck",
      type: "manual" as const,
      defaultSort: "added_at",
      defaultSortDir: "desc" as const,
    },
    {
      id: "69/terrain",
      label: "Prospectable physiquement",
      icon: "MapPinCheck",
      type: "manual" as const,
      defaultSort: "added_at",
      defaultSortDir: "desc" as const,
    },
    {
      id: "69/eclates",
      label: "Sites éclatés (tous)",
      icon: "AlertTriangle",
      type: "smart" as const,
      filters: {
        departement: "69",
      },
      defaultSort: "tech_score",
      defaultSortDir: "desc" as const,
    },
  ],
};

// AURA departments (hors 69)
const AURA_DEPTS_OTHER = ["01", "03", "07", "15", "26", "38", "43", "63", "73", "74"];
const ALL_AURA_DEPTS = ["69", "42", ...AURA_DEPTS_OTHER];

// Solocal tier → estimated monthly spend (site only, excluding add-ons)
// Solocal tier → estimated monthly spend (site only, excluding add-ons like Ref Prioritaire ~150€/mois)
// Tiers detected via ExternalUid in Duda HTML: 'TIER|PJ_ID|...'
// Sources: tarifs Solocal 2024 + inflation 2025/2026
export const SOLOCAL_SPEND_ESTIMATES: Record<string, { min: number; max: number; annual: string; label: string }> = {
  ESSENTIEL: { min: 80, max: 100, annual: "~1 000€/an", label: "Site Essentiel" },
  PREMIUM: { min: 180, max: 220, annual: "~2 400€/an", label: "Site Premium" },
  PERFORMANCE: { min: 209, max: 250, annual: "~2 700€/an", label: "Site Performance" },
  PRIVILEGE: { min: 355, max: 400, annual: "~4 500€/an", label: "Site Privilège" },
  EXTERNE: { min: 0, max: 0, annual: "0€", label: "Site externe (propre)" },
  CONNECT_ONLY: { min: 49, max: 100, annual: "~600-1200€/an", label: "Visibilité seule (pas de site)" },
};

// PJ segment — leads from PagesJaunes scraping
export const PJ_SEGMENT: SegmentConfig = {
  id: "pagesjaunes",
  label: "Pages Jaunes",
  icon: "BookOpen",
  type: "pj",
  defaultSort: "nom_entreprise",
  defaultSortDir: "asc",
  children: [
    {
      id: "pagesjaunes/69",
      label: "Rhône (69)",
      icon: "MapPin",
      type: "pj" as const,
      pjFilters: { departement: "69" },
      defaultSort: "nom_entreprise",
      defaultSortDir: "asc" as const,
    },
    {
      id: "pagesjaunes/42",
      label: "Loire / St-Étienne (42)",
      icon: "MapPin",
      type: "pj" as const,
      pjFilters: { departement: "42" },
      defaultSort: "nom_entreprise",
      defaultSortDir: "asc" as const,
    },
    {
      id: "pagesjaunes/13",
      label: "Bouches-du-Rhône (13)",
      icon: "MapPin",
      type: "pj" as const,
      pjFilters: { departement: "13" },
      defaultSort: "nom_entreprise",
      defaultSortDir: "asc" as const,
    },
    {
      id: "pagesjaunes/aura",
      label: "AURA (hors 69/42)",
      icon: "Mountain",
      type: "pj" as const,
      pjFilters: { departements: AURA_DEPTS_OTHER },
      defaultSort: "nom_entreprise",
      defaultSortDir: "asc" as const,
    },
    {
      id: "pagesjaunes/national",
      label: "National (hors AURA)",
      icon: "Globe",
      type: "pj" as const,
      pjFilters: { excludeDepartements: ALL_AURA_DEPTS },
      defaultSort: "nom_entreprise",
      defaultSortDir: "asc" as const,
    },
  ],
};

// Claude segment — prospects avec activités Claude
export const CLAUDE_SEGMENT: SegmentConfig = {
  id: "claude",
  label: "Claude",
  icon: "Bot",
  type: "smart",
  defaultSort: "qualification",
  defaultSortDir: "desc",
  // No specific filters — handled via custom query in getSmartSegmentLeads
};

// Cold Calling segment — petites entreprises avec téléphone, prêtes pour la prospection téléphonique
export const COLDCALL_SEGMENT: SegmentConfig = {
  id: "coldcall",
  label: "Cold Calling",
  icon: "PhoneCall",
  type: "smart",
  defaultSort: "ca",
  defaultSortDir: "desc",
  children: [
    {
      id: "coldcall/69",
      label: "Rhône (69)",
      icon: "MapPin",
      type: "smart" as const,
      filters: { departement: "69" },
      defaultSort: "ca",
      defaultSortDir: "desc" as const,
    },
    {
      id: "coldcall/42",
      label: "Loire (42)",
      icon: "MapPin",
      type: "smart" as const,
      filters: { departement: "42" },
      defaultSort: "ca",
      defaultSortDir: "desc" as const,
    },
    {
      id: "coldcall/38",
      label: "Isère (38)",
      icon: "MapPin",
      type: "smart" as const,
      filters: { departement: "38" },
      defaultSort: "ca",
      defaultSortDir: "desc" as const,
    },
    {
      id: "coldcall/01",
      label: "Ain (01)",
      icon: "MapPin",
      type: "smart" as const,
      filters: { departement: "01" },
      defaultSort: "ca",
      defaultSortDir: "desc" as const,
    },
  ],
};

// === PROSPECT QUALITY SEGMENTS ===

// Poubelle exploitable — sites sans SIRET mais avec un minimum de preuve business (nom ou adresse)
// Pas enrichi par l'API état, mais potentiellement croisable Google Maps
export const POUBELLE_SEGMENT: SegmentConfig = {
  id: "poubelle",
  label: "Poubelle exploitable",
  icon: "Trash2",
  type: "smart",
  defaultSort: "domain",
  defaultSortDir: "asc",
  children: [
    {
      id: "poubelle/contactable",
      label: "Avec contact (tel/email)",
      icon: "Phone",
      type: "smart" as const,
      defaultSort: "domain",
      defaultSortDir: "asc" as const,
    },
    {
      id: "poubelle/gmaps",
      label: "Croisable Google Maps",
      icon: "MapPin",
      type: "smart" as const,
      defaultSort: "domain",
      defaultSortDir: "asc" as const,
    },
    {
      id: "poubelle/dead",
      label: "Sites morts (HTTP erreur)",
      icon: "AlertTriangle",
      type: "smart" as const,
      defaultSort: "domain",
      defaultSortDir: "asc" as const,
    },
  ],
};

// === SPEED CALLING SEGMENTS ===
// Score "éclaté" = pas responsive + pas HTTPS + copyright <= 2020 (0 à 3)
// Tri: score éclaté DESC, mobile d'abord, CA DESC

// NAF Gold: santé privée, droit, beauté, BTP gros oeuvre, archi/bureau d'étude, immo, traiteurs
export const NAF_GOLD = [
  // Santé privée
  "86.21Z","86.22A","86.22B","86.22C","86.23Z","86.90A","86.90B","86.90D","86.90E","86.90F",
  // Droit / Comptabilité
  "69.10Z","69.20Z",
  // Beauté / Esthétique
  "96.02A","96.02B","96.04Z",
  // BTP gros oeuvre + second oeuvre
  "43.21A","43.21B","43.22A","43.22B","43.31Z","43.32A","43.32B","43.33Z","43.34Z",
  "43.91A","43.91B","43.99C","43.12A","43.11Z",
  // Architecture / Bureaux d'étude / Ingénierie
  "71.11Z","71.12A","71.12B","71.20A","71.20B",
  // Immobilier
  "68.31Z","68.20A","68.20B","68.32A",
  // Design
  "74.10Z",
  // Traiteurs / Restauration collective
  "56.21Z","56.29A","56.29B",
];

// NAF Silver: auto, commerce spé, hôtellerie, formation, sport, nettoyage, IT, conseil, grossistes
export const NAF_SILVER = [
  // Auto / Garage
  "45.20A","45.11Z","45.32Z","45.40Z",
  // Commerce spécialisé
  "47.73Z","47.76Z","47.71Z","47.78C","47.64Z","47.59A",
  // Hôtellerie
  "55.10Z","55.20Z",
  // Formation
  "85.59A","85.51Z","85.53Z",
  // Sport
  "93.12Z","93.11Z","93.13Z",
  // Nettoyage / Entretien / Paysagisme
  "81.21Z","81.30Z","81.22Z","81.29A",
  // IT / Dev
  "62.01Z","62.02A",
  // Conseil / Management
  "70.22Z","70.21Z",
  // Publicité
  "73.11Z",
  // Services admin
  "82.11Z","82.30Z",
  // Grossistes intéressants
  "46.73A","46.51Z",
  // Industrie alimentaire
  "10.71C","10.71D",
  // Métallurgie
  "25.11Z","25.62B",
];

// TPE Speed Calling
export const TPE_SEGMENT: SegmentConfig = {
  id: "tpe",
  label: "TPE Speed Call",
  icon: "Store",
  type: "smart",
  defaultSort: "tech_score",
  defaultSortDir: "desc",
  children: [
    {
      id: "tpe/quickwins",
      label: "Quick wins (mobile + éclaté)",
      icon: "Zap",
      type: "smart" as const,
      defaultSort: "tech_score",
      defaultSortDir: "desc" as const,
    },
    {
      id: "tpe/mobile",
      label: "Mobile + site vieillissant",
      icon: "Phone",
      type: "smart" as const,
      defaultSort: "tech_score",
      defaultSortDir: "desc" as const,
    },
    {
      id: "tpe/qualified",
      label: "Bon secteur + signaux biz",
      icon: "Star",
      type: "smart" as const,
      defaultSort: "tech_score",
      defaultSortDir: "desc" as const,
    },
  ],
};

// PME Speed Calling
export const PME_SEGMENT: SegmentConfig = {
  id: "pme",
  label: "PME Speed Call",
  icon: "Building2",
  type: "smart",
  defaultSort: "ca",
  defaultSortDir: "desc",
  children: [
    {
      id: "pme/gold",
      label: "Gold (santé, droit, beauté, BTP, archi)",
      icon: "Star",
      type: "smart" as const,
      defaultSort: "tech_score",
      defaultSortDir: "desc" as const,
    },
    {
      id: "pme/silver",
      label: "Silver (auto, commerce, hôtel, IT...)",
      icon: "Shield",
      type: "smart" as const,
      defaultSort: "tech_score",
      defaultSortDir: "desc" as const,
    },
    {
      id: "pme/bronze",
      label: "Bronze (reste)",
      icon: "Folder",
      type: "smart" as const,
      defaultSort: "tech_score",
      defaultSortDir: "desc" as const,
    },
  ],
};

// Grosse entreprise — >50 effectifs ET CA > 5M
export const GROSSE_SEGMENT: SegmentConfig = {
  id: "grosse",
  label: "Grandes entreprises",
  icon: "Landmark",
  type: "smart",
  defaultSort: "ca",
  defaultSortDir: "desc",
};

// TOP LEADS — Les incontestables : recrutent + site éclaté + 3-50 salariés + téléphone
export const TOP_LEADS_SEGMENT: SegmentConfig = {
  id: "topleads",
  label: "Top Leads",
  icon: "Trophy",
  type: "smart",
  defaultSort: "eclate_score",
  defaultSortDir: "desc",
  children: [
    {
      id: "topleads/eclate3",
      label: "Site éclaté au sol (3/3)",
      icon: "AlertTriangle",
      type: "smart" as const,
      defaultSort: "ca",
      defaultSortDir: "desc" as const,
    },
    {
      id: "topleads/eclate2",
      label: "Site bien pourri (2/3)",
      icon: "Zap",
      type: "smart" as const,
      defaultSort: "ca",
      defaultSortDir: "desc" as const,
    },
    {
      id: "topleads/eclate1",
      label: "Site vieillissant (1/3)",
      icon: "Star",
      type: "smart" as const,
      defaultSort: "ca",
      defaultSortDir: "desc" as const,
    },
  ],
};

// === RGE SEGMENTS ===
// Artisans certifiés RGE avec sous-domaines (PAC, isolation, PV...)
export const RGE_META_DOMAINS = {
  efficacite: "Travaux d'efficacité énergétique",
  renouvelables: "Installations d'énergies renouvelables",
  etudes: "Etudes énergétiques",
  renovation: "Rénovation globale",
};

export const RGE_SEGMENT: SegmentConfig = {
  id: "rge",
  label: "RGE Certifiés",
  icon: "ShieldCheck",
  type: "smart",
  defaultSort: "bilan_ca",
  defaultSortDir: "desc",
  children: [
    {
      id: "rge/pac",
      label: "Pompes à chaleur",
      icon: "Thermometer",
      type: "smart" as const,
      defaultSort: "bilan_ca",
      defaultSortDir: "desc" as const,
    },
    {
      id: "rge/isolation",
      label: "Isolation (murs, combles, planchers)",
      icon: "Home",
      type: "smart" as const,
      defaultSort: "bilan_ca",
      defaultSortDir: "desc" as const,
    },
    {
      id: "rge/photovoltaique",
      label: "Panneaux solaires",
      icon: "Sun",
      type: "smart" as const,
      defaultSort: "bilan_ca",
      defaultSortDir: "desc" as const,
    },
    {
      id: "rge/fenetres",
      label: "Fenêtres / Portes / Volets",
      icon: "DoorOpen",
      type: "smart" as const,
      defaultSort: "bilan_ca",
      defaultSortDir: "desc" as const,
    },
    {
      id: "rge/chaudiere",
      label: "Chaudières / Poêles bois",
      icon: "Flame",
      type: "smart" as const,
      defaultSort: "bilan_ca",
      defaultSortDir: "desc" as const,
    },
    {
      id: "rge/ventilation",
      label: "Ventilation mécanique",
      icon: "Wind",
      type: "smart" as const,
      defaultSort: "bilan_ca",
      defaultSortDir: "desc" as const,
    },
    {
      id: "rge/architecte",
      label: "Architectes RGE",
      icon: "Ruler",
      type: "smart" as const,
      defaultSort: "bilan_ca",
      defaultSortDir: "desc" as const,
    },
    {
      id: "rge/audit",
      label: "Audit énergétique",
      icon: "ClipboardCheck",
      type: "smart" as const,
      defaultSort: "bilan_ca",
      defaultSortDir: "desc" as const,
    },
  ],
};

// Overture Maps segment — leads from Overture Maps Foundation (Facebook/Foursquare/Meta)
// 246K entreprises matchées SIREN, 87% avec téléphone, 85% avec réseau social
export const OVERTURE_SEGMENT: SegmentConfig = {
  id: "overture",
  label: "Overture Maps",
  icon: "Globe2",
  type: "overture",
  defaultSort: "nom_entreprise",
  defaultSortDir: "asc",
  children: [
    {
      id: "overture/phone_no_site",
      label: "Phone sans site (prospects)",
      icon: "PhoneCall",
      type: "overture" as const,
      overtureFilters: { hasPhone: true, noWebsite: true },
      defaultSort: "nom_entreprise",
      defaultSortDir: "asc" as const,
    },
    {
      id: "overture/69",
      label: "Rhône (69)",
      icon: "MapPin",
      type: "overture" as const,
      overtureFilters: { departement: "69" },
      defaultSort: "nom_entreprise",
      defaultSortDir: "asc" as const,
    },
    {
      id: "overture/42",
      label: "Loire (42)",
      icon: "MapPin",
      type: "overture" as const,
      overtureFilters: { departement: "42" },
      defaultSort: "nom_entreprise",
      defaultSortDir: "asc" as const,
    },
    {
      id: "overture/38",
      label: "Isère (38)",
      icon: "MapPin",
      type: "overture" as const,
      overtureFilters: { departement: "38" },
      defaultSort: "nom_entreprise",
      defaultSortDir: "asc" as const,
    },
    {
      id: "overture/btp",
      label: "BTP / Construction",
      icon: "HardHat",
      type: "overture" as const,
      overtureFilters: { categories: ["contractor", "construction_services", "building_supply_store"] },
      defaultSort: "nom_entreprise",
      defaultSortDir: "asc" as const,
    },
    {
      id: "overture/resto",
      label: "Restauration",
      icon: "UtensilsCrossed",
      type: "overture" as const,
      overtureFilters: { categories: ["restaurant", "french_restaurant", "pizza_restaurant", "fast_food_restaurant", "cafe", "bar", "bakery"] },
      defaultSort: "nom_entreprise",
      defaultSortDir: "asc" as const,
    },
    {
      id: "overture/beaute",
      label: "Beauté / Coiffure",
      icon: "Scissors",
      type: "overture" as const,
      overtureFilters: { categories: ["beauty_salon", "hair_salon", "beauty_and_spa", "tattoo_and_piercing"] },
      defaultSort: "nom_entreprise",
      defaultSortDir: "asc" as const,
    },
    {
      id: "overture/auto",
      label: "Auto / Garage",
      icon: "Car",
      type: "overture" as const,
      overtureFilters: { categories: ["automotive_repair", "car_dealer", "car_wash"] },
      defaultSort: "nom_entreprise",
      defaultSortDir: "asc" as const,
    },
    {
      id: "overture/immobilier",
      label: "Immobilier",
      icon: "Home",
      type: "overture" as const,
      overtureFilters: { categories: ["real_estate_agent", "real_estate"] },
      defaultSort: "nom_entreprise",
      defaultSortDir: "asc" as const,
    },
    {
      id: "overture/commerce",
      label: "Commerce",
      icon: "ShoppingBag",
      type: "overture" as const,
      overtureFilters: { categories: ["clothing_store", "womens_clothing_store", "grocery_store", "supermarket", "jewelry_store", "flowers_and_gifts_shop", "shopping"] },
      defaultSort: "nom_entreprise",
      defaultSortDir: "asc" as const,
    },
    {
      id: "overture/national",
      label: "National (hors AURA)",
      icon: "Globe",
      type: "overture" as const,
      overtureFilters: { excludeDepartements: ["69", "42", "01", "03", "07", "15", "26", "38", "43", "63", "73", "74"] },
      defaultSort: "nom_entreprise",
      defaultSortDir: "asc" as const,
    },
  ],
};

// All root segments
export const SEGMENT_ROOTS: SegmentConfig[] = [TOP_LEADS_SEGMENT, RGE_SEGMENT, TPE_SEGMENT, PME_SEGMENT, GROSSE_SEGMENT, COLDCALL_SEGMENT, POUBELLE_SEGMENT, CLAUDE_SEGMENT, SEGMENTS_TREE, PJ_SEGMENT, OVERTURE_SEGMENT];

// Cold call base SQL — adapted for `entreprises` table (SIREN-centric refactor 2026-04-05).
// - Has phone E.164, not registrar, not ca_suspect
// - TPE/PME only (exclut GE)
// - BODACC: not in liquidation
export const COLDCALL_BASE_WHERE = `
  e.best_phone_e164 IS NOT NULL
  AND e.is_registrar = false
  AND COALESCE(e.ca_suspect, false) = false
  AND (e.is_prospectable IS NULL OR e.is_prospectable = true)
  AND (e.categorie_entreprise IS NULL OR e.categorie_entreprise IN ('TPE', 'PME'))
  AND (e.bodacc_status IS NULL OR e.bodacc_status != 'liquidation')
  AND (
    e.tranche_effectifs IN ('00','01','02','03','11','NN')
    OR (e.chiffre_affaires >= 1000000 AND e.tranche_effectifs = '12')
  )
`;

function getNafGroupIcon(id: string): string {
  const icons: Record<string, string> = {
    btp: "HardHat",
    nettoyage: "Sparkles",
    ingenierie: "Ruler",
    immobilier: "Home",
    sante: "Heart",
    beaute: "Scissors",
    restauration: "UtensilsCrossed",
    commerce: "ShoppingBag",
    auto: "Car",
    formation: "GraduationCap",
    conseil: "Briefcase",
    reparation: "Wrench",
    informatique: "Monitor",
    droit: "Scale",
    transport: "Truck",
    industrie: "Factory",
    agriculture: "Leaf",
    sport: "Dumbbell",
    assurance: "Shield",
  };
  return icons[id] || "Folder";
}

// Flatten all trees for quick lookup
export function getAllSegments(): SegmentConfig[] {
  const result: SegmentConfig[] = [];
  for (const root of SEGMENT_ROOTS) {
    result.push(root);
    if (root.children) {
      result.push(...root.children);
    }
  }
  return result;
}

export function findSegment(id: string): SegmentConfig | undefined {
  return getAllSegments().find(s => s.id === id);
}

// Tech score — now uses web_tech_score from `entreprises` table.
// Use e.web_tech_score directly; COALESCE handles NULLs for rows without a website.
export const TECH_SCORE_SQL = `COALESCE(e.web_tech_score, 0)`;
