FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Адрес панели на поддомене: /admin основного сайта уводит туда.
ARG VITE_ADMIN_ORIGIN=
ENV VITE_ADMIN_ORIGIN=$VITE_ADMIN_ORIGIN
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
