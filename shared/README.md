# Shared data

Both models normally keep everything in `localStorage` — a box on one machine,
in one browser. This makes the grades, notes, short lists and vet status
*shared*: what you type appears for everyone else within a few seconds, and
what they type appears for you.

Not switched on by default. With `js/config.js` left on its placeholders, both
models behave exactly as they always have — local-only, no network, no prompts,
and the **Shared** panel doesn't appear at all.

---

## What it costs

Nothing, at this size. Supabase's free tier is 500MB of database and 5GB of
egress a month. A 226-hip sale fully graded is a few hundred kilobytes.

---

## Setting it up

You have to do steps 1 and 2 yourself — they involve creating an account, which
is not something to hand off.

**1. Make a Supabase project.** Sign up at [supabase.com](https://supabase.com),
create a project, and pick a region near you. It takes about two minutes to
provision.

**2. Run the schema.** In the dashboard: **SQL Editor → New query**. Paste the
whole of [`schema.sql`](schema.sql) and hit Run. Before you do, change this line
near the top to whatever code you want to hand out:

```sql
values (1, 'change-me-before-you-share-the-url')
```

If you forget, run this afterwards:

```sql
update app_config set write_code = 'your-actual-code' where id = 1;
```

**3. Point the apps at it.** In the dashboard: **Project Settings → API**. Copy
the **Project URL** and the **anon / public** key into `js/config.js` — the same
two values in both `Yearling/js/config.js` and `Two-Year-Old/js/config.js`:

```js
window.SHARED_REINS_CONFIG = {
  url: 'https://abcdefgh.supabase.co',
  anonKey: 'eyJhbGciOi…'
};
```

Both values are meant to be public and are safe to commit — see below.

**4. Commit and push.** The site now opens on an access-code screen. Each person
enters the code once per device, and can set a display name afterwards in the
**Shared** panel if they want their changes attributed.

---

## What's shared

Everything that is a judgement about a horse, and everything that coordinates
work between people:

| | |
|---|---|
| Conformation, pedigree, breeze-visual grades | shared |
| Notes | shared |
| Vet status | shared |
| Short lists, and which horses are on them | shared |
| Manual sire ratings | shared |
| Saved filters | shared |
| Imported BloodHorse sire lists | shared |
| Model weights, scoring options, theme | **local** — your own settings |
| Which tab and list you're looking at | **local** |

One rating per horse, last edit wins. It resolves **per field**, so someone
grading the physical while you read the page does not overwrite you — the app
only ever sends the field it actually changed. Two people editing the *same*
field within a few seconds of each other is the one case where a value is lost,
and nothing short of locking rows would prevent it.

---

## The access screen

With sharing configured, the site opens on a code prompt and shows nothing else
until it's entered.

**Once per device, then effectively never again.** The accepted code is kept in
`localStorage`, so it survives reloads, restarts and reboots. People are asked
again only if they clear browser data, use a private window, hit **Disconnect**,
or you rotate the code.

**Losing signal does not lock you out.** The prompt keys off whether a code was
ever accepted *on that device*, never off the current connection. Someone who
unlocked this morning keeps working through a dead patch in a barn — which is
exactly when being thrown back to a login screen would be worst.

**It's a front door, not the lock.** An overlay can be removed from devtools by
anyone who cares to. It isn't what protects the data: `sr_read` returns nothing
without the code, so getting past the screen gains you an empty app rather than
anyone's shortlist. The screen exists so people are asked, and so a laptop open
on a sales-ground table isn't showing your work to whoever walks past.

## Rotating the code, and what it can't do

```sql
update app_config set write_code = 'the-new-one' where id = 1;
```

Everyone is asked for the new code the next time their app syncs. Nothing stored
in the database is affected.

**It stops future access; it does not retract past access.** Anyone who was
connected still has whatever had synced to their browser sitting in their own
`localStorage`, and rotating the code cannot reach into their machine to remove
it. Rotation is the right move when someone leaves or the code gets loose — just
don't read it as "they can no longer see what they already saw." If that matters,
you want per-person accounts, not a shared code.

## How it behaves

**Your work never waits on the network.** Every change is written to
`localStorage` first and mirrored up afterwards. Sale grounds have bad
reception; if the signal drops you carry on exactly as before, the pill in the
Shared panel reads `offline`, and the queue goes up when you're back. Nothing is
lost by closing the tab — the queue is on disk.

**Changes arrive without stealing the page.** Someone else's grade lands as a
quiet update to that row. It will not re-sort the table under your hands, take
an input away mid-keystroke, or restart a walk video you're part-way through —
the ranking settles when you press **Re-rank**, the same as after your own
grades.

**A first connection uploads what you already had.** A browser that's been
grading offline for a week contributes its work on connect rather than being
overwritten by the first pull.

**Live means a few seconds.** The apps poll every 5 seconds when the tab is in
front of you, every 30 when it isn't, and immediately when you come back to it.
This is a poll rather than a websocket so that both models stay dependency-free
classic scripts that still run from `file://`.

---

## Security, stated plainly

**The URL and the anon key are public.** They ship in the page source of every
Supabase app and this repo is public. They are not what protects your data.
Every table has row-level security on with no policy, so the anon key by itself
opens nothing at all. The only two ways in are the `sr_read` and `sr_write`
functions, and both check the access code inside the database before touching a
row.

**Reads are gated too, not just writes.** Your shortlist is competitive
information at a sale — who you've starred and what you've graded is worth
something to someone standing in the same barn. Without the code, the API
returns nothing.

**The access code is one shared secret.** It establishes that you are one of the
group. It does *not* establish which member you are: the display name is a label
people type, not a login, and anyone with the code could type someone else's.
Treat "changed by" as a helpful note about who was working, never as evidence.

**Anyone with the code can change anything**, including clearing a grade you
entered. That is what "shared" means here. It suits a small trusted group and
nothing wider.

**To rotate the code**, run the `update app_config` line above. Everyone is
asked for it again on their next change; no data is affected.

If you later need real accounts — genuine attribution, or removing one person's
access without disturbing everyone else — switch to Supabase Auth with magic
links. The table layout doesn't change; only the check at the top of the two
functions does.

---

## Turning it off

Delete the two values in `js/config.js`, or set them back to the placeholders.
Both models revert to local-only and the Shared panel disappears. Nothing in
`localStorage` is touched, so the last state you synced is still there to work
from.

**Disconnect** in the panel does the same for one device without changing the
config: grades stay in that browser, but further changes stop reaching anyone.

---

## Files

```
shared/schema.sql       the whole backend — tables, the access-code gate,
                        and the two functions the apps call
shared/sync.js          master copy of the transport layer
shared/sync-build.js    copies it into both apps
```

`js/sync.js` in each app is **generated**. Edit `shared/sync.js` and run:

```bash
node shared/sync-build.js
```
