/**
 * Pure, dependency-free parser for an iPhone WhatsApp "_chat.txt" export.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * EXPORT FORMAT QUIRKS (verified against the real 30MB export)
 * ──────────────────────────────────────────────────────────────────────────
 * 1. Message header shape:  `[DD/MM/YYYY, HH:MM:SS] Sender: body`
 *    - Date is day-first (`19/03/2021`), NOT month-first.
 *    - Time is 24-hour with NO AM/PM. The hour may be 1 OR 2 digits
 *      (`8:52:48` and `10:59:25` both occur).
 *
 * 2. Line endings are CRLF (`\r\n`). We normalise CRLF and lone CR to LF
 *    before splitting so the parser is host-OS independent.
 *
 * 3. Unicode directionality marks litter the file. Most header lines are
 *    PREFIXED with a left-to-right mark (U+200E) BEFORE the `[`, e.g.
 *      `‎[19/03/2021, 11:47:07] Maor: ‎image omitted`
 *    Media/system placeholder bodies are ALSO U+200E-prefixed. The parser
 *    therefore strips control marks (a) at the start of a line before testing
 *    whether it is a header, and (b) from bodies before classifying them as
 *    system/media. See {@link stripControlMarks}.
 *
 * 4. A single message body can span MULTIPLE physical lines. Any line that is
 *    NOT itself a valid header is treated as a continuation of the current
 *    message and appended with `\n`.
 *
 * 5. The two couple participants are exactly `Maor` and `מאורי שלי❤️`.
 *    The second name ends with ❤ (U+2764) + a variation selector (U+FE0F),
 *    and the export occasionally appends RTL/variation tails. Sender matching
 *    is therefore a control-mark-normalised `startsWith` against the
 *    configured couple names (see {@link ParseOptions.coupleSenders}) so the
 *    emoji/variation-selector tail never breaks matching.
 *
 * 6. Non-content lines that are dropped:
 *    - the end-to-end-encryption notice,
 *    - media/placeholder bodies (`image omitted`, `audio omitted`, …),
 *    - deleted-message markers,
 *    - any message whose sender is not one of the couple participants.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TIMEZONE ASSUMPTION
 * ──────────────────────────────────────────────────────────────────────────
 * WhatsApp writes timestamps in the EXPORTING phone's LOCAL wall-clock time
 * with no offset attached. We convert local → UTC using a fixed offset
 * (`timezoneOffsetMinutes`, default {@link DEFAULT_TZ_OFFSET_MINUTES} = +120,
 * i.e. Asia/Jerusalem STANDARD time, UTC+2).
 *
 * CAVEAT: Israel observes DST (IDT, UTC+3) for roughly half the year, so
 * messages sent during DST will be off by one hour with the default offset.
 * A fixed offset is used deliberately to keep this module pure and free of
 * `Intl`/timezone-database dependencies. If hour-accurate UTC matters,
 * resolve the per-message offset upstream (e.g. via `Intl.DateTimeFormat`
 * with `timeZone: "Asia/Jerusalem"`) and pass it in per batch.
 */

/** A successfully parsed, content-bearing message from the export. */
export interface ParsedMessage {
  /** 1-based line number of the message header in the normalised input. */
  sourceLine: number;
  /** Couple participant name, exactly as configured in `coupleSenders`. */
  sender: string;
  /** Message text, control-mark-stripped, multi-line lines joined with `\n`. */
  body: string;
  /** Send time as a UTC `Date` (local wall-clock converted via the offset). */
  sentAt: Date;
}

/** Options controlling who counts as a participant and the TZ conversion. */
export interface ParseOptions {
  /**
   * The couple participant display names. Matching is done with a
   * control-mark-normalised `startsWith`, so passing `"מאורי שלי"` (without the
   * ❤️ tail) is fine and recommended.
   */
  coupleSenders: string[];
  /**
   * Minutes to SUBTRACT from local wall-clock time to reach UTC.
   * For UTC+2 (Asia/Jerusalem standard) this is `120`.
   * Defaults to {@link DEFAULT_TZ_OFFSET_MINUTES}. See the file header for the
   * DST caveat.
   */
  timezoneOffsetMinutes?: number;
}

