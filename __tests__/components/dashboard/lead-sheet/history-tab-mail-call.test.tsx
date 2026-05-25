/**
 * Tests source-level sur history-tab.tsx — extension Phase 2 (mail_out)
 * + Phase 3 (call) de la fiche historique 360°.
 *
 * Verrouille l'invariant front qu'on ne peut pas oublier de câbler :
 *  - Le set des EventType inclut bien mail_out + call (en plus des 3 Phase 1)
 *  - TYPE_LABELS exposent "Mails envoyés" + "Appels"
 *  - Les icônes Mail, Phone, PhoneIncoming sont importées (pas faux import)
 *  - Le rendu mail_out affiche subject, status, body preview, template
 *  - Le rendu call affiche durée formatée + status + lien Écouter conditionnel
 *  - data-testid history-call-recording présent (sinon E2E rate le bouton)
 */
import { describe, expect, test } from "vitest";

describe("history-tab.tsx — Phase 2 mail_out + Phase 3 call", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(
        process.cwd(),
        "src/components/dashboard/lead-sheet/history-tab.tsx",
      ),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  test("EventType union inclut 'mail_out' et 'call'", () => {
    expect(source).toMatch(/"mail_out"/);
    expect(source).toMatch(/"call"/);
  });

  test("TYPE_LABELS expose 'Mails envoyés' + 'Appels'", () => {
    expect(source).toMatch(/mail_out:\s*"Mails envoyés"/);
    expect(source).toMatch(/call:\s*"Appels"/);
  });

  test("imports lucide étendus avec Mail, Phone, PhoneIncoming", () => {
    expect(source).toMatch(/\bMail\b/);
    expect(source).toMatch(/\bPhone\b/);
    expect(source).toMatch(/\bPhoneIncoming\b/);
  });

  test("rendu mail_out présent (subject + bodyPreview + status)", () => {
    expect(source).toMatch(/evt\.type === "mail_out"/);
    expect(source).toMatch(/evt\.subject/);
    expect(source).toMatch(/evt\.bodyPreview/);
    expect(source).toMatch(/evt\.status/);
    expect(source).toMatch(/\(sans objet\)/);
    expect(source).toMatch(/\(sans contenu\)/);
  });

  test("rendu call présent (direction inbound vs outbound)", () => {
    expect(source).toMatch(/evt\.type === "call"/);
    expect(source).toMatch(/evt\.direction === "inbound"/);
    expect(source).toMatch(/formatDuration\(evt\.durationSeconds\)/);
  });

  test("bouton Écouter conditionné sur recordingPath", () => {
    // Le pattern attendu : test sur evt.recordingPath avant de rendre le bouton
    expect(source).toMatch(/evt\.recordingPath\s*&&/);
    expect(source).toMatch(/data-testid="history-call-recording"/);
    expect(source).toMatch(/Écouter/);
  });

  test("enabledTypes initial inclut mail_out + call (= rien n'est filtré par défaut)", () => {
    expect(source).toMatch(/"mail_out"/);
    expect(source).toMatch(/new Set\(\["pipeline_transition"[\s\S]*?"mail_out"[\s\S]*?"call"/);
  });

  test("formatDuration helper exporté/présent pour mm:ss", () => {
    expect(source).toMatch(/function formatDuration/);
    expect(source).toMatch(/padStart\(2, "0"\)/);
  });

  test("data-testid history-event-mail_out et history-event-call rendus implicitement par template literal", () => {
    // Le composant Phase 1 utilise `history-event-${evt.type}` — donc OK
    // pour tous nouveaux types tant que le pattern dynamique est conservé.
    expect(source).toMatch(/data-testid=\{`history-event-\$\{evt\.type\}`\}/);
  });
});
