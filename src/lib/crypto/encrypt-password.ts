/**
 * AES-256-GCM symmetric crypto for tenant SMTP passwords.
 *
 * Used by `tenant_mail_config.smtp_password_enc` (migration 0022). Le secret
 * dérive de `AUTH_SECRET` (32+ bytes mandatory côté Auth.js v5) — pas de clé
 * dédiée parce qu'on n'a pas de rotation de clé prévue v1 et qu'AUTH_SECRET
 * a la même surface d'exposition que ce qu'on protège (DB).
 *
 * Format de sortie chiffré : "<iv_b64>:<tag_b64>:<ciphertext_b64>"
 *   - iv  = 12 bytes random (recommandation NIST pour GCM)
 *   - tag = 16 bytes authentication tag (intégrité)
 *   - ciphertext = bytes chiffrés
 *
 * Throw si AUTH_SECRET manque ou trop court : on préfère un 500 explicite
 * qu'un mot de passe en clair quelque part.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

/** Dérive une clé 32 bytes depuis AUTH_SECRET via SHA-256.
 *  SHA-256 est ici un KDF léger : on accepte la perte d'entropie vs PBKDF2
 *  parce qu'AUTH_SECRET est déjà du random 32+ bytes (recommandation Auth.js). */
function getKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET missing or too short (>=32 chars required for AES-256-GCM key derivation)",
    );
  }
  return createHash("sha256").update(secret).digest();
}

/** Chiffre une chaîne UTF-8 en `<iv_b64>:<tag_b64>:<ciphertext_b64>`. */
export function encryptPassword(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("encryptPassword: plaintext must be a non-empty string");
  }
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/** Déchiffre une chaîne produite par {@link encryptPassword}.
 *  Throw si format invalide, mauvaise clé, ou tampering. */
export function decryptPassword(encrypted: string): string {
  if (typeof encrypted !== "string") {
    throw new Error("decryptPassword: encrypted must be a string");
  }
  const parts = encrypted.split(":");
  if (parts.length !== 3) {
    throw new Error(
      "decryptPassword: invalid format (expected <iv>:<tag>:<ciphertext>)",
    );
  }
  const [ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(ctB64, "base64");
  if (iv.length !== IV_LENGTH) {
    throw new Error(`decryptPassword: invalid IV length (got ${iv.length})`);
  }

  const key = getKey();
  if (key.length !== KEY_LENGTH) {
    throw new Error("decryptPassword: invalid key length");
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/** Helper pour les routes UI : ne JAMAIS retourner le password déchiffré
 *  au client, même partiellement. On expose seulement "configuré : oui/non". */
export function isPasswordConfigured(encrypted: string | null | undefined): boolean {
  return typeof encrypted === "string" && encrypted.length > 0;
}
