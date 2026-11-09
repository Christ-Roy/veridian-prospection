/**
 * Aucun secret d'une autre app en clair dans la base de Prospection : les colonnes twenty_api_key,
 * twenty_user_password et twenty_login_token ont été vidées puis supprimées le 09/11 (dump au froid).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

test("le schéma Prisma ne déclare plus de clé d'API d'une autre app", () => {
  const schema = readFileSync(path.resolve(__dirname, "../../prisma/schema.prisma"), "utf8");
  for (const col of ["twenty_api_key", "twenty_user_password", "twenty_login_token", "notifuse_api_key"]) {
    expect(schema).not.toMatch(new RegExp(`@map\\("${col}`));
  }
});

test("pas d'invitation locale : la table invitations ne revient pas (une invitation crée un utilisateur, c'est le Hub)", () => {
  const schema = readFileSync(path.resolve(__dirname, "../../prisma/schema.prisma"), "utf8");
  expect(schema).not.toMatch(/@@map\("invitations"\)/);
});
