# --- build stage -------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

RUN apk add --no-cache openssl

# Install deps (layer cached independently of source changes)
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# --- runtime stage -----------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache openssl

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund && npx prisma generate

COPY --from=builder /app/dist ./dist
COPY prisma ./prisma

EXPOSE 3000
USER node
CMD ["node", "dist/server.js"]