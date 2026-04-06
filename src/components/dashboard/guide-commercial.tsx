"use client";

import { useState } from "react";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Factory, Stethoscope, Hammer, ChevronDown, ChevronRight,
  AlertTriangle, MapPin, Target, ShieldAlert, FileText,
  Link2Off, Phone, Mail, Globe, Clock,
  Code, Lock, MonitorSmartphone, Zap,
  Ban, TrendingUp, Building2, BookOpen,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Collapsible Section                                                */
/* ------------------------------------------------------------------ */

function Section({
  id,
  title,
  icon: Icon,
  badge,
  badgeColor,
  defaultOpen = false,
  children,
}: {
  id: string;
  title: string;
  icon: React.ElementType;
  badge?: string;
  badgeColor?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div id={id} className="scroll-mt-20">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 text-left group py-3 px-1 rounded-lg hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-blue-50 text-blue-600 shrink-0">
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
            {badge && (
              <Badge className={badgeColor || "bg-blue-100 text-blue-700 border-blue-200"}>
                {badge}
              </Badge>
            )}
          </div>
        </div>
        {open ? (
          <ChevronDown className="h-5 w-5 text-gray-400 shrink-0" />
        ) : (
          <ChevronRight className="h-5 w-5 text-gray-400 shrink-0" />
        )}
      </button>
      {open && <div className="pl-12 pb-6 space-y-4">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ICP Card                                                           */
/* ------------------------------------------------------------------ */

function ICPCard({
  icon: Icon,
  title,
  subtitle,
  color,
  profil,
  siteActuel,
  psychologie,
  detection,
}: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  color: string;
  profil: string;
  siteActuel: string;
  psychologie: string;
  detection: string;
}) {
  const colorMap: Record<string, { bg: string; text: string; border: string; iconBg: string }> = {
    amber: { bg: "bg-amber-50", text: "text-amber-800", border: "border-amber-200", iconBg: "bg-amber-100" },
    blue: { bg: "bg-blue-50", text: "text-blue-800", border: "border-blue-200", iconBg: "bg-blue-100" },
    green: { bg: "bg-emerald-50", text: "text-emerald-800", border: "border-emerald-200", iconBg: "bg-emerald-100" },
  };
  const c = colorMap[color] || colorMap.blue;

  return (
    <Card className={`${c.border} ${c.bg} py-0 overflow-hidden`}>
      <CardHeader className="pb-2 pt-5">
        <div className="flex items-center gap-3">
          <div className={`h-10 w-10 rounded-lg ${c.iconBg} ${c.text} flex items-center justify-center`}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className={`text-base ${c.text}`}>{title}</CardTitle>
            <CardDescription className={`${c.text} opacity-70 text-xs`}>{subtitle}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pb-5 pt-2">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Profil type</p>
          <p className="text-sm text-gray-700">{profil}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Site actuel</p>
          <p className="text-sm text-gray-700">{siteActuel}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Psychologie d&apos;achat</p>
          <p className="text-sm text-gray-700 italic">{psychologie}</p>
        </div>
        <div className="pt-1 border-t border-dashed border-gray-300">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Detection dans le dashboard</p>
          <p className="text-sm text-gray-600 font-mono bg-white/60 rounded px-2 py-1">{detection}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Signal Row                                                         */
/* ------------------------------------------------------------------ */

function SignalRow({
  icon: Icon,
  signal,
  argument,
  severity,
}: {
  icon: React.ElementType;
  signal: string;
  argument: string;
  severity: "high" | "medium" | "low";
}) {
  const severityMap = {
    high: { bg: "bg-red-50", border: "border-red-200", badge: "bg-red-100 text-red-700 border-red-200", label: "Urgent" },
    medium: { bg: "bg-amber-50", border: "border-amber-200", badge: "bg-amber-100 text-amber-700 border-amber-200", label: "Important" },
    low: { bg: "bg-blue-50", border: "border-blue-200", badge: "bg-blue-100 text-blue-700 border-blue-200", label: "Utile" },
  };
  const s = severityMap[severity];

  return (
    <div className={`${s.bg} ${s.border} border rounded-xl p-4 space-y-2`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-gray-500" />
          <span className="text-sm font-semibold text-gray-800">{signal}</span>
        </div>
        <Badge className={s.badge}>{s.label}</Badge>
      </div>
      <p className="text-sm text-gray-700 leading-relaxed">
        &laquo; {argument} &raquo;
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function GuideCommercial() {
  return (
    <div className="max-w-4xl mx-auto space-y-2">
      {/* Hero */}
      <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 rounded-2xl p-8 text-white">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-10 w-10 rounded-xl bg-white/20 flex items-center justify-center">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Guide Commercial</h1>
            <p className="text-blue-200 text-sm">Refonte de sites web &mdash; Budget 1 500 - 5 000 EUR</p>
          </div>
        </div>
        <p className="text-blue-100 text-sm leading-relaxed max-w-2xl">
          Ce guide rassemble les profils clients ideaux, les arguments de vente par signal technique
          detecte, et les zones geographiques prioritaires. Utilisez-le comme reference
          lors de vos appels de prospection.
        </p>

        {/* Mini nav */}
        <div className="flex flex-wrap gap-2 mt-5">
          {[
            { href: "#icp", label: "Profils clients" },
            { href: "#arguments", label: "Arguments" },
            { href: "#eviter", label: "Faux amis" },
            { href: "#departements", label: "Departements" },
            { href: "#secteurs", label: "Secteurs" },
          ].map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="px-3 py-1 bg-white/15 hover:bg-white/25 rounded-lg text-xs font-medium transition-colors"
            >
              {item.label}
            </a>
          ))}
        </div>
      </div>

      {/* Divider */}
      <div className="border-b" />

      {/* ============================================================ */}
      {/*  1. PROFILS CLIENTS IDEAUX (ICP)                             */}
      {/* ============================================================ */}
      <Section
        id="icp"
        title="Profils clients ideaux (ICP)"
        icon={Target}
        badge="3 profils"
        badgeColor="bg-emerald-100 text-emerald-700 border-emerald-200"
        defaultOpen={true}
      >
        <p className="text-sm text-gray-600 mb-4">
          Ces trois profils representent les meilleurs prospects pour une refonte de site
          dans la tranche 1 500 - 5 000 EUR. Ils ont le budget, le besoin, et la douleur.
        </p>

        <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-1">
          <ICPCard
            icon={Factory}
            title="L'Industriel PME"
            subtitle="La pepite cachee"
            color="amber"
            profil="Usinage, Plasturgie, Grossiste B2B, Transport specialise"
            siteActuel="Fait en 2005, visuellement date, mais l'entreprise fait 2M EUR de CA"
            psychologie="Ils ont honte de donner leur URL a leurs clients internationaux. 5 000 EUR est une depense petite caisse pour eux."
            detection="NAF Industrie/Gros + TechDebt elevee + has_hreflang"
          />

          <ICPCard
            icon={Stethoscope}
            title="Le Professionnel Liberal Etabli"
            subtitle="L'image = les honoraires"
            color="blue"
            profil="Cabinet d'avocats (3+ associes), Clinique veterinaire, Cabinet dentaire, Architecte"
            siteActuel="Non responsive, photos floues, design des annees 2010"
            psychologie="Leur image professionnelle conditionne directement la perception de leurs honoraires. Un site date fait baisser leur valeur percue."
            detection="NAF 69/71/86 + Telephone Fixe"
          />

          <ICPCard
            icon={Hammer}
            title="L'Artisan du Beau (Habitat)"
            subtitle="Ils vendent du visuel"
            color="green"
            profil="Paysagiste, Pisciniste, Verandaliste, Cuisiniste"
            siteActuel="Galeries photos Flash ou images minuscules, pas d'images modernes"
            psychologie="Leur metier est visuel par essence. Un site qui ne met pas en valeur leurs realisations tue leur vente avant meme le premier contact."
            detection='Mots cles "realisation", "galerie" + pas d&apos;images modernes (WebP/AVIF)'
          />
        </div>
      </Section>

      <div className="border-b" />

      {/* ============================================================ */}
      {/*  2. ARGUMENTS DE VENTE                                       */}
      {/* ============================================================ */}
      <Section
        id="arguments"
        title="Arguments de vente par signal"
        icon={Zap}
        badge="10 signaux"
        badgeColor="bg-amber-100 text-amber-700 border-amber-200"
        defaultOpen={true}
      >
        <p className="text-sm text-gray-600 mb-4">
          Chaque signal technique detecte dans le dashboard correspond a un argument commercial
          concret a utiliser au telephone. Classement par urgence.
        </p>

        <div className="space-y-3">
          <SignalRow
            icon={ShieldAlert}
            signal="Site hacke / spam"
            argument="Votre site a ete pirate et affiche des publicites indesirables. C'est urgent, votre reputation est en jeu en ce moment meme."
            severity="high"
          />
          <SignalRow
            icon={Zap}
            signal="Flash"
            argument="Le Flash n'est plus supporte depuis 2021. Une partie de votre site est invisible pour tous vos visiteurs."
            severity="high"
          />
          <SignalRow
            icon={Lock}
            signal="Pas HTTPS"
            argument="Votre site affiche 'Non securise' dans Chrome. Ca fait fuir 85% des visiteurs avant meme qu'ils voient votre contenu."
            severity="high"
          />
          <SignalRow
            icon={MonitorSmartphone}
            signal="Pas responsive"
            argument="60% de vos visiteurs sont sur mobile. Votre site est illisible sur un telephone, vous perdez plus de la moitie de vos contacts potentiels."
            severity="high"
          />
          <SignalRow
            icon={FileText}
            signal="PDF Menu / Tarifs"
            argument="Vos clients sur mobile doivent telecharger un PDF pour voir vos prix. C'est le meilleur moyen de les envoyer chez le concurrent."
            severity="medium"
          />
          <SignalRow
            icon={Link2Off}
            signal="Liens sociaux casses"
            argument="Vous envoyez vos visiteurs sur l'accueil de Facebook au lieu de votre page pro. Ca donne une image peu serieuse."
            severity="medium"
          />
          <SignalRow
            icon={Phone}
            signal="Telephone non cliquable"
            argument="Votre numero n'est pas cliquable. Sur mobile, c'est une torture pour vous appeler. Chaque clic en moins = plus d'appels."
            severity="medium"
          />
          <SignalRow
            icon={Mail}
            signal="Formulaire mailto:"
            argument="Votre formulaire de contact ouvre le logiciel de mail au lieu d'envoyer directement. La plupart des gens abandonnent a cette etape."
            severity="medium"
          />
          <SignalRow
            icon={Clock}
            signal="Copyright ancien (>3 ans)"
            argument="Votre site n'a pas ete mis a jour depuis [annee]. Google penalise les sites abandonnes dans ses resultats de recherche."
            severity="low"
          />
          <SignalRow
            icon={Code}
            signal="Vieux HTML (font, marquee)"
            argument="Votre site utilise des technologies des annees 2000. Les navigateurs modernes peuvent mal l'afficher, et ca s'aggrave avec chaque mise a jour."
            severity="low"
          />
        </div>
      </Section>

      <div className="border-b" />

      {/* ============================================================ */}
      {/*  3. FAUX AMIS                                                */}
      {/* ============================================================ */}
      <Section
        id="eviter"
        title="A eviter (faux amis)"
        icon={Ban}
        badge="Attention"
        badgeColor="bg-red-100 text-red-700 border-red-200"
        defaultOpen={false}
      >
        <p className="text-sm text-gray-600 mb-4">
          Ces profils semblent avoir besoin d&apos;un site, mais le taux de conversion est tres
          faible. Evitez d&apos;y passer du temps.
        </p>

        <div className="grid gap-3 sm:grid-cols-1 md:grid-cols-3">
          <Card className="border-red-200 bg-red-50/50 py-0">
            <CardHeader className="pb-1 pt-4">
              <CardTitle className="text-sm text-red-800 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Restaurants
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4 pt-1">
              <p className="text-xs text-gray-600 leading-relaxed">
                Marges faibles, preferent Instagram et TheFork. Rarement prets a investir
                dans un site web quand les plateformes de livraison suffisent.
              </p>
            </CardContent>
          </Card>

          <Card className="border-red-200 bg-red-50/50 py-0">
            <CardHeader className="pb-1 pt-4">
              <CardTitle className="text-sm text-red-800 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Startups / Agences
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4 pt-1">
              <p className="text-xs text-gray-600 leading-relaxed">
                Le font en interne ou ont des exigences irrealistes pour 1 500 EUR.
                Demandent beaucoup de temps pour peu de resultat.
              </p>
            </CardContent>
          </Card>

          <Card className="border-red-200 bg-red-50/50 py-0">
            <CardHeader className="pb-1 pt-4">
              <CardTitle className="text-sm text-red-800 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Petit commerce de detail
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4 pt-1">
              <p className="text-xs text-gray-600 leading-relaxed">
                Se font manger par Amazon et Vinted. Budget marketing proche de zero,
                pas de retour sur investissement pour un site.
              </p>
            </CardContent>
          </Card>
        </div>
      </Section>

      <div className="border-b" />

      {/* ============================================================ */}
      {/*  4. DEPARTEMENTS PRIORITAIRES                                */}
      {/* ============================================================ */}
      <Section
        id="departements"
        title="Departements prioritaires"
        icon={MapPin}
        badge="8 departements"
        badgeColor="bg-purple-100 text-purple-700 border-purple-200"
        defaultOpen={false}
      >
        <p className="text-sm text-gray-600 mb-4">
          Budget moyen de refonte 30-50% plus eleve qu&apos;en zone rurale. Concentrez vos
          efforts sur ces zones en priorite.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { code: "75", name: "Paris", icon: "capital" },
            { code: "92", name: "Hauts-de-Seine", icon: "business" },
            { code: "69", name: "Rhone", icon: "metro" },
            { code: "33", name: "Gironde", icon: "metro" },
            { code: "44", name: "Loire-Atlantique", icon: "metro" },
            { code: "13", name: "Bouches-du-Rhone", icon: "metro" },
            { code: "59", name: "Nord", icon: "metro" },
            { code: "31", name: "Haute-Garonne", icon: "metro" },
          ].map((dept) => (
            <Card key={dept.code} className="py-0 hover:shadow-md transition-shadow cursor-default">
              <CardContent className="py-4 flex items-center gap-3">
                <div className={`h-10 w-10 rounded-lg flex items-center justify-center font-bold text-sm ${
                  dept.icon === "capital"
                    ? "bg-amber-100 text-amber-700"
                    : dept.icon === "business"
                    ? "bg-blue-100 text-blue-700"
                    : "bg-gray-100 text-gray-700"
                }`}>
                  {dept.code}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-800">{dept.name}</p>
                  <p className="text-xs text-gray-500">
                    {dept.icon === "capital" ? "Capitale" : dept.icon === "business" ? "Affaires" : "Metropole"}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-3 p-3 bg-purple-50 border border-purple-200 rounded-xl">
          <p className="text-xs text-purple-700 flex items-center gap-2">
            <TrendingUp className="h-3.5 w-3.5" />
            <span className="font-medium">Astuce :</span>
            Filtrez par departement dans le dashboard pour cibler ces zones. Les entreprises
            de ces departements ont en moyenne un budget refonte 30 a 50% superieur.
          </p>
        </div>
      </Section>

      <div className="border-b" />

      {/* ============================================================ */}
      {/*  5. SECTEURS PRIORITAIRES                                    */}
      {/* ============================================================ */}
      <Section
        id="secteurs"
        title="Secteurs prioritaires"
        icon={Building2}
        badge="3 secteurs"
        badgeColor="bg-teal-100 text-teal-700 border-teal-200"
        defaultOpen={false}
      >
        <p className="text-sm text-gray-600 mb-4">
          Ces secteurs combinent un fort besoin d&apos;image en ligne, un budget disponible,
          et une sensibilite a la modernite de leur presence web.
        </p>

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-teal-200 bg-teal-50/30 py-0">
            <CardHeader className="pb-1 pt-4">
              <div className="flex items-center gap-2">
                <Stethoscope className="h-4 w-4 text-teal-700" />
                <CardTitle className="text-sm text-teal-800">Sante</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pb-4 pt-2">
              <div className="flex flex-wrap gap-1.5">
                {["Dentistes", "Orthodontistes", "Kinesitherapeutes", "Cliniques veterinaires"].map((s) => (
                  <Badge key={s} className="bg-teal-100 text-teal-700 border-teal-200 text-xs">
                    {s}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-indigo-200 bg-indigo-50/30 py-0">
            <CardHeader className="pb-1 pt-4">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-indigo-700" />
                <CardTitle className="text-sm text-indigo-800">Droit</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pb-4 pt-2">
              <div className="flex flex-wrap gap-1.5">
                {["Avocats", "Notaires", "Huissiers", "Experts-comptables"].map((s) => (
                  <Badge key={s} className="bg-indigo-100 text-indigo-700 border-indigo-200 text-xs">
                    {s}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-amber-200 bg-amber-50/30 py-0">
            <CardHeader className="pb-1 pt-4">
              <div className="flex items-center gap-2">
                <Hammer className="h-4 w-4 text-amber-700" />
                <CardTitle className="text-sm text-amber-800">BTP Second Oeuvre</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pb-4 pt-2">
              <div className="flex flex-wrap gap-1.5">
                {["Renovation", "Piscine", "Veranda", "Cuisine", "Chauffage"].map((s) => (
                  <Badge key={s} className="bg-amber-100 text-amber-700 border-amber-200 text-xs">
                    {s}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </Section>

      {/* Keyboard Shortcuts */}
      <Section id="shortcuts" title="Raccourcis clavier" icon={Zap} badge="Productivite" badgeColor="bg-purple-100 text-purple-700">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground mb-3">
            Utilisez ces raccourcis pour naviguer plus rapidement dans l&apos;application.
            Appuyez sur <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">?</kbd> n&apos;importe ou pour afficher l&apos;aide.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { keys: "?", desc: "Afficher l'aide raccourcis" },
              { keys: "g → p", desc: "Aller a /prospects" },
              { keys: "g → s", desc: "Aller a /segments" },
              { keys: "g → h", desc: "Aller a /historique" },
              { keys: "g → k", desc: "Aller au pipeline (kanban)" },
              { keys: "g → a", desc: "Aller a /admin" },
              { keys: "Esc", desc: "Fermer un panneau / dialogue" },
            ].map(s => (
              <div key={s.keys} className="flex items-center justify-between bg-gray-50 rounded px-3 py-2">
                <span className="text-sm">{s.desc}</span>
                <kbd className="px-2 py-0.5 bg-white border rounded text-xs font-mono text-gray-600">{s.keys}</kbd>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* Footer */}
      <div className="border-t pt-4 pb-8 text-center">
        <p className="text-xs text-gray-400">
          Guide commercial &mdash; Prospection .fr &mdash; Donnees issues de l&apos;analyse de 996K+ entreprises
        </p>
      </div>
    </div>
  );
}
