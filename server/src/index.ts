/**
 * Maori Ink Screen — Express API (mis-api).
 *
 * Serves curated love-quotes from the couple's WhatsApp history to:
 *   - the ESP32 on the wall (fetches /quote/random.png or /quote/random.epd),
 *   - the Vercel marketing app (fetches /quote/random + /quote/random.png),
 *   - a small approval UI (admin routes, bearer-guarded).
 *
 * Runs in the `mis-api` Docker container on the VPS, behind the host nginx
 * (which terminates TLS). Postgres (`mis-postgres`) and a warm Chromium live
 * alongside. The renderer screenshots the LOCKED keepsake HTML (see ./render)
 * and thresholds it to 1-bit black/white for the panel.
 */
import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response,
} from "express";

import {
  closePool,
  countApproved,
  getPool,
  getQuoteById,
  getRandomApprovedQuote,
  listPending,
  setStatus,
  type Quote,
} from "./db";
import {
  closeBrowser,
  renderQuoteEpdBuffer,
  renderQuotePng,
  type RenderQuoteInput,
} from "./render";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = "0.0.0.0";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

// ── helpers ──────────────────────────────────────────────────────────────────

/** JSON view of a quote for API consumers (camelCase, ISO dates). */
function quoteJson(q: Quote): Record<string, unknown> {
  return {
    id: q.id,
    body: q.body,
    displayBody: q.displayBody,
    speaker: q.speaker,
    recipient: q.recipient,
    sentAt: q.sentAt instanceof Date ? q.sentAt.toISOString() : q.sentAt,
    category: q.category,
  };
}

/** Map a DB quote to the renderer's input shape. */
function toRenderInput(q: Quote): RenderQuoteInput {
  return {
    body: q.body,
    displayBody: q.displayBody,
    speaker: q.speaker,
    recipient: q.recipient,
    sentAt: q.sentAt,
  };
}

/** Parse a positive-integer route id, or null when invalid. */
function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Wrap an async handler so any rejection flows to the error middleware instead
 * of crashing the process or hanging the request.
 */
function wrap(
  handler: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

// ── health ───────────────────────────────────────────────────────────────────

app.get(
  "/healthz",
  wrap(async (_req, res) => {
    const approved = await countApproved();
    res.json({ ok: true, approved });
  })
);

// ── public quote routes ────────────────────────────────────────────────────────

/** JSON of a random APPROVED quote — for the Vercel app preview. */
app.get(
  "/quote/random",
  wrap(async (_req, res) => {
    const quote = await getRandomApprovedQuote();
    if (!quote) {
      res.status(404).json({ error: "no approved quotes" });
      return;
    }
    res.json(quoteJson(quote));
  })
);

/** 1-bit 800×480 PNG of a random approved quote — the ESP32/Vercel fetch this. */
app.get(
  "/quote/random.png",
  wrap(async (_req, res) => {
    const quote = await getRandomApprovedQuote();
    if (!quote) {
      res.status(404).json({ error: "no approved quotes" });
      return;
    }
    const png = await renderQuotePng(toRenderInput(quote));
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store"); // always a fresh random pick
    res.setHeader("X-Quote-Id", String(quote.id));
    res.send(png);
  })
);

/** Raw packed 1-bpp EPD framebuffer of a random approved quote — for firmware. */
app.get(
  "/quote/random.epd",
  wrap(async (_req, res) => {
    const quote = await getRandomApprovedQuote();
    if (!quote) {
      res.status(404).json({ error: "no approved quotes" });
      return;
    }
    const epd = await renderQuoteEpdBuffer(toRenderInput(quote));
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Quote-Id", String(quote.id));
    res.send(epd);
  })
);

/** Render a specific quote by id — for previews / the approval UI. */
app.get(
  "/quote/:id.png",
  wrap(async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const quote = await getQuoteById(id);
    if (!quote) {
      res.status(404).json({ error: "quote not found" });
      return;
    }
    const png = await renderQuotePng(toRenderInput(quote));
    res.setHeader("Content-Type", "image/png");
    res.send(png);
  })
);

// ── admin (bearer-guarded) ─────────────────────────────────────────────────────

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!ADMIN_TOKEN) {
    res.status(503).json({ error: "admin disabled: ADMIN_TOKEN not set" });
    return;
  }
  const header = req.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (token !== ADMIN_TOKEN) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

app.get(
  "/admin/pending",
  requireAdmin,
  wrap(async (_req, res) => {
    const pending = await listPending(50);
    res.json(pending.map(quoteJson));
  })
);

app.post(
  "/admin/quotes/:id/approve",
  requireAdmin,
  wrap(async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    await setStatus(id, "approved");
    res.json({ ok: true, id, status: "approved" });
  })
);

app.post(
  "/admin/quotes/:id/reject",
  requireAdmin,
  wrap(async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    await setStatus(id, "rejected");
    res.json({ ok: true, id, status: "rejected" });
  })
);

// ── fallbacks ──────────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: "not found" });
});

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  const message = err instanceof Error ? err.message : "internal error";
  console.error("[mis-api] request error:", message);
  if (res.headersSent) return;
  res.status(500).json({ error: message });
};
app.use(onError);

// ── boot ───────────────────────────────────────────────────────────────────────

// Fail fast if DATABASE_URL is missing — surfaces config errors at boot, not on
// the first request.
getPool();

const server = app.listen(PORT, HOST, () => {
  console.log(`[mis-api] listening on http://${HOST}:${PORT}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[mis-api] ${signal} received — shutting down`);
  server.close();
  await Promise.allSettled([closeBrowser(), closePool()]);
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

export { app };
