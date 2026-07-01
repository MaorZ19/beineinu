-- 0003_quote_display_body.sql
-- ---------------------------------------------------------------------------
-- Long heartfelt messages (whole paragraphs) don't fit large on an 800×480
-- panel. The curator extracts the single most beautiful self-standing sentence
-- into `display_body` (original words, never invented). The screen renders
-- `display_body`; the full original stays in `body` for archive/app use.
-- ---------------------------------------------------------------------------

alter table public.quotes
  add column if not exists display_body text;

-- Backfill: where no short form was extracted, show the full body.
update public.quotes set display_body = body where display_body is null;