/**
 * Default local→UTC offset in minutes: +120 = Asia/Jerusalem STANDARD time
 * (UTC+2). Does NOT account for IDT (DST, UTC+3). See file header.
 */
export const DEFAULT_TZ_OFFSET_MINUTES = 120;

/**
 * Bodies that are media/placeholder/system markers and must be dropped.
 * Compared AFTER {@link stripControlMarks} (the export prefixes these with
 * U+200E). Includes the two non-spec variants found in the real export:
 * `video note omitted` and `product image omitted`.
 */
export const MEDIA_PLACEHOLDERS: readonly string[] = [
  "image omitted",
  "video omitted",
  "audio omitted",
  "sticker omitted",
  "GIF omitted",
  "Contact card omitted",
  "document omitted",
  "video note omitted",
  "product image omitted",
  "This message was deleted.",
  "You deleted this message.",
  "<Media omitted>",
] as const;

/**
 * Unicode control / directionality marks to strip:
 * U+200E LEFT-TO-RIGHT MARK, U+200F RIGHT-TO-LEFT MARK,
 * U+202A–U+202E (embeddings/overrides/pop), U+FEFF (BOM / ZWNBSP).
 */
const CONTROL_MARK_REGEX = /[‎‏‪-‮﻿]/g;

/**
 * Header matcher. Tolerates leading control marks before `[`.
 * Captures: 1=DD, 2=MM, 3=YYYY, 4=HH (1–2 digits), 5=MM, 6=SS, 7=sender.
 * `rest` (the body) is everything after the first `: ` following the sender.
 */
const HEADER_REGEX =
  /^[‎‏‪-‮﻿]*\[(\d{2})\/(\d{2})\/(\d{4}),\s+(\d{1,2}):(\d{2}):(\d{2})\]\s+([^:]+?):\s?([\s\S]*)$/;

/**
 * Remove Unicode directionality/control marks (U+200E/U+200F/U+202A–202E/
 * U+FEFF) and trim surrounding whitespace.
 */
export function stripControlMarks(s: string): string {
  return s.replace(CONTROL_MARK_REGEX, "").trim();
}

/**
 * True if `body` is an end-to-end-encryption notice, a media/placeholder
 * marker, or a deleted-message marker — i.e. it carries no real content and
 * should be dropped. Input is normalised via {@link stripControlMarks} first.
 */
export function isSystemOrMediaBody(body: string): boolean {
  const clean = stripControlMarks(body);
  if (clean.length === 0) {
    return true;
  }
  if (clean.startsWith("Messages and calls are end-to-end encrypted")) {
    return true;
  }
  return MEDIA_PLACEHOLDERS.includes(clean);
}

/**
 * Media sent WITH a caption renders on one line as `<caption> <placeholder>`
 * (e.g. `"תראה מה קניתי image omitted"`). Only the "* omitted" family appears
 * as a trailing caption suffix — deleted-message and `<Media omitted>` markers
 * never co-occur with text. Strip a trailing such suffix and return the caption
 * (or empty string if the body was a bare placeholder). Input should already be
 * control-mark stripped.
 */
const TRAILING_OMITTED_REGEX =
  /\s*(?:image|video|audio|sticker|GIF|Contact card|document|video note|product image)\somitted$/;

export function stripTrailingMediaPlaceholder(clean: string): string {
  return clean.replace(TRAILING_OMITTED_REGEX, "").trim();
}

