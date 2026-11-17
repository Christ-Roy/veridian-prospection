/**
 * Libellés des valeurs codées d'ODH : UN seul dictionnaire pour l'écran (puces, phrases, tableau, barres,
 * fiche) et pour l'export. Aucune dépendance serveur ni React : importable des deux côtés.
 *
 * Règle : une valeur inconnue reste telle quelle (on ne devine jamais), une valeur vide se lit « Non renseigné ».
 * Les valeurs réelles des énumérations ont été relevées sur odh.company_prospection_current (16/11).
 */
import { NAF_LIBELLES, normaliserNaf } from "./naf";

type Table = Readonly<Record<string, string>>;

/** AAAA-MM-JJ → JJ/MM/AAAA (autre texte rendu tel quel). */
export function formaterDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// ---------------------------------------------------------------- forme juridique (INSEE, niveau III)

/**
 * Catégories juridiques INSEE (niveau III, 4 chiffres) : libellé court usuel (sigle quand il existe).
 * Le code est gardé à côté du libellé à l'écran, car plusieurs catégories partagent un sigle usuel.
 */
const FORMES_JURIDIQUES: Table = {
  "1000": "Entrepreneur individuel",
  "2110": "Indivision entre personnes physiques", "2120": "Indivision avec personne morale",
  "2200": "Société créée de fait", "2210": "Société créée de fait entre personnes physiques", "2220": "Société créée de fait avec personne morale",
  "2310": "Société en participation entre personnes physiques", "2320": "Société en participation avec personne morale",
  "2385": "Société en participation de professions libérales", "2400": "Fiducie", "2700": "Paroisse hors zone concordataire",
  "2900": "Autre groupement de droit privé sans personnalité morale",
  "3110": "Représentation d'un organisme public étranger", "3120": "Société commerciale étrangère", "3205": "Organisation internationale",
  "3210": "État, collectivité ou établissement public étranger", "3220": "Société étrangère non immatriculée au RCS", "3290": "Autre personne morale de droit étranger",
  "4110": "EPIC national avec comptable public", "4120": "EPIC national sans comptable public", "4130": "Exploitant public",
  "4140": "EPIC local", "4150": "Régie locale à caractère industriel ou commercial", "4160": "Banque de France",
  "5191": "Société de caution mutuelle", "5192": "Banque populaire", "5193": "Caisse de crédit maritime mutuel", "5194": "Caisse de crédit mutuel",
  "5195": "Association coopérative inscrite (Alsace-Moselle)", "5196": "Caisse d'épargne coopérative",
  "5202": "SNC", "5203": "SNC coopérative", "5306": "SCS", "5307": "SCS coopérative", "5308": "SCA", "5309": "SCA coopérative",
  "5310": "Société en libre partenariat", "5370": "SPFPL SCA", "5385": "SELCA",
  "5410": "SARL nationale", "5415": "SARL d'économie mixte", "5422": "SARL immobilière (SICOMI)", "5426": "SARL immobilière de gestion",
  "5430": "SARL SAFER", "5431": "SARL mixte d'intérêt agricole", "5432": "SARL d'intérêt collectif agricole", "5442": "SARL d'attribution",
  "5443": "SARL coopérative de construction", "5451": "SARL coopérative de consommation", "5453": "SARL coopérative artisanale",
  "5454": "SARL coopérative maritime", "5455": "SARL coopérative de transport", "5458": "SCOP SARL", "5459": "SARL union de coopératives",
  "5460": "Autre SARL coopérative", "5470": "SPFPL SARL", "5485": "SELARL", "5498": "EURL", "5499": "SARL",
  "5505": "SA à participation ouvrière (CA)", "5510": "SA nationale (CA)", "5515": "SA d'économie mixte (CA)", "5520": "Fonds à forme sociétale (CA)",
  "5522": "SA immobilière SICOMI (CA)", "5525": "SA immobilière d'investissement (CA)", "5530": "SA SAFER (CA)", "5531": "SA mixte d'intérêt agricole (CA)",
  "5532": "SA d'intérêt collectif agricole (CA)", "5542": "SA d'attribution (CA)", "5543": "SA coopérative de construction (CA)", "5546": "SA de HLM (CA)",
  "5547": "Société coopérative européenne (CA)", "5548": "SA à capital public majoritaire (CA)", "5551": "SA coopérative de consommation (CA)",
  "5552": "SA coopérative de commerçants (CA)", "5553": "SA coopérative artisanale (CA)", "5554": "SA coopérative maritime (CA)",
  "5555": "SA coopérative de transport (CA)", "5558": "SCOP SA (CA)", "5559": "SA union de coopératives (CA)", "5560": "Autre SA coopérative (CA)",
  "5570": "SPFPL SA (CA)", "5585": "SELAFA", "5599": "SA à conseil d'administration",
  "5605": "SA à participation ouvrière (directoire)", "5610": "SA nationale (directoire)", "5615": "SA d'économie mixte (directoire)",
  "5620": "Fonds à forme sociétale (directoire)", "5622": "SA immobilière SICOMI (directoire)", "5625": "SA immobilière d'investissement (directoire)",
  "5630": "SA SAFER (directoire)", "5631": "SA mixte d'intérêt agricole (directoire)", "5632": "SA d'intérêt collectif agricole (directoire)",
  "5642": "SA d'attribution (directoire)", "5643": "SA coopérative de construction (directoire)", "5646": "SA de HLM (directoire)",
  "5647": "Société coopérative européenne (directoire)", "5648": "SA à capital public majoritaire (directoire)", "5651": "SA coopérative de consommation (directoire)",
  "5652": "SA coopérative de commerçants (directoire)", "5653": "SA coopérative artisanale (directoire)", "5654": "SA coopérative maritime (directoire)",
  "5655": "SA coopérative de transport (directoire)", "5658": "SCOP SA (directoire)", "5659": "SA union de coopératives (directoire)",
  "5660": "Autre SA coopérative (directoire)", "5670": "SPFPL SA (directoire)", "5685": "SELAFA (directoire)", "5699": "SA à directoire",
  "5710": "SAS", "5720": "SASU", "5770": "SPFPL SAS", "5785": "SELAS", "5800": "Société coopérative européenne",
  "5910": "SCIC SAS", "5922": "SCIC SARL", "5930": "SCIC SA à directoire", "5931": "SCIC SA à conseil d'administration",
  "6100": "Caisse d'épargne et de prévoyance", "6210": "GEIE", "6220": "GIE", "6316": "CUMA", "6317": "Coopérative agricole", "6318": "Union de coopératives agricoles",
  "6411": "Société d'assurance à forme mutuelle", "6412": "Société mutuelle d'assurance", "6413": "Union de sociétés mutuelles d'assurance",
  "6511": "SISA", "6521": "SCPI", "6532": "SICA", "6533": "GAEC", "6534": "Groupement foncier agricole", "6535": "Groupement agricole foncier",
  "6536": "Groupement forestier", "6537": "Groupement pastoral", "6538": "Groupement foncier rural", "6539": "Société civile foncière", "6540": "SCI",
  "6541": "SCI de construction-vente", "6542": "Société civile d'attribution", "6543": "Société civile coopérative de construction",
  "6544": "SCI d'accession progressive", "6551": "Société civile coopérative de consommation", "6554": "Société civile coopérative maritime",
  "6558": "Société civile coopérative de médecins", "6560": "Autre société civile coopérative",
  "6561": "SCP d'avocats", "6562": "SCP d'avocats aux conseils", "6563": "SCP d'avoués", "6564": "SCP d'huissiers", "6565": "SCP de notaires",
  "6566": "SCP de commissaires-priseurs", "6567": "SCP de greffiers", "6568": "SCP de conseils juridiques", "6569": "SCP de commissaires aux comptes",
  "6571": "SCP de médecins", "6572": "SCP de dentistes", "6573": "SCP d'infirmiers", "6574": "SCP de masseurs-kinésithérapeutes",
  "6575": "SCP de laboratoires d'analyses", "6576": "SCP de vétérinaires", "6577": "SCP de géomètres-experts", "6578": "SCP d'architectes",
  "6585": "Autre société civile professionnelle", "6589": "SCM", "6595": "Caisse locale de crédit mutuel", "6596": "Caisse de crédit agricole mutuel",
  "6597": "SCEA", "6598": "EARL", "6599": "Autre société civile", "6901": "Autre personne de droit privé inscrite au RCS",
  "7111": "Autorité constitutionnelle", "7112": "Autorité administrative indépendante", "7113": "Ministère", "7120": "Service central d'un ministère",
  "7150": "Service du ministère de la Défense", "7160": "Service déconcentré national", "7171": "Service déconcentré (inter)régional",
  "7172": "Service déconcentré (inter)départemental", "7179": "Autre service déconcentré de l'État", "7190": "École nationale",
  "7210": "Commune", "7220": "Département", "7225": "Collectivité d'outre-mer", "7229": "Autre collectivité territoriale", "7230": "Région",
  "7312": "Commune associée ou déléguée", "7313": "Section de commune", "7314": "Ensemble urbain", "7321": "Association syndicale autorisée",
  "7322": "Association foncière urbaine", "7323": "Association foncière de remembrement", "7331": "Établissement public local d'enseignement",
  "7340": "Pôle métropolitain", "7341": "Secteur de commune", "7342": "District urbain", "7343": "Communauté urbaine", "7344": "Métropole",
  "7345": "SIVOM", "7346": "Communauté de communes", "7347": "Communauté de villes", "7348": "Communauté d'agglomération",
  "7349": "Autre établissement public local de coopération", "7351": "Institution interdépartementale", "7352": "Institution interrégionale",
  "7353": "SIVU", "7354": "Syndicat mixte fermé", "7355": "Syndicat mixte ouvert", "7356": "Commission syndicale des biens indivis", "7357": "PETR",
  "7361": "CCAS", "7362": "Caisse des écoles", "7363": "Caisse de crédit municipal", "7364": "Établissement d'hospitalisation",
  "7365": "Syndicat interhospitalier", "7366": "Établissement public social ou médico-social", "7367": "CIAS", "7371": "OPH",
  "7372": "SDIS", "7373": "Établissement public local culturel", "7378": "Régie locale à caractère administratif", "7379": "Autre établissement public administratif local",
  "7381": "Organisme consulaire", "7382": "Établissement public national d'administration centrale", "7383": "Établissement public national scientifique, culturel ou professionnel",
  "7384": "Établissement public national d'enseignement", "7385": "Autre établissement public national à compétence limitée", "7389": "Établissement public national administratif",
  "7410": "GIP", "7430": "Établissement public des cultes d'Alsace-Lorraine", "7450": "Cercle ou foyer des armées", "7470": "Groupement de coopération sanitaire public",
  "7490": "Autre personne morale de droit administratif",
  "8110": "Régime général de la Sécurité sociale", "8120": "Régime spécial de Sécurité sociale", "8130": "Institution de retraite complémentaire",
  "8140": "Mutualité sociale agricole", "8150": "Régime maladie des non-salariés non agricoles", "8160": "Régime vieillesse hors régime général",
  "8170": "Régime d'assurance chômage", "8190": "Autre régime de Sécurité sociale", "8210": "Mutuelle", "8250": "Assurance mutuelle agricole",
  "8290": "Autre organisme mutualiste", "8310": "CSE d'entreprise", "8311": "CSE d'établissement", "8410": "Syndicat de salariés", "8420": "Syndicat patronal",
  "8450": "Ordre professionnel", "8470": "Centre technique industriel ou comité professionnel", "8490": "Autre organisme professionnel",
  "8510": "Institution de prévoyance", "8520": "Institution de retraite supplémentaire",
  "9110": "Syndicat de copropriétaires", "9150": "Association syndicale libre", "9210": "Association non déclarée", "9220": "Association déclarée",
  "9221": "Association d'insertion par l'économique", "9222": "Association intermédiaire", "9223": "Groupement d'employeurs",
  "9224": "Association d'avocats (AARPI)", "9230": "Association reconnue d'utilité publique", "9240": "Congrégation",
  "9260": "Association de droit local", "9300": "Fondation", "9900": "Autre personne morale de droit privé", "9970": "Groupement de coopération sanitaire privé",
};

