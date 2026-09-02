FROM node:22-alpine AS base

FROM base AS deps
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* are baked at build time by Next.js.
# They are read from .env.production (committed, public URLs only).
# Build args can override them if passed (e.g. CI staging build).
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_HUB_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_TRIAL_DAYS

# Only set ENV if the ARG was explicitly provided (non-empty).
# Otherwise Next.js reads from .env.production automatically.
RUN if [ -n "$NEXT_PUBLIC_SUPABASE_URL" ]; then echo "NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL" >> .env.local; fi && \
    if [ -n "$NEXT_PUBLIC_SUPABASE_ANON_KEY" ]; then echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY" >> .env.local; fi && \
    if [ -n "$NEXT_PUBLIC_HUB_URL" ]; then echo "NEXT_PUBLIC_HUB_URL=$NEXT_PUBLIC_HUB_URL" >> .env.local; fi && \
    if [ -n "$NEXT_PUBLIC_SITE_URL" ]; then echo "NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL" >> .env.local; fi && \
    if [ -n "$NEXT_PUBLIC_TRIAL_DAYS" ]; then echo "NEXT_PUBLIC_TRIAL_DAYS=$NEXT_PUBLIC_TRIAL_DAYS" >> .env.local; fi

RUN npx prisma generate && npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

# Build provenance — injecté par CI via --build-arg.
# Lu par GET /api/version pour confirmer le SHA du container actif
# (fix race condition webhook Dokploy, cf. project_prospection_dokploy_webhook_fail).
ARG COMMIT_SHA=unknown
ARG BUILT_AT=unknown
ENV COMMIT_SHA=$COMMIT_SHA
ENV BUILT_AT=$BUILT_AT

# Retire npm + corepack du runner (Next.js standalone tourne avec node server.js).
# Eradique CVE node-pkg embarques dans /usr/local/lib/node_modules/npm/* (ex
# CVE-2026-33671 sur picomatch 4.0.3 embedded dans npm). Cf sprint GitOps 2026-05-13.
# `apk upgrade` AVANT le `apk add` : sans lui, les paquets DÉJÀ présents dans
# node:22-alpine (libssl3, libcrypto3, busybox, zlib…) restent à la version
# publiée le jour où l'image de base a été construite. `apk add` n'y touche pas :
# il installe ce qui manque, il ne remonte pas ce qui est déjà satisfait. Une
# image reconstruite aujourd'hui repartait donc avec les CVE OpenSSL d'il y a
# plusieurs semaines, quel que soit le nombre de constructions.
#
# 🔴 Cette couche n'a d'effet que si elle est RÉELLEMENT EXÉCUTÉE. `--no-cache`
# est une option d'apk, elle ne désactive PAS le cache de couches de buildkit :
# tant que le digest de node:22-alpine ne bouge pas, `cache-from: type=gha`
# resservirait indéfiniment un jeu de paquets figé (mesuré sur notifuse, run
# 33254429451 : `RUN apk upgrade … CACHED`). C'est pourquoi le stage s'appelle
# `runner` et que les workflows portent `no-cache-filters: runner` + `pull: true`.
# Ne PAS renommer ce stage sans corriger les trois workflows qui le nomment.
RUN apk upgrade --no-cache && \
    apk add --no-cache openssl && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Next 15 standalone tracing keeps Sharp's native binding but omits the
# separate libvips package introduced by Sharp 0.35 on Alpine. Without this
# explicit copy, image optimization crashes at runtime with ERR_DLOPEN_FAILED.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@img/sharp-libvips-linuxmusl-x64 ./node_modules/@img/sharp-libvips-linuxmusl-x64
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
