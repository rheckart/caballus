# The single container of ADR 0007, built on the Node 24 LTS that ADR pins by
# digest rather than by tag — a tag moves, and a base image that moved under a
# deploy is the one variable nobody thinks to check at 6am.
#
# The runtime stage deliberately keeps `src/`, `drizzle.config.ts` and the
# development dependencies. Two acts on this image are not the server: the
# migration step (`drizzle-kit`, reading `src/db/migrations` and `schema.ts`)
# and the one-time bootstrap (`jiti`, reading TypeScript straight out of
# `src/`). Splitting them into a second image is the alternative, and it buys a
# smaller image at the price of two artefacts that can disagree about which
# commit they are — which is the failure this ADR spends a digest to avoid.

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

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/package.json /app/package-lock.json /app/tsconfig.json /app/drizzle.config.ts ./

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
