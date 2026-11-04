# syntax=docker/dockerfile:1
# Node 22 LTS (alpine), pinned by digest.
ARG NODE_IMAGE=node@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
# Runtime base: plain Alpine; only the node binary is copied in, so the image
# carries no npm, yarn or corepack.
ARG RUNTIME_IMAGE=alpine@sha256:2e0b81d60597f449baa56dc25d355367869d2dca4cd57e866f1e2b52af3eb55f

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM ${NODE_IMAGE} AS node-bin

FROM ${RUNTIME_IMAGE} AS runtime
RUN apk add --no-cache libstdc++ && adduser -D -u 10001 app
COPY --from=node-bin /usr/local/bin/node /usr/local/bin/node
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Files stay root-owned and read-only for the app; only /tmp is writable.
USER app
EXPOSE 8080
# server.ts handles SIGTERM itself, so node can run as PID 1 without an init wrapper.
CMD ["node", "dist/server.js"]
