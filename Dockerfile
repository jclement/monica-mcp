# ---- build: compile CSS + bundle the server with bun -----------------------
FROM oven/bun:1.3.14 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bunx @tailwindcss/cli -i styles/app.css -o public/app.css --minify \
 && bun build src/server.ts --target=bun --outdir=dist \
 && mkdir -p dist/migrations && cp src/db/migrations/*.sql dist/migrations/

# ---- runtime: Bun only (Monica is reached over HTTP — no child processes) ----
FROM oven/bun:1.3.14-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD bun -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bun", "dist/server.js"]
