# OBS 2YO Sale Model

A shortlist tool for the Ocala Breeders' Sales two-year-olds-in-training sales
(March, Spring/April, June/Open). It pulls the live catalog, scores every hip on
breeze time, your conformation grades, pedigree and foal date, and lets you filter
down to the horses actually worth walking to the barn for.

Plain HTML/CSS/JavaScript. No build step, no dependencies, no framework.

---

## Running it

```bash
node serve.js
```

Then open <http://localhost:8099>. The server is 100 lines of Node with no
dependencies and no install. It's needed for **sale history** — see below —
which proxies Keeneland to get past CORS.

**Everything else works by just double-clicking `index.html`**, including the
live pull from OBS. Opened that way, sale history falls back to OBS-only.

The OBS pull works from `file://` because their API echoes back whatever
`Origin` a request carries — including the `null` origin a local file sends.
(Verified by probing the response headers; plenty of APIs would refuse.)
Keeneland does not, which is why it needs the proxy.

Pick a sale and hit **Load sale**. It fetches the catalog, then quietly pulls
the previous year's 2YO sales to build the sire book, and the yearling sales to
build sale history.

Scoring, filtering, rating and export all work offline once a sale is loaded.

---

## Where the data comes from

The OBS catalog site is an Angular app over a WordPress REST API:

```
https://obssales.com/wp-json/obs-catalog-wp-plugin/v1/horse-sales/<id>?is_digital=false
```

One request returns the whole sale — every hip, its pedigree, breeze time,
consignor, media links and (after the sale) its result. Sale ids are the same
numbers as in the catalog URL `obssales.com/catalog/#/149/results`:

| Sale | 2024 | 2025 | 2026 |
|---|---|---|---|
| March | 135 | 142 | **149** |
| Spring (April) | 136 | 144 | 150 |
| June (Open) | 137 | 145 | 151 |

**Breeze times are in fifths.** `10.3` in the feed means 10 and 3/5 seconds, not
10.3 seconds — the digit after the decimal never exceeds 4. The app parses this
properly and displays `:10 3/5`. Getting this wrong quietly corrupts any breeze
comparison, so it's worth knowing.

### Feeding it data by hand

If the live pull ever fails: open the API URL above in a browser, save the JSON,
and use **Import JSON**. The app takes the file exactly as OBS serves it, no
massaging needed.

---

## The model

**The model scores nothing on its own.** Open a sale and every horse reads `—`.
All three components are your 0–10 ratings; the model's job is to weight them
consistently across 800 hips, not to have opinions of its own.

| Component | Weight | What you're rating |
|---|---|---|
| **Breeze visual** | 39 | How the horse *looked* working, after watching the video. |
| **Conformation** | 33 | The physical. |
| **Pedigree** | 28 | Your read of the page. |

What the app does instead of scoring is put the evidence in front of you at the
moment you're making each call:

- the clock and the breeze video, next to the Breeze visual slider
- the conformation photo and catalog page, in the same panel
- the **sire book** — full racing-record rankings for sire and broodmare sire —
  next to the Pedigree slider

So the Pedigree slider reads `Pedigree · Into Mischief 99 · BM War Front 86`, and
the detail panel spells out the cohort, sample size and rates behind those
numbers. You decide what they're worth.

**Breeze time and foal date are filters, not components.** The clock tells you
which horses to go and look at; it doesn't tell you how good they are. (Foal
date also showed no relationship to the market at all, ρ = -0.019.)

### Why nothing is auto-scored

An earlier version computed Pedigree from sire data directly. It was dropped
because a number the model invents is a number you have to argue with — you end
up reverse-engineering why it disagrees with you instead of recording what you
think. Ratings you entered yourself are worth exactly what you meant by them,
and the ranking that comes out is your own judgement applied evenly rather than
a black box's.

The sire rankings still exist in full, as reference. They inform the number;
they don't set it.

Move the sliders and everything re-ranks live. The weights are relative — the
raw numbers don't need to add to 100.

**A horse missing a component is scored on what's known, not penalised.** A hip
that hasn't breezed yet, or one you haven't inspected, gets scored on the
remaining factors and the detail panel tells you what share of the model it was
scored on. (If you'd rather ungraded horses take a neutral 50 for conformation,
switch it under *Scoring options*.)

