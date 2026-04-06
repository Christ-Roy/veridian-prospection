"use client";

import { Card } from "@/components/ui/card";

export function SettingsReference() {
  return (
    <Card className="p-6 space-y-4">
      <h2 className="text-lg font-semibold">Reference technique</h2>
      <p className="text-sm text-muted-foreground">
        Documentation interne des criteres, signaux et formules utilises par le dashboard.
        Ces valeurs sont definies dans le code source.
      </p>

      {/* Tech Score */}
      <details className="border rounded">
        <summary className="p-3 cursor-pointer font-semibold text-sm hover:bg-muted/30">
          Score technique (tech_score) — Formule de calcul
        </summary>
        <div className="px-3 pb-3 text-xs space-y-2">
          <p className="text-muted-foreground">
            Somme lineaire de signaux d&apos;obsolescence. Plus le score est eleve, plus le site a
            besoin d&apos;une refonte.
          </p>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b">
                <th className="py-1 pr-2">Signal</th>
                <th className="py-1 pr-2">Points</th>
                <th className="py-1">Description</th>
              </tr>
            </thead>
            <tbody className="text-muted-foreground">
              <tr><td className="py-0.5 pr-2 font-mono">has_responsive = 0</td><td className="pr-2 text-red-500">+15</td><td>Site pas mobile-friendly</td></tr>
              <tr><td className="py-0.5 pr-2 font-mono">has_https = 0</td><td className="pr-2 text-red-500">+15</td><td>Pas de HTTPS</td></tr>
              <tr><td className="py-0.5 pr-2 font-mono">has_old_html = 1</td><td className="pr-2 text-orange-500">+10</td><td>Balises &lt;font&gt;, &lt;marquee&gt;, &lt;center&gt;</td></tr>
              <tr><td className="py-0.5 pr-2 font-mono">has_flash = 1</td><td className="pr-2 text-orange-500">+10</td><td>Flash detecte (mort depuis 2020)</td></tr>
              <tr><td className="py-0.5 pr-2 font-mono">has_layout_tables = 1</td><td className="pr-2 text-orange-500">+8</td><td>Mise en page avec &lt;table&gt;</td></tr>
              <tr><td className="py-0.5 pr-2 font-mono">has_mixed_content = 1</td><td className="pr-2">+5</td><td>HTTP dans une page HTTPS</td></tr>
              <tr><td className="py-0.5 pr-2 font-mono">has_phpsessid = 1</td><td className="pr-2">+5</td><td>Session PHP dans l&apos;URL</td></tr>
              <tr><td className="py-0.5 pr-2 font-mono">has_ie_polyfills = 1</td><td className="pr-2">+5</td><td>Polyfills Internet Explorer</td></tr>
              <tr><td className="py-0.5 pr-2 font-mono">has_meta_keywords = 1</td><td className="pr-2">+4</td><td>Meta keywords (SEO obsolete)</td></tr>
              <tr><td className="py-0.5 pr-2 font-mono">has_viewport_no_scale = 1</td><td className="pr-2">+3</td><td>user-scalable=no</td></tr>
              <tr><td className="py-0.5 pr-2 font-mono">has_lorem_ipsum = 1</td><td className="pr-2">+3</td><td>Contenu placeholder</td></tr>
              <tr><td className="py-0.5 pr-2 font-mono">has_favicon = 0</td><td className="pr-2">+2</td><td>Pas de favicon</td></tr>
              <tr><td className="py-0.5 pr-2 font-mono">has_modern_images = 0</td><td className="pr-2">+2</td><td>Pas de WebP/AVIF</td></tr>
              <tr><td className="py-0.5 pr-2 font-mono">has_minified_assets = 0</td><td className="pr-2">+2</td><td>CSS/JS pas minifies</td></tr>
              <tr><td className="py-0.5 pr-2 font-mono">has_compression = 0</td><td className="pr-2">+2</td><td>Pas de gzip/brotli</td></tr>
              <tr><td className="py-0.5 pr-2 font-mono">copyright &lt;= 2018</td><td className="pr-2 text-red-500">+10</td><td>Site de 8+ ans</td></tr>
              <tr><td className="py-0.5 pr-2 font-mono">copyright 2019-2021</td><td className="pr-2 text-orange-500">+5</td><td>Site de 5-7 ans</td></tr>
            </tbody>
          </table>
          <p className="text-muted-foreground">Max theorique = 106. Moyenne observee ~15-25.</p>
        </div>
      </details>

      {/* Eclate Score */}
      <details className="border rounded">
        <summary className="p-3 cursor-pointer font-semibold text-sm hover:bg-muted/30">
          Score eclate (eclate_score) — 0 a 3
        </summary>
        <div className="px-3 pb-3 text-xs space-y-1 text-muted-foreground">
          <p>Resume binaire de 3 signaux critiques :</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li><span className="font-mono">+1</span> si pas responsive (has_responsive = 0)</li>
            <li><span className="font-mono">+1</span> si pas HTTPS (has_https = 0)</li>
            <li><span className="font-mono">+1</span> si copyright &lt;= 2020</li>
          </ul>
          <p className="mt-1">3/3 = site completement eclate. 0/3 = site correct sur ces 3 criteres.</p>
          <p>Distribution : 89% a 0/3, 7.5% a 1/3, 3% a 2/3, 0.2% a 3/3</p>
        </div>
      </details>

      {/* NAF par preset */}
      <details className="border rounded">
        <summary className="p-3 cursor-pointer font-semibold text-sm hover:bg-muted/30">
          NAF par preset — Prefixes sectoriels
        </summary>
        <div className="px-3 pb-3 text-xs space-y-2">
          <table className="w-full text-left text-muted-foreground">
            <thead><tr className="border-b"><th className="py-1 pr-2">Preset</th><th className="py-1">Prefixes NAF</th></tr></thead>
            <tbody>
              <tr><td className="py-0.5 font-semibold text-amber-600">Top Prospects</td><td>Tous (eclate &gt;= 2 + telephone)</td></tr>
              <tr><td className="py-0.5 font-semibold text-orange-600">BTP &amp; Artisans</td><td className="font-mono">41.*, 43.*</td></tr>
              <tr><td className="py-0.5 font-semibold text-blue-600">Sante &amp; Droit</td><td className="font-mono">86.*, 69.*, 71.*</td></tr>
              <tr><td className="py-0.5 font-semibold text-green-600">Commerce &amp; Services</td><td className="font-mono">55.*, 56.*, 45.*, 47.*, 96.*, 93.*</td></tr>
              <tr><td className="py-0.5 font-semibold text-gray-600">Tous</td><td>Tous (telephone requis)</td></tr>
              <tr><td className="py-0.5 font-semibold text-indigo-600">Historique</td><td>Deja consultes (last_visited not null)</td></tr>
            </tbody>
          </table>
        </div>
      </details>

      {/* Effectifs INSEE */}
      <details className="border rounded">
        <summary className="p-3 cursor-pointer font-semibold text-sm hover:bg-muted/30">
          Codes effectifs INSEE — Tranches salariales
        </summary>
        <div className="px-3 pb-3 text-xs">
          <table className="w-full text-left text-muted-foreground">
            <thead><tr className="border-b"><th className="py-1 pr-4">Code</th><th className="py-1 pr-4">Tranche</th><th className="py-1">Nb dans la DB</th></tr></thead>
            <tbody>
              <tr><td className="py-0.5 font-mono">00</td><td>0 salarie</td><td>~4K</td></tr>
              <tr><td className="py-0.5 font-mono">01</td><td>1-2 salaries</td><td>~47K</td></tr>
              <tr><td className="py-0.5 font-mono">02</td><td>3-5 salaries</td><td>~37K</td></tr>
              <tr><td className="py-0.5 font-mono">03</td><td>6-9 salaries</td><td>~25K</td></tr>
              <tr><td className="py-0.5 font-mono">11</td><td>10-19 salaries</td><td>~27K</td></tr>
              <tr><td className="py-0.5 font-mono">12</td><td>20-49 salaries</td><td>~18K</td></tr>
              <tr><td className="py-0.5 font-mono">21</td><td>50-99 salaries</td><td>~9K</td></tr>
              <tr><td className="py-0.5 font-mono">22</td><td>100-199 salaries</td><td>~7K</td></tr>
              <tr><td className="py-0.5 font-mono">31</td><td>200-249 salaries</td><td>~1.3K</td></tr>
              <tr><td className="py-0.5 font-mono">32</td><td>250-499 salaries</td><td>~3.4K</td></tr>
              <tr><td className="py-0.5 font-mono">41</td><td>500-999 salaries</td><td>~2.5K</td></tr>
              <tr><td className="py-0.5 font-mono">42</td><td>1000-1999 salaries</td><td>~8.6K</td></tr>
              <tr><td className="py-0.5 font-mono">NN</td><td>Non renseigne</td><td>~162K</td></tr>
            </tbody>
          </table>
        </div>
      </details>

      {/* Qualite des donnees */}
      <details className="border rounded">
        <summary className="p-3 cursor-pointer font-semibold text-sm hover:bg-muted/30">
          Qualite des donnees — Distribution enrichissement
        </summary>
        <div className="px-3 pb-3 text-xs space-y-1 text-muted-foreground">
          <table className="w-full text-left">
            <thead><tr className="border-b"><th className="py-1 pr-4">Source</th><th className="py-1 pr-4">Signification</th><th className="py-1">Volume</th></tr></thead>
            <tbody>
              <tr><td className="py-0.5 font-mono">enriched_via = siren</td><td>Match exact par SIREN via API gouv</td><td>~254K (9%)</td></tr>
              <tr><td className="py-0.5 font-mono">enriched_via = name_cp</td><td>Match fuzzy nom + code postal</td><td>~98K (3.5%)</td></tr>
              <tr><td className="py-0.5 font-mono">enriched_via = name_cp_not_found</td><td>Cherche mais pas trouve</td><td>~304K (11%)</td></tr>
              <tr><td className="py-0.5 font-mono">enriched_via = name_blacklisted</td><td>Nom trop generique (blacklist)</td><td>~14K</td></tr>
              <tr><td className="py-0.5 font-mono">enriched_via IS NULL</td><td>Jamais enrichi</td><td>~2.2M (76%)</td></tr>
            </tbody>
          </table>
          <p className="mt-2">Fiabilite : SIREN = 100%, name_cp = ~50%, non enrichi = 0%. Seuls les SIREN et name_cp sont utilises pour les presets sectoriels.</p>
        </div>
      </details>

      {/* Domaines metier */}
      <details className="border rounded">
        <summary className="p-3 cursor-pointer font-semibold text-sm hover:bg-muted/30">
          Domaines metier — Regroupement des 18 secteurs
        </summary>
        <div className="px-3 pb-3 text-xs space-y-1 text-muted-foreground">
          <table className="w-full text-left">
            <thead><tr className="border-b"><th className="py-1 pr-2">Domaine</th><th className="py-1">Prefixes NAF</th></tr></thead>
            <tbody>
              <tr><td className="py-0.5">BTP / Construction</td><td className="font-mono">41.*, 43.*</td></tr>
              <tr><td className="py-0.5">Sante / Paramedical</td><td className="font-mono">86.*</td></tr>
              <tr><td className="py-0.5">Beaute / Bien-etre</td><td className="font-mono">96.02*, 96.04, 96.09</td></tr>
              <tr><td className="py-0.5">Immobilier</td><td className="font-mono">68.*</td></tr>
              <tr><td className="py-0.5">Restauration / Hotellerie</td><td className="font-mono">55.*, 56.*</td></tr>
              <tr><td className="py-0.5">Auto / Garage</td><td className="font-mono">45.*</td></tr>
              <tr><td className="py-0.5">Commerce de detail</td><td className="font-mono">47.*</td></tr>
              <tr><td className="py-0.5">Droit / Comptabilite</td><td className="font-mono">69.*</td></tr>
              <tr><td className="py-0.5">Ingenierie / Architecture</td><td className="font-mono">71.*</td></tr>
              <tr><td className="py-0.5">Informatique / Digital</td><td className="font-mono">58.*, 62.*, 63.*</td></tr>
              <tr><td className="py-0.5">Conseil / Services</td><td className="font-mono">70.*, 73.*, 74.*, 78.*, 82.*</td></tr>
              <tr><td className="py-0.5">Formation / Enseignement</td><td className="font-mono">85.4*, 85.5*</td></tr>
              <tr><td className="py-0.5">Nettoyage / Entretien</td><td className="font-mono">81.*</td></tr>
              <tr><td className="py-0.5">Reparation / Maintenance</td><td className="font-mono">33.*, 95.*</td></tr>
              <tr><td className="py-0.5">Transport / Logistique</td><td className="font-mono">49.*, 52.*, 53.*</td></tr>
              <tr><td className="py-0.5">Sport / Loisirs</td><td className="font-mono">93.*</td></tr>
              <tr><td className="py-0.5">Industrie / Fabrication</td><td className="font-mono">10-32.*</td></tr>
              <tr><td className="py-0.5">Assurance / Finance</td><td className="font-mono">64.*, 65.*, 66.*</td></tr>
            </tbody>
          </table>
        </div>
      </details>

      {/* Lead flags */}
      <details className="border rounded">
        <summary className="p-3 cursor-pointer font-semibold text-sm hover:bg-muted/30">
          Lead flags — Tags calcules par domaine
        </summary>
        <div className="px-3 pb-3 text-xs space-y-1 text-muted-foreground">
          <table className="w-full text-left">
            <thead><tr className="border-b"><th className="py-1 pr-2">Flag</th><th className="py-1">Condition</th></tr></thead>
            <tbody>
              <tr><td className="py-0.5 font-mono">has_phone</td><td>phone_principal renseigne</td></tr>
              <tr><td className="py-0.5 font-mono">has_email</td><td>email_principal renseigne</td></tr>
              <tr><td className="py-0.5 font-mono">has_name</td><td>nom d&apos;entreprise trouve</td></tr>
              <tr><td className="py-0.5 font-mono">has_address</td><td>ville ou adresse trouvee</td></tr>
              <tr><td className="py-0.5 font-mono">enriched</td><td>enrichi via SIREN ou name+CP</td></tr>
              <tr><td className="py-0.5 font-mono">siren_dup</td><td>meme SIREN sur &gt;1 domaine (doublon)</td></tr>
              <tr><td className="py-0.5 font-mono">siren_polluter</td><td>SIREN sur &gt;50 domaines (hebergeur/revendeur)</td></tr>
              <tr><td className="py-0.5 font-mono">http_dead</td><td>site en erreur HTTP (non-200)</td></tr>
              <tr><td className="py-0.5 font-mono">has_mobile</td><td>numero mobile valide (06/07)</td></tr>
              <tr><td className="py-0.5 font-mono">has_fixe</td><td>numero fixe valide</td></tr>
              <tr><td className="py-0.5 font-mono">has_email_dir</td><td>email dirigeant trouve par SMTP</td></tr>
              <tr><td className="py-0.5 font-mono">phone_shared</td><td>numero partage par plusieurs entreprises</td></tr>
            </tbody>
          </table>
        </div>
      </details>

      {/* DB Stats */}
      <details className="border rounded">
        <summary className="p-3 cursor-pointer font-semibold text-sm hover:bg-muted/30">
          Statistiques DB — Vue d&apos;ensemble
        </summary>
        <div className="px-3 pb-3 text-xs space-y-1 text-muted-foreground">
          <ul className="space-y-0.5">
            <li>Total resultats : ~3.1M lignes</li>
            <li>Excluded (niveau=excluded) : ~1.5M (48%)</li>
            <li>Redflag : ~43K (1.5%)</li>
            <li>Exploitables : ~1.5M (50%)</li>
            <li>Avec telephone : ~570K (18%)</li>
            <li>Avec email : ~692K (22%)</li>
            <li>Avec SIRET : ~354K (11%)</li>
            <li>Email verification : ~97K lignes</li>
            <li>Phone verification : table presente</li>
            <li>Taille DB : ~2.8 Go</li>
          </ul>
        </div>
      </details>
    </Card>
  );
}
