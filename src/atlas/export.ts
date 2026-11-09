/**
 * Export d'un segment (réservé aux plans payants, tracé) : CSV lisible par Excel (UTF-8 avec BOM, point-
 * virgule) ou classeur .xlsx. Les lignes sont celles du segment, classées par sa priorité quand elle
 * existe, 5 000 au plus par export. Les colonnes : celles du segment plus les coordonnées utiles.
 *
 * Le .xlsx est écrit à la main (SpreadsheetML minimal dans un zip « stocké », sans compression) : pas de
 * dépendance, donc pas de surface de CVE de plus pour un format figé depuis 2006.
 */
import { hasFeature, isGiftedPlan, PLANS, type AnyPlanId } from "@/lib/billing/plans";

import { CHAMP } from "./champs";
import type { Ligne } from "./source";

export const LIGNES_MAX_EXPORT = 5000;

/** Plan payant : celui dont les options comprennent l'export ; un plan offert ou entreprise aussi. */
export function peutExporter(plan: string | null | undefined): boolean {
  if (!plan) return false;
  if (plan === "enterprise") return true;
  if (isGiftedPlan(plan as AnyPlanId)) return true;
  return plan in PLANS && hasFeature(plan as AnyPlanId, "csv_export");
}
export type FormatExport = "csv" | "xlsx";

/** Coordonnées toujours exportées, puis les colonnes du segment (25 au plus, comme l'écran). */
const ESSENTIELLES = ["nom", "email", "telephone", "site", "commune", "departement", "naf"];
export function colonnesExport(colonnesSegment: readonly string[]): string[] {
  return [...new Set([...ESSENTIELLES, ...colonnesSegment])].filter((id) => CHAMP.has(id)).slice(0, 24);
}

export function entete(ids: readonly string[]): string[] {
  return ids.map((id) => (id === "score" ? "Score de priorité" : (CHAMP.get(id)?.libelle ?? id)));
}

const texte = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "oui" : "non") : String(v));

/**
 * Une cellule qui commence par = + - @ (ou tabulation, retour) serait lue comme une formule par Excel :
 * on la préfixe d'une apostrophe (injection de formule, OWASP CSV Injection).
 */
export function neutraliser(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export function versCsv(ids: readonly string[], lignes: readonly Ligne[]): Buffer {
  const cellule = (v: string) => {
    const s = neutraliser(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rangs = [entete(ids), ...lignes.map((l) => ids.map((id) => texte(l[id])))].map((r) => r.map(cellule).join(";"));
  return Buffer.from(`﻿${rangs.join("\r\n")}\r\n`, "utf8");
}

// ---------------------------------------------------------------- xlsx

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

function colonne(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function feuille(ids: readonly string[], lignes: readonly Ligne[]): string {
  const rang = (valeurs: unknown[], r: number, gras = false) =>
    `<row r="${r}">${valeurs
      .map((v, c) => {
        const ref = `${colonne(c)}${r}`;
        if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
        const t = texte(v);
        if (t === "") return "";
        return `<c r="${ref}" t="inlineStr"${gras ? ' s="1"' : ""}><is><t xml:space="preserve">${xml(t)}</t></is></c>`;
      })
      .join("")}</row>`;
  const corps = [rang(entete(ids), 1, true), ...lignes.map((l, i) => rang(ids.map((id) => l[id]), i + 2))].join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${corps}</sheetData></worksheet>`;
}

const FICHIERS_FIXES: Record<string, string> = {
  "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`,
};

function classeur(nomFeuille: string): string {
  const nom = xml(nomFeuille.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Segment");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${nom}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
}

const TABLE_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = TABLE_CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Zip « stocké » (méthode 0) : en-têtes locaux, répertoire central, fin de répertoire. */
export function zipStocke(fichiers: Record<string, Buffer>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let decalage = 0;
  for (const [nom, contenu] of Object.entries(fichiers)) {
    const n = Buffer.from(nom, "utf8");
    const crc = crc32(contenu);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // noms en UTF-8
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(contenu.length, 18);
    local.writeUInt32LE(contenu.length, 22);
    local.writeUInt16LE(n.length, 26);
    parts.push(local, n, contenu);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(contenu.length, 20);
    c.writeUInt32LE(contenu.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(decalage, 42);
    central.push(c, n);
    decalage += 30 + n.length + contenu.length;
  }
  const dir = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(Object.keys(fichiers).length, 8);
  fin.writeUInt16LE(Object.keys(fichiers).length, 10);
  fin.writeUInt32LE(dir.length, 12);
  fin.writeUInt32LE(decalage, 16);
  return Buffer.concat([...parts, dir, fin]);
}

export function versXlsx(ids: readonly string[], lignes: readonly Ligne[], nomFeuille: string): Buffer {
  const f: Record<string, Buffer> = {};
  for (const [k, v] of Object.entries(FICHIERS_FIXES)) f[k] = Buffer.from(v, "utf8");
  f["xl/workbook.xml"] = Buffer.from(classeur(nomFeuille), "utf8");
  f["xl/worksheets/sheet1.xml"] = Buffer.from(feuille(ids, lignes), "utf8");
  return zipStocke(f);
}

/** Nom de fichier sûr : « atlas-eleveurs-rhone-2026-11-10.xlsx ». */
export function nomFichier(nomSegment: string, format: FormatExport, jour = new Date()): string {
  const base = nomSegment
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `atlas-${base || "segment"}-${jour.toISOString().slice(0, 10)}.${format}`;
}
