/**
 * Tests unitaires pour src/lib/mail/provider-presets.ts
 *
 * detectProvider doit :
 *  - retourner le preset correct pour chaque domaine connu
 *  - être case-insensitive sur le domaine
 *  - retourner null pour domaines inconnus, malformés, ou vides
 *  - ne pas planter sur inputs bizarres (undefined, sans @, espaces)
 *
 * Et la table MAIL_PROVIDERS doit respecter le contrat :
 *  - host non-vide pour chaque entrée
 *  - port > 0
 *  - les flags requiresAppPassword correspondent à la doc 2026 (Gmail/MS/Yahoo/iCloud = true, OVH/Free = false)
 *
 * Run: npx vitest run src/lib/mail/provider-presets.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  detectProvider,
  MAIL_PROVIDERS,
  type MailProviderPreset,
} from "./provider-presets";

describe("detectProvider — domaines connus", () => {
  it("gmail.com → preset gmail", () => {
    const p = detectProvider("john@gmail.com");
    expect(p?.id).toBe("gmail");
    expect(p?.imap.host).toBe("imap.gmail.com");
    expect(p?.smtp.host).toBe("smtp.gmail.com");
    expect(p?.requiresAppPassword).toBe(true);
  });

  it("googlemail.com → preset gmail (alias)", () => {
    expect(detectProvider("jane@googlemail.com")?.id).toBe("gmail");
  });

  it("outlook.com → preset outlook", () => {
    const p = detectProvider("bob@outlook.com");
    expect(p?.id).toBe("outlook");
    expect(p?.smtp.port).toBe(587);
  });

  it("hotmail.com → preset outlook", () => {
    expect(detectProvider("user@hotmail.com")?.id).toBe("outlook");
  });

  it("yahoo.fr → preset yahoo", () => {
    expect(detectProvider("alice@yahoo.fr")?.id).toBe("yahoo");
  });

  it("icloud.com → preset icloud", () => {
    expect(detectProvider("steve@icloud.com")?.id).toBe("icloud");
  });

  it("ovh.fr → preset ovh (pas d'app password requis)", () => {
    const p = detectProvider("admin@ovh.fr");
    expect(p?.id).toBe("ovh");
    expect(p?.requiresAppPassword).toBe(false);
  });

  it("free.fr → preset free", () => {
    expect(detectProvider("dupont@free.fr")?.id).toBe("free");
  });
});

describe("detectProvider — case insensitive", () => {
  it("OUTLOOK.COM (upper) → preset outlook", () => {
    expect(detectProvider("BOB@OUTLOOK.COM")?.id).toBe("outlook");
  });

  it("Gmail.Com (mixed case) → preset gmail", () => {
    expect(detectProvider("jane@Gmail.Com")?.id).toBe("gmail");
  });

  it("trim whitespace dans domaine", () => {
    expect(detectProvider("trim@gmail.com  ")?.id).toBe("gmail");
  });
});

describe("detectProvider — null cases", () => {
  it("domaine inconnu → null", () => {
    expect(detectProvider("alice@boulanger.fr")).toBeNull();
  });

  it("email sans @ → null", () => {
    expect(detectProvider("notanemail")).toBeNull();
  });

  it("email vide → null", () => {
    expect(detectProvider("")).toBeNull();
  });

  it("email avec @ vide en domaine → null", () => {
    expect(detectProvider("user@")).toBeNull();
  });
});

describe("MAIL_PROVIDERS — contrat structurel", () => {
  it("contient au moins 6 providers", () => {
    expect(MAIL_PROVIDERS.length).toBeGreaterThanOrEqual(6);
  });

  it.each(MAIL_PROVIDERS.map((p): [string, MailProviderPreset] => [p.id, p]))(
    "preset %s : host/port valides",
    (_id, p) => {
      expect(p.imap.host).not.toBe("");
      expect(p.smtp.host).not.toBe("");
      expect(p.imap.port).toBeGreaterThan(0);
      expect(p.smtp.port).toBeGreaterThan(0);
      expect(p.domains.length).toBeGreaterThan(0);
    },
  );

  it("Gmail/Outlook/Yahoo/iCloud exigent App Password (2026 reality)", () => {
    const ids = ["gmail", "outlook", "yahoo", "icloud"];
    for (const id of ids) {
      const p = MAIL_PROVIDERS.find((x) => x.id === id);
      expect(p?.requiresAppPassword).toBe(true);
      expect(p?.appPasswordUrl).toMatch(/^https:\/\//);
      expect(p?.appPasswordGuide?.steps.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("OVH/Free n'exigent pas d'App Password", () => {
    expect(MAIL_PROVIDERS.find((p) => p.id === "ovh")?.requiresAppPassword).toBe(false);
    expect(MAIL_PROVIDERS.find((p) => p.id === "free")?.requiresAppPassword).toBe(false);
  });

  it("Gmail = port IMAP 993 SSL direct (pas 143 STARTTLS — imapflow s'attend à ça)", () => {
    const gmail = MAIL_PROVIDERS.find((p) => p.id === "gmail");
    expect(gmail?.imap.port).toBe(993);
    expect(gmail?.imap.tls).toBe(true);
  });
});