### How you actually work it

A fresh sale has no ranking, so it builds as you go:

1. **Filter down to a watchable set** — breeze time, distance, "has breeze
   video", sire, foal date. 816 hips becomes 60.
2. **Rate what you look at.** A horse scores on whatever you've filled in — rate
   only the breeze and it's scored on the breeze alone, at 39% coverage. The
   detail panel says so on every horse.
3. **Track progress** in the count line: `… · 40 watched · 25 graded · 31 ped`.
   Each rating has an *only ones I've rated / haven't rated* filter so you never
   lose your place.
4. **Star the keepers**, work the Short List, record vet results.

If you'd rather partially-rated horses sit mid-pack than be scored on what's
known, switch *Scoring options → Horses you haven't rated yet* to **neutral**.

### The sire book — reference, not scoring

The sire book ranks every sire from **BloodHorse sire lists** — how their
progeny actually run. Those rankings are shown beside each horse (a small badge
next to the sire's name, and the full figures in the detail panel) so you can
rate the pedigree knowing what's behind it. **They never feed the score.**

Three signals, all rates rather than totals so a sire with 40 runners isn't
beaten by one with 400 simply for having more:

| Signal | Weight | Why |
|---|---|---|
| % black-type winners from runners | 0.40 | quality rate |
| average earnings per runner (log) | 0.35 | overall performance |
| graded stakes winners per runner | 0.25 | elite quality |

Small books are shrunk toward the cohort average (`rnrs / (rnrs + 20)`), then
each sire is ranked **within its own cohort** — a freshman is compared to other
freshmen, not to Into Mischief. See *Cohorts* below.

**Auction prices are deliberately excluded.** What the ring pays measures the
market's opinion of a sire, not his ability to get runners; a model built on it
would rediscover the market's own biases and report them back as insight. The
OBS market columns are still shown in the sire book — dimmed, right of a dashed
divider — because knowing a sire's stock typically brings $40K is useful when
you're deciding what to bid. That's budgeting, not evaluation.

With Leading Sires 2025 + 2026 pooled, the top of the *All runners* cohort is
Not This Time 100, Into Mischief 99, Gun Runner 99, Vekoma 98. The *First crop*
cohort ranks separately: Corniche 99, Roadster 97, Life Is Good 94.

#### Getting the lists in

**BloodHorse can't be fetched by the app.** It sends no
`Access-Control-Allow-Origin` header at all, so browsers block any direct
request, and it sits behind Imperva bot protection — a scripted fetch gets a
~1KB challenge page instead of the table. Both were verified directly, not
assumed.

So you extract it from your own browser, where you're a normal visitor:

1. Open [BloodHorse sire lists](https://www.bloodhorse.com/horse-racing/thoroughbred-breeding/sire-lists)
   and pick the Racing Year and List Type.
2. F12 → Console.
3. Paste in `bloodhorse-extract.js` and hit Enter. A `.json` file downloads.
4. **Sire book → Import sire list.**

The extractor maps columns by **header text, not position** — Leading Sires has
13 columns (Rank and Sire are duplicated for the sticky header) while First-Crop
has 11, so reading by index silently shifts every field on some lists. It also
reads the sire's name from the cell's first line rather than its link, because
pensioned and deceased sires have no profile link and the only `<a>` there is an
icon with no text.

#### Cohorts: like judged against like

Imported lists are sorted into **cohorts**, and a sire is only ever ranked
against others in the same one:

| Cohort | From | Why separate |
|---|---|---|
| **First crop** | First-Crop Sires | 20-ish runners apiece. Comparing a freshman to a sire with 400 runners says nothing about either. |
| **Later crop** | Second- through Sixth-Crop | Young, but with real samples building. |
| **All runners** | Leading Sires | Established horses, deep samples. |

Cohorts are **never blended**. When a sire qualifies for more than one, the most
recent data wins, then the narrower cohort — so a sire who was a freshman in
2025 and has a second crop running in 2026 moves up rather than being stuck in
the first-crop cohort forever.

**Sires of Two-Year-Olds and Three-Year-Olds are excluded outright.** They
measure one age group inside a single season — a small, noisy slice that says
more about which juveniles happened to run early than about the sire. Importing
one is refused with an explanation rather than silently dropped. To change that,
edit `IGNORED_TYPES` in `js/bloodhorse.js`.

#### Pooling years

Import the same list for several years and they pool into one row per sire.
Counts are summed, then the rates recomputed from the pooled totals. Into
Mischief across 2025 + 2026:

| | 2026 | 2025 | Pooled |
|---|---|---|---|
| Runners | 337 | 453 | **790** |
| Black-type winners | 19 | 27 | **46** |
| % BTW | 5.6% | 6.0% | **5.8%** |
| Earnings per runner | $55,873 | $70,343 | **$64,170** |

Earnings-per-runner is weighted by runners, not averaged naively. Stud fee and
foal count take the most recent year rather than summing, since they're
point-in-time facts.

⚠️ **This counts runner-seasons, not unique horses.** A horse that raced in both
2025 and 2026 is in the denominator twice. That's consistent — numerator and
denominator are summed together, so the *rate* stays honest — and it's the
point: two years roughly doubles the sample to shrink against, so a ranking
stops swinging on one good season. It is not a count of individual animals.

#### Coverage

Measured on 2026 March:

| Imported | Sires matched | Hips covered |
|---|---|---|
| Leading Sires 2026 only | 87 / 152 | 387 / 816 (47%) |
| + Leading Sires 2025 + First-Crop 2026 | 123 / 152 | **766 / 816 (94%)** |

The gap under one list is entirely young sires — Jack Christopher (31 hips),
Nashville (30), Drain the Clock (27) — with no general-list record because their
first runners are only now appearing. First-Crop covers them.

**Worth importing:** Leading Sires for two or three years, plus First-Crop for
the current year (and Second-Crop once you have it). Tick *Needs a rating* in
the sire book to see who's still uncovered, sorted by hip count.

`sample-data/` holds Leading Sires 2025 + 2026 and First-Crop 2026, taken
2026-08-07, so you can test the import before doing your own.

#### Overrides

Type a 0–100 in *Your rating* for any sire and it wins over everything else.
That's the intended escape hatch for a sire you know something about that the
lists don't show.

---

## What the backtest showed — and what it no longer covers

⚠️ **This backtest measured an earlier version of the model** that scored breeze
*time* directly. Breeze time is now a filter, not a component, so the numbers
below no longer describe what the app ships. They're kept because of what they
say about the underlying data — which is what justified the change.

Backtested against the 2026 March sale (816 hips, 450 sold), with the sire book
built **only from the 2025 sales** so the model never saw the results it was
being tested on. Breeze time + pedigree, no manual input.

Spearman correlation between that score and hammer price: **ρ = 0.63**.

| Score quintile | Median price |
|---|---|
| 1 (highest) | $210,000 |
| 2 | $140,000 |
| 3 | $95,000 |
| 4 | $50,000 |
| 5 (lowest) | $25,000 |

Perfectly monotonic, an 8× spread top to bottom, and the model never saw price.
RNA rate was also lower in the top half (17% vs 24%).

**What that told us:**

1. **The clock alone carried almost all of it.** Breeze time by itself scored
   ρ = 0.628 — the same as that whole model. This is exactly why it's now a
   *filter*: it is very good at telling you which horses the market will chase,
   which is a different question from which horses can run. Filtering on it
   costs nothing and keeps that signal in the workflow.
2. **The pedigree component was weak** (ρ = 0.195 alone) — but that was the
   old market-derived version, which has since been replaced by BloodHorse
   racing data. It hasn't been re-measured, and can't be against price without
   reintroducing the circularity the change was meant to remove.
3. **Foal date showed no relationship to price at all** (ρ = -0.019), which is
   why it was dropped from the weights and kept as a filter. If you want it back
   as a component, the recipe is under *Adding a component* below — it needs a
   percentile rank of `h.foalDay` against the sale.

Also worth saying plainly: correlating with *price* only proves a model agrees
with the market. It says nothing about which horses can run. Tracking scores
against subsequent race results is the test that actually matters — and the
current model, being mostly your own eye, can't be backtested against past sales
at all. It'll only be measurable going forward.

---

## Filters

Search, breeze (distance, absolute time range in fifths, or "fastest N% of its
distance"), sire, broodmare sire, foal date, conformation grade, sex, colour,
consignor, foaling state, session, media availability, sale results and price,
and a minimum model score. Active filters show as chips you can dismiss
individually.

Foal-date shortcuts for Jan–Feb and "before Mar 31" are there because that's the
filter people actually reach for.

## Sale history

Open a horse and you get every prior auction appearance it can be traced to,
in order. A real example — hip 1, Instagrand–Haka's Sister:

| Where | As | Result |
|---|---|---|
| Keeneland NOV 2024 | Weanling | $3,000 |
| OBS Winter Mixed Jan 2025 | | RNA $15,000 |
| OBS October Yearling 2025 | Yearling | $35,000 |
| **OBS March 2026** | 2YO | $20,000 |

That's the consignor's basis laid out. A colt bought for $14K and pinhooked is a
different proposition from one that cost $300K, and the model can't tell you
that — the trail can.

**Two sources.**

*OBS* is free and needs nothing: horses are matched on **dam + foaling year**,
which is unique in practice since a mare has one foal a year. Verified across
all 816 hips with zero collisions, and the sire agreed every time despite not
being part of the key. The relevant yearling and mixed sales load quietly in the
background after the main sale.

*Keeneland* comes through the local server. Their horse search returns clean
JSON but sends no CORS header, so the browser can't call it directly — there's
no bot protection though, so `serve.js` proxies it at `/api/keeneland?dam=…`:

```
GET flex.keeneland.com/misc/SearchResults.do
   ?actionName=HorseSearch
   &paramNames=search_id^!^search_all_mode^!^search_all_string
   &paramValues=-1^!^D^!^<dam>
```

`-1` is the magic value for a fresh search; `D` searches by dam. Searching by
dam returns every foal that mare has sent through Keeneland, so the client
narrows to the individual by foaling year and confirms on sire.

**This is the one feature that needs `node serve.js`.** Opened off disk,
everything else works and sale history quietly falls back to OBS-only, saying so
in the panel. Lookups happen when you open a horse — one request per mare, cached
for the session — rather than 800 requests on load.

Fasig-Tipton keeps results on per-sale pages with no search-by-dam endpoint, so
it isn't covered yet.

## Media

Open a horse and the conformation photo, catalog page, breeze video and walk
video all render inline — no new tabs. OBS serves these without `X-Frame-Options`
or a CSP `frame-ancestors` rule, so the catalog PDF embeds directly.

**Nothing loads until you click its tab.** The photo (~150KB) opens by default;
the breeze videos are around 35MB each and are marked as such. Even then the
`<video>` element only pulls metadata and a keyframe — measured at 0.2s of a
23-second clip — so the full file downloads only if you press play. That matters
on sale-grounds wifi.

Every tab still has an *open full size* link if you'd rather have the real thing
in its own tab.

Grading a horse refreshes its score breakdown *in place* rather than rebuilding
the panel, so it won't interrupt a video you're part-way through.

## Tabs and short lists

**Full Catalog** is the whole sale. Alongside it sits one tab per **short list**,
and **+ list** makes another.

A horse can be on several lists at once — "colts to see" and "over budget" are
different thoughts about the same animal, and one boolean can't carry both.
Open a horse and the chips under *Short lists & vet* toggle membership
individually.

The ★ in the table adds to a single list: on a list tab that's the tab you're
looking at, and on the catalog it's whatever the **★ to** picker in the toolbar
points at. Opening a list tab also makes it the star target, so starring from
the catalog afterwards puts horses where you were just working.

Un-starring from a list removes the horse immediately; from the catalog it waits
for a re-rank, so rows don't jump while you're working down the page.

*rename* and *delete list* sit next to the count line on a list tab. Deleting a
list takes horses off it but keeps every grade, note and vet status — and the
last list can't be deleted, since the ★ needs somewhere to go.

List *definitions* are global; membership is per-sale, because the keys carry the
sale id. So a list you use every year ("vet these") survives switching sales
while its contents don't bleed across.

The sidebar filters apply to every tab, so you can narrow a list further (say, to
one consignor's barn) without losing it.

## Saved filters

Building a filter with fifteen stallions on it is real work, so it's saveable.
The controls sit at the top of the Filters panel:

- **Save** — names the current filter set, or overwrites one of that name
- the dropdown loads one back
- **✕** deletes the selected one
- **export filters** / **import filters** move them between machines

Import merges by name, so re-importing your own export is idempotent rather than
producing duplicates.

Loading a filter checks it against the sale you have open and says so when it
doesn't fit — *"Loaded 'Fast KY colts' — 3 of 15 sires not in this sale"*. A
filter built on last year's catalogue would otherwise produce an empty table with
no explanation.

Saved filters travel in the main backup too, alongside your grades and lists.

## Vet tracking

Each horse carries a vet status, shown as a column on the Short List and in every
detail panel:

| Status | Meaning |
|---|---|
| — | nothing requested |
| Report requested | you've ordered it, waiting |
| Vetted clean | passed |
| **Did not vet** | failed — scratched |

A horse marked **Did not vet** stays on its lists as a record, but is struck
through and drops to the bottom immediately, regardless of how the list is
sorted. You never lose the fact that you looked at it and why, and it never
clutters the top of the list again.

This is a four-state control rather than a checkbox because "requested" and
"failed" are genuinely different things — a checkbox can't tell you which of your
short list is still waiting on a vet.

Vet status and list membership both export to CSV alongside your grades and
notes — the **Short lists** column names every list a horse is on.

## Your ratings

Three 0–10 inputs per horse, in the table and in the detail panel — these *are*
the model:

- **Visual** — how the horse looked working. The clock sits next to the slider.
- **Conf** — the physical.
- **Ped** — your read of the page. The sire book's numbers sit next to the slider.

Each has filters for *only ones I've rated* / *only ones I haven't*, so you can
work through a sale without losing your place. Add notes per horse. Everything
saves to this browser automatically.

Grading a horse updates its score immediately but **doesn't re-sort the list** —
the rows would jump under your cursor. A **Re-rank** button appears when scores
have moved; hit it when you're ready.

**Back up your grades before a sale.** *Your data → Back up grades* writes a JSON
file that restores into any browser. Browser storage is not a safe place to keep
a day's work at a sale ground.

## Exports

**Export CSV** writes the current filtered, sorted list with every component
score, your grades and notes, the result, and direct links to the breeze video
and catalog page.

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

---

## Layout

```
index.html          markup
css/styles.css      styling, light + dark
js/util.js          fifths parsing, dates, percentiles, formatting
js/data.js          OBS API, sale ids, record normalisation
js/config.js        shared-data connection settings (placeholders = local only)
js/sync.js          shared-data transport — GENERATED from shared/sync.js
js/store.js         localStorage: grades, notes, sire lists, overrides, settings;
                    mirrors the shared ones up
js/bloodhorse.js    BloodHorse sire lists — the racing basis for Pedigree
js/sires.js         OBS market index (reference only) + the rating chain
js/salehistory.js   prior auction appearances — OBS matching + Keeneland lookup
js/scoring.js       the model — components, weights, context
js/filters.js       filtering and facets
js/ui.js            rendering
js/app.js           state and event wiring
serve.js            dependency-free static server + Keeneland proxy
bloodhorse-extract.js   paste into BloodHorse's console to pull a sire list
sample-data/        a BloodHorse snapshot for testing the import
```

Scripts are classic (no ES modules) so the page still works from `file://`.
`OBS.app.state` is exposed for poking at the model from the console.

### Adding a component

Write a function returning `{ value: 0..100, detail: 'why' }`, add it to
`COMPONENTS` in `js/scoring.js`, and add a default weight in `DEFAULTS.weights`.
The sliders, detail panel and CSV pick it up automatically.

---

## Worth adding next

- **Race results.** Score against what the horses actually did. This is the only
  validation that means anything now that the model is mostly your own eye.
- **Auto-refresh of sire lists.** Currently a manual paste-and-import per list.
  A small local proxy could automate it, at the cost of a moving part.
- **Tune the sire shrinkage.** `SHRINK_K = 20` in `js/bloodhorse.js` currently
  lets Preservationist (8.2% BTW off 49 runners) rank above Gun Runner. That may
  be right, or the constant may want raising — it's one number to change.
- **Breeze video review state**, so you can track what you've actually watched.
- **Split conformation into sub-grades** (walk, shoulder, knees, hind end) that
  roll up, once you know which parts you weight.
