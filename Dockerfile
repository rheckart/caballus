# The single container of ADR 0007, built on the Node 24 LTS that ADR pins by
# digest rather than by tag — a tag moves, and a base image that moved under a
# deploy is the one variable nobody thinks to check at 6am.
#
# The runtime stage keeps `src/` and `drizzle.config.ts`, because two acts on
# this image are not the server: the migration step (`drizzle-kit`, reading
# `src/db/migrations` and `schema.ts`) and the one-time bootstrap (`jiti`,
# reading TypeScript straight out of `src/`). Both tools are `dependencies` for
# exactly that reason — running a migration is a production act here, and
# calling them development-only would be a lie the deploy depends on.
#
# It installs those production dependencies **fresh** rather than copying the
# build stage's `node_modules`, and that is not tidiness. The full tree is
# 430 MB in one layer, and pushing one layer that size to a registry behind a
# home Cloudflare tunnel timed out awaiting response headers on the blob commit
# — a deploy that fails on the size of its own artefact. Splitting the image is
# still refused: it buys a smaller artefact at the price of two that can
# disagree about which commit they are.

FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS build

WORKDIR /app

# The lockfile alone first, so that a change to application code does not
# reinstall the world.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS runtime

LABEL org.opencontainers.image.source="https://git.heckart.me/rob/caballus"
LABEL org.opencontainers.image.description="Operations for a horse rescue."

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
# `prepare` runs husky, which is a development dependency and therefore absent
# here — the hook it installs belongs to a working copy, not to a container.
# Dropped from this image's copy of the manifest rather than skipping scripts
# wholesale, because drizzle-kit's own esbuild still needs its install script.
RUN npm pkg delete scripts.prepare \
  && npm ci --omit=dev \
  && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY tsconfig.json drizzle.config.ts ./

EXPOSE 3000

# The same probe the deploy script polls from outside, so `docker compose ps`
# and the deploy agree about what healthy means.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node

# `node` rather than `npm start`: npm sits between the init signal and the
# process, and a container that does not hear SIGTERM is a container that gets
# killed rather than closing its connections.
CMD ["node", "--env-file-if-exists=.env", "scripts/serve.mjs"]