/**
 * Parse a single physical line as a message header.
 *
 * Returns `{ sender, sentAt, rest }` if the line is a valid header (where
 * `rest` is the first physical line of the body, possibly empty), or `null`
 * if the line is a body continuation. Exposed so multi-line continuation
 * handling is unit-testable.
 *
 * @param line          a single physical line (no trailing `\n`).
 * @param offsetMinutes local→UTC offset; defaults to
 *                      {@link DEFAULT_TZ_OFFSET_MINUTES}.
 */
export function parseHeaderLine(
  line: string,
  offsetMinutes: number = DEFAULT_TZ_OFFSET_MINUTES
): { sender: string; sentAt: Date; rest: string } | null {
  const match = HEADER_REGEX.exec(line);
  if (match === null) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  // Reject impossible calendar/clock values so stray `[...]` text isn't
  // mistaken for a header (e.g. a line that happens to look bracketed).
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }

  // Build the instant: take the local wall-clock as if it were UTC via
  // Date.UTC, then subtract the configured offset to reach true UTC.
  // (Date.UTC avoids any dependence on the host machine's timezone.)
  const utcMillis =
    Date.UTC(year, month - 1, day, hour, minute, second) -
    offsetMinutes * 60_000;
  const sentAt = new Date(utcMillis);
  if (Number.isNaN(sentAt.getTime())) {
    return null;
  }

  const sender = stripControlMarks(match[7]);
  const rest = match[8];
  return { sender, sentAt, rest };
}

/**
 * True if `sender` (already control-mark-stripped) matches one of the
 * configured couple participants. Matching is a normalised `startsWith` so
 * the ❤️/variation-selector tail on `מאורי שלי❤️` doesn't break equality.
 */
function isCoupleSender(sender: string, coupleSenders: string[]): boolean {
  for (const name of coupleSenders) {
    const target = stripControlMarks(name);
    if (target.length > 0 && sender.startsWith(target)) {
      return true;
    }
  }
  return false;
}

/**
 * Parse an entire WhatsApp `_chat.txt` export into content-bearing messages
 * from the configured couple participants.
 *
 * Pipeline:
 *  1. Normalise CRLF / lone CR → LF, then split into physical lines.
 *  2. Walk lines: a valid header starts a new message; every non-header line
 *     is appended to the current message body (joined with `\n`).
 *  3. On message boundaries, emit only if the sender is a couple participant
 *     and the body is not a system/media/deleted marker.
 *
 * @returns messages in source order. Bodies are control-mark-stripped.
 */
export function parseWhatsappExport(
  raw: string,
  opts: ParseOptions
): ParsedMessage[] {
  const offsetMinutes = opts.timezoneOffsetMinutes ?? DEFAULT_TZ_OFFSET_MINUTES;
  const normalised = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalised.split("\n");

  const messages: ParsedMessage[] = [];

  // Accumulator for the message currently being built.
  let curSender: string | null = null;
  let curSentAt: Date | null = null;
  let curLineNo = 0;
  let curBodyParts: string[] = [];

  const flush = (): void => {
    if (curSender === null || curSentAt === null) {
      return;
    }
    const rawBody = curBodyParts.join("\n");
    if (isCoupleSender(curSender, opts.coupleSenders) && !isSystemOrMediaBody(rawBody)) {
      // Strip a trailing media placeholder left by a captioned attachment;
      // if nothing meaningful remains, drop the message entirely.
      const body = stripTrailingMediaPlaceholder(stripControlMarks(rawBody));
      if (body.length > 0) {
        messages.push({
          sourceLine: curLineNo,
          sender: curSender,
          body,
          sentAt: curSentAt,
        });
      }
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const header = parseHeaderLine(line, offsetMinutes);

    if (header !== null) {
      // Boundary: finalise the previous message, then start a new one.
      flush();
      curSender = header.sender;
      curSentAt = header.sentAt;
      curLineNo = i + 1; // 1-based
      curBodyParts = [header.rest];
    } else if (curSender !== null) {
      // Continuation of the in-progress message.
      curBodyParts.push(line);
    }
    // Leading non-header lines before the first header are ignored.
  }

  flush();
  return messages;
}
