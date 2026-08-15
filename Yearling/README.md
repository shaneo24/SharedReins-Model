# Fasig-Tipton Yearling Sale Model

A shortlist tool for the Fasig-Tipton selected yearling sales — Saratoga and
New York Bred. It pulls the live catalogue, scores every hip on your
conformation and pedigree grades, and lets you filter down to the horses
actually worth walking to the barn for.

It is the [OBS 2YO model](../Model/README.md) with the clock taken out. Same
interface, same workflow, same sire book, different feed.

Plain HTML/CSS/JavaScript. No build step, no dependencies, no framework.

---

## Running it

**Double-click `index.html`.** Unlike the OBS model, the catalogue pull works
straight off disk — Fasig-Tipton's API answers `Access-Control-Allow-Origin: *`
to every request, whatever origin it carries. Verified on the response headers,
not assumed.

For sale history through Keeneland you need the local server:

```bash
node serve.js
```

Then open <http://localhost:8098>. It's about a hundred lines of Node with no
install, and it exists to proxy Keeneland past CORS — see *Sale history* below.
Port 8098 rather than the OBS model's 8099 so both can run at once.

Pick a sale and hit **Load sale**. It fetches the catalogue and its updates,
then quietly pulls last year's yearling sales to build the market index and the
mixed sales this crop passed through as weanlings.

Scoring, filtering, rating and export all work offline once a sale is loaded.

---

## Putting it on the web

There is no build step and no server-side anything except the Keeneland proxy,
so this drops onto **GitHub Pages** (or Netlify, Cloudflare Pages, S3) as-is —
commit the folder, point Pages at the branch root, done.

Measured on a plain static server with no `/api` routes, which is exactly what
Pages is:

| | |
|---|---|
| Catalogue pull, all six sales | works |
| Sire book, market index, scoring, filters, saved filters, short lists | works |
| Photos, catalog-page PDFs, Vimeo walk videos | works |
| Sale history — Fasig-Tipton legs | works |
| **Sale history — Keeneland leg** | **gone** |

Fasig-Tipton answers `Access-Control-Allow-Origin: *` to any origin, including a
`github.io` one, and every asset is already HTTPS, so nothing trips
mixed-content. The one casualty is Keeneland, which sends no CORS header and so
needs `serve.js` sitting in front of it. Statically hosted the app detects the
missing proxy and says so per horse.

Three things to know before you do it:

**It is a public site.** Free GitHub Pages serves publicly whatever repo it
builds from — private Pages is an Enterprise Cloud feature. Anyone with the URL
gets the tool and this README. Your grades don't go with it: by default
everything you type lives in `localStorage` and is never uploaded. (If you have
switched on [shared data](../shared/README.md), that changes — see below.)

**`localStorage` is per-origin.** Grades entered on `localhost:8098` will not
appear on `you.github.io`, and vice versa — same browser, different box. Moving
between them means *Back up grades* on one and *Restore* on the other. Worth
knowing before you grade eighty hips on the wrong one. Shared data sidesteps
this: both origins read the same database.

