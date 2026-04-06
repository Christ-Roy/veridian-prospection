"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { EFFECTIFS_LABELS, STATUS_OPTIONS } from "@/lib/types";
import {
  Filter,
  X,
  Check,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Zap,
  AlertTriangle,
  Building2,
  Save,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { NAF_LABELS } from "@/lib/naf";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AdvancedFiltersProps {
  filters: Record<string, string>;
  setFilters: (filters: Record<string, string>) => void;
  deduplicate: boolean;
  setDeduplicate: (v: boolean) => void;
  className?: string;
}

interface CustomPreset {
  id: string;
  label: string;
  filters: Record<string, string>;
  deduplicate: boolean;
}

interface BoolChip {
  key: string;
  label: string;
  activeValue: string; // "=1" or "=0"
}

interface SelectOption {
  value: string;
  label: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const EFFECTIFS_GROUPS = [
  { label: "TPE (0-9)", codes: ["NN", "00", "01", "02", "03"] },
  { label: "PME (10-249)", codes: ["11", "12", "21", "22", "31"] },
  { label: "ETI / GE (250+)", codes: ["32", "41", "42", "51", "52", "53"] },
];

const CATEGORIE_OPTIONS = ["PME", "ETI", "GE"];
const FORME_JURIDIQUE_OPTIONS = ["SAS", "SARL", "EI", "SA", "SCI"];

const CA_RANGES = [
  { label: "< 100K", value: "0-100000" },
  { label: "100K-500K", value: "100000-500000" },
  { label: "500K-2M", value: "500000-2000000" },
  { label: "2-10M", value: "2000000-10000000" },
  { label: "> 10M", value: ">=10000000" },
];

const COPYRIGHT_RANGES = [
  { label: "\u2264 2015", value: "<=2015" },
  { label: "\u2264 2018", value: "<=2018" },
  { label: "\u2264 2020", value: "<=2020" },
  { label: "\u2264 2022", value: "<=2022" },
];

const CMS_OPTIONS: SelectOption[] = [
  { value: "wordpress", label: "WordPress" },
  { value: "joomla", label: "Joomla" },
  { value: "prestashop", label: "PrestaShop" },
  { value: "spip", label: "SPIP" },
  { value: "drupal", label: "Drupal" },
  { value: "typo3", label: "TYPO3" },
];

const PLATFORM_OPTIONS: SelectOption[] = [
  { value: "wix", label: "Wix" },
  { value: "shopify", label: "Shopify" },
  { value: "webflow", label: "Webflow" },
  { value: "weebly", label: "Weebly" },
  { value: "jimdo", label: "Jimdo" },
  { value: "squarespace", label: "Squarespace" },
  { value: "duda", label: "Duda" },
];

const PAGE_BUILDER_OPTIONS: SelectOption[] = [
  { value: "elementor", label: "Elementor" },
  { value: "divi", label: "Divi" },
  { value: "wpbakery", label: "WPBakery" },
  { value: "oxygen", label: "Oxygen" },
  { value: "avada", label: "Avada" },
  { value: "beaver-builder", label: "Beaver Builder" },
  { value: "brizy", label: "Brizy" },
];

const JS_FRAMEWORK_OPTIONS: SelectOption[] = [
  { value: "nextjs", label: "Next.js" },
  { value: "vue", label: "Vue.js" },
  { value: "nuxtjs", label: "Nuxt.js" },
  { value: "react", label: "React" },
  { value: "angular", label: "Angular" },
  { value: "svelte", label: "Svelte" },
];

const CSS_FRAMEWORK_OPTIONS: SelectOption[] = [
  { value: "tailwind", label: "Tailwind" },
  { value: "foundation", label: "Foundation" },
  { value: "bulma", label: "Bulma" },
];

const ANALYTICS_OPTIONS: SelectOption[] = [
  { value: "GTM+GA4", label: "GTM + GA4" },
  { value: "GA4", label: "GA4" },
  { value: "GTM", label: "GTM seul" },
  { value: "matomo", label: "Matomo" },
  { value: "UA_deprecated", label: "UA (obsolete)" },
  { value: "plausible", label: "Plausible" },
  { value: "none", label: "Aucun" },
];

const COOKIE_BANNER_OPTIONS: SelectOption[] = [
  { value: "complianz", label: "Complianz" },
  { value: "tarteaucitron", label: "Tarteaucitron" },
  { value: "cookie-law-info", label: "Cookie Law Info" },
  { value: "axeptio", label: "Axeptio" },
  { value: "cookiebot", label: "Cookiebot" },
  { value: "didomi", label: "Didomi" },
  { value: "onetrust", label: "OneTrust" },
];

const ETAT_OPTIONS: SelectOption[] = [
  { value: "A", label: "Active" },
  { value: "C", label: "Cessée" },
];

const CONTACT_CHIPS: BoolChip[] = [
  { key: "has_contact_form", label: "Formulaire", activeValue: "=1" },
  { key: "has_chat_widget", label: "Chat widget", activeValue: "=1" },
  { key: "has_whatsapp", label: "WhatsApp", activeValue: "=1" },
];

const SOCIAL_CHIPS: BoolChip[] = [
  { key: "social_linkedin", label: "LinkedIn", activeValue: "!empty" },
  { key: "social_facebook", label: "Facebook", activeValue: "!empty" },
  { key: "social_instagram", label: "Instagram", activeValue: "!empty" },
  { key: "social_twitter", label: "Twitter/X", activeValue: "!empty" },
  { key: "social_youtube", label: "YouTube", activeValue: "!empty" },
];

const IDENTITY_CHIPS: BoolChip[] = [
  { key: "siret", label: "SIRET", activeValue: "!empty" },
  { key: "siren", label: "SIREN", activeValue: "!empty" },
  { key: "tva_intracom", label: "TVA Intra.", activeValue: "!empty" },
  { key: "rcs", label: "RCS", activeValue: "!empty" },
  { key: "has_mentions_legales", label: "Mentions lég.", activeValue: "=1" },
];

const TECH_DEBT_CHIPS: BoolChip[] = [
  { key: "has_responsive", label: "Non responsive", activeValue: "=0" },
  { key: "has_https", label: "Pas HTTPS", activeValue: "=0" },
  { key: "has_old_html", label: "Vieux HTML", activeValue: "=1" },
  { key: "has_flash", label: "Flash", activeValue: "=1" },
  { key: "has_layout_tables", label: "Tables layout", activeValue: "=1" },
  { key: "has_ie_polyfills", label: "IE polyfills", activeValue: "=1" },
  { key: "has_lorem_ipsum", label: "Lorem ipsum", activeValue: "=1" },
  { key: "has_phpsessid", label: "PHPSESSID", activeValue: "=1" },
  { key: "has_mixed_content", label: "Mixed content", activeValue: "=1" },
  { key: "has_old_images", label: "Images obsolètes", activeValue: "=1" },
  { key: "has_viewport_no_scale", label: "No-scale", activeValue: "=1" },
  { key: "has_meta_keywords", label: "Meta keywords", activeValue: "=1" },
];

const MODERN_CHIPS: BoolChip[] = [
  { key: "has_favicon", label: "Favicon", activeValue: "=1" },
  { key: "has_modern_images", label: "WebP/AVIF", activeValue: "=1" },
  { key: "has_minified_assets", label: "Minifié", activeValue: "=1" },
  { key: "has_compression", label: "Gzip/Brotli", activeValue: "=1" },
  { key: "has_cdn", label: "CDN", activeValue: "=1" },
  { key: "has_lazy_loading", label: "Lazy loading", activeValue: "=1" },
  { key: "has_security_headers", label: "Sec. headers", activeValue: "=1" },
];

const SEO_CHIPS: BoolChip[] = [
  { key: "has_noindex", label: "Noindex", activeValue: "=1" },
  { key: "has_canonical", label: "Canonical", activeValue: "=1" },
  { key: "has_hreflang", label: "Hreflang", activeValue: "=1" },
  { key: "has_schema_org", label: "Schema.org", activeValue: "=1" },
  { key: "has_og_tags", label: "OG Tags", activeValue: "=1" },
];

const MARKETING_CHIPS: BoolChip[] = [
  { key: "has_facebook_pixel", label: "FB Pixel", activeValue: "=1" },
  { key: "has_linkedin_pixel", label: "LI Pixel", activeValue: "=1" },
  { key: "has_google_ads", label: "AdSense", activeValue: "=1" },
  { key: "has_cookie_banner", label: "Cookie banner", activeValue: "=1" },
];

const BUSINESS_CHIPS: BoolChip[] = [
  { key: "has_devis", label: "Devis", activeValue: "=1" },
  { key: "has_ecommerce", label: "E-commerce", activeValue: "=1" },
  { key: "has_blog", label: "Blog", activeValue: "=1" },
  { key: "has_recruiting_page", label: "Recrutement", activeValue: "=1" },
  { key: "has_google_maps", label: "Google Maps", activeValue: "=1" },
  { key: "has_horaires", label: "Horaires", activeValue: "=1" },
  { key: "has_booking_system", label: "Réservation", activeValue: "=1" },
  { key: "has_newsletter_provider", label: "Newsletter", activeValue: "=1" },
  { key: "has_certifications", label: "Certifications", activeValue: "=1" },
  { key: "has_app_links", label: "App mobile", activeValue: "=1" },
  { key: "has_trust_signals", label: "Avis/badges", activeValue: "=1" },
];

const ENRICHMENT_CHIPS: BoolChip[] = [
  { key: "enriched", label: "Enrichi", activeValue: "=1" },
  { key: "api_est_asso", label: "Association", activeValue: "=1" },
  { key: "api_est_ess", label: "ESS", activeValue: "=1" },
  { key: "api_est_service_public", label: "Service public", activeValue: "=1" },
  { key: "api_est_qualiopi", label: "Qualiopi", activeValue: "=1" },
  { key: "api_est_rge", label: "RGE", activeValue: "=1" },
  { key: "api_est_societe_mission", label: "Soc. mission", activeValue: "=1" },
  { key: "bodacc_procedure", label: "BODACC proc.", activeValue: "!empty" },
];

const PHONE_VERIF_CHIPS: BoolChip[] = [
  { key: "phone_valid", label: "Tél validé", activeValue: "=1" },
  { key: "phone_shared", label: "Tél partagé", activeValue: "=1" },
  { key: "phone_test", label: "N\u00b0 test", activeValue: "=1" },
];

const BUILTIN_PRESETS: {
  label: string;
  icon: typeof Zap;
  color: string;
  filters: Record<string, string>;
}[] = [
  {
    label: "Leads chauds",
    icon: Zap,
    color: "text-orange-600 border-orange-300 bg-orange-50 hover:bg-orange-100",
    filters: { phone: "!empty", phone_type: "=mobile", enriched_via: "!empty" },
  },
  {
    label: "Sites obsolètes",
    icon: AlertTriangle,
    color: "text-red-600 border-red-300 bg-red-50 hover:bg-red-100",
    filters: { has_responsive: "=0", has_https: "=0" },
  },
  {
    label: "PME enrichies",
    icon: Building2,
    color: "text-blue-600 border-blue-300 bg-blue-50 hover:bg-blue-100",
    filters: { categorie: "PME", enriched_via: "!empty", phone: "!empty" },
  },
];

const STORAGE_KEY = "dashboard_custom_presets";

// ─── Sections ────────────────────────────────────────────────────────────────

type SectionId =
  | "display"
  | "entreprise"
  | "ca"
  | "contact"
  | "identity"
  | "tech_debt"
  | "tech_modern"
  | "stack"
  | "seo"
  | "marketing"
  | "business"
  | "enrichment"
  | "outreach";

// All filter keys per section (for counting)
const SECTION_KEYS: Record<SectionId, string[]> = {
  display: [],
  entreprise: ["effectifs", "categorie", "forme_juridique", "departement", "api_etat", "code_naf"],
  ca: ["ca_range"],
  contact: ["phone", "phone_type", "dirigeant_email", "enriched_via", "email_principal", "has_contact_form", "has_chat_widget", "has_whatsapp", "social_linkedin", "social_facebook", "social_instagram", "social_twitter", "social_youtube"],
  identity: ["siret", "siren", "tva_intracom", "rcs", "has_mentions_legales"],
  tech_debt: ["has_responsive", "has_https", "has_old_html", "has_flash", "has_layout_tables", "has_ie_polyfills", "has_lorem_ipsum", "has_phpsessid", "has_mixed_content", "has_old_images", "has_viewport_no_scale", "has_meta_keywords", "copyright_max"],
  tech_modern: ["has_favicon", "has_modern_images", "has_minified_assets", "has_compression", "has_cdn", "has_lazy_loading", "has_security_headers"],
  stack: ["cms", "platform_name", "page_builder_name", "js_framework_name", "css_framework_name", "jquery_version", "bootstrap_version", "agency_signature", "php_version", "powered_by"],
  seo: ["has_noindex", "has_canonical", "has_hreflang", "has_schema_org", "has_og_tags", "language"],
  marketing: ["analytics_type", "has_facebook_pixel", "has_linkedin_pixel", "has_google_ads", "has_cookie_banner", "cookie_banner_name"],
  business: ["has_devis", "has_ecommerce", "has_blog", "has_recruiting_page", "has_google_maps", "has_horaires", "has_booking_system", "has_newsletter_provider", "has_certifications", "has_app_links", "has_trust_signals"],
  enrichment: ["enriched", "api_est_asso", "api_est_ess", "api_est_service_public", "api_est_qualiopi", "api_est_rge", "api_est_societe_mission", "bodacc_procedure", "phone_valid", "phone_shared", "phone_test"],
  outreach: ["outreach_status"],
};

// ─── NAF Filter (searchable) ─────────────────────────────────────────────────

const NAF_OPTIONS = Object.entries(NAF_LABELS).map(([code, label]) => ({ code, label }));

function NafFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const selectedCodes = value ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];

  const filtered = search.trim()
    ? NAF_OPTIONS.filter(
        (n) =>
          n.code.toLowerCase().includes(search.toLowerCase()) ||
          n.label.toLowerCase().includes(search.toLowerCase())
      )
    : NAF_OPTIONS;

  const toggleCode = (code: string) => {
    const next = selectedCodes.includes(code)
      ? selectedCodes.filter((c) => c !== code)
      : [...selectedCodes, code];
    onChange(next.join(","));
  };

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium block">Secteur (NAF)</label>
      {selectedCodes.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1">
          {selectedCodes.map((code) => (
            <span key={code} className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 border border-primary text-primary">
              {NAF_LABELS[code] ? `${NAF_LABELS[code]}` : code}
              <button onClick={() => toggleCode(code)} className="ml-0.5 hover:text-red-500"><X className="h-2.5 w-2.5" /></button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Input
          placeholder="Rechercher un secteur..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          className="h-7 text-xs"
        />
        {open && (
          <div className="absolute z-50 top-8 left-0 right-0 bg-background border rounded-md shadow-lg max-h-64 overflow-y-auto">
            {filtered.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">Aucun résultat</div>}
            {filtered.map((n) => {
              const isSelected = selectedCodes.includes(n.code);
              return (
                <button
                  key={n.code}
                  onClick={() => { toggleCode(n.code); setSearch(""); }}
                  className={cn(
                    "w-full text-left px-3 py-1.5 text-[11px] hover:bg-muted transition-colors flex items-center gap-2",
                    isSelected && "bg-primary/5 font-semibold"
                  )}
                >
                  <span className="font-mono text-[10px] text-muted-foreground w-12 flex-shrink-0">{n.code}</span>
                  <span className="truncate">{n.label}</span>
                  {isSelected && <Check className="h-3 w-3 ml-auto text-primary flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {open && (
        <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setSearch(""); }} />
      )}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AdvancedFilters({
  filters,
  setFilters,
  deduplicate,
  setDeduplicate,
  className,
}: AdvancedFiltersProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Set<SectionId>>(
    new Set(["entreprise", "contact", "tech_debt", "outreach"])
  );
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);

  // Load custom presets from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setCustomPresets(JSON.parse(stored));
    } catch {}
  }, []);

  const savePresetsToStorage = useCallback((presets: CustomPreset[]) => {
    setCustomPresets(presets);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  }, []);

  const saveCurrentAsPreset = () => {
    if (!presetName.trim()) return;
    const preset: CustomPreset = {
      id: Date.now().toString(),
      label: presetName.trim(),
      filters: { ...filters },
      deduplicate,
    };
    savePresetsToStorage([...customPresets, preset]);
    setPresetName("");
    setShowSaveInput(false);
  };

  const deletePreset = (id: string) => {
    savePresetsToStorage(customPresets.filter((p) => p.id !== id));
  };

  const applyPreset = (preset: { filters: Record<string, string>; deduplicate?: boolean }) => {
    setFilters({ ...filters, ...preset.filters });
    if (preset.deduplicate !== undefined) setDeduplicate(preset.deduplicate);
  };

  const applyPresetExclusive = (preset: { filters: Record<string, string>; deduplicate?: boolean }) => {
    setFilters(preset.filters);
    if (preset.deduplicate !== undefined) setDeduplicate(preset.deduplicate);
  };

  // ─── Filter helpers ──────────────────────────────────────────────

  const toggleSection = (id: SectionId) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleFilterValue = (key: string, value: string) => {
    const current = filters[key] ? filters[key].split(",") : [];
    const idx = current.indexOf(value);
    const next = idx >= 0 ? current.filter((v) => v !== value) : [...current, value];
    const nf = { ...filters };
    if (next.length > 0) nf[key] = next.join(",");
    else delete nf[key];
    setFilters(nf);
  };

  const setSingleFilter = (key: string, value: string | null) => {
    const nf = { ...filters };
    if (value) nf[key] = value;
    else delete nf[key];
    setFilters(nf);
  };

  const getExcludeValue = (activeValue: string): string => {
    if (activeValue === "!empty") return "empty";
    if (activeValue.startsWith("=")) return `!${activeValue}`;
    return `!=${activeValue}`;
  };

  const toggleBool = (chip: BoolChip) => {
    const current = filters[chip.key];
    const excludeVal = getExcludeValue(chip.activeValue);
    if (current === chip.activeValue) {
      setSingleFilter(chip.key, excludeVal);
    } else if (current === excludeVal) {
      setSingleFilter(chip.key, null);
    } else {
      setSingleFilter(chip.key, chip.activeValue);
    }
  };

  const selectAllInGroup = (key: string, codes: string[]) => {
    const current = filters[key] ? filters[key].split(",") : [];
    const allSelected = codes.every((c) => current.includes(c));
    const next = allSelected
      ? current.filter((c) => !codes.includes(c))
      : [...new Set([...current, ...codes])];
    const nf = { ...filters };
    if (next.length > 0) nf[key] = next.join(",");
    else delete nf[key];
    setFilters(nf);
  };

  const clearAll = () => {
    setFilters({});
    setDeduplicate(false);
  };

  const countActiveFilters = Object.keys(filters).length + (deduplicate ? 1 : 0);

  const sectionCount = (id: SectionId) =>
    SECTION_KEYS[id].filter((k) => filters[k]).length;

  // ─── Reusable UI pieces ──────────────────────────────────────────

  function SectionHeader({ id, title }: { id: SectionId; title: string }) {
    const count = id === "display" ? (deduplicate ? 1 : 0) : sectionCount(id);
    return (
      <button onClick={() => toggleSection(id)} className="flex items-center justify-between w-full py-1 group">
        <div className="flex items-center gap-1.5">
          {openSections.has(id) ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          <h4 className="font-medium text-[11px] text-muted-foreground uppercase tracking-wider group-hover:text-foreground transition-colors">{title}</h4>
        </div>
        {count > 0 && <Badge variant="secondary" className="h-4 px-1 text-[10px]">{count}</Badge>}
      </button>
    );
  }

  function ChipGrid({ chips }: { chips: BoolChip[] }) {
    return (
      <div className="flex flex-wrap gap-1">
        {chips.map((c) => {
          const active = filters[c.key] === c.activeValue;
          const excluded = filters[c.key] === getExcludeValue(c.activeValue);
          return (
            <button key={c.key} onClick={() => toggleBool(c)} className={cn("px-2 py-0.5 rounded text-[11px] border transition-all", active ? "bg-primary/10 border-primary text-primary font-semibold" : excluded ? "bg-red-50 border-red-400 text-red-600 font-semibold line-through" : "bg-background hover:bg-muted/50 border-border text-muted-foreground")}>
              {c.label}
            </button>
          );
        })}
      </div>
    );
  }

  function FilterSelect({ filterKey, options, placeholder }: { filterKey: string; options: SelectOption[]; placeholder: string }) {
    return (
      <Select value={filters[filterKey]?.replace("=", "") || "all"} onValueChange={(v) => setSingleFilter(filterKey, v === "all" ? null : `=${v}`)}>
        <SelectTrigger className="h-7 text-xs">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tous</SelectItem>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  }

  function MultiChips({ filterKey, options }: { filterKey: string; options: string[] }) {
    return (
      <div className="flex gap-1.5 flex-wrap">
        {options.map((v) => {
          const selected = filters[filterKey]?.split(",").includes(v);
          return (
            <button key={v} onClick={() => toggleFilterValue(filterKey, v)} className={cn("px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all", selected ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border")}>
              {v}
            </button>
          );
        })}
      </div>
    );
  }

  function RangeChips({ filterKey, ranges, color }: { filterKey: string; ranges: { label: string; value: string }[]; color: string }) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {ranges.map((r) => {
          const active = filters[filterKey] === r.value;
          return (
            <button key={r.value} onClick={() => setSingleFilter(filterKey, active ? null : r.value)} className={cn("px-2.5 py-1 rounded text-[11px] border transition-all", active ? color : "bg-background hover:bg-muted/50 border-border text-muted-foreground")}>
              {r.label}
            </button>
          );
        })}
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className={cn("h-8 gap-2", className)}>
          <Filter className="h-3.5 w-3.5" />
          Filtres avancés
          {countActiveFilters > 0 && <Badge variant="secondary" className="h-5 px-1.5 min-w-5 justify-center">{countActiveFilters}</Badge>}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[420px] sm:w-[560px] gap-0 p-0 flex flex-col">
        <SheetHeader className="px-5 pt-5 pb-2 flex-shrink-0">
          <SheetTitle className="text-base">Filtres avancés</SheetTitle>
          <SheetDescription className="text-xs">
            Tous les filtres se cumulent (AND). Sauvegardez vos combinaisons en presets.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-0.5">

          {/* ── Presets ── */}
          <div className="space-y-2 pb-3">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Presets</span>
            <div className="flex gap-1.5 flex-wrap">
              {BUILTIN_PRESETS.map((p) => (
                <Button key={p.label} variant="outline" size="sm" className={cn("h-6 text-[11px] gap-1 px-2 border", p.color)} onClick={() => applyPreset(p)}>
                  <p.icon className="h-3 w-3" />
                  {p.label}
                </Button>
              ))}
              {customPresets.map((p) => (
                <div key={p.id} className="flex items-center gap-0.5">
                  <Button variant="outline" size="sm" className="h-6 text-[11px] gap-1 px-2 border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100" onClick={() => applyPresetExclusive(p)}>
                    {p.label}
                  </Button>
                  <button onClick={() => deletePreset(p.id)} className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* ── Display ── */}
          <div className="py-2 space-y-2">
            <SectionHeader id="display" title="Affichage" />
            {openSections.has("display") && (
              <div className="pl-5">
                <div className="flex items-center space-x-2 border p-2 rounded-md">
                  <Checkbox id="deduplicate" checked={deduplicate} onCheckedChange={(c) => setDeduplicate(!!c)} />
                  <label htmlFor="deduplicate" className="text-xs font-medium cursor-pointer">Grouper par entreprise (déduplication)</label>
                </div>
              </div>
            )}
          </div>
          <Separator />

          {/* ── Entreprise ── */}
          <div className="py-2 space-y-2">
            <SectionHeader id="entreprise" title="Entreprise" />
            {openSections.has("entreprise") && (
              <div className="pl-5 space-y-3">
                <div><label className="text-xs font-medium mb-1 block">Catégorie</label><MultiChips filterKey="categorie" options={CATEGORIE_OPTIONS} /></div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Effectifs</label>
                  {EFFECTIFS_GROUPS.map((g) => {
                    const allSel = g.codes.every((c) => filters.effectifs?.split(",").includes(c));
                    return (
                      <div key={g.label} className="space-y-0.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground">{g.label}</span>
                          <button onClick={() => selectAllInGroup("effectifs", g.codes)} className="text-[10px] text-primary hover:underline">{allSel ? "Aucun" : "Tout"}</button>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {g.codes.map((code) => {
                            const sel = filters.effectifs?.split(",").includes(code);
                            return <button key={code} onClick={() => toggleFilterValue("effectifs", code)} className={cn("px-2 py-0.5 rounded text-[10px] border transition-all", sel ? "bg-primary/10 border-primary text-primary font-semibold" : "bg-background hover:bg-muted/50 border-border text-muted-foreground")}>{EFFECTIFS_LABELS[code]}</button>;
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div><label className="text-xs font-medium mb-1 block">Forme juridique</label><MultiChips filterKey="forme_juridique" options={FORME_JURIDIQUE_OPTIONS} /></div>
                <div><label className="text-xs font-medium mb-1 block">État</label><FilterSelect filterKey="api_etat" options={ETAT_OPTIONS} placeholder="Tous" /></div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Département</label>
                  <Input placeholder="75, 69, 33..." value={filters.departement || ""} onChange={(e) => setSingleFilter("departement", e.target.value || null)} className="h-7 text-xs" />
                </div>
                <NafFilter value={filters.code_naf || ""} onChange={(v) => setSingleFilter("code_naf", v || null)} />
              </div>
            )}
          </div>
          <Separator />

          {/* ── CA ── */}
          <div className="py-2 space-y-2">
            <SectionHeader id="ca" title="Chiffre d'affaires" />
            {openSections.has("ca") && (
              <div className="pl-5">
                <RangeChips filterKey="ca_range" ranges={CA_RANGES} color="bg-emerald-50 border-emerald-500 text-emerald-700 font-semibold" />
              </div>
            )}
          </div>
          <Separator />

          {/* ── Contact ── */}
          <div className="py-2 space-y-2">
            <SectionHeader id="contact" title="Contact & Réseaux" />
            {openSections.has("contact") && (
              <div className="pl-5 space-y-3">
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { key: "phone", label: "Tél présent", value: "!empty" },
                    { key: "phone_type", label: "Mobile", value: "=mobile" },
                    { key: "dirigeant_email", label: "Email dirigeant", value: "!empty" },
                    { key: "enriched_via", label: "Enrichi API", value: "!empty" },
                    { key: "email_principal", label: "Email site", value: "!empty" },
                  ].map((item) => {
                    const excludeVal = getExcludeValue(item.value);
                    const active = filters[item.key] === item.value;
                    const excluded = filters[item.key] === excludeVal;
                    return (
                      <div
                        key={item.key}
                        className={cn(
                          "flex items-center space-x-1.5 border p-2 rounded cursor-pointer hover:bg-muted/50 transition-all",
                          active && "border-green-500 bg-green-50",
                          excluded && "border-red-400 bg-red-50"
                        )}
                        onClick={() => {
                          if (active) setSingleFilter(item.key, excludeVal);
                          else if (excluded) setSingleFilter(item.key, null);
                          else setSingleFilter(item.key, item.value);
                        }}
                      >
                        <div className={cn("h-3.5 w-3.5 rounded-full border flex items-center justify-center flex-shrink-0", active ? "border-green-600 bg-green-600" : excluded ? "border-red-500 bg-red-500" : "border-muted-foreground")}>
                          {active && <Check className="h-2.5 w-2.5 text-white" />}
                          {excluded && <X className="h-2.5 w-2.5 text-white" />}
                        </div>
                        <span className={cn("text-[11px] font-medium", excluded && "line-through text-red-600")}>{item.label}</span>
                      </div>
                    );
                  })}
                </div>
                <div><label className="text-[10px] text-muted-foreground font-medium mb-1 block">Canaux contact</label><ChipGrid chips={CONTACT_CHIPS} /></div>
                <div><label className="text-[10px] text-muted-foreground font-medium mb-1 block">Réseaux sociaux</label><ChipGrid chips={SOCIAL_CHIPS} /></div>
              </div>
            )}
          </div>
          <Separator />

          {/* ── Identity ── */}
          <div className="py-2 space-y-2">
            <SectionHeader id="identity" title="Identité légale" />
            {openSections.has("identity") && (
              <div className="pl-5"><ChipGrid chips={IDENTITY_CHIPS} /></div>
            )}
          </div>
          <Separator />

          {/* ── Tech Debt ── */}
          <div className="py-2 space-y-2">
            <SectionHeader id="tech_debt" title="Dette technique" />
            {openSections.has("tech_debt") && (
              <div className="pl-5 space-y-3">
                <ChipGrid chips={TECH_DEBT_CHIPS} />
                <div><label className="text-[10px] text-muted-foreground font-medium mb-1 block">Copyright (ancienneté)</label><RangeChips filterKey="copyright_max" ranges={COPYRIGHT_RANGES} color="bg-amber-50 border-amber-500 text-amber-700 font-semibold" /></div>
              </div>
            )}
          </div>
          <Separator />

          {/* ── Tech Modern ── */}
          <div className="py-2 space-y-2">
            <SectionHeader id="tech_modern" title="Modernité technique" />
            {openSections.has("tech_modern") && (
              <div className="pl-5"><ChipGrid chips={MODERN_CHIPS} /></div>
            )}
          </div>
          <Separator />

          {/* ── Stack ── */}
          <div className="py-2 space-y-2">
            <SectionHeader id="stack" title="CMS & Stack" />
            {openSections.has("stack") && (
              <div className="pl-5 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-[10px] text-muted-foreground mb-0.5 block">CMS</label><FilterSelect filterKey="cms" options={CMS_OPTIONS} placeholder="Tous" /></div>
                  <div><label className="text-[10px] text-muted-foreground mb-0.5 block">Plateforme</label><FilterSelect filterKey="platform_name" options={PLATFORM_OPTIONS} placeholder="Toutes" /></div>
                  <div><label className="text-[10px] text-muted-foreground mb-0.5 block">Page builder</label><FilterSelect filterKey="page_builder_name" options={PAGE_BUILDER_OPTIONS} placeholder="Tous" /></div>
                  <div><label className="text-[10px] text-muted-foreground mb-0.5 block">JS Framework</label><FilterSelect filterKey="js_framework_name" options={JS_FRAMEWORK_OPTIONS} placeholder="Tous" /></div>
                  <div><label className="text-[10px] text-muted-foreground mb-0.5 block">CSS Framework</label><FilterSelect filterKey="css_framework_name" options={CSS_FRAMEWORK_OPTIONS} placeholder="Tous" /></div>
                </div>
                <ChipGrid chips={[
                  { key: "jquery_version", label: "jQuery", activeValue: "!empty" },
                  { key: "bootstrap_version", label: "Bootstrap", activeValue: "!empty" },
                  { key: "agency_signature", label: "Signature agence", activeValue: "!empty" },
                  { key: "php_version", label: "PHP détecté", activeValue: "!empty" },
                  { key: "powered_by", label: "X-Powered-By", activeValue: "!empty" },
                ]} />
              </div>
            )}
          </div>
          <Separator />

          {/* ── SEO ── */}
          <div className="py-2 space-y-2">
            <SectionHeader id="seo" title="SEO" />
            {openSections.has("seo") && (
              <div className="pl-5 space-y-2">
                <ChipGrid chips={SEO_CHIPS} />
                <div><label className="text-[10px] text-muted-foreground mb-0.5 block">Langue</label>
                  <FilterSelect filterKey="language" options={[
                    { value: "fr-FR", label: "fr-FR" },
                    { value: "fr", label: "fr" },
                    { value: "en", label: "en" },
                    { value: "en-US", label: "en-US" },
                  ]} placeholder="Toutes" />
                </div>
              </div>
            )}
          </div>
          <Separator />

          {/* ── Marketing ── */}
          <div className="py-2 space-y-2">
            <SectionHeader id="marketing" title="Analytics & Marketing" />
            {openSections.has("marketing") && (
              <div className="pl-5 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-[10px] text-muted-foreground mb-0.5 block">Analytics</label><FilterSelect filterKey="analytics_type" options={ANALYTICS_OPTIONS} placeholder="Tous" /></div>
                  <div><label className="text-[10px] text-muted-foreground mb-0.5 block">Cookie banner</label><FilterSelect filterKey="cookie_banner_name" options={COOKIE_BANNER_OPTIONS} placeholder="Tous" /></div>
                </div>
                <ChipGrid chips={MARKETING_CHIPS} />
              </div>
            )}
          </div>
          <Separator />

          {/* ── Business ── */}
          <div className="py-2 space-y-2">
            <SectionHeader id="business" title="Signaux business" />
            {openSections.has("business") && (
              <div className="pl-5"><ChipGrid chips={BUSINESS_CHIPS} /></div>
            )}
          </div>
          <Separator />

          {/* ── Enrichment ── */}
          <div className="py-2 space-y-2">
            <SectionHeader id="enrichment" title="Enrichissement & Vérif." />
            {openSections.has("enrichment") && (
              <div className="pl-5 space-y-2">
                <ChipGrid chips={ENRICHMENT_CHIPS} />
                <div><label className="text-[10px] text-muted-foreground font-medium mt-1 mb-0.5 block">Vérification téléphone</label><ChipGrid chips={PHONE_VERIF_CHIPS} /></div>
              </div>
            )}
          </div>
          <Separator />

          {/* ── Outreach ── */}
          <div className="py-2 space-y-2">
            <SectionHeader id="outreach" title="Statut prospection" />
            {openSections.has("outreach") && (() => {
              const isExcl = filters.outreach_status?.startsWith("!") ?? false;
              const rawValues = (filters.outreach_status?.replace(/^!/, "") || "").split(",").filter(Boolean);
              return (
                <div className="pl-5 space-y-2">
                  <div className="flex gap-1">
                    <button
                      onClick={() => {
                        if (!rawValues.length) return;
                        setSingleFilter("outreach_status", rawValues.join(","));
                      }}
                      className={cn("px-2 py-0.5 rounded text-[10px] border transition-all", !isExcl && rawValues.length > 0 ? "bg-primary/10 border-primary text-primary font-semibold" : "bg-background hover:bg-muted/50 border-border text-muted-foreground")}
                    >
                      Inclure
                    </button>
                    <button
                      onClick={() => {
                        if (!rawValues.length) return;
                        setSingleFilter("outreach_status", `!${rawValues.join(",")}`);
                      }}
                      className={cn("px-2 py-0.5 rounded text-[10px] border transition-all", isExcl ? "bg-red-50 border-red-400 text-red-600 font-semibold" : "bg-background hover:bg-muted/50 border-border text-muted-foreground")}
                    >
                      Exclure
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {STATUS_OPTIONS.map((s) => {
                      const sel = rawValues.includes(s.value);
                      return (
                        <div
                          key={s.value}
                          className={cn("flex items-center space-x-1.5 border rounded p-1.5 cursor-pointer hover:bg-muted/50 transition-colors", sel && (isExcl ? "border-red-500 bg-red-50" : "border-blue-500 bg-blue-50"))}
                          onClick={() => {
                            const next = sel ? rawValues.filter((v) => v !== s.value) : [...rawValues, s.value];
                            if (next.length === 0) {
                              setSingleFilter("outreach_status", null);
                            } else {
                              setSingleFilter("outreach_status", (isExcl ? "!" : "") + next.join(","));
                            }
                          }}
                        >
                          <Checkbox checked={sel} className="h-3.5 w-3.5" />
                          <span className={cn("text-[11px]", sel && isExcl && "line-through")}>{s.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>

        </div>

        {/* ── Footer ── */}
        <div className="flex-shrink-0 border-t px-5 py-3 space-y-2">
          {/* Save preset row */}
          {showSaveInput ? (
            <div className="flex gap-2">
              <Input placeholder="Nom du preset..." value={presetName} onChange={(e) => setPresetName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveCurrentAsPreset()} className="h-7 text-xs flex-1" autoFocus />
              <Button size="sm" className="h-7 text-xs px-3" onClick={saveCurrentAsPreset} disabled={!presetName.trim()}>
                <Save className="h-3 w-3 mr-1" /> Sauver
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => setShowSaveInput(false)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {countActiveFilters > 0 && (
                <>
                  <Button variant="ghost" size="sm" onClick={clearAll} className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50">
                    <X className="mr-1 h-3 w-3" /> Effacer ({countActiveFilters})
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowSaveInput(true)} className="h-7 text-xs text-violet-600 border-violet-200 hover:bg-violet-50">
                    <Save className="mr-1 h-3 w-3" /> Sauver preset
                  </Button>
                </>
              )}
              <Button size="sm" onClick={() => setIsOpen(false)} className="h-7 text-xs ml-auto">
                Résultats <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
