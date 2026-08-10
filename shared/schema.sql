-- Shared Reins — shared-data backend.
--
-- Run this once, whole, in the Supabase SQL editor (Dashboard -> SQL Editor ->
-- New query -> paste -> Run). It is idempotent: running it again is safe and
-- will not touch data you have already entered.
--
-- WHAT THIS SETS UP
--
--   Both models (Yearling and Two-Year-Old) share these tables and are kept
--   apart by an `app` column, exactly as their localStorage namespaces keep
--   them apart today. Grades from one model can never appear in the other.
--
--   Nothing here is readable or writable with the public anon key on its own.
--   Every path goes through sr_read/sr_write, which check the shared access
--   code server-side. The code is stored here, never in the client source.
--
-- THE SECURITY MODEL, STATED HONESTLY
--
--   One code, shared by everyone who uses the site. It establishes that you
--   are one of the group. It does NOT establish which member you are — the
--   display name recorded against each change is a label people type, not a
--   login, and anyone holding the code could type someone else's name. Treat
--   `updated_by` as a helpful note about who was working, never as evidence.
--
--   That is appropriate for a small trusted group and is not appropriate for
--   anything else. If you later need edits to be genuinely attributable, or
--   you need to revoke one person without disturbing everyone, switch to
--   Supabase Auth with magic links; the table layout below does not change.

-- ------------------------------------------------------------------- config
-- Holds the access code. RLS is on and there is no policy, so the anon key
-- cannot read this table under any query. Only the SECURITY DEFINER functions
-- below can see it.

create table if not exists app_config (
  id          int primary key default 1,
  write_code  text not null,
  constraint app_config_singleton check (id = 1)
);

alter table app_config enable row level security;

-- Set your code here. CHANGE THIS before anyone uses the site.
insert into app_config (id, write_code)
values (1, 'change-me-before-you-share-the-url')
on conflict (id) do nothing;

-- ------------------------------------------------------------------- tables
--
-- Deletes are soft (a `deleted` flag) rather than real DELETEs. A real delete
-- is invisible to a client that was offline when it happened — it would come
-- back online, see no row, and have no way to tell "removed" from "never
-- existed", so the row would quietly resurrect from its local cache. A flag
-- syncs like any other change.

-- One rating per horse, shared by everyone. Two people grading hip 42 are
-- editing the same number and the later edit stands.
--
-- Resolution is per FIELD, not per row: `updated_by` records who touched it
-- last, but someone setting a conformation grade does not overwrite the
-- pedigree rating a colleague set a moment earlier, because the client sends
-- only the fields it actually changed and the merge below leaves the rest
-- alone. Two people editing the SAME field within a few seconds of each other
-- is the one case where a value can be lost, and no scheme short of locking
-- avoids that.
create table if not exists ratings (
  app          text not null,
  horse_key    text not null,          -- "<saleCode>:<hip>"
  conf         real,                   -- conformation 0-10
  ped          real,                   -- pedigree 0-10 (unused by the 2YO model)
  breeze       real,                   -- breeze visual 0-10 (2YO model only)
  notes        text,
  updated_by   text,                   -- display name, optional, for attribution only
  updated_at   timestamptz not null default now(),
  primary key (app, horse_key)
);

-- Facts about a horse rather than opinions of it: everyone sees one value.
-- Whether films have been pulled is not a matter of judgement.
create table if not exists horse_shared (
  app         text not null,
  horse_key   text not null,
  vet         text,                    -- none | requested | passed | failed
  vet_by      text,
  updated_at  timestamptz not null default now(),
  primary key (app, horse_key)
);

-- Short list definitions — shared, so everyone sees the same tabs.
create table if not exists lists (
  app         text not null,
  id          text not null,
  name        text not null,
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (app, id)
);

-- Membership, shared and attributed: the star shows who put it there.
create table if not exists list_members (
  app         text not null,
  horse_key   text not null,
  list_id     text not null,
  added_by    text,
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (app, horse_key, list_id)
);

-- Manual sire ratings. Shared and last-write-wins: the sire book is a shared
-- reference shelf, not a per-person opinion, and a stallion with no runners
-- needs one agreed number rather than four competing ones.
create table if not exists sire_overrides (
  app         text not null,
  sire        text not null,           -- UPPERCASE sire name
  rating      real,
  set_by      text,
  updated_at  timestamptz not null default now(),
  primary key (app, sire)
);

-- Saved filters — shared, because a fifteen-stallion filter is ten minutes of
-- clicking and there is no reason for four people to each spend it.
create table if not exists filter_presets (
  app         text not null,
  id          text not null,
  name        text not null,
  filters     jsonb not null,
  saved_by    text,
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (app, id)
);

