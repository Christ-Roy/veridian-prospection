// Domain definitions for the navigation sidebar
// Maps business domains to NAF code groups from segments.ts

import { NAF_GROUPS } from "./segments";

export interface DomainConfig {
  id: string;
  label: string;
  icon: string; // lucide icon name
  nafGroupKey: string | null; // key in NAF_GROUPS, null for "all"
}

// 18 business domains + "Tous les secteurs"
export const DOMAINS: DomainConfig[] = [
  { id: "all", label: "Tous les secteurs", icon: "Globe", nafGroupKey: null },
  { id: "btp", label: "BTP / Construction", icon: "HardHat", nafGroupKey: "btp" },
  { id: "sante", label: "Sante / Paramedical", icon: "Heart", nafGroupKey: "sante" },
  { id: "beaute", label: "Beaute / Bien-etre", icon: "Scissors", nafGroupKey: "beaute" },
  { id: "immobilier", label: "Immobilier", icon: "Home", nafGroupKey: "immobilier" },
  { id: "restauration", label: "Restauration / Hotellerie", icon: "UtensilsCrossed", nafGroupKey: "restauration" },
  { id: "auto", label: "Auto / Garage", icon: "Car", nafGroupKey: "auto" },
  { id: "commerce", label: "Commerce de detail", icon: "ShoppingBag", nafGroupKey: "commerce" },
  { id: "droit", label: "Droit / Comptabilite", icon: "Scale", nafGroupKey: "droit" },
  { id: "ingenierie", label: "Ingenierie / Architecture", icon: "Ruler", nafGroupKey: "ingenierie" },
  { id: "informatique", label: "Informatique / Digital", icon: "Monitor", nafGroupKey: "informatique" },
  { id: "conseil", label: "Conseil / Services", icon: "Briefcase", nafGroupKey: "conseil" },
  { id: "formation", label: "Formation / Enseignement", icon: "GraduationCap", nafGroupKey: "formation" },
  { id: "nettoyage", label: "Nettoyage / Entretien", icon: "Sparkles", nafGroupKey: "nettoyage" },
  { id: "reparation", label: "Reparation / Maintenance", icon: "Wrench", nafGroupKey: "reparation" },
  { id: "transport", label: "Transport / Logistique", icon: "Truck", nafGroupKey: "transport" },
  { id: "sport", label: "Sport / Loisirs", icon: "Dumbbell", nafGroupKey: "sport" },
  { id: "industrie", label: "Industrie / Fabrication", icon: "Factory", nafGroupKey: "industrie" },
  { id: "assurance", label: "Assurance / Finance", icon: "Shield", nafGroupKey: "assurance" },
];

// Get NAF codes for a domain (exact codes and prefix codes)
export function getDomainNafCodes(domainId: string): { nafExact: string[]; nafPrefixes: string[] } | null {
  const domain = DOMAINS.find(d => d.id === domainId);
  if (!domain || !domain.nafGroupKey) return null;

  const group = NAF_GROUPS[domain.nafGroupKey];
  if (!group) return null;

  return {
    nafExact: group.codes.filter(c => c.length >= 5),
    nafPrefixes: group.codes.filter(c => c.length < 5),
  };
}

// Prospect preset definitions (sectorial presets replacing Or/Argent/Bronze)
export type ProspectPreset = "top_prospects" | "btp_artisans" | "sante_droit" | "commerce_services" | "tous" | "historique" | "rge" | "qualiopi" | "bio" | "epv" | "bni" | "non_identifie_avec_tel";

export interface ProspectPresetConfig {
  id: ProspectPreset;
  label: string;
  description: string;
  color: string;
  activeColor: string;
  borderColor: string;
}

export const PROSPECT_PRESETS: ProspectPresetConfig[] = [
  {
    id: "top_prospects",
    label: "Top Prospects",
    description: "Sites eclates + enrichis + telephone — les meilleurs leads toutes categories",
    color: "text-amber-600", activeColor: "bg-amber-50", borderColor: "border-amber-200",
  },
  {
    id: "btp_artisans",
    label: "BTP & Artisans",
    description: "Construction, plomberie, electricite, maconnerie, renovation",
    color: "text-orange-600", activeColor: "bg-orange-50", borderColor: "border-orange-200",
  },
  {
    id: "sante_droit",
    label: "Sante & Droit",
    description: "Medecins, dentistes, kines, avocats, comptables, architectes",
    color: "text-blue-600", activeColor: "bg-blue-50", borderColor: "border-blue-200",
  },
  {
    id: "commerce_services",
    label: "Commerce & Services",
    description: "Restaurants, hotels, garages, commerces, beaute, sport",
    color: "text-green-600", activeColor: "bg-green-50", borderColor: "border-green-200",
  },
  {
    id: "tous",
    label: "Tous",
    description: "Tous les prospects enrichis avec telephone",
    color: "text-gray-600", activeColor: "bg-gray-50", borderColor: "border-gray-200",
  },
  {
    id: "historique",
    label: "Historique",
    description: "Prospects deja consultes",
    color: "text-indigo-600", activeColor: "bg-indigo-50", borderColor: "border-indigo-200",
  },
];
