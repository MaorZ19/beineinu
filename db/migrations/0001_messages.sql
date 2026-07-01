-- 0001_messages.sql
-- ---------------------------------------------------------------------------
-- messages: the raw, cleaned import of the couple's WhatsApp chat.
--
-- Each row is one real message from a couple participant ("Maor" or
-- "מאורי שלי❤️"), after the parser has stripped system notices, media
-- placeholders, deleted-message markers, and any non-couple senders, and has
-- stitched multi-line message bodies back together.
--
-- `source_line` is the 1-based line number of the message's HEADER line in the
-- export (`_chat.txt`). It is the import idempotency key: re-running the
-- importer upserts on `source_line` instead of inserting duplicates.
--
-- Timestamps: the export prints local wall-clock time (DD/MM/YYYY, HH:MM:SS).
-- The importer interprets these as Asia/Jerusalem and converts to UTC before
-- writing `sent_at`. This is a fixed, documented assumption — the importer does
-- NOT rely on the host machine's timezone.
--
-- Downstream: the Phase-2 AI curation job reads candidate rows from here and
-- writes the best ones into a separate `quotes` table (status='pending' →
-- 'approved'). This table itself has no status column.
-- ---------------------------------------------------------------------------

create table if not exists public.messages (
  id          bigint generated always as identity primary key,
  source_line integer     not null,
  sender      text        not null,
  body        text        not null,
  sent_at     timestamptz not null,
  created_at  timestamptz not null default now(),

  -- Re-imports upsert on this key instead of duplicating rows.
  constraint messages_source_line_key unique (source_line)
);

-- Chronological scans (timelines, context windows, date-range queries).
create index if not exists messages_sent_at_idx
  on public.messages (sent_at);

-- Supports the curation job scanning candidates per sender in time order,
-- and later random/approved-style selection passes over the corpus.
create index if not exists messages_sender_sent_at_idx
  on public.messages (sender, sent_at);
