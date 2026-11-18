# syntax=docker/dockerfile:1
# On-prem web image: builds the SPA with the OIDC auth provider and serves it with nginx.
# Build context is the REPOSITORY ROOT (npm workspaces): docker build -f web/Dockerfile .
ARG NODE_IMAGE=node@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged@sha256:65e3e85dbaed8ba248841d9d58a899b6197106c23cb0ff1a132b7bfe0547e4c0

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY api/package.json api/
RUN npm ci -w @certificate-manager/web --include-workspace-root --ignore-scripts
COPY web ./web
# Build-time configuration; public values only (never secrets).
ARG VITE_AUTH_PROVIDER=oidc
ARG VITE_OIDC_AUTHORITY
ARG VITE_OIDC_CLIENT_ID
ARG VITE_OIDC_SCOPE
ENV VITE_AUTH_PROVIDER=$VITE_AUTH_PROVIDER VITE_OIDC_AUTHORITY=$VITE_OIDC_AUTHORITY \
    VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID VITE_OIDC_SCOPE=$VITE_OIDC_SCOPE
WORKDIR /app/web
RUN npx vite build && node scripts/check-bundle.mjs

FROM ${NGINX_IMAGE} AS runtime
COPY --from=build /app/web/dist /usr/share/nginx/html
COPY infra/onprem/nginx/default.conf /etc/nginx/conf.d/default.conf
EXPOSE 8443
