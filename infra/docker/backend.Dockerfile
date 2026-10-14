FROM node:20-alpine AS builder
WORKDIR /app
# Install OpenSSL for Prisma
RUN apk add --no-cache openssl
COPY package*.json ./
COPY prisma/ ./prisma/
RUN npm ci
RUN npx prisma generate
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
# Install OpenSSL runtime for Prisma engine
RUN apk add --no-cache openssl
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma
# CD запускает сид (npx tsx prisma/seed.ts) в этом образе, а сид города берёт
# каталог из src/modules/city/city.config.ts: без исходников выкат падал.
COPY --from=builder /app/src ./src
EXPOSE 4000
CMD ["node", "dist/main.js"]
