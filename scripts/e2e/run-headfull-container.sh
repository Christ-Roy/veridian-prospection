#!/usr/bin/env bash
# Entrypoint du container Playwright utilisé par staging-full.sh.
# Xvfb est lancé explicitement : xvfb-run attend un signal USR1 qui se perd
# quand le container rejoint le namespace réseau d'une allocation Nomad.
set -euo pipefail

echo "── npm ci ──"
npm ci --no-audit --no-fund

if [[ "${STAGING_URL:-}" == *".staging."* ]]; then
  echo
  echo "── Fixture credentials staging ──"
  node <<'NODE'
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const email = process.env.STAGING_USER_EMAIL;
const password = process.env.STAGING_USER_PASSWORD;
if (!email || !password) {
  throw new Error("STAGING_USER_EMAIL/STAGING_USER_PASSWORD manquants");
}

const prisma = new PrismaClient();
(async () => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new Error(`Utilisateur staging introuvable: ${email}`);
  }

  const account = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: "credentials",
        providerAccountId: email,
      },
    },
  });
  const alreadyValid = Boolean(account?.access_token) &&
    await bcrypt.compare(password, account.access_token);
  if (!alreadyValid) {
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.account.upsert({
      where: {
        provider_providerAccountId: {
          provider: "credentials",
          providerAccountId: email,
        },
      },
      update: { userId: user.id, type: "credentials", access_token: passwordHash },
      create: {
        userId: user.id,
        type: "credentials",
        provider: "credentials",
        providerAccountId: email,
        access_token: passwordHash,
      },
    });
  }
})()
  .then(async () => {
    await prisma.$disconnect();
    console.log("✓ Fixture credentials staging prête");
  })
  .catch(async (error) => {
    console.error(error.message);
    await prisma.$disconnect();
    process.exit(1);
  });
NODE
fi

echo
echo "── Xvfb + Playwright headfull ──"
XVFB_LOG=$(mktemp)
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp -ac >"$XVFB_LOG" 2>&1 &
XVFB_PID=$!

cleanup() {
  kill "$XVFB_PID" >/dev/null 2>&1 || true
  wait "$XVFB_PID" >/dev/null 2>&1 || true
  rm -f "$XVFB_LOG"
}
trap cleanup EXIT INT TERM

for _ in {1..50}; do
  if [ -S /tmp/.X11-unix/X99 ]; then
    break
  fi
  if ! kill -0 "$XVFB_PID" >/dev/null 2>&1; then
    echo "::error::Xvfb s'est arrêté avant de créer le display :99"
    cat "$XVFB_LOG"
    exit 1
  fi
  sleep 0.1
done

if [ ! -S /tmp/.X11-unix/X99 ]; then
  echo "::error::Xvfb n'a pas créé le display :99 après 5 secondes"
  cat "$XVFB_LOG"
  exit 1
fi

PLAYWRIGHT_ARGS=()
if [ -n "${PLAYWRIGHT_TEST_ARGS:-}" ]; then
  read -r -a PLAYWRIGHT_ARGS <<<"$PLAYWRIGHT_TEST_ARGS"
fi

DISPLAY=:99 npx --no-install playwright test \
  "${PLAYWRIGHT_ARGS[@]}" \
  --config=playwright.staging-full.config.ts
