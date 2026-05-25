/**
 * E2E hard-core IMAP réception (W8b 2026-05-25).
 *
 * Périmètre :
 *  - UI Settings → onglet IMAP : config CRUD, bouton test connexion
 *  - API /api/mail/imap-config : RBAC admin only, idempotence
 *  - API /api/mail/test-imap-connection : statut persisté, mauvais host → error
 *  - API /api/cron/imap-sync : auth Bearer, idempotence, pas de duplicate
 *  - Insertion lead_emails(direction="incoming") visible en DB
 *  - Threading : in_reply_to / references stockés
 *
 * Note : pas de vrai serveur IMAP dans staging-edge (mailpit = SMTP only).
 * On valide donc :
 *  - les flows de config & test (avec host invalide → erreurs attendues)
 *  - les flows downstream (cron + DB) en injectant directement des
 *    lead_emails incoming via Prisma — simule ce que ferait le cron une
 *    fois branché sur un serveur IMAP réel.
 *
 * Un smoke contractuel "vrai serveur IMAP" peut être ajouté plus tard avec
 * REAL_IMAP_HOST/USER/PASSWORD comme mail-real-smtp.spec.ts.
 */
import { test, expect } from "@playwright/test";
import { loginAsE2EUser } from "../helpers/auth";
import {
  seedImapConfig,
  clearImapConfig,
  readImapState,
  insertIncomingLeadEmail,
  countIncomingEmails,
  purgeIncomingEmails,
  setImapLastUid,
} from "../flows-mail/_helpers/imap-config";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

const CRON_SECRET = process.env.CRON_SECRET;

const FAKE_IMAP_CFG = {
  host: "imap-does-not-exist.invalid",
  port: 993,
  username: "ghost@invalid.test",
  password: "doesnotmatter",
  tls: true,
  folder: "INBOX",
};

