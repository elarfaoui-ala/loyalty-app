# --- build stage ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

# --- runtime stage ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# `prisma` is a production dependency (not dev) so the migrate CLI and the
# generated client are available at runtime below.
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate
COPY --from=build /app/dist ./dist

RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3000

# Apply schema migrations before starting, so a fresh `docker compose up`
# boots against a fully-initialized database.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