/** Dénomination complète des sigles de la table ci-dessus (infobulle). */
const FORMES_LONGUES: Table = {
  "1000": "Entrepreneur individuel (EI)", "5202": "Société en nom collectif", "5306": "Société en commandite simple", "5308": "Société en commandite par actions",
  "5385": "Société d'exercice libéral en commandite par actions", "5485": "Société d'exercice libéral à responsabilité limitée",
  "5498": "Entreprise unipersonnelle à responsabilité limitée (SARL à associé unique)", "5499": "Société à responsabilité limitée",
  "5585": "Société d'exercice libéral à forme anonyme (conseil d'administration)", "5685": "Société d'exercice libéral à forme anonyme (directoire)",
  "5599": "Société anonyme à conseil d'administration", "5699": "Société anonyme à directoire", "5710": "Société par actions simplifiée",
  "5720": "Société par actions simplifiée à associé unique", "5785": "Société d'exercice libéral par actions simplifiée",
  "6210": "Groupement européen d'intérêt économique", "6220": "Groupement d'intérêt économique", "6316": "Coopérative d'utilisation de matériel agricole en commun",
  "6511": "Société interprofessionnelle de soins ambulatoires", "6521": "Société civile de placement collectif immobilier",
  "6532": "Société d'intérêt collectif agricole", "6533": "Groupement agricole d'exploitation en commun", "6540": "Société civile immobilière",
  "6589": "Société civile de moyens", "6597": "Société civile d'exploitation agricole", "6598": "Exploitation agricole à responsabilité limitée",
  "7353": "Syndicat intercommunal à vocation unique", "7345": "Syndicat intercommunal à vocation multiple", "7357": "Pôle d'équilibre territorial et rural",
  "7361": "Centre communal d'action sociale", "7367": "Centre intercommunal d'action sociale", "7371": "Office public de l'habitat",
  "7372": "Service départemental d'incendie et de secours", "7410": "Groupement d'intérêt public", "9224": "Association d'avocats à responsabilité professionnelle individuelle",
};

