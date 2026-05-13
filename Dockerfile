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
# Retire npm + corepack du runner (Next.js standalone tourne avec node server.js).
# Eradique CVE node-pkg embarques dans /usr/local/lib/node_modules/npm/* (ex
# CVE-2026-33671 sur picomatch 4.0.3 embedded dans npm). Cf sprint GitOps 2026-05-13.
RUN apk add --no-cache openssl && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