**You'd be hotlinking Fasig-Tipton's photos and catalog PDFs from a public
page**, which is a different proposition from a tool on your own laptop doing
it. Their [Terms of Use](https://www.fasigtipton.com/docs/Terms_of_Use.pdf) is
the place to check.

### Keeping Keeneland

If sale history matters — and for a yearling sale it does, since Keeneland
November is where most of the crop's weanlings changed hands — host somewhere
with serverless functions instead. **Cloudflare Pages** and **Netlify** are both
free at this size and both give you the missing piece: the whole of
`keenelandByDam` in `serve.js` becomes a ~20-line function at
`/api/keeneland`, `/api/ping` returns `{ keeneland: true }`, and the client
needs no changes at all — it already probes for exactly that.

---

## What's different from the 2YO model

| | OBS 2YO | Fasig-Tipton yearlings |
|---|---|---|
| Components | Breeze visual 39, Conformation 33, Pedigree 28 | **Conformation 54, Pedigree 46** |
| The clock | breeze time filters the list | doesn't exist |
| Media | photo, catalog page, breeze video, walk video | photo, catalog page, walk video |
| Short lists | one | **as many as you want**, a horse on several |
| Filters | set them each time | **named, saved, exportable** |
| New | — | **repository status**, **catalog page updates** |
| Live pull from `file://` | works | works |
| Sale history needs the server | for Keeneland | for Keeneland (matters more here) |

**The weights are the OBS ratio, rescaled.** 33:28 becomes 54:46 — the same
relative preference for the physical over the page, filling the whole 100 now
that Breeze visual is gone. No new opinion was introduced; if you want a
different balance at a yearling sale, the sliders are right there.

There is no under-tack show at a yearling sale, so **everything the 2YO model
knew about how a horse moves is gone**. What replaces it isn't another number —
it's the walk video, and it feeds your Conformation grade rather than a
component of its own.

---

## Where the data comes from

The Fasig-Tipton catalogue page is a React app over a Django REST API:

```
/django/api/sales/?sale_identifier=N26A    -> the sale record (gives its pk)
/django/api/horses/?sale=309               -> every hip, in one request
/django/api/updates/?horse__sale_id=309    -> catalog-page updates, by hip
```

All three are on `www.fasigtipton.com` and all three send `Access-Control-Allow-Origin: *`.

**Sale identifiers are `<region><yy><letter>`** — `N` = New York (Saratoga),
`K` = Kentucky, `M` = Midlantic, `C` = California. The letter is the order
within that region's year. The horses endpoint wants the *numeric* pk instead,
so the app resolves the identifier first and only falls back to the pk baked
into `js/data.js` if that lookup fails.

| Sale | 2024 | 2025 | 2026 |
|---|---|---|---|
| The Saratoga Sale | N24A | N25A | **N26A** (Aug 10–11) |
| New York Bred Yearlings | N24B | N25B | **N26B** (Aug 16–17) |
| Saratoga Fall | N24C | N25C | — |
| Kentucky October Yearlings | K24C | K25C | — |
| Midlantic Fall Yearlings | M24B | M25B | — |
| The November Sale | K24D | K25D | — |
| Kentucky Winter Mixed | K24A | K25A | K26A |

To add one, put a row in `SALES` (or `HISTORY_SALES`) in `js/data.js`. The
identifier is also sitting in `drupalSettings.catalogues.sale_identifier` on any
Fasig-Tipton sale page if you need to look one up.

### Reading the results

Fasig-Tipton has no RNA flag and no separate out flag on the price fields —
**the outcome lives in `purchaser`**:

| `purchaser` | means | `price` |
|---|---|---|
| a name | sold | the hammer price |
| `NOT SOLD` | RNA | what it was bid up to |
| `OUT` | withdrawn | `0.00` |
| `null` | hasn't sold yet | `null` |

Getting this wrong would quietly turn twenty RNAs into twenty sales. Parsed
against the 2025 Saratoga sale it gives **161 sold, 20 RNA, 36 out** — which
matches Fasig-Tipton's own published totals for that sale exactly.

Two more things the feed does that are worth knowing:

- **`year_of_birth` is the full foaling date**, not a year — `"03/05/2025"`.
- **An unnamed yearling's `name` is a placeholder**, `"2025-KEESHA"`. The app
  drops anything matching `<year>-<dam>` rather than printing it as a name.
- **Colour codes are not stable between sales.** The 2026 Saratoga feed says
  `DK B/` and `GR/RO`; the 2025 one says `DKB` and `GRR`. Both spellings map to
  one label, or the colour picker shows the same colour twice.

### Catalog pages

Per-hip pedigree pages are PDFs at a predictable path:

```
https://www.fasigtipton.com/catalogs/<year>/<MMDD of the sale's FIRST day>/<hip>.pdf
```

So hip 2 of the 2026 Saratoga sale is `/catalogs/2026/0810/2.pdf` — and hip 200,
which sells on the 11th, is *also* under `0810`. A two-day sale is one folder,
numbered straight through. They carry no `X-Frame-Options`, so they embed
inline. `web.pdf` in the same folder is the whole book.

### Feeding it data by hand

If the live pull ever fails: open the horses URL in a browser, save the JSON,
and use **Import JSON**. The app takes the array exactly as Fasig-Tipton serves
it and identifies the sale from the `sale` pk each record carries.

---

## The model

**The model scores nothing on its own.** Open a sale and every horse reads `—`.
Both components are your 0–10 ratings; the model's job is to weight them
consistently across 226 hips, not to have opinions of its own.

| Component | Weight | What you're rating |
|---|---|---|
| **Conformation** | 54 | The physical — photo, walk video, and the horse in front of you. |
| **Pedigree** | 46 | Your read of the page. |

What the app does instead of scoring is put the evidence in front of you at the
moment you're making each call:

- the conformation photo and the walk video, next to the Conformation slider
- the catalog page, and any **update** posted since the book was printed
- the **sire book** — racing-record rankings for sire and broodmare sire —
  next to the Pedigree slider
- whether there are **x-rays in the repository** to send a vet to

So the Pedigree slider reads `Pedigree · Into Mischief 99 · BM Tapit 96`, and
the detail panel spells out the cohort, sample size and rates behind those
numbers. You decide what they're worth.

### Why nothing is auto-scored

Carried over from the 2YO model, and it applies harder here. A number the model
invents is a number you have to argue with — you end up reverse-engineering why
it disagrees with you instead of recording what you think. Ratings you entered
yourself are worth exactly what you meant by them.

At a yearling sale there is also nothing honest to auto-score *from*. No clock,
no race record, no workout. Any computed score would be a pedigree score
wearing a hat, and pedigree is the one thing the market has already priced.

Move the sliders and everything re-ranks live. The weights are relative — the
raw numbers don't need to add to 100.

**A horse missing a component is scored on what's known, not penalised.** A hip
you've graded but not read the page on scores on the conformation alone, at 54%
coverage, and the detail panel says so. (If you'd rather ungraded horses take a
neutral 50, switch it under *Scoring options*.)

### How you actually work it

A fresh sale has no ranking, so it builds as you go:

1. **Filter down to a watchable set** — sire, consignor, foal date, session,
   x-rays lodged. 226 hips becomes 60. **Save the filter** once you've got it
   right; you'll want it again on the next sale.
2. **Rate what you look at.** A horse scores on whatever you've filled in.
3. **Track progress** in the count line: `… · 40 graded · 31 ped`. Each rating
   has an *only ones I've rated / haven't rated* filter so you never lose your
   place.
4. **Star the keepers** onto whichever short list they belong on, then work each
   list — pull films, record vet results.

---

---

## Working as a group

By default everything you type stays in this browser. Switch on **shared data**
and grades, notes, short lists and vet status become one set that everyone
sees — what you enter appears for the others within a few seconds, and theirs
appears for you.

It needs a free Supabase project and about five minutes of setup, all of it in
[`shared/README.md`](../shared/README.md). Until you do that, nothing changes:
no network, no prompts, and the **Shared** panel doesn't appear.

Three things worth knowing before you turn it on:

- **One rating per horse, last edit wins** — resolved per field, so someone
  grading the physical while you read the page won't overwrite you.
- **Your work never waits on the network.** Changes save locally first and go
  up afterwards, so bad reception on the grounds costs you nothing.
- **The access code is one shared secret.** It proves you're one of the group,
  not which member — the display name is a label, not a login. Anyone with the
  code can change anything, which is what "shared" means.
- **The site opens on a code prompt** once sharing is on, and asks once per
  device. Losing signal never locks anyone out of work they've already started.

Model weights, scoring options and theme stay yours alone.

## The sire book

Unchanged from the OBS model, and it works the same way: **BloodHorse sire
lists**, ranked on how a sire's progeny actually run, shown beside each horse as
reference. **They never feed the score.**

| Signal | Weight | Why |
|---|---|---|
| % black-type winners from runners | 0.40 | quality rate |
| average earnings per runner (log) | 0.35 | overall performance |
| graded stakes winners per runner | 0.25 | elite quality |

Small books are shrunk toward the cohort average (`rnrs / (rnrs + 20)`), then
each sire is ranked **within its own cohort** — first crop, later crop, all
runners — and cohorts are never blended. Import the same list for several years
and they pool. Full detail is in the [OBS README](../Model/README.md#the-sire-book--reference-not-scoring);
none of it changed.

### Getting the lists in

BloodHorse sends no CORS header and sits behind bot protection, so the app
can't fetch them. You extract them from your own browser:

1. Open [BloodHorse sire lists](https://www.bloodhorse.com/horse-racing/thoroughbred-breeding/sire-lists)
   and pick the Racing Year and List Type.
2. F12 → Console.
3. Paste in `bloodhorse-extract.js` and hit Enter. A `.json` file downloads.
4. **Sire book → Import sire list.**

`sample-data/` holds Leading Sires 2025 + 2026 and First-Crop 2026, taken
2026-08-07 — import those three and you have a working sire book in a minute.

### The first-crop hole, which is specific to yearlings

Measured on 2026 Saratoga, with all three sample lists imported:

| | |
|---|---|
| Sires in the sale | 50 |
| Matched to a BloodHorse list | 40 |
| Hips covered | **175 / 226 (77%)** |

The 51 uncovered hips are not a gap you can close by importing more lists. They
are by **Arcangelo, Cody's Wish, Forte, Mage, Taiba, Elite Power, Gunite,
Arabian Lion, Loggins and Up to the Mark** — stallions whose *first foals are
this crop*. They have no runners anywhere, so no list of runners can rank them.

This is the structural difference between a yearling sale and a 2YO sale: about
a quarter of the book is by stallions with no racing record to their name at
all, and at a boutique sale like Saratoga that share is where a lot of the money
goes. For those, tick **Needs a rating** in the sire book and put your own 0–100
in *Your rating* — that override beats everything else, and it's the only honest
input available.

### The market columns

The dimmed columns right of the dashed divider are what a sire's yearlings have
actually fetched at Fasig-Tipton, pooled from last year's yearling sales
(Saratoga, NY Bred, Kentucky October by default; Midlantic Fall and Saratoga
Fall are one click away in the sire book footer). On 2026 Saratoga that's a
172-sire index — Into Mischief $563K median at 94% sell-through, Gun Runner
$650K at 93%, Flightline $688K.

**It is reference only and never touches the score.** What the ring pays
measures the market's opinion, not the sire's ability to get runners. That
circularity is worse at a yearling sale than at a 2YO sale, not better: with no
clock and no race record, price is *entirely* opinion. Knowing a sire's stock
brings $500K is budgeting, not evaluation.

---

## Repository and catalog updates

Two things the Fasig-Tipton feed gives you that OBS doesn't, both shown as
glyphs in the **Evid** column and spelled out in the detail panel:

**Repository** — the x-ray and scope set a consignor lodges before the sale,
with the date it was last touched. On 2026 Saratoga, 201 of 226 hips have films
lodged. It scores nothing; it tells you whether there is anything to send your
vet to, which is the question you actually have. A blank here two days out is
itself information.

**Catalog updates** — Fasig-Tipton posts page updates right up to the hammer, and
they are exactly the sort of thing that moves a page: *"1/2 brother TIZTASTIC
(Tiz the Law) finished 3rd in G2-Suburban S. (SAR) to increase earnings to
$1,739,305."* Fifty-eight hips carry one. They're pulled with the catalogue,
shown in full in the detail panel, flagged with a **U**, filterable, and they go
into the CSV. The printed book doesn't have them; your Pedigree rating should.

---

## Sale history

Open a horse and you get every prior auction appearance it can be traced to, in
order. This is the pinhook trail — a colt bought as a weanling for $40K is a
different proposition from one that cost $400K, and the model can't tell you
that.

A real example — hip 20, 2026 Saratoga:

| Where | As | Result |
|---|---|---|
| Fasig-Tipton November 2025 | Weanling | $425,000 |
| **Fasig-Tipton Saratoga 2026** | Yearling | — |

**Two sources.**

*Fasig-Tipton* is free and needs nothing. Horses are matched on **dam + foaling
year**, which is unique in practice since a mare has one foal a year; the sire
is checked afterwards as a guard rather than being part of the key. The mixed
sales this crop could have passed through load quietly in the background: The
November Sale of the previous year and **Saratoga Fall** (both weanlings), and
Kentucky Winter Mixed of the current one (short yearlings). On 2026 Saratoga
that traces 18 hips.

**Saratoga Fall is catalogued as a yearling sale but is really a mixed one** —
230 of the 281 hips in the 2025 edition were that year's foals, the rest
broodmares. It was originally left out of the history sales for that reason,
which hid a prior sale on **65 of the 317 hips** in the 2026 New York Bred
catalogue, 49 of them sold. What a horse is described as having sold *as* is
therefore worked out from its foaling year against the sale's, not taken from
the sale's label.

*Keeneland* comes through the local server, and **it matters more here than it
did for 2YOs**: Keeneland November is where most of a crop's weanlings change
hands. Their search returns clean JSON but sends no CORS header, so `serve.js`
proxies it at `/api/keeneland?dam=…`:

```
GET flex.keeneland.com/misc/SearchResults.do
   ?actionName=HorseSearch
   &paramNames=search_id^!^search_all_mode^!^search_all_string
   &paramValues=-1^!^D^!^<dam>
```

Searching by dam returns every foal that mare has sent through Keeneland, so the
client narrows to the individual by foaling year and confirms on sire. Across
hips 2–41 of 2026 Saratoga, adding Keeneland takes the traced count from 4 to
14 — most of this crop's weanling trade went through Lexington in November, not
through Fasig-Tipton.

Opened off disk — or hosted statically, see *Putting it on the web* — everything
else works and sale history falls back to Fasig-Tipton-only, saying so in the
panel. Lookups happen when you open a horse: one request per mare, cached for
the session.

When Keeneland can't be reached, a horse with no Fasig-Tipton history reads
**"Nothing at Fasig-Tipton. Keeneland wasn't checked, so this horse may still
have sold as a weanling."** — not "no prior sale found". Hip 5 of the 2026
Saratoga sale went through Keeneland November for $210,000; without the proxy it
is indistinguishable from a horse that has never seen a ring, and saying
otherwise would be a confident lie about the consignor's basis.

---

## Filters

Search, sire, broodmare sire, foal date, conformation grade, pedigree rating,
sex, colour, consignor, foaling state, session, media availability, x-rays
lodged, page updated, sale results and price, and a minimum model score. Active
filters show as chips you can dismiss individually.

### Saving a filter

Building a fifteen-stallion filter is ten minutes of clicking; doing it twice is
a waste. **Save** at the top of the Filters panel names the current filter and
puts it in the dropdown. Loading one applies it whole — pickers, sliders, dates,
checkboxes.

Saving under a name that already exists overwrites it, so that's also how you
update one.

**export filters / import filters** writes the lot to a JSON file and reads it
back, so a filter can move between machines or to someone else. Import merges by
name: re-importing your own export changes nothing, and importing a colleague's
adds theirs alongside yours rather than replacing them.

Two details worth knowing:

- **Dates are stored as `YYYY-MM-DD` strings, not timestamps.** The two foal-date
  fields are live `Date` objects in the app, and round-tripping those through
  JSON hands back strings that then silently fail every comparison. `serialize`
  and `deserialize` in `js/filters.js` own that conversion.
- **A filter loads even if it was saved before a control existed.**
  `deserialize` starts from a blank filter and copies only keys the current
  model knows about, so an old file leaves new filters at their defaults instead
  of refusing to load.

**Filters are not tied to a sale**, which is the point — the same stallion list
is worth running over Saratoga and the NY-bred sale. But a filter naming sires
or sessions that aren't in the sale you have open would otherwise just produce a
mysteriously empty table, so the app says what landed:

> Loaded "Top 15 stallions, early colts". 10 of 15 sires are in this sale.

That line covers sires, broodmare sires, consignors, sessions, foaling states
and colours.

Sessions are named by date at Fasig-Tipton, so they're listed chronologically
(Aug 10, then Aug 11) rather than by hip count.

Foal-date shortcuts for Jan–Feb and "before Mar 31" are there because that's the
filter people actually reach for — though note that foal date showed no
relationship to price in the OBS backtest (ρ = -0.019), which is why it is a
filter and not a component here either.

## Media

Open a horse and the conformation photo, catalog page and walk video all render
inline — no new tabs. **Nothing loads until you click its tab.** The photo opens
by default; the walk videos are Vimeo embeds (Thorostride) that only start
streaming once you open theirs. Every tab has an *open full size* link.

Grading a horse refreshes its score breakdown *in place* rather than rebuilding
the panel, so it won't restart a video you're part-way through.

On 2026 Saratoga: 190 of the 196 live hips have a conformation photo, 193 have a
walk video.

## Short lists

**Full Catalog** is the whole sale, scored and filtered. Everything after it in
the tab bar is a short list of yours, with its own count for the sale you're
shopping. **+ list** makes another.

One sale is rarely one list. "Colts to see", "over budget", "vet these before
Tuesday" are different thoughts about overlapping sets of horses, and a single
star can't carry all three.

**A horse can be on as many lists as you like.** Two ways in:

- The **★** in each row is the fast path. It adds to whichever list the **★ to**
  picker in the toolbar is pointing at — so you set the target once and work
  down the page. On a list tab the target *is* that tab, so the picker hides and
  the star just toggles membership of the list you're looking at.
- The **chips in the detail panel** are the precise path: one per list, so a
  horse goes onto two at once without changing what the star is aimed at.

A star is filled if the horse is on *any* list; hover it to see which.

**rename** and **delete list** sit next to the count when a list tab is open.
Deleting asks first, tells you how many hips from this sale are on it, and
removes only the list — grades, notes and vet status stay. The last list can't
be deleted, since the ★ needs somewhere to go.

**List definitions are global; membership is per sale.** The keys are
`<sale>:<hip>`, so "vet these" survives switching from Saratoga to the NY-bred
sale while its contents don't follow it over.

## Vet tracking and exports

Each horse carries a vet status — *No vet yet · Films pulled · Vetted clean ·
Did not vet*. A horse marked **Did not vet** stays on the short list as a record
but is struck through and drops to the bottom immediately, whatever the sort.
("Films pulled" rather than "Report requested": at a yearling sale the first
move is the repository, not a fresh exam.)

**Export CSV** writes the current filtered, sorted list with both component
scores, your grades and notes, x-ray status, the full text of any catalog
update, every list the horse is on, the result, and direct links to the walk
video and catalog page. Exporting from a list tab names the file after the list.

**Back up your grades before a sale.** *Your data → Back up grades* writes a JSON
file — grades, notes, vet status, your short lists and their contents, sire
overrides and saved filters — that restores into any browser. Browser storage is
not a safe place to keep a day's work on the grounds. Backups from this model
and the OBS one are separate files and separate namespaces; they can't overwrite
each other.

The backup format is at version 2. Version 1 files predate named short lists and
carry a single `flag: true` per horse; restoring one folds those onto the first
list rather than dropping them.

---

## Layout

```
index.html          markup
css/styles.css      styling, light + dark
js/util.js          dates, percentiles, formatting
js/data.js          Fasig-Tipton API, sale identifiers, record normalisation
js/config.js        shared-data connection settings (placeholders = local only)
js/sync.js          shared-data transport — GENERATED from shared/sync.js
js/store.js         localStorage: grades, notes, short lists, saved filters,
                    sire lists, overrides, settings; mirrors the shared ones up
js/bloodhorse.js    BloodHorse sire lists — the racing record behind each page
js/sires.js         Fasig-Tipton yearling market index (reference only)
js/salehistory.js   prior auction appearances — Fasig matching + Keeneland lookup
js/scoring.js       the model — components, weights, context
js/filters.js       filtering and facets
js/ui.js            rendering
js/app.js           state and event wiring
serve.js            dependency-free static server + Keeneland proxy
bloodhorse-extract.js   paste into BloodHorse's console to pull a sire list
sample-data/        a BloodHorse snapshot for testing the import
```

Scripts are classic (no ES modules) so the page still works from `file://`.
The global namespace is `FT` (the OBS model uses `OBS`), and `FT.app.state` is
exposed for poking at the model from the console.

### Adding a component

Write a function returning `{ value: 0..100, detail: 'why' }`, add it to
`COMPONENTS` in `js/scoring.js`, and add a default weight in `DEFAULTS.weights`.
The sliders, detail panel and CSV pick it up automatically.

---

## What this model can't tell you, and no backtest will fix

The OBS model could be backtested because it had a clock. This one can't be, in
either direction:

- Against **price**, a backtest would only prove the model agrees with the
  market — and since the model is your eye on a physical and a page, that's the
  same information the market is pricing. There is no independent signal to
  test.
- Against **race results**, the horses haven't run. The 2025 Saratoga yearlings
  are two-year-olds now; the first real read on any of this is 2028.

So the honest claim is narrower than the 2YO model's: this applies *your*
judgement evenly across 226 hips, keeps the evidence in front of you while you
make each call, and remembers what you decided. It does not know which yearling
can run. Nothing does.

## Worth adding next

- **Track the sale as it happens.** The feed fills in `purchaser` and `price`
  live. A "how did my short list do" view would write itself, now that there are
  several lists to compare.
- **Reorder the short-list tabs.** They're in creation order; drag-to-reorder is
  a few lines and the array is already ordered.
- **Split conformation into sub-grades** (walk, shoulder, knees, hind end) that
  roll up. This matters more here than at a 2YO sale — with no clock, the
  physical is 54% of the model on its own.
- **Repository doc detail.** The feed says *whether* films are lodged and when.
  If there's an endpoint behind the login that lists which views, that's worth
  finding.
- **Pull the results back in after the sale** and score your grades against
  hammer price — not to validate the model, but to see where your eye and the
  market disagreed while you can still remember the horse.
- **Score against race results in 2028.** The only test that means anything.
