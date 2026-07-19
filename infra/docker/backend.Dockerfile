FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY prisma/ ./prisma/
RUN npm ci
# Generate Prisma client (required before TypeScript compilation)
RUN npx prisma generate
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma
EXPOSE 4000
CMD ["node", "dist/main.js"]