// ---------------------------------------------------------------- autres énumérations

/** Tranches d'effectif SIRENE (salariés). */
const EFFECTIFS: Table = {
  NN: "Non renseignée", "00": "0 salarié", "01": "1 ou 2 salariés", "02": "3 à 5 salariés", "03": "6 à 9 salariés", "11": "10 à 19 salariés",
  "12": "20 à 49 salariés", "21": "50 à 99 salariés", "22": "100 à 199 salariés", "31": "200 à 249 salariés", "32": "250 à 499 salariés",
  "41": "500 à 999 salariés", "42": "1 000 à 1 999 salariés", "51": "2 000 à 4 999 salariés", "52": "5 000 à 9 999 salariés", "53": "10 000 salariés et plus",
};

/** Type de structure et états du cube de marché (axes `forme`, `statut`, `diffusion`). */
const MOTS: Table = {
  entreprise_individuelle: "Entreprise individuelle", societe: "Société", autre: "Autre", inconnu: "Inconnu",
  actif: "Active", ferme: "Fermée", fermé: "Fermée", diffusible: "Diffusible", partielle: "Diffusion partielle", non_diffusible: "Non diffusible", inconnue: "Inconnue",
};

const DEPARTEMENTS: Table = {
  "01": "Ain", "02": "Aisne", "03": "Allier", "04": "Alpes-de-Haute-Provence",
  "05": "Hautes-Alpes", "06": "Alpes-Maritimes", "07": "Ardèche", "08": "Ardennes",
  "09": "Ariège", "10": "Aube", "11": "Aude", "12": "Aveyron",
  "13": "Bouches-du-Rhône", "14": "Calvados", "15": "Cantal", "16": "Charente",
  "17": "Charente-Maritime", "18": "Cher", "19": "Corrèze", "21": "Côte-d'Or",
  "22": "Côtes-d'Armor", "23": "Creuse", "24": "Dordogne", "25": "Doubs",
  "26": "Drôme", "27": "Eure", "28": "Eure-et-Loir", "29": "Finistère",
  "2A": "Corse-du-Sud", "2B": "Haute-Corse", "30": "Gard", "31": "Haute-Garonne",
  "32": "Gers", "33": "Gironde", "34": "Hérault", "35": "Ille-et-Vilaine",
  "36": "Indre", "37": "Indre-et-Loire", "38": "Isère", "39": "Jura",
  "40": "Landes", "41": "Loir-et-Cher", "42": "Loire", "43": "Haute-Loire",
  "44": "Loire-Atlantique", "45": "Loiret", "46": "Lot", "47": "Lot-et-Garonne",
  "48": "Lozère", "49": "Maine-et-Loire", "50": "Manche", "51": "Marne",
  "52": "Haute-Marne", "53": "Mayenne", "54": "Meurthe-et-Moselle", "55": "Meuse",
  "56": "Morbihan", "57": "Moselle", "58": "Nièvre", "59": "Nord",
  "60": "Oise", "61": "Orne", "62": "Pas-de-Calais", "63": "Puy-de-Dôme",
  "64": "Pyrénées-Atlantiques", "65": "Hautes-Pyrénées", "66": "Pyrénées-Orientales", "67": "Bas-Rhin",
  "68": "Haut-Rhin", "69": "Rhône", "70": "Haute-Saône", "71": "Saône-et-Loire",
  "72": "Sarthe", "73": "Savoie", "74": "Haute-Savoie", "75": "Paris",
  "76": "Seine-Maritime", "77": "Seine-et-Marne", "78": "Yvelines", "79": "Deux-Sèvres",
  "80": "Somme", "81": "Tarn", "82": "Tarn-et-Garonne", "83": "Var",
  "84": "Vaucluse", "85": "Vendée", "86": "Vienne", "87": "Haute-Vienne",
  "88": "Vosges", "89": "Yonne", "90": "Territoire de Belfort", "91": "Essonne",
  "92": "Hauts-de-Seine", "93": "Seine-Saint-Denis", "94": "Val-de-Marne", "95": "Val-d'Oise",
  "971": "Guadeloupe", "972": "Martinique", "973": "Guyane", "974": "La Réunion",
  "976": "Mayotte", "99": "Étranger",
};

