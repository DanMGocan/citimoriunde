# Debian provides reliable Sharp/libvips support; Node 24 is a supported LTS release.
FROM node:24.21.0-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts=false

FROM dependencies AS build
COPY . .
# These non-production build-only values are never deployment credentials.
ENV APP_ENV=development AUTH_SECRET=build-only-placeholder-never-use-for-deployment DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
ENV NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=1536
RUN npm run build

# The worker and maintenance commands are outside Next's web dependency traces.
# Retain their production dependencies, including tsx, without test/build tooling.
FROM dependencies AS production-dependencies
RUN npm prune --omit=dev --ignore-scripts

FROM node:24.21.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=768
ENV HOSTNAME=0.0.0.0 PORT=3000
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid 10001 --no-create-home app && mkdir -p /app/storage/images && chown -R app:app /app
# Keep generated web package metadata separate from the ESM maintenance package.
# Next's generated standalone server is the production web entrypoint.
# Official pattern: https://github.com/vercel/next.js/tree/canary/examples/with-docker
COPY --from=build --chown=app:app /app/.next/standalone ./web
COPY --from=production-dependencies --chown=app:app /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=app:app /app/package.json /app/package-lock.json ./
COPY --from=build --chown=app:app /app/tsconfig.json ./
COPY --from=build --chown=app:app /app/.next/static ./web/.next/static
COPY --from=build --chown=app:app /app/public ./web/public
COPY --from=build --chown=app:app /app/src ./src
COPY --from=build --chown=app:app /app/scripts ./scripts
COPY --from=build --chown=app:app /app/data ./data
COPY --from=build --chown=app:app /app/migrations ./migrations
USER 10001:10001
EXPOSE 3000
CMD ["node", "web/server.js"]
