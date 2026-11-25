/**
 * PDF écrit à la main (texte, traits, barres) : pas de dépendance pour un format figé. Polices standard Helvetica, encodage
 * WinAnsi : un caractère hors de cet encodage devient « ? », jamais un octet brut.
 */
const L = 595.28, H = 841.89; // A4, en points
export const MARGE = 48;

const HORS_LATIN: Record<string, number> = { "€": 0x80, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "œ": 0x9c, "Œ": 0x8c, "Ÿ": 0x9f, "™": 0x99 };
/** Chaîne PDF échappée, en octets WinAnsi. */
export function chaine(s: string): string {
  let r = "";
  for (const c of s.normalize("NFC").replace(/[  ]/g, " ").replace(/[\u0000-\u001f]+/g, " ")) {
    const p = c.codePointAt(0)!;
    const o = HORS_LATIN[c] ?? (p < 0x80 || (p >= 0xa0 && p <= 0xff) ? p : 0x3f);
    r += c === "(" || c === ")" || c === "\\" ? `\\${c}` : o < 0x80 ? String.fromCharCode(o) : `\\${o.toString(8).padStart(3, "0")}`;
  }
  return `(${r})`;
}

/** Largeur approchée en Helvetica (exacte pour les chiffres, qui servent à aligner). */
export function largeur(s: string, corps: number, gras = false): number {
  let w = 0;
  for (const c of s) w += /[0-9]/.test(c) ? 556 : /[ .,:;!'’|il  ]/.test(c) ? 278 : /[fjrt()\-]/.test(c) ? 333 : /[mwMW%@]/.test(c) ? 860 : /[A-ZÀ-Ý]/.test(c) ? 690 : 545;
  return (w * corps * (gras ? 1.06 : 1)) / 1000;
}
export function couper(s: string, corps: number, max: number, gras = false): string {
  if (largeur(s, corps, gras) <= max) return s;
  let t = s;
  while (t && largeur(`${t}…`, corps, gras) > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}
/** Lignes d'un paragraphe à cette largeur ; un mot trop long se coupe. */
export function lignes(s: string, corps: number, max: number): string[] {
  const r: string[] = [];
  for (const para of s.replace(/\r/g, "").split("\n")) {
    let l = "";
    for (const mot of para.split(/ +/)) {
      const essai = l ? `${l} ${mot}` : mot;
      if (largeur(essai, corps) <= max) l = essai;
      else {
        if (l) r.push(l);
        l = couper(mot, corps, max);
      }
    }
    r.push(l);
  }
  return r;
}

type Couleur = readonly [number, number, number];
export const ENCRE: Couleur = [0.09, 0.09, 0.11], GRIS: Couleur = [0.42, 0.43, 0.46], FOND: Couleur = [0.95, 0.95, 0.96], BLEU: Couleur = [0.1, 0.35, 0.75];

/** Document : on écrit du haut vers le bas, `y` descend. */
export class Pdf {
  private pages: string[][] = [[]];
  y = MARGE;
  readonly large = L - 2 * MARGE;
  private o(s: string) {
    this.pages[this.pages.length - 1].push(s);
  }
  private c([r, v, b]: Couleur) {
    return `${r} ${v} ${b}`;
  }
  /** Nouvelle page si `h` points ne tiennent plus. */
  place(h: number) {
    if (this.y + h <= H - MARGE - 14) return;
    this.pages.push([]);
    this.y = MARGE;
  }
  texteEn(x: number, y: number, s: string, corps: number, { gras = false, couleur = ENCRE as Couleur, droite = false } = {}) {
    const px = droite ? x - largeur(s, corps, gras) : x;
    this.o(`BT /${gras ? "F2" : "F1"} ${corps} Tf ${this.c(couleur)} rg ${px.toFixed(2)} ${(H - y).toFixed(2)} Td ${chaine(s)} Tj ET`);
  }
  rect(x: number, y: number, w: number, h: number, couleur: Couleur) {
    if (w > 0 && h > 0) this.o(`${this.c(couleur)} rg ${x.toFixed(2)} ${(H - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }
  titre(s: string, corps: number) {
    for (const l of lignes(s, corps, this.large)) {
      this.place(corps * 1.3);
      this.y += corps;
      this.texteEn(MARGE, this.y, l, corps, { gras: true });
      this.y += corps * 0.3;
    }
  }
  paragraphe(s: string, corps = 10, couleur: Couleur = ENCRE) {
    for (const l of lignes(s, corps, this.large)) {
      this.place(corps * 1.45);
      this.y += corps * 1.1;
      this.texteEn(MARGE, this.y, l, corps, { couleur });
      this.y += corps * 0.35;
    }
  }
  espace(h: number) {
    this.y += h;
  }
  octets(titre: string, pied: string): Buffer {
    const n = this.pages.length;
    const objets: string[] = [
      "<< /Type /Catalog /Pages 2 0 R /Lang (fr-FR) >>",
      `<< /Type /Pages /Kids [${this.pages.map((_, i) => `${6 + i * 2} 0 R`).join(" ")}] /Count ${n} >>`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
      `<< /Title ${chaine(titre)} /Creator (Veridian Atlas) >>`,
    ];
    this.pages.forEach((p, i) => {
      const bas = `BT /F1 8 Tf ${this.c(GRIS)} rg ${MARGE} 30 Td ${chaine(pied)} Tj ET\nBT /F1 8 Tf ${this.c(GRIS)} rg ${(L - MARGE - 30).toFixed(2)} 30 Td ${chaine(`${i + 1} / ${n}`)} Tj ET`;
      const flux = `${p.join("\n")}\n${bas}`;
      objets.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${L} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${7 + i * 2} 0 R >>`, `<< /Length ${Buffer.byteLength(flux, "latin1")} >>\nstream\n${flux}\nendstream`);
    });
    let s = "%PDF-1.4\n";
    const positions: number[] = [];
    objets.forEach((o, i) => {
      positions.push(Buffer.byteLength(s, "latin1"));
      s += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = Buffer.byteLength(s, "latin1");
    s += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${positions.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`).join("")}trailer << /Size ${objets.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(s, "latin1");
  }
}