/** Divisions NAF rév. 2 (2 chiffres). */
const DIVISIONS_NAF: Table = {
  "01": "Culture et production animale, chasse", "02": "Sylviculture et exploitation forestière", "03": "Pêche et aquaculture",
  "05": "Extraction de houille et de lignite", "06": "Extraction d'hydrocarbures", "07": "Extraction de minerais métalliques", "08": "Autres industries extractives",
  "09": "Services de soutien aux industries extractives", "10": "Industries alimentaires", "11": "Fabrication de boissons", "12": "Fabrication de produits à base de tabac",
  "13": "Fabrication de textiles", "14": "Industrie de l'habillement", "15": "Industrie du cuir et de la chaussure", "16": "Travail du bois et fabrication d'articles en bois",
  "17": "Industrie du papier et du carton", "18": "Imprimerie et reproduction d'enregistrements", "19": "Cokéfaction et raffinage", "20": "Industrie chimique",
  "21": "Industrie pharmaceutique", "22": "Produits en caoutchouc et en plastique", "23": "Autres produits minéraux non métalliques", "24": "Métallurgie",
  "25": "Produits métalliques (hors machines et équipements)", "26": "Produits informatiques, électroniques et optiques", "27": "Équipements électriques",
  "28": "Machines et équipements n.c.a.", "29": "Industrie automobile", "30": "Autres matériels de transport", "31": "Fabrication de meubles",
  "32": "Autres industries manufacturières", "33": "Réparation et installation de machines et d'équipements", "35": "Électricité, gaz, vapeur et air conditionné",
  "36": "Captage, traitement et distribution d'eau", "37": "Collecte et traitement des eaux usées", "38": "Collecte, traitement et élimination des déchets",
  "39": "Dépollution et gestion des déchets", "41": "Construction de bâtiments", "42": "Génie civil", "43": "Travaux de construction spécialisés",
  "45": "Commerce et réparation d'automobiles et de motocycles", "46": "Commerce de gros", "47": "Commerce de détail", "49": "Transports terrestres",
  "50": "Transports par eau", "51": "Transports aériens", "52": "Entreposage et services auxiliaires des transports", "53": "Activités de poste et de courrier",
  "55": "Hébergement", "56": "Restauration", "58": "Édition", "59": "Cinéma, vidéo, télévision et musique", "60": "Programmation et diffusion",
  "61": "Télécommunications", "62": "Programmation, conseil et autres activités informatiques", "63": "Services d'information",
  "64": "Services financiers (hors assurance)", "65": "Assurance", "66": "Auxiliaires de services financiers et d'assurance", "68": "Activités immobilières",
  "69": "Activités juridiques et comptables", "70": "Sièges sociaux et conseil de gestion", "71": "Architecture, ingénierie et contrôle technique",
  "72": "Recherche-développement scientifique", "73": "Publicité et études de marché", "74": "Autres activités spécialisées, scientifiques et techniques",
  "75": "Activités vétérinaires", "77": "Location et location-bail", "78": "Activités liées à l'emploi", "79": "Agences de voyage et voyagistes",
  "80": "Enquêtes et sécurité", "81": "Services relatifs aux bâtiments et paysagisme", "82": "Soutien administratif aux entreprises",
  "84": "Administration publique et défense", "85": "Enseignement", "86": "Santé humaine", "87": "Hébergement médico-social et social", "88": "Action sociale sans hébergement",
  "90": "Activités créatives, artistiques et de spectacle", "91": "Bibliothèques, archives, musées", "92": "Jeux de hasard et d'argent", "93": "Sports, loisirs et récréation",
  "94": "Organisations associatives", "95": "Réparation d'ordinateurs et de biens personnels", "96": "Autres services personnels",
  "97": "Ménages employeurs de personnel domestique", "98": "Ménages producteurs pour usage propre", "99": "Organisations extraterritoriales",
};

