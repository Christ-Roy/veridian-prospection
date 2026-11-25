/** Lecture d'un fichier de clients et tournée Google Maps : pur, sans base. */
import { describe, expect, test } from "vitest";

import { lireNumero as serveur } from "@/atlas/clients";
import { ARRETS_PAR_LIEN, distance, liensMaps, ordonner, tournee } from "@/atlas/parcours";
import { cellules, lireDate, lireFichierClients, lireMontant, lireNumero, pourcent } from "@/components/atlas/clients-logique";

const DANONE = "552032534", ENGIE = "542107651";

describe("numéros", () => {
  test("SIREN, SIRET, espaces, TVA, zéros mangés par un tableur ; écran et serveur d'accord", () => {
    const cas: [string, string | null][] = [
      ["552 032 534", DANONE], ["552.032.534", DANONE], ["55203253400646", DANONE], ["FR59552032534", DANONE], ["552\u202f032\u202f534", DANONE],
      ["5480546", "005480546"], ["05480546", "005480546"], ["0612345678", null], ["552032535", null], ["000000000", null], ["5,52E+08", null], ["abc", null], ["", null], ["123", null],
    ];
    for (const [brut, attendu] of cas) {
      expect([brut, lireNumero(brut)]).toEqual([brut, attendu]);
      expect([brut, serveur(brut)]).toEqual([brut, attendu]);
    }
  });
});

describe("fichier", () => {
  test("colonne SIRET trouvée par son titre, téléphones et montants ignorés", () => {
    const csv = `\uFEFFNom;Téléphone;CA;SIRET\r\n"Danone; SA";0155001122;552032534;55203253400646\r\nEngie;;;542 107 651 00013\r\nFaux;;;12345678900011\r\nVide;;;\r\n`;
    expect(lireFichierClients(csv)).toMatchObject({ ventes: null, numeros: [DANONE, ENGIE], colonne: "SIRET", ecartes: 1 });
  });
  test("sans titre reconnu : la colonne la plus remplie de numéros valides ; doublons fondus", () => {
    expect(lireFichierClients(`Danone,${DANONE},Paris\nEngie,${ENGIE},Paris\nDanone bis,${DANONE},Lyon`)).toMatchObject({ ventes: null, numeros: [DANONE, ENGIE], colonne: null, ecartes: 0 });
    expect(lireFichierClients(`Client,Identifiant\nDanone,${DANONE}`)).toMatchObject({ ventes: null, numeros: [DANONE], colonne: "Identifiant", ecartes: 0 });
  });
  test("collage : une ligne par numéro, ou séparés sur une ligne ; rien de valide = rien", () => {
    expect(lireFichierClients(`${DANONE}\n\n${ENGIE}\n`).numeros).toEqual([DANONE, ENGIE]);
    expect(lireFichierClients(`${DANONE}, ${ENGIE}`).numeros).toEqual([DANONE, ENGIE]);
    expect(lireFichierClients("bonjour\nau revoir")).toMatchObject({ ventes: null, numeros: [], colonne: null, ecartes: 1 });
    expect(lireFichierClients("")).toMatchObject({ ventes: null, numeros: [], colonne: null, ecartes: 0 });
  });
  test("cellules entre guillemets", () => expect(cellules('a;"b;c";"d ""e"""', ";")).toEqual(["a", "b;c", 'd "e"']));
  test("un petit taux ne s'arrondit jamais à zéro", () => expect([0, 0.0423, 4.2, 12.345, null].map(pourcent)).toEqual(["0 %", "0,042 %", "4,2 %", "12,3 %", "–"]));
});

describe("tournée", () => {
  const a = (siren: string, lat: number, lon: number) => ({ siren, nom: `E${siren}`, lat, lon });
  test("du nord, puis toujours le plus proche", () => {
    expect(ordonner([a("1", 45, 5), a("2", 48, 2), a("3", 47.9, 2.1), a("4", 45.1, 5.1)]).map((x) => x.siren)).toEqual(["2", "3", "4", "1"]);
    expect(ordonner([])).toEqual([]);
  });
  test("dix arrêts par lien, le suivant repart du dernier ; aucun hôte autre que Google Maps", () => {
    const l = liensMaps(Array.from({ length: 23 }, (_, i) => a(String(i), 45 + i / 100, 5)));
    expect(l.map((x) => x.arrets.length)).toEqual([ARRETS_PAR_LIEN, ARRETS_PAR_LIEN, 3]);
    const u = l.map((x) => new URL(x.url));
    expect(u.every((x) => x.origin === "https://www.google.com" && x.pathname === "/maps/dir/")).toBe(true);
    expect(u[0].searchParams.get("origin")).toBeNull();
    expect(u[1].searchParams.get("origin")).toBe(u[0].searchParams.get("destination"));
    expect(u[0].searchParams.get("waypoints")!.split("|")).toHaveLength(9);
    expect(liensMaps([a("1", 45, 5)])[0].url).not.toContain("waypoints");
  });
  test("distance et total", () => {
    expect(Math.round(distance({ lat: 48.8566, lon: 2.3522 }, { lat: 45.764, lon: 4.8357 }))).toBe(391);
    expect(tournee([a("1", 48.8566, 2.3522), a("2", 45.764, 4.8357)])).toMatchObject({ vol_oiseau_km: 391, arrets: [{ siren: "1" }, { siren: "2" }] });
  });
});

describe("ventes dans le fichier", () => {
  test("montants français, anglais, avoirs ; dates ; rien d'inventé", () => {
    expect(["1 234,56 €", "1,234.56", "1.234,5", "(120,00)", "-12", "12-", "1 234", "1.234", "0", "", "abc", "12 rue", "3,14,15"].map(lireMontant)).toEqual([1234.56, 1234.56, 1234.5, -120, -12, -12, 1234, 1234, 0, null, null, null, 314.15]);
    expect(["05/03/2026", "2026-03-05T10:00", "5-3-2026", "31/02/2026", "03/2026", ""].map(lireDate)).toEqual(["2026-03-05", "2026-03-05", "2026-03-05", null, null, null]);
  });
  test("une colonne de montant titrée fait un fichier de ventes ; facture et date suivent ; les lignes illisibles se comptent", () => {
    const f = lireFichierClients(`N° facture;Date;SIRET client;Total HT\nF1;05/03/2026;${DANONE};1 200,50\nF2;06/03/2026;${ENGIE};-30\nF3;;12345678900011;10\nF4;;${ENGIE};offert\n`);
    expect(f).toMatchObject({ numeros: [DANONE, ENGIE], colonneMontant: "Total HT", ventesEcartees: 2, ventes: [{ numero: DANONE, montant: 1200.5, date: "2026-03-05", reference: "F1" }, { numero: ENGIE, montant: -30, date: "2026-03-06", reference: "F2" }] });
  });
  test("sans titre de montant, ce n'est jamais un fichier de ventes", () => {
    expect(lireFichierClients(`Nom;SIREN;Effectif\nDanone;${DANONE};1200`).ventes).toBeNull();
    expect(lireFichierClients(`${DANONE};1200\n${ENGIE};30`).ventes).toBeNull();
  });
});
