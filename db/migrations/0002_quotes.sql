-- 0002_quotes.sql
-- ---------------------------------------------------------------------------
-- quotes: the curated, scored, approvable subset of `messages`.
--
-- The Phase-2 AI curation job scans `messages` and writes the most
-- beautiful / meaningful / funny lines here, each with a numeric `score`,
-- a `category`, and the speaker→recipient framing so a chat bubble reads
-- naturally. A quote starts life as status='pending'; Maor flips it to
-- 'approved' or 'rejected'. Only 'approved' quotes are ever served to the
-- screen (GET /quote/random).
-- ---------------------------------------------------------------------------

create table if not exists public.quotes (
  id           bigint generated always as identity primary key,

  -- The message this quote came from (idempotency + provenance).
  -- References messages.source_line so re-running curation can upsert.
  message_source_line integer not null,

  -- The line shown on screen. Usually equals the source message body, but the
  -- curator may lightly trim trailing noise — kept separate so we never mutate
  -- the raw `messages` table.
  body         text    not null,

  speaker      text    not null,   -- who said it
  recipient    text    not null,   -- who it was said to

  -- Optional short preceding context so a bubble can read naturally.
  context      text,

  score        integer not null,   -- 0..100, higher = lovelier
  category     text    not null,   -- 'beautiful' | 'meaningful' | 'funny' | ...

  sent_at      timestamptz not null,

  status       text    not null default 'pending'
               check (status in ('pending', 'approved', 'rejected')),

  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz,

  -- One curated quote per source message; re-curation upserts on this key.
  constraint quotes_message_source_line_key unique (message_source_line),
  constraint quotes_score_range check (score >= 0 and score <= 100)
);

-- The hot path: pick a random APPROVED quote fast.
create index if not exists quotes_status_idx
  on public.quotes (status);

-- Review queue: highest-scoring pending quotes first.
create index if not exists quotes_status_score_idx
  on public.quotes (status, score desc);