const MOTIFS_EMAIL: Table = {
  // Fiche non livrable (blocking_reasons d'ODH) : le motif dit pourquoi on n'écrit pas, même à une adresse valable.
  block_honeypot: "Piège à spam",
  block_ceased: "Entreprise cessée",
  block_insolvency: "Procédure collective",
  block_ambiguous: "Rattachement du contact ambigu",
  block_non_decision_maker: "Contact non décideur",
  block_postal_unusable: "Adresse inutilisable",
  block_provider_siren: "Contact d'un prestataire",
  block_not_diffusible: "Entreprise non diffusible",
  domaine_mort: "Domaine mort",
  mx_injoignable: "Serveur mail injoignable",
  boite_inexistante: "Boîte inexistante",
  email_disparu_du_site: "Email retiré du site",
  email_placeholder: "Adresse fictive",
  email_role_non_commercial: "Adresse générique non commerciale",
  contact_de_prestataire: "Contact d'un prestataire",
  email_invalide: "Adresse invalide",
};

const TAILLES: Table = { micro: "Micro-entreprise", petite: "Petite entreprise", moyenne: "Moyenne entreprise", grande: "Grande entreprise" };
const NIVEAUX_WEB: Table = { moderne: "Moderne", correct: "Correct", vieillissant: "Vieillissant", obsolete: "Obsolète" };
const TENDANCES_CA: Table = {
  stable: "Stable", growth: "En croissance", croissance: "En croissance", growth_strong: "Forte croissance", growth_continuous: "Croissance continue",
  decline: "En baisse", declin: "En baisse", crash: "Chute",
};
const VERIFICATIONS: Table = { existe: "Boîte confirmée", inconnu: "Inconnu", non_verifiable: "Non vérifiable", n_existe_pas: "Boîte inexistante", catch_all: "Accepte toute adresse" };
const PREUVES: Table = {
  mx_present: "Serveur mail présent", web_publie: "Publié sur le site", mx_refuse_ip_residentielle: "Sonde refusée par le serveur", aucune_sonde: "Aucune sonde",
  dns_nxdomain: "Domaine inexistant", dns_no_mx: "Pas de serveur mail", smtp_domaine: "Test SMTP du domaine", smtp_email: "Test SMTP de l'adresse",
  web_disparu: "Email retiré du site", mx_injoignable_port25: "Serveur mail injoignable", bounce_notifuse: "Rebond constaté",
};
const MESSAGERIES: Table = {
  google: "Google", microsoft: "Microsoft", ovh: "OVH", orange: "Orange", ionos: "IONOS", self_hosted: "Serveur propre", o2switch: "o2switch", hostinger: "Hostinger",
  infomaniak: "Infomaniak", gandi: "Gandi", yahoo: "Yahoo", mailinblack: "Mailinblack", "education.gouv.fr": "Éducation nationale", iliad: "Free (Iliad)",
  hornetsecurity: "Hornetsecurity", altice: "SFR (Altice)", lws: "LWS", website_builder: "Éditeur de site", securemail: "SecureMail", proofpoint: "Proofpoint",
  apple: "Apple", laposte: "La Poste", planethoster: "PlanetHoster", proton: "Proton", zoho: "Zoho", cloudflare: "Cloudflare", bouygues: "Bouygues", aol: "AOL",
};
const GRADES: Table = { or: "Or", a_requalifier: "À requalifier", rebut: "Rebut" };
/** Pile logicielle d'ODH (ODH-0263) : identifiants d'outils → nom commercial ; un inconnu prend une majuscule. */
const LOGICIELS: Table = {
  odoo: "Odoo", dolibarr: "Dolibarr", sage: "Sage", ebp: "EBP", cegid: "Cegid", axonaut: "Axonaut", sellsy: "Sellsy", pennylane: "Pennylane",
  quickbooks: "QuickBooks", glpi: "GLPI", zoho: "Zoho", hubspot: "HubSpot", salesforce: "Salesforce", pipedrive: "Pipedrive",
  brevo: "Brevo", sendinblue: "Brevo (Sendinblue)", mailchimp: "Mailchimp", mailjet: "Mailjet", mailerlite: "MailerLite", klaviyo: "Klaviyo",
  activecampaign: "ActiveCampaign", sendgrid: "SendGrid", tidio: "Tidio", intercom: "Intercom", crisp: "Crisp", zendesk: "Zendesk",
  stripe: "Stripe", paypal: "PayPal", doctolib: "Doctolib", calendly: "Calendly",
};
const TYPES_LOGICIEL: Table = {
  erp: "ERP (gestion)", crm: "CRM", emailing: "Emailing", compta: "Comptabilité", support: "Support client", paiement: "Paiement", rdv: "Prise de rendez-vous",
};
const OUTILS: Table = { wordpress: "WordPress", joomla: "Joomla", prestashop: "PrestaShop", drupal: "Drupal", spip: "SPIP", typo3: "TYPO3" };

