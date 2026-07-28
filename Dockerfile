FROM oven/bun:1.3.14-slim

WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY data ./data

RUN mkdir -p /data && chown -R bun:bun /app /data

ENV PORT=8402
ENV SQLITE_PATH=/data/rob.db

USER bun

EXPOSE 8402

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "const r=await fetch('http://127.0.0.1:8402/healthz');if(!r.ok)process.exit(1)"]

CMD ["bun", "run", "src/cli.ts", "serve"]
