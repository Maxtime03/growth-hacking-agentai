# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS presentation-deps-base

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY worker/presentations/secure-npm-ci.mjs ./worker/presentations/secure-npm-ci.mjs

FROM presentation-deps-base AS presentation-deps-public-tls

RUN test ! -e /run/secrets/npm_ca_cert \
  && test -z "${NODE_EXTRA_CA_CERTS:-}" \
  && test "${NODE_TLS_REJECT_UNAUTHORIZED:-1}" != "0" \
  && node worker/presentations/secure-npm-ci.mjs

FROM presentation-deps-base AS presentation-deps-private-tls

RUN --mount=type=secret,id=npm_ca_cert,required=false \
  node worker/presentations/secure-npm-ci.mjs

FROM node:22-bookworm-slim AS worker

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates fontconfig libreoffice-impress poppler-utils \
  && rm -rf /var/lib/apt/lists/*

RUN --mount=type=secret,id=impact_font,required=true \
  install -D -m 0444 /run/secrets/impact_font /usr/local/share/fonts/lexicon/IMPACT.TTF \
  && fc-cache -f \
  && fc-match Impact | grep -qi "Impact"

WORKDIR /app
COPY --from=presentation-deps-private-tls /app/package.json /app/package-lock.json ./
COPY --from=presentation-deps-private-tls /app/node_modules ./node_modules
COPY lib/presentations ./lib/presentations
COPY worker/presentations/runtime.ts ./worker/presentations/runtime.ts
COPY worker/presentations/artifact-broker.ts ./worker/presentations/artifact-broker.ts
COPY worker/presentations/supabase-worker.ts ./worker/presentations/supabase-worker.ts
COPY worker/presentations/main.ts ./worker/presentations/main.ts
COPY worker/presentations/extract-golden-sample.mjs ./worker/presentations/extract-golden-sample.mjs
COPY worker/presentations/smoke-render.mjs ./worker/presentations/smoke-render.mjs

ENV IMPACT_FONT_PATH=/usr/local/share/fonts/lexicon/IMPACT.TTF
ENV PRESENTATION_FONT_POLICY=strict

EXPOSE 8080

CMD ["node", "--experimental-strip-types", "worker/presentations/main.ts"]
