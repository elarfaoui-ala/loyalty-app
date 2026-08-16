# --- build stage ---
# VITE_API_BASE is baked in at build time. For the compose deployment it is the
# relative /api/v1 path, which the bundled nginx proxies to the API service.
FROM node:20-alpine AS build
WORKDIR /app
ARG VITE_API_BASE=/api/v1
ENV VITE_API_BASE=$VITE_API_BASE
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- runtime stage ---
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
