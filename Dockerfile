# For any container host: Fly.io, Railway (deploy from Dockerfile), a VPS.
# On Render, prefer render.yaml.
#
# Mount a persistent volume at /app/data. Without one, every account is lost
# on the next deploy — the image itself is rebuilt from scratch each time.

# ---- build ------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Only needed if better-sqlite3 has no prebuilt binary for this platform and
# must compile. Kept in the build stage, so none of it ships.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# --include=dev: Vite and Tailwind are needed to build the client.
RUN npm ci --include=dev

COPY . .
RUN npm run build \
 && npm prune --omit=dev

# ---- run --------------------------------------------------------------------
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    TRUST_PROXY=1

COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/data && chown node:node /app/data

# Never run as root.
USER node
EXPOSE 3001

# No curl in slim images; Node's fetch does the job. 127.0.0.1 is exempt from
# the HTTPS redirect, so this checks the app rather than getting a 301.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