-- Imported BloodHorse sire lists — shared, so one person's console paste gives
-- everybody the sire book.
create table if not exists sire_lists (
  app         text not null,
  id          text not null,
  payload     jsonb not null,
  imported_by text,
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (app, id)
);

-- Every table is locked shut to the anon key. The functions below are the
-- only way in.
alter table ratings         enable row level security;
alter table horse_shared    enable row level security;
alter table lists           enable row level security;
alter table list_members    enable row level security;
alter table sire_overrides  enable row level security;
alter table filter_presets  enable row level security;
alter table sire_lists      enable row level security;

-- Pulling "everything that changed since I last looked" is the hot path, and
-- it is a timestamp scan on every table.
create index if not exists ratings_sync_idx        on ratings        (app, updated_at);
create index if not exists horse_shared_sync_idx   on horse_shared   (app, updated_at);
create index if not exists lists_sync_idx          on lists          (app, updated_at);
create index if not exists list_members_sync_idx   on list_members   (app, updated_at);
create index if not exists sire_overrides_sync_idx on sire_overrides (app, updated_at);
create index if not exists filter_presets_sync_idx on filter_presets (app, updated_at);
create index if not exists sire_lists_sync_idx     on sire_lists     (app, updated_at);

-- ---------------------------------------------------------------- the gate