/** Champs du catalogue (et clés de la fiche) → table de leurs valeurs. */
const TABLES: Record<string, Table> = {
  forme_juridique: FORMES_JURIDIQUES,
  effectif: EFFECTIFS,
  naf_division: DIVISIONS_NAF,
  departement: DEPARTEMENTS,
  motif_email: MOTIFS_EMAIL,
  taille: TAILLES,
  niveau_web: NIVEAUX_WEB,
  tendance_ca: TENDANCES_CA,
  email_verification: VERIFICATIONS,
  email_preuve: PREUVES,
  messagerie: MESSAGERIES,
  grade: GRADES,
  logiciel: LOGICIELS,
  type_logiciel: TYPES_LOGICIEL,
  cms: OUTILS,
  forme: MOTS,
  statut: MOTS,
  diffusion: MOTS,
};

/** Clés de la fiche (thème.clé) qui nomment un champ du catalogue sous un autre id. */
const ALIAS: Record<string, string> = { verification: "email_verification", preuve: "email_preuve", niveau: "niveau_web", tendance: "tendance_ca", outil: "cms" };

const champDe = (champ: string) => ALIAS[champ] ?? champ;

/** Le serveur rend parfois « catégorie 5485 » pour une forme qu'il ne connaît pas : on retrouve le code. */
function codeForme(cle: string): string {
  return /^catégorie (\d{4})$/i.exec(cle)?.[1] ?? cle;
}

