# mis-api — Maori Ink Screen render/API service
#
# BUILD CONTEXT MUST BE THE PROJECT ROOT (not server/), because we copy the
# Next app's single source of truth for the locked render template
# (../src/lib/render-template.ts) into the server source tree. Build with:
#
#     docker compose -f server/docker-compose.yml build
#     # or, by hand, from the project root:
#     docker build -f server/Dockerfile -t mis-api .
#
# The Playwright base image already ships Chromium + all its system deps, so we
# do NOT run `playwright install-deps`.
FROM mcr.microsoft.com/playwright:v1.47.0-jammy

ENV NODE_ENV=production \
    PORT=8080 \
    # Use the browser already baked into the base image; do not re-download.
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

# ---------------------------------------------------------------------------
# Hebrew fonts: bundle the exact TTFs at BUILD time so the renderer has ZERO
# render-time network dependency. The template @imports Google Fonts, but the
# container must render correctly even with no outbound internet — so we fetch
# Frank Ruhl Libre / Suez One / Heebo once here, drop them in the OS font dir,
# and rebuild the font cache. Chromium then resolves them by family name.
#
# Tradeoff vs. `apt-get install fonts-noto-*`: Noto Hebrew would give us SOME
# Hebrew glyphs but NOT the three specific display faces the locked design
# requires (Frank Ruhl Libre quote, Suez One signature). Bundling the real
# TTFs is the only way to honor design/RENDER-CONTRACT.md exactly. The cost is
# one network fetch at build time (CI/VPS build host needs internet — runtime
# does not).
# ---------------------------------------------------------------------------
RUN apt-get update \
 && apt-get install -y --no-install-recommends fontconfig unzip curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Copy any pre-bundled TTFs the repo ships (offline-friendly; optional).
COPY server/fonts/ /usr/share/fonts/truetype/mis/

# Fetch the three families from the Google Fonts GitHub mirror at build time
# (pinned by family folder; static TTFs, no API key). If server/fonts/ already
# provided them this is just belt-and-suspenders.
RUN set -eux; \
    mkdir -p /usr/share/fonts/truetype/mis; \
    base="https://raw.githubusercontent.com/google/fonts/main"; \
    curl -fsSL "$base/ofl/frankruhllibre/FrankRuhlLibre%5Bwght%5D.ttf" \
         -o /usr/share/fonts/truetype/mis/FrankRuhlLibre.ttf; \
    curl -fsSL "$base/ofl/suezone/SuezOne-Regular.ttf" \
         -o /usr/share/fonts/truetype/mis/SuezOne-Regular.ttf; \
    curl -fsSL "$base/ofl/heebo/Heebo%5Bwght%5D.ttf" \
         -o /usr/share/fonts/truetype/mis/Heebo.ttf; \
    fc-cache -f; \
    fc-list | grep -iE "frank ruhl|suez|heebo"

# ---------------------------------------------------------------------------
# Dependencies (cached layer) — copy only the server manifest first.
# ---------------------------------------------------------------------------
# `npm ci` enforces the lockfile EXACTLY (playwright pinned to 1.47.0 to match
# this base image's baked-in Chromium). Using `npm install` here would let a
# newer playwright resolve and break chromium.launch() at runtime.
COPY server/package.json server/package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
# Source. Copy the server tree, then overlay the Next app's locked template as
# the single source of truth (overwrites the vendored dev copy under
# src/lib/). Both live inside src/, so tsc's rootDir stays clean.
# ---------------------------------------------------------------------------
COPY server/tsconfig.json ./tsconfig.json
COPY server/src ./src
COPY src/lib/render-template.ts ./src/lib/render-template.ts

RUN npm run build

EXPOSE 8080
CMD ["node", "dist/index.js"]