-- Hashing both sides makes the comparison run over two equal-length strings,
-- so it cannot leak the code's length or how far a guess matched.
--
-- md5 is used rather than sha256 because md5() is built into Postgres while
-- digest() needs pgcrypto, which Supabase installs into the `extensions`
-- schema — a SECURITY DEFINER function pinned to `search_path = public` cannot
-- see it, and the function would fail at run time rather than at install time.
-- md5's weakness is collision resistance, which nothing here depends on: the
-- hashes are never stored, never sent, and never shown. What stops guessing is
-- Supabase's rate limiting, not the hash.
create or replace function sr_check_code(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  stored text;
begin
  select write_code into stored from app_config where id = 1;
  if stored is null or p_code is null then
    return false;
  end if;
  return md5(stored) = md5(p_code);
end;
$$;

revoke all on function sr_check_code(text) from public, anon, authenticated;

-- --------------------------------------------------------------- read path
--
-- Returns everything for one app that changed at or after `p_since`. Passing
-- null pulls the lot, which is what a cold page load does; passing the last
-- timestamp you saw makes the live path cheap.
--
-- Returns one JSON object rather than seven result sets so the client gets a
-- consistent snapshot in a single round trip.

create or replace function sr_read(p_code text, p_app text, p_since timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  cutoff timestamptz := coalesce(p_since, '-infinity'::timestamptz);
begin
  if not sr_check_code(p_code) then
    raise exception 'Access code not accepted' using errcode = '28000';
  end if;

  select jsonb_build_object(
    'now', now(),
    'ratings', coalesce((
      select jsonb_agg(to_jsonb(t)) from ratings t
      where t.app = p_app and t.updated_at >= cutoff), '[]'::jsonb),
    'horseShared', coalesce((
      select jsonb_agg(to_jsonb(t)) from horse_shared t
      where t.app = p_app and t.updated_at >= cutoff), '[]'::jsonb),
    'lists', coalesce((
      select jsonb_agg(to_jsonb(t)) from lists t
      where t.app = p_app and t.updated_at >= cutoff), '[]'::jsonb),
    'listMembers', coalesce((
      select jsonb_agg(to_jsonb(t)) from list_members t
      where t.app = p_app and t.updated_at >= cutoff), '[]'::jsonb),
    'sireOverrides', coalesce((
      select jsonb_agg(to_jsonb(t)) from sire_overrides t
      where t.app = p_app and t.updated_at >= cutoff), '[]'::jsonb),
    'filterPresets', coalesce((
      select jsonb_agg(to_jsonb(t)) from filter_presets t
      where t.app = p_app and t.updated_at >= cutoff), '[]'::jsonb),
    'sireLists', coalesce((
      select jsonb_agg(to_jsonb(t)) from sire_lists t
      where t.app = p_app and t.updated_at >= cutoff), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

-- -------------------------------------------------------------- write path
--
-- One entry point for every write, so there is exactly one place the code is
-- checked. `p_ops` is an array of { op, ... } objects; the client batches, so
-- dragging a slider across ten hips is one request rather than ten.
--
-- Last-write-wins, resolved per field rather than per row — see the note on
-- the `ratings` table. Two people working different fields of the same horse
-- both keep their work; two people working the same field within seconds of
-- each other do not, and nothing short of locking would change that.

create or replace function sr_write(p_code text, p_app text, p_who text, p_ops jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  op      jsonb;
  kind    text;
  applied int := 0;
  who     text := nullif(trim(coalesce(p_who, '')), '');
begin
  if not sr_check_code(p_code) then
    raise exception 'Access code not accepted' using errcode = '28000';
  end if;

  for op in select * from jsonb_array_elements(p_ops)
  loop
    kind := op->>'op';

    if kind = 'rating' then
      -- `op ? 'conf'` asks whether the client SENT that field, which is a
      -- different question from whether the value it sent is null. Sending
      -- null clears a grade; not sending the key leaves it untouched. Reading
      -- this as coalesce() instead would make clearing a grade impossible.
      insert into ratings (app, horse_key, conf, ped, breeze, notes, updated_by, updated_at)
      values (
        p_app, op->>'key',
        nullif(op->'conf',   'null'::jsonb)::text::real,
        nullif(op->'ped',    'null'::jsonb)::text::real,
        nullif(op->'breeze', 'null'::jsonb)::text::real,
        op->>'notes', who, now()
      )
      on conflict (app, horse_key) do update set
        conf   = case when op ? 'conf'   then excluded.conf   else ratings.conf   end,
        ped    = case when op ? 'ped'    then excluded.ped    else ratings.ped    end,
        breeze = case when op ? 'breeze' then excluded.breeze else ratings.breeze end,
        notes  = case when op ? 'notes'  then excluded.notes  else ratings.notes  end,
        updated_by = who,
        updated_at = now();

    elsif kind = 'vet' then
      insert into horse_shared (app, horse_key, vet, vet_by, updated_at)
      values (p_app, op->>'key', op->>'vet', who, now())
      on conflict (app, horse_key) do update set
        vet = excluded.vet, vet_by = excluded.vet_by, updated_at = now();

    elsif kind = 'list' then
      insert into lists (app, id, name, deleted, updated_at)
      values (p_app, op->>'id', coalesce(op->>'name', 'Untitled'),
              coalesce((op->>'deleted')::boolean, false), now())
      on conflict (app, id) do update set
        name = excluded.name, deleted = excluded.deleted, updated_at = now();

    elsif kind = 'listMember' then
      insert into list_members (app, horse_key, list_id, added_by, deleted, updated_at)
      values (p_app, op->>'key', op->>'listId', who,
              coalesce((op->>'deleted')::boolean, false), now())
      on conflict (app, horse_key, list_id) do update set
        deleted = excluded.deleted,
        -- Keep the original starrer when a membership is merely toggled back
        -- on; overwrite only when it had genuinely been removed.
        added_by = case when list_members.deleted then excluded.added_by
                        else list_members.added_by end,
        updated_at = now();

    elsif kind = 'sireOverride' then
      insert into sire_overrides (app, sire, rating, set_by, updated_at)
      values (p_app, upper(op->>'sire'),
              nullif(op->'rating', 'null'::jsonb)::text::real, who, now())
      on conflict (app, sire) do update set
        rating = excluded.rating, set_by = excluded.set_by, updated_at = now();

    elsif kind = 'filterPreset' then
      insert into filter_presets (app, id, name, filters, saved_by, deleted, updated_at)
      values (p_app, op->>'id', coalesce(op->>'name', 'Untitled'),
              coalesce(op->'filters', '{}'::jsonb), who,
              coalesce((op->>'deleted')::boolean, false), now())
      on conflict (app, id) do update set
        name = excluded.name, filters = excluded.filters,
        saved_by = excluded.saved_by, deleted = excluded.deleted, updated_at = now();

    elsif kind = 'sireList' then
      insert into sire_lists (app, id, payload, imported_by, deleted, updated_at)
      values (p_app, op->>'id', coalesce(op->'payload', '{}'::jsonb), who,
              coalesce((op->>'deleted')::boolean, false), now())
      on conflict (app, id) do update set
        payload = excluded.payload, imported_by = excluded.imported_by,
        deleted = excluded.deleted, updated_at = now();

    else
      raise exception 'Unknown op: %', kind;
    end if;

    applied := applied + 1;
  end loop;

  return jsonb_build_object('applied', applied, 'now', now());
end;
$$;

-- The anon key may call these two functions and nothing else. Both check the
-- code before they touch a table, so possession of the anon key alone —
-- which is public by design, and sits in the page source — gets you nothing.
grant execute on function sr_read(text, text, timestamptz) to anon, authenticated;
grant execute on function sr_write(text, text, text, jsonb) to anon, authenticated;

-- --------------------------------------------------------------- changing
-- To rotate the access code later:
--
--   update app_config set write_code = 'the-new-one' where id = 1;
--
-- Everyone is prompted for it again on their next write. Nothing is lost.