/** Libellé court d'une valeur, tel qu'il s'affiche partout (jamais vide : une valeur inconnue reste telle quelle). */
export function libelleValeur(champ: string, cle: string | number): string {
  const c = champDe(champ);
  let k = String(cle);
  if (k === "") return c === "departement" ? "Département inconnu" : c === "effectif" ? "Non renseignée" : "Non renseigné";
  if (c === "naf") {
    const n = normaliserNaf(k);
    return n && NAF_LIBELLES[n] ? `${n} · ${NAF_LIBELLES[n]}` : k;
  }
  if (c === "forme_juridique") k = codeForme(k);
  if (c === "departement") {
    k = /^\d$/.test(k) ? `0${k}` : k.toUpperCase();
    const nom = DEPARTEMENTS[k];
    return nom ? (k === "99" ? nom : `${nom} (${k})`) : String(cle);
  }
  if (c === "naf_division") {
    k = /^\d$/.test(k) ? `0${k}` : k;
    return DIVISIONS_NAF[k] ? `${k} · ${DIVISIONS_NAF[k]}` : String(cle);
  }
  if (c === "forme") return MOTS[k] ?? FORMES_JURIDIQUES[k] ?? k;
  // Colonne du tableau ou de l'export : plusieurs logiciels joints par des virgules.
  if ((c === "logiciel" || c === "type_logiciel") && k.includes(",")) return k.split(/,\s*/).map((x) => libelleValeur(c, x)).join(", ");
  if (c === "logiciel" && !LOGICIELS[k]) {
    const interne = k.match(/^interne:(.+)$/);
    if (interne) return `Outil interne (${TYPES_LOGICIEL[interne[1]] ?? interne[1]})`;
    return k ? k.charAt(0).toUpperCase() + k.slice(1) : k;
  }
  return TABLES[c]?.[k] ?? String(cle);
}