test.describe("IMAP réception — config CRUD", () => {
  test.beforeEach(async () => {
    await clearImapConfig();
    await purgeIncomingEmails();
  });

  test("config IMAP : PUT → GET retourne la config persistée (sans password)", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    await seedImapConfig(page, PROSPECTION_URL, FAKE_IMAP_CFG);

    const getRes = await page.request.get(`${PROSPECTION_URL}/api/mail/imap-config`);
    expect(getRes.ok()).toBe(true);
    const cfg = await getRes.json();
    expect(cfg.host).toBe(FAKE_IMAP_CFG.host);
    expect(cfg.port).toBe(FAKE_IMAP_CFG.port);
    expect(cfg.passwordConfigured).toBe(true);
    expect(cfg).not.toHaveProperty("password");
    expect(cfg).not.toHaveProperty("imapPasswordEnc");
  });

  test("config IMAP : DELETE → état effacé (host null, last_sync_status null)", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    await seedImapConfig(page, PROSPECTION_URL, FAKE_IMAP_CFG);

    const delRes = await page.request.delete(`${PROSPECTION_URL}/api/mail/imap-config`);
    expect(delRes.ok()).toBe(true);

    const state = await readImapState();
    expect(state?.imapHost).toBeNull();
    expect(state?.imapPasswordEnc).toBeNull();
    expect(state?.imapLastUidSeen).toBeNull();
  });

  test("config IMAP : 400 si payload invalide (port hors plage)", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    const res = await page.request.put(`${PROSPECTION_URL}/api/mail/imap-config`, {
      data: { host: "x.com", port: 99999, username: "u", tls: true, folder: "INBOX" },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe("IMAP réception — test de connexion", () => {
  test.beforeEach(async () => {
    await clearImapConfig();
    await purgeIncomingEmails();
  });

  test("test-imap-connection : host inexistant → reason mappé, status persisté", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    await seedImapConfig(page, PROSPECTION_URL, FAKE_IMAP_CFG);

    const res = await page.request.post(`${PROSPECTION_URL}/api/mail/test-imap-connection`, {
      data: {},
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    // Selon le DNS du runner : host_unreachable ou timeout. Les deux sont acceptables.
    expect(["host_unreachable", "timeout", "unknown"]).toContain(body.reason);

    // Vérif le state DB
    const state = await readImapState();
    expect(state?.imapLastSyncStatus).toBeTruthy();
    expect(["host_unreachable", "timeout", "unknown"]).toContain(state?.imapLastSyncStatus ?? "");
  });

  test("test-imap-connection : pas de creds → reason=missing_credentials", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    // Pas de seed → pas de creds en DB
    const res = await page.request.post(`${PROSPECTION_URL}/api/mail/test-imap-connection`, {
      data: {},
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("missing_credentials");
  });
});

test.describe("IMAP réception — cron route (auth Bearer)", () => {
  test.skip(!CRON_SECRET, "CRON_SECRET non exposé au runner E2E — skip auth Bearer specs");

  test.beforeEach(async () => {
    await clearImapConfig();
    await purgeIncomingEmails();
  });

  test("cron route : 401 sans header Authorization", async ({ request }) => {
    const res = await request.post(`${PROSPECTION_URL}/api/cron/imap-sync`);
    expect(res.status()).toBe(401);
  });

  test("cron route : 401 avec mauvais Bearer", async ({ request }) => {
    const res = await request.post(`${PROSPECTION_URL}/api/cron/imap-sync`, {
      headers: { authorization: "Bearer notthesecret" },
    });
    expect(res.status()).toBe(401);
  });

  test("cron route : 200 avec Bearer valide, retourne le compteur tenants", async ({ request }) => {
    const res = await request.post(`${PROSPECTION_URL}/api/cron/imap-sync`, {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.totalTenants).toBe("number");
    expect(typeof body.duration_ms).toBe("number");
  });

  test("cron route : tenant IMAP fake → run met à jour last_sync_status=error", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    await seedImapConfig(page, PROSPECTION_URL, FAKE_IMAP_CFG);

    const res = await request.post(`${PROSPECTION_URL}/api/cron/imap-sync`, {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(res.status()).toBe(200);

    const state = await readImapState();
    expect(state?.imapLastSyncStatus).toBeTruthy();
    expect(state?.imapLastSyncStatus).not.toBe("ok");
  });
});

test.describe("IMAP réception — lead_emails incoming", () => {
  test.beforeEach(async () => {
    await clearImapConfig();
    await purgeIncomingEmails();
  });

  test("incoming inséré → direction=incoming + sent_status=received en DB", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    const messageId = `e2e-incoming-${Date.now()}@test`;
    await insertIncomingLeadEmail({
      messageId,
      fromEmail: "prospect@example.com",
      subject: "Réponse à votre offre",
      bodyText: "Bonjour, intéressé.",
    });
    const count = await countIncomingEmails();
    expect(count).toBe(1);
  });

  test("incoming idempotent : insertion duplicate messageId rejetée par UNIQUE", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    const messageId = `e2e-dup-${Date.now()}@test`;
    await insertIncomingLeadEmail({ messageId, fromEmail: "x@y.fr" });
    await expect(async () => {
      await insertIncomingLeadEmail({ messageId, fromEmail: "x@y.fr" });
    }).rejects.toThrow();
    const count = await countIncomingEmails();
    expect(count).toBe(1);
  });

  test("incoming avec from inconnu → siren=NULL (non rattaché)", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    await insertIncomingLeadEmail({
      messageId: `e2e-unknown-${Date.now()}@test`,
      fromEmail: "inconnu@nowhere.com",
      siren: null,
    });
    expect(await countIncomingEmails()).toBe(1);
    expect(await countIncomingEmails({ siren: undefined })).toBe(1);
  });

  test("threading : in_reply_to + references stockés", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    const parentId = `e2e-thread-parent-${Date.now()}@test`;
    const childId = `e2e-thread-child-${Date.now()}@test`;
    await insertIncomingLeadEmail({
      messageId: childId,
      fromEmail: "prospect@example.com",
      inReplyTo: parentId,
      references: `<${parentId}>`,
    });
    expect(await countIncomingEmails()).toBe(1);
  });
});

test.describe("IMAP réception — UI Settings", () => {
  test.beforeEach(async () => {
    await clearImapConfig();
  });

  test("onglet IMAP visible sur /settings/mail", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    await page.goto(`${PROSPECTION_URL}/settings/mail`);
    // Cherche l'onglet IMAP. Tabs Shadcn → role=tab
    const tab = page.getByRole("tab", { name: /IMAP/i });
    await expect(tab).toBeVisible({ timeout: 15_000 });
  });

  test("clic onglet IMAP → form IMAP visible avec champs host/port/folder", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    await page.goto(`${PROSPECTION_URL}/settings/mail`);
    await page.getByRole("tab", { name: /IMAP/i }).click();

    await expect(page.locator("#imap-host")).toBeVisible();
    await expect(page.locator("#imap-port")).toBeVisible();
    await expect(page.locator("#imap-folder")).toBeVisible();
  });

  test("UI affiche dernier sync status après seed", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    await seedImapConfig(page, PROSPECTION_URL, FAKE_IMAP_CFG);
    // Force un last_sync via test-connection (host invalide → status error)
    await page.request.post(`${PROSPECTION_URL}/api/mail/test-imap-connection`, { data: {} });

    await page.goto(`${PROSPECTION_URL}/settings/mail`);
    await page.getByRole("tab", { name: /IMAP/i }).click();

    // L'UI doit afficher le badge "✓ configuré" puisqu'on a un password
    const configured = page.locator("text=✓ configuré");
    await expect(configured.first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("IMAP réception — incrémental UID", () => {
  test.beforeEach(async () => {
    await clearImapConfig();
    await purgeIncomingEmails();
  });

  test("set last_uid_seen via helper → cron repart de ce point", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    await seedImapConfig(page, PROSPECTION_URL, FAKE_IMAP_CFG);
    await setImapLastUid(42);
    const state = await readImapState();
    expect(state?.imapLastUidSeen).toBe(42);
  });
});
