# ── deps ──────────────────────────────────────────────────────────────────
FROM node:22-slim AS deps
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install

# ── dev (used by docker-compose.yml for local development) ─────────────────
FROM deps AS dev
WORKDIR /app
COPY . .
RUN npx prisma generate
EXPOSE 4000
CMD ["npm", "run", "dev"]

# ── build ────────────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /app
COPY . .
RUN npx prisma generate
RUN npm run build

# ── migrate-seed (one-shot compose service) ─────────────────────────────
FROM deps AS migrate-seed
WORKDIR /app
COPY . .
RUN npx prisma generate
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed/index.ts"]

# ── runtime (production target, must stay last: Render builds the final
# stage when no --target is given) ──────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts/start.sh ./scripts/start.sh
EXPOSE 4000
CMD ["node", "dist/main.js"]