/** Pour une puce de filtre : « SAS · 5710 » (le code sert à distinguer les catégories qui se ressemblent). */
export function libelleAvecCode(champ: string, cle: string | number): string {
  const l = libelleValeur(champ, cle);
  if (champDe(champ) !== "forme_juridique") return l;
  const k = codeForme(String(cle));
  return k !== l && FORMES_JURIDIQUES[k] ? `${l} · ${k}` : l;
}

/** Infobulle : le libellé complet et le code brut, pour qui veut vérifier. */
export function titreValeur(champ: string, cle: string | number): string {
  const c = champDe(champ);
  const k = String(cle);
  if (k === "") return libelleValeur(champ, cle);
  if (c === "forme_juridique") {
    const code = codeForme(k);
    const long = FORMES_LONGUES[code] ?? FORMES_JURIDIQUES[code];
    return long ? `${long} (code ${code})` : k;
  }
  const l = libelleValeur(champ, cle);
  return l.includes(k) || l === k ? l : `${l} (${k})`;
}

const sansAccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const REVERSES = new Map<string, Map<string, string>>();
/** Libellé normalisé → clé, pour les libellés sans ambiguïté seulement (deux clés pour un libellé : on ne devine pas). */
function inverse(champ: string): Map<string, string> {
  let m = REVERSES.get(champ);
  if (m) return m;
  m = new Map();
  const doublons = new Set<string>();
  for (const [cle, brut] of Object.entries(TABLES[champ] ?? {})) {
    for (const t of new Set([sansAccent(brut), sansAccent(libelleValeur(champ, cle))])) {
      if (m.has(t) && m.get(t) !== cle) doublons.add(t);
      else m.set(t, cle);
    }
  }
  for (const d of doublons) m.delete(d);
  if (champ === "forme_juridique") m.set("ei", "1000");
  REVERSES.set(champ, m);
  return m;
}

/**
 * Ce que l'utilisateur tape dans une saisie libre → la clé réelle : « SAS » → 5710, « rhône » → 69,
 * « 01.49z » → 0149Z. Une saisie qui ne correspond à rien est rendue telle quelle.
 */
export function cleDepuisSaisie(champ: string, saisie: string): string {
  const c = champDe(champ);
  const s = saisie.trim();
  if (!s) return s;
  if (c === "naf") return normaliserNaf(s) ?? s;
  if (c === "departement" && /^(\d{1,3}|2[abAB])$/.test(s)) return /^\d$/.test(s) ? `0${s}` : s.toUpperCase();
  if (c === "naf_division" && /^\d$/.test(s)) return `0${s}`;
  const t = TABLES[c];
  if (!t) return s;
  if (s in t) return s;
  return inverse(c).get(sansAccent(s)) ?? s;
}

/** Une valeur correspond-elle à ce que l'utilisateur tape (code ou morceau du libellé, sans tenir compte des accents) ? */
export function valeurCorrespond(champ: string, cle: string, saisie: string): boolean {
  const q = sansAccent(saisie);
  return !q || sansAccent(cle).includes(q) || sansAccent(libelleValeur(champ, cle)).includes(q);
}

