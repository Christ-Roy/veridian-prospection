/**
 * Export : CSV que Excel lit (BOM, point-virgule, guillemets), aucune formule injectable, .xlsx qui est un
 * vrai zip (CRC, répertoire central) avec l'en-tête et les lignes, export réservé aux plans payants.
 */
import { describe, expect, test } from "vitest";

import { colonnesExport, crc32, entete, neutraliser, nomFichier, peutExporter, versCsv, versXlsx, zipStocke } from "@/atlas/export";

/** Lecteur de zip « stocké » minimal : nom → contenu, via le répertoire central. */
function lireZip(b: Buffer): Record<string, string> {
  const fin = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(fin).toBeGreaterThan(0);
  const n = b.readUInt16LE(fin + 10);
  let p = b.readUInt32LE(fin + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < n; i++) {
    expect(b.readUInt32LE(p)).toBe(0x02014b50);
    const crc = b.readUInt32LE(p + 16);
    const taille = b.readUInt32LE(p + 20);
    const lnom = b.readUInt16LE(p + 28);
    const local = b.readUInt32LE(p + 42);
    const nom = b.subarray(p + 46, p + 46 + lnom).toString("utf8");
    expect(b.readUInt32LE(local)).toBe(0x04034b50);
    const debut = local + 30 + b.readUInt16LE(local + 26);
    const contenu = b.subarray(debut, debut + taille);
    expect(crc32(contenu), nom).toBe(crc);
    out[nom] = contenu.toString("utf8");
    p += 46 + lnom;
  }
  return out;
}

const LIGNES = [
  { siren: "812441145", nom: "Le Fournil; « Traditions »", email: "a@b.fr", telephone: "0400000000", score: 87, chiffre_affaires: 120000 },
  { siren: "900000001", nom: "=HYPERLINK(\"http://x\")", email: null, telephone: "+33 4 00", score: 12, chiffre_affaires: null },
];
const IDS = ["siren", "nom", "email", "telephone", "chiffre_affaires", "score"];

describe("CSV", () => {
  test("BOM UTF-8, point-virgule, guillemets doublés, en-tête lisible", () => {
    const t = versCsv(IDS, LIGNES).toString("utf8");
    expect(t.charCodeAt(0)).toBe(0xfeff);
    const rangs = t.slice(1).split("\r\n");
    expect(rangs[0]).toBe("SIREN;Nom;Email;Téléphone;Chiffre d'affaires (€);Score de priorité");
    expect(rangs[1]).toBe('812441145;"Le Fournil; « Traditions »";a@b.fr;0400000000;120000;87');
  });
  test("aucune cellule ne peut devenir une formule Excel", () => {
    const t = versCsv(IDS, LIGNES).toString("utf8");
    expect(t).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(t).toContain(";'+33 4 00;");
    expect(neutraliser("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(neutraliser("Boulangerie")).toBe("Boulangerie");
  });
});

describe("xlsx", () => {
  test("CRC32 de référence", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
  test("un vrai zip : parties OOXML, en-tête en gras figé, nombres en nombres, texte échappé", () => {
    const f = lireZip(versXlsx(IDS, LIGNES, "Éleveurs [Rhône]"));
    expect(Object.keys(f).sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]);
    expect(f["xl/workbook.xml"]).toContain('name="Éleveurs  Rhône"'); // crochets interdits dans un nom de feuille
    const s = f["xl/worksheets/sheet1.xml"];
    expect(s).toContain('state="frozen"');
    expect(s).toContain('<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">SIREN</t></is></c>');
    expect(s).toContain('<c r="F2"><v>87</v></c>');
    expect(s).toContain("Le Fournil; « Traditions »");
    expect(s).toContain("=HYPERLINK(&quot;http://x&quot;)"); // texte, jamais une formule (<f>)
    expect(s).not.toContain("<f>");
    expect(s).not.toContain('r="C3"'); // email vide : pas de cellule
  });
  test("zip vide accepté, fichiers multiples bien placés", () => {
    const f = lireZip(zipStocke({ "a.txt": Buffer.from("un"), "dossier/b.txt": Buffer.from("deux") }));
    expect(f).toEqual({ "a.txt": "un", "dossier/b.txt": "deux" });
  });
});

describe("règles d'export", () => {
  test("réservé aux plans payants (pro, business, offerts, entreprise), jamais au freemium", () => {
    for (const p of ["pro", "business", "lifetime_partner", "internal", "enterprise"]) expect(peutExporter(p), p).toBe(true);
    for (const p of ["freemium", null, undefined, "", "plan_inconnu"]) expect(peutExporter(p), String(p)).toBe(false);
  });
  test("colonnes : coordonnées d'abord, sans doublon ni champ inconnu, 24 au plus", () => {
    const c = colonnesExport(["nom", "taille", "secret", "chiffre_affaires"]);
    expect(c.slice(0, 7)).toEqual(["nom", "email", "telephone", "site", "commune", "departement", "naf"]);
    expect(c).toContain("taille");
    expect(c).not.toContain("secret");
    expect(new Set(c).size).toBe(c.length);
    expect(entete(["score"])).toEqual(["Score de priorité"]);
  });
  test("nom de fichier sans accent ni caractère risqué", () => {
    expect(nomFichier("Éleveurs du Rhône / chiens", "xlsx", new Date("2026-11-10T08:00:00Z"))).toBe("atlas-eleveurs-du-rhone-chiens-2026-11-10.xlsx");
    expect(nomFichier("«»", "csv", new Date("2026-11-10T08:00:00Z"))).toBe("atlas-segment-2026-11-10.csv");
  });
});
