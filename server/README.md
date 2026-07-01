# mis-api — Maori Ink Screen render/API service

Standalone Node + TypeScript + Express service. It serves a random **approved**
love-quote from Postgres as either JSON (`/api/quote`) or a **1-bit 800×480 PNG**
(`/api/render.png`) for the ESP32-C3 e-paper panel. Rendering screenshots the
locked keepsake HTML (`src/lib/render-template.ts`, shared with the Next app)
with headless Chromium and thresholds it to pure black/white with sharp.

This is separate from the Next.js app at the repo root (that stays on Vercel for
marketing). The API lives here and runs as a Docker container on the VPS.

## Endpoints

| Method | Path                  | Auth        | Returns |
| ------ | --------------------- | ----------- | ------- |
| GET    | `/healthz`            | none        | `{ ok: true }` |
| GET    | `/api/quote`          | none        | JSON of a random approved quote |
| GET    | `/api/render.png`     | none        | 1-bit 800×480 PNG (the ESP32 fetches this) |
| GET    | `/api/render/:id.png` | Bearer admin| 1-bit PNG of a specific quote (review) |

## Photo frames (family photos → e-paper)

Besides quotes, the screen also shows dithered family photos. They're produced by
`scripts/photo-to-epd.ts` at the repo root, which reuses two modules here:

| File | What |
| ---- | ---- |
| `src/dither.ts` | Pure dithering math — Floyd–Steinberg / Atkinson / halftone / threshold + `packEpd()`. Packs to the **exact same** MSB-first, `bit=1→WHITE` EPD convention as `render.ts`, so a photo frame is byte-compatible with a quote frame. |
| `src/photo.ts` | `sharp` wrapper — decode → EXIF rotate → optional manual crop `rect` → tone (brightness/contrast/gamma) → 800×480 grayscale plane → dither → `{epd, png}`. |

`sharp` only resolves from `server/node_modules`, so the root script imports these
through `../server/src/*` (same pattern as `render-approved.ts`). See the repo
README "Adding family photos" for the CLI workflow.

## Local dev

```bash
cd server
cp .env.example .env        # point DATABASE_URL at a tunneled/local Postgres
npm install
npm run dev                 # tsx watch src/index.ts on :8080
```

`npm run dev` uses the vendored copy of `render-template.ts` already present in
`src/lib/`. In the Docker build that copy is overwritten by the Next app's
canonical file so there is a single source of truth.

## Deploy to a VPS

Prereqs on the box: Docker + compose, the existing host nginx, certbot, and the
**already-running** `mis-postgres` container (compose project `maori-ink` at
`/opt/maori-ink`, network `maori-ink_default`).

1. **Get the code on the VPS.** Clone/pull the repo so the project root (the dir
   containing both `server/` and `src/`) is present, e.g. `/opt/maori-ink-screen`.

2. **Create the env file.**
   ```bash
   cd /opt/maori-ink-screen/server
   cp .env.example .env
   # set DATABASE_URL (host = mis-postgres), ADMIN_TOKEN, PORT=8080
   ```

3. **Verify the external network exists** (created by the postgres compose):
   ```bash
   docker network ls | grep maori-ink_default
   # if missing: `cd /opt/maori-ink && docker compose up -d` first
   ```

4. **Build + start.** Run from the project root so the build context is correct:
   ```bash
   cd /opt/maori-ink-screen
   docker compose -f server/docker-compose.yml up -d --build
   ```
   The build fetches the three Hebrew TTFs and bakes them into the image (needs
   internet on the build host; the running container does NOT need internet to
   render).

5. **Smoke test from the host** (published on localhost only):
   ```bash
   curl -s http://127.0.0.1:8090/healthz
   curl -s http://127.0.0.1:8090/api/render.png -o /tmp/frame.png && file /tmp/frame.png
   ```

6. **nginx + TLS.**
   ```bash
   sudo cp server/nginx-mis.conf /etc/nginx/sites-available/maori-mis.conf
   sudo ln -s /etc/nginx/sites-available/maori-mis.conf /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d maori.your-vps.example.com
   ```
   certbot rewrites the block to add `listen 443 ssl`, the cert paths, and the
   HTTP→HTTPS redirect. The ESP32 and the Vercel app then call
   `https://maori.your-vps.example.com/api/render.png`.

## Updating

```bash
cd /opt/maori-ink-screen && git pull
docker compose -f server/docker-compose.yml up -d --build
```

## Notes

- **DB host is `mis-postgres`, not localhost** — both containers share the
  `maori-ink_default` network. Postgres is never published to the host.
- **The API port is bound to `127.0.0.1:8090`** — only nginx (on the host) can
  reach it; nothing public hits the Node process directly.
- **Fonts are baked into the image** — no render-time dependency on Google Fonts.
