# Handover

Living notes for whoever picks this up next. Read this, then
[ARCHITECTURE.md](ARCHITECTURE.md), before opening source files.

**Update this file at the end of a piece of work.** Newest entry first in the log
at the bottom; fold anything that is now permanently true into the sections
above it.

---

## State

Working. Typecheck is clean and the flows below have been exercised against the
running app.

Verified end to end on 2026-08-30 (the purchase-need form): driven in a real
browser - every department's category list, the picker narrowing to a category
and then to typed text, the photos loading, picking a row filling the field,
"Something else…" falling back to the whole department, and switching department
clearing the category. See the log entry.

Verified on 2026-08-30 (asset quantity): migration applied and the schema
matches the database; column widths re-solved; not clicked through in the app.
Restart `next dev` so it loads the regenerated Prisma client.

Verified on 2026-08-30 (report wording): every fixed label in the document can
now be typed over on the canvas and prints as typed - checked by rendering the
template both ways against a fixture, not yet clicked through in the app.

Verified on 2026-08-30 (the canvas bar): not yet exercised in the app -
the bar now stays on the block that was clicked; see the log entry for what to
try.

Verified on 2026-08-27 (money): every cost and total now prints its cents, and
the report tables were re-measured so the wider figures still fit - see the log
entry.

Verified end to end on 2026-08-27 (the report canvas): the handles on the page,
removing and putting back, dragging and nudging blocks, columns dropped and
resized on the page itself, rows struck out, added blocks, typing in place,
undo, the tool bar, saved layouts, and the PDF - see the log entry for what each
probe covered.

Verified end to end on 2026-08-26 (the report builder): every grouping, the
column width solver against a real render, the drag-and-drop, saved reports, and
the department-head boundary - see the log entry for what each probe covered.

Verified end to end on 2026-08-22 (Locations): the Locations screen, create,
rename, the case-insensitive duplicate rejection on both POST and PATCH,
delete-refused-then-deactivate for a location holding assets, assigning and
clearing an asset's location, the `?locationId=` deep link, search by location
name, the department-head permission boundary (403 on all three writes, no nav
link, `/locations` redirects to `/assets`, asset counts scoped to their own
department), and PDF report generation.

Verified end to end on 2026-08-13: login, the Categories screen, category create
(including the duplicate-name and duplicate-code messages), asset create with an
auto-generated tag (`WRK-NUT-001` then `WRK-NUT-002`), the cross-department
category rejection, deactivate-instead-of-delete, the add-asset form's draft
surviving a trip to `/departments/new` and back, and PDF report generation.

Verified end to end on 2026-09-16 (the landing page): `npm run build` is clean
from a deleted `.next`, and the launcher, the seven admin tiles, the absence of a
sidebar on `/` and its presence on `/departments`, `/assets`, `/reports` and
`/users` were all checked in a real browser against `next start`. See the log
entry.

---

## Environment gotchas

These have each cost a session before.

- **`npx prisma migrate dev` fails here: P3014.** The `assets` role cannot create
  the shadow database. Write the migration SQL by hand under
  `prisma/migrations/<timestamp>_<name>/migration.sql` and apply it with
  **`npx prisma migrate deploy`**. Confirm the result matches the schema with:
  ```bash
  npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma \
      --to-schema-datasource prisma/schema.prisma --script   # expect "empty migration"
  ```
- **`npx prisma generate` fails with `EPERM … query_engine-windows.dll.node`**
  when the dev server is running — it holds the DLL. Stop `npm run dev` first,
  generate, then restart.
- **Never run `next build` while `next dev` is running.** They share `.next`, and
  the build overwrites the dev manifests - every page then 500s with
  `Cannot read properties of undefined (reading 'call')` and a complaint about
  the React Client Manifest. Recovery: stop node, delete `.next`, start dev again.
  Hit again on 2026-09-16, with a **second, quieter symptom**: the dev server can
  recompile itself back to HTTP 200 while `/_next/static/css/app/layout.css` stays
  a 404, so every page renders correct markup with no styling at all. That looks
  exactly like a broken stylesheet and is not one - check the CSS URL returns 200
  before suspecting your CSS. Same recovery.
- **Back up before a destructive migration.** pg_dump lives at
  `C:\Program Files\PostgreSQL\16\bin\pg_dump.exe` (not on PATH). Two traps when
  feeding it `DATABASE_URL`: strip the `?schema=public` suffix (that is Prisma's,
  and libpq rejects it with `invalid URI query parameter: "schema"`), and use the
  `--dbname=`/`--file=` forms rather than positional arguments. Same for `psql`
  — and pass SQL with `-f file.sql`, because PowerShell 5.1 strips the embedded
  double quotes that every quoted identifier in this schema needs.
- **Credentials are not in the repo** — `.env` is gitignored. To get in without
  guessing:
  `npm run create-admin -- --email <addr> --name "<name>" --password "<pw>"`.
  The single ADMIN account was renamed on 2026-08-26 - it is no longer
  `admin@company.local`, which is what README.md and the two setup scripts
  still print (correctly: that is the seed default for a fresh install). Read
  the User table for role ADMIN to see who it actually is; the password is
  only on the office PC.
- `npm run lint` is not configured (it drops into an interactive ESLint setup
  prompt). **`npm run typecheck` is the gate.**
- `/favicon.ico` 404s in the browser console. Cosmetic, pre-existing, nobody has
  asked for one.

## Testing without a UI

There is no test suite. The cheap loop is curl against `npm run dev`:

```bash
curl -s -c jar.txt -X POST localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"...","password":"..."}'
curl -s -b jar.txt localhost:3000/api/asset-categories
```

For the interactive pieces (the combobox, the draft hand-off) drive Chrome with
the Puppeteer already in `node_modules` — the script has to sit inside the
project directory for the import to resolve, and Chrome is at
`C:\Program Files\Google\Chrome\Application\chrome.exe`
(`PUPPETEER_EXECUTABLE_PATH` in `.env`).

---

## Log

### 2026-09-16 - The Overview became a launcher

The screen at `/` was a dashboard: four stat tiles, a condition bar, two tables
and a per-department breakdown. It was dropped. Nobody acted on the numbers, and
it was the one screen standing between signing in and the screen you actually
wanted.

`/` is now a launcher - a tinted tile per destination, icon, name and one line of
what is behind it, and nothing else. It queries nothing, so it no longer waits on
the database to show you a set of links.

**The sidebar is gone from `/` and only from `/`.** That is why the page moved out
of `(app)/` to `src/app/page.tsx`: the `(app)` layout is what draws the sidebar,
so leaving the file in that group would have meant a sidebar sitting beside tiles
that say the same thing. Every other screen is untouched and still has its nav,
which now opens with **Home** (the old **Overview** entry, repointed - same `/`).

Two things came out of the move:

- `lib/page-auth.ts` — `requirePageUser()`. Two layouts now need the same gate
  (signed in, past `mustChangePassword`), and three lines copied into both would
  have been three lines to keep in step.
- `lib/nav.ts` — the destination list, read by both `NavLinks` and the tiles.
  Without it, adding a screen would mean remembering two files. Home is
  deliberately not in it: as a tile it would point at the page you are on. The
  department-head rules are unchanged and now live in one place - **My
  department** instead of **Departments**, and no Locations or Users tile.

The tile tints are `--tile-*` pairs in `globals.css`, pale ground plus a deep ink
of the same hue. **They are decoration and carry no meaning** - unlike the status
colours directly above them in that file, which do. Do not reach for a status
colour to tint a tile.

The `overview` icon went with the page; `home` (a roof over a doorway) replaced
it. Checked in a browser at 1280px and 430px; the tiles reflow to one column.

Hit the `next build` / `next dev` trap again while verifying this - see the
sharper note in the gotchas, the no-styling symptom is new.

### 2026-08-30 - Flagging a need starts from the equipment you already own

**Why:** Asked for: "in the first thing <<<What needs to be bought. section i
should able to select assets from the assets list . like i should able to see
the assets as i type and there images and also before that i should see to
select the departmnet and the category so the assets can filted and show there.
and also those categories and departments should be like a dropdown. that i
should able to select. not type."

The form asked for a title and a category as two empty text boxes, so every need
was typed from memory. That is how the CEO's report ends up listing "Heidelberg
SM52", "Heidleberg SM 52" and "heidelberg press" as three separate lines, and
department heads know their machines by sight long before they know the tag.

**What changed:**

- **`AssetPicker.tsx` is new.** A text field that searches the department's
  equipment as you type and shows each match with its photo, tag, category and
  condition. Deliberately **not** the existing `Combobox`: that one only ever
  hands back an id, and this field has to stay writable because most needs are
  for something nobody owns yet. So it hands back *text*, and the list is a
  shortcut, not a constraint.
- **Department and category moved above it**, in that order, because they are
  what narrow the picker to a list somebody can recognise. Department was already
  a `<select>`; **category is now one too**, listing that department's active
  `AssetCategory` names, with a **"Something else…"** row that reveals a write-in
  box.
- Changing department clears the category - categories belong to one department.
- `purchases/page.tsx` now loads `loadAssetCategoryOptions` and selects the
  category, quantity and photo columns for each asset. Assets are ordered by
  **name** rather than tag: that is how the picker is searched and scanned.
- `ReplaceableAsset` became **`PurchaseAsset`** - it is no longer only the
  replacement list.
- `.asset-option` / `.thumb-sm` in `globals.css` for the picker's rows.

**The one bug found on the way, and it was not new:** Escape inside a picker
closed the whole modal, losing a half-filled form. `Combobox` had it too. It
calls `stopPropagation`, which cannot work here - the App Router hydrates React
at `document`, so React's delegated listener and `Modal`'s own listener sit on
the same node. `Modal` now ignores an Escape that is already `defaultPrevented`,
which both pickers set. First Escape shuts the list, second closes the modal.

**Left alone on purpose:**

- **`PurchaseRequest.category` is still a `String`.** The dropdown is a UI
  affordance over free text, not a foreign key - see ARCHITECTURE. An older row
  filed under something that is not one of the department's categories keeps it:
  the list puts that value back so editing the quantity cannot silently rewrite
  what the thing is.
- **Picking an asset does not set `replacesAssetId`.** "Buy another one like
  this" is not "replace this one", and quietly linking them would change what a
  stored field means. The replacement select is unchanged.
- **`validation.ts` and the API are untouched.** Nothing about what may be sent
  changed.

**Verified** in a real browser against the running app, as an admin over all
three departments: each department offers only its own categories; Workshop's 4
assets narrow to the 2 under "Machine tool", then to 1 on typing; all four
photos load at their natural sizes; clicking a row fills the field and shuts the
list; "Something else…" reveals the write-in box and drops the category filter;
switching department resets the category to the placeholder and removes the
write-in box; Escape closes the list first and the modal second. Typecheck clean
and `next build` clean.

**Gotcha found here:** running `next build` while `next dev` is up overwrites
`.next` and leaves the dev server throwing `Cannot find module
'./vendor-chunks/…'` on routes it has not recompiled. `prisma generate` also
fails with `EPERM` on the query engine DLL while dev holds it. Stop `next dev`
before building.

### 2026-08-30 - Assets carry how many units they stand for

**Why:** Asked for: "to the assets we need to add a like count. 5 of this
things. 3 of this things. like a count column. and also that should in the
report as well." Identical equipment was being entered as one row with no way to
say there were five of it, or as five near-duplicate rows sharing nothing but a
name.

**What changed**

- **`Asset.quantity Int @default(1)`**, migration
  `20260830000000_asset_quantity`, applied with `migrate deploy` (not
  `migrate dev` — see the gotcha above). The default backfills every existing
  row with 1, which is exactly what those rows already meant, so `NOT NULL` is
  safe and nothing needed rewriting.
- **`quantity` in `assetCreateSchema`** — whole number, 1 to 9999, the same
  rule a purchase request's quantity already uses. `assetUpdateSchema` is its
  `.partial()`, so editing follows for free.
- **A "How many" field** on the asset form, paired in a row with Purchase cost.
- **A "Qty" column** on the Assets screen, after the asset name.
- **`× N units`** beside the tag on an asset's own page, shown only when N > 1.
- **A `quantity` column in the report's asset column set**, added to
  `DEFAULT_ASSET_COLUMNS` so it is in the Assets table of any new report, and
  available in the column picker for Needs attention too. Its floor is 34px —
  the same measurement the purchase table's Qty column uses.

**The decision worth knowing: `purchaseCost` is per *record*, not per unit.**
Nothing multiplies it, so "Recorded purchase value" and every asset count in the
app and in reports mean exactly what they meant yesterday — a count of records.
The cost field's hint now says so outright, because "5 chairs, $100" is
otherwise ambiguous. If the CEO would rather see units — "Assets tracked" summing
quantities, or a cost entered per unit — that is a deliberate change to what
those figures mean and it has not been made.

**Verified:** typecheck clean; `migrate deploy` applied and
`migrate diff --from-schema-datamodel --to-schema-datasource` reports an empty
migration, so the DB matches the schema. The width solver was re-run over the
new default column list (`npx tsx`): the Assets table fits portrait at 688px
and landscape at 1016px, the colgroup sums to exactly 100%, and no column sits
under its hard floor. A report rendered with a quantity of 5 prints the Qty
header and the figure. Not clicked through in the running app.

**One thing to do before the app picks this up:** `npx prisma generate` could
not replace `query_engine-windows.dll.node` — a running `next dev` has it
open (EPERM on the rename). The generated client itself *is* current: the
TypeScript types and the inline schema in `.prisma/client/index.js` both carry
`Asset.quantity`, and the engine binary is identical anyway since the Prisma
version did not change. **Restart `next dev`** so it loads the new client. If
anything looks stale, stop the dev server and run `npx prisma generate` once
with nothing holding the DLL.

### 2026-08-30 - Every fixed label on the report can be worded your own way

**Why:** Asked for: "in the preview area can we just make it like I can edit all
the texts and things." Only three pieces of text were editable - the title, the
opening note, and blocks someone added. Everything else was a string in
`template.ts`: the letterhead, "Executive summary", "Equipment requiring a
decision", the four figures on a group card, every column header, the closing
line. None of it is fact, and all of it is house phrasing somebody may disagree
with.

**What changed**

- **`textOverrides: Record<string, string>` on `ReportConfig`** (zod in
  `validation.ts`, defaults and a `textMap` normaliser in `reports/config.ts`).
  Text id -> what to print instead. Keys are capped at 80 chars, values at 400,
  the map at 300 entries; unknown ids are kept rather than dropped, like
  `hiddenBlocks` and `groupOrder`, because a section put back next month should
  come back worded as it was left.
- **`words()` and `say()` in `template.ts`.** `words` resolves a label to its
  override or its default; `say` wraps it in the element that carries it with
  the `data-btext` the canvas needs. 39 labels are typeable in a document with
  one group - every heading, the letterhead, the four KPI labels, the title
  block's `dt`s, the group-card figures, the closing line, and every column
  header.
- **Column headers** are keyed `col:<tableKey>:<columnKey>`, so the same column
  can read one way in Assets and another in Needs attention. Each one is in a
  span of its own inside the `th` - the canvas hangs a ✕ and a resize grip off
  that `th`, and typing over the header must not swallow either.
- **`data-bmain`** marks the one text the ✎ opens for a block. Without it the
  pen would land on a section's first column header rather than its heading.
- **`setBlockText` routes `field === 'label'`** into `textOverrides`. Emptying a
  label deletes the key, so the original wording comes back - the way out of a
  typo without having to retype what was there. The panel also offers "Put all
  the original wording back" once anything has been reworded.

**Invariant checked, and one guard added:** "a report table always fits the
page" rests on the hand-measured `hardPx` floors in `reports/columns.ts`, and
the note there says a header is part of that floor. A reworded header can be any
length. `table.data th` never actually carried `white-space: nowrap`, so a long
one wraps rather than overlapping; the only gap was a single unbroken word, so
`th` now has `overflow-wrap: break-word` to match `td`. The colgroup is untouched
either way - the header row gets taller, never wider.

**Still not editable, and deliberately:** anything carrying a figure or a record
- the KPI values and their notes ("across 2 departments"), group headings
(a department's own name), table cells, dates, the "Showing the first 25 of 40"
line. Typing over those would put words in the document that the data does not
support, and they would be overwritten on the next render anyway.

**Verified:** typecheck clean, `CANVAS_SCRIPT` parses, and the template was
rendered both ways against a fixture (`npx tsx`, with `server-only` stubbed):
39 typeable ids present in the preview; an override for a heading, the company
name and a column header all print in the PDF; the original heading is gone from
it; the company override follows through to the closing line; and the PDF
carries no `data-btext`, `data-bmain`, `data-b`, `data-col` or `data-row`. Not
yet clicked through in the running app.

### 2026-08-30 - The pen on the canvas bar now opens text for typing

**Why:** Reported: "when I click the pen icon nothing happens." It was accurate,
for two separate reasons.

1. **The pen only ever opened the side panel.** Typing on the page was wired to
   `dblclick` on a `[data-btext]` element and nothing else - undiscoverable, and
   not what a pencil icon promises.
2. **For several blocks that panel has no settings**, so its body rendered
   empty: every `part` id (`TITLE:scope`, `SUMMARY:kpi:*`, `MASTHEAD:right`,
   `group:<key>:header` …) and `ENDNOTE`. The heading changed, nothing else did.

**What changed**

- **`canvas.ts`: `startTyping(el)`** - the old `dblclick` body, lifted out and
  given a caret placed at the end of the text (the pen is nowhere near the words
  it opens, so the click position is no guide). `dblclick` now calls it, and so
  does the bar's ✎ via `textIn(el)`, which returns the block itself if it
  carries `data-btext` or the first one inside it. The `edit` message is still
  posted, so the panel opens behind for whatever else the block has.
- **`ReportBuilder.tsx`: `hasInspector` + `inspectorNote(id)`** - when the panel
  has no settings for a selection it now says what the block is and what can be
  done with it, instead of rendering an empty body.
- The panel's opening hint now describes what ✎ actually does.

**What the pen opens:** the report title, and any TEXT or HEADING block added to
the page. The opening note is `data-btext` too, but ✎ on the title block finds
the `<h1>` first - the note has its own field in the panel, and a double-click
still works on it.

**Still not editable anywhere, by design of the data:** the masthead company
name and tagline (`COMPANY_NAME` / `COMPANY_TAGLINE` in the environment, via
`appConfig.branding`, not per report), the "End of report ·" line, and the
section headings. `inspectorNote` now says so for the closing line rather than
leaving the panel blank. Making any of them per-report means new `ReportConfig`
fields, zod rules and a `settext` branch.

**Verified:** typecheck clean, and `CANVAS_SCRIPT` parses (`new Function` over
the extracted literal - tsc does not look inside a template string, so a syntax
error in there would otherwise only show up in the browser). Not yet clicked
through in the running app.

### 2026-08-30 - "Purchase planning" is now "Purchase needs"

**Why:** Reported. The screen called itself three things at once. The nav link
and the `<h1>` said *Purchase planning*, the buttons said *Flag a purchase
need*, and the filter and empty states said *requests* - and the dashboard card
for the same records was headed *Purchase requests pending* above an empty state
reading *No purchase needs are currently flagged*. One name, "purchase need",
matching the verb the page already uses.

**What changed** - user-visible copy only:

- `NavLinks.tsx`, `purchases/page.tsx` `<h1>`, and the button on the department
  page all say **Purchase needs**.
- `PurchaseManager.tsx`: "All requests" → "All needs", "No requests with that
  status." → "No needs with that status.", the replacement-asset hint, "Review
  purchase request" → "Review purchase need", and the delete dialog's title and
  confirm label.
- The dashboard's stat note and its "Purchase requests pending" heading.

**Not touched, on purpose:**

- **Everything internal.** The `PurchaseRequest` model, `/api/purchase-requests`,
  the `PurchaseRow` type and the `requests` props keep their names. This was a
  wording change; renaming the model would be a migration and a wide refactor
  for no reader's benefit.
- **The report and the PDF.** `reports/template.ts`, `config.ts` and
  `columns.ts` still print "Purchase requests" (the section label) alongside
  "Flagged purchase needs" (the group heading). That document is the CEO's, its
  register is its own, and changing a section label changes saved layouts that
  refer to it. Worth settling separately if the same mismatch bothers anyone
  there.
- **Copy about what a department owns** - `departments/page.tsx`,
  `departments/new/page.tsx`, `DepartmentManager.tsx`, `UserManager.tsx` still
  say "purchase requests" when describing records generically.

**Verified:** typecheck clean. No "Purchase planning" left anywhere in `src/`.
Not clicked through in the running app - it is copy only, and every string was
replaced with a uniqueness check rather than a blanket find-and-replace.

### 2026-08-30 - The canvas bar stays on the block you picked

**Why:** Reported. Clicking a block on the report canvas put the little blue bar
above it, and then reaching for its ✎ or ✕ made the bar dart off to another
block. The bar hangs 4px above its block, so the pointer's route to it leaves
the block and crosses whatever is behind - and `target()` read
`state.hot || state.sel`, so that stray crossing re-aimed the bar mid-reach. The
whole toolbar was a moving target.

**What changed** - all in `src/lib/reports/canvas.ts`:

- **`target()` now reads `state.sel || state.hot`.** A block that has been
  clicked owns the bar until something else is clicked. Hovering elsewhere still
  draws the dashed outline that says "a click picks this up", but it no longer
  takes the bar with it. The behaviour change worth knowing: with a selection
  live, ✎ / ✕ / ↑ / ↓ / drag act on the *selected* block, not the hovered one -
  the bar's own label names which that is, so what the buttons will hit is on
  screen.
- **A hover buffer around the bar.** `atBar(e)` ignores `mousemove` while the
  pointer is within 8px of the bar, and `#rc-bar::after` extends the bar's hit
  area over the gap down to its block. Nothing selected, hover-only, the bar is
  reachable now too - which it was not before.
- **Esc lets go of the selection** from inside the canvas (the keyboard is in
  that document once anything in there has been clicked, so the builder's own
  listener never sees it). It posts the usual `select` with a null id, so the
  side panel closes with it.
- **The bar's buttons went from 20×18 to 22×20**, gap 2px → 3px. The preview is
  scaled by the zoom control, so at 50% those buttons were ~9px on screen.

The hint in `ReportBuilder.tsx` now says the bar stays put and that Esc lets go.

**Unchanged:** none of this reaches the PDF. `CANVAS_STYLES` / `CANVAS_SCRIPT`
are only injected when `renderReportHtml` is asked for an editable preview, and
Puppeteer never asks.

**Verified:** typecheck clean. Not yet exercised in the running app - the thing
to try is: click a block, reach for ✕, confirm the bar holds still; then hover a
different block and confirm the bar stays on the selection while the dashed
outline follows the pointer; then Esc.

### 2026-08-27 - Money shows its cents

**Why:** Reported. Every figure on screen and in the PDF was rounded to whole
units, so a recorded value of 234,650.80 read as "$234,651" - and the totals
never quite added up from the rows above them. Costs are entered to the cent
(both inputs are `step="0.01"`) and stored as `Decimal(12, 2)`, so the rounding
was purely a display decision, and the wrong one for a document about money.

**What changed**

- **`formatMoney` now prints two decimal places** (`min`/`maxFractionDigits: 2`),
  which is the full precision the database holds. That one function is the only
  place money is formatted - the asset page, the asset table, the dashboard and
  department tiles, the purchases screen and its totals, and every figure in the
  report and the PDF all went with it, unchanged.
- **`formatMoneyPrecise` is gone.** It did exactly this and nothing called it.
- **The money columns in the report got wider hard floors.** All three are
  `nowrap`, so a figure wider than its column does not wrap - it draws over the
  next one, which is the 2026-08-25 bug. Three characters of cents is enough to
  reach it. Measured at 8pt tabular with the cell's 7px padding either side:

  | Column | Was | Now | Sized for |
  | --- | --- | --- | --- |
  | Cost (assets) | 62 | 80 | `$9,999,999.99` at 79px |
  | Unit est. | 76 | 80 | same |
  | Line total | 76 | 88 | `$29,999,999.97` at 87px |

  Line total is the odd one out because it is the only money column holding
  arithmetic - a unit cost times a quantity - and the tfoot "Estimated total"
  under it sums the whole column, so it is always the widest figure in the
  table. Past those ceilings a figure would overlap again; re-measure rather
  than guessing a bigger number.

**Verified** on 2026-08-27 with a throwaway probe, the same method as the
2026-08-25 one: render the real `renderReportHtml` output, `emulateMediaType`
`print`, then lay a `Range` over every cell and compare its box with the
column's content box. Fed a hand-built `ReportData` rather than going through
the running app - no session and no database needed, only the `server-only`
stub - carrying costs of `null`, 0.05, 12,500, 145,000, 999,999.99, 1,234,567.89
and 9,999,999.99, each also multiplied by a quantity of 3 for the line totals.
Four passes: portrait and landscape, default columns and every column. **148
cells and 8 stat tiles clear portrait, 224 clear landscape**, and the first run
caught the line-total overflow the table above records. Portrait-with-every-column
renders no table at all - the solver refuses that combination on hard floors
alone, as it did before this work. `npm run typecheck` is clean.

Two things left alone on purpose: `formatBytes` still rounds a video size (a
size is not money), and the status bar in the report still rounds its
percentages to one place so the segments sum to 100.

**Known gaps**

- `optionalMoney` in `validation.ts` accepts any number of decimal places and
  Postgres rounds to two on the way in, so typing 12.345 silently stores 12.35.
  That predates this work and nobody has complained; rejecting it would be a
  one-line `refine`.
- The measured ceilings above are per column, not enforced anywhere. A cost past
  them is accepted by validation (which allows up to 9,999,999,999) and would
  overlap in the PDF.

### 2026-08-27 - The report page became a canvas

**Why:** Asked for. The builder edited a report through a rail of controls
beside a preview, which meant looking at one thing while changing another. The
ask was to work on the page itself - every part with an ✕ to take it off and a
✎ to open it, dragged into place by hand - with the tools along the top instead
of down the side. And: assets ticked on the Assets screen should stop printing
one department per page.

**What it does now**

- **The preview is the editor.** Hovering any block on the page raises a bar
  over it: **⠿** drag it somewhere else, **✎** open it in the panel, **↑ ↓**
  nudge it, **✕** take it off. Dragging draws an insertion line and drops the
  block between two others.
- **Everything is a block**, including the parts that used to be fixed
  furniture: the letterhead, the title block, the closing line, the whole run of
  groups, each group, each group's heading, its four figures, its condition bar
  and each of its tables, and each summary tile. Any of them can go, and come
  back from **Add → Taken off**.
- **Tables are edited where they are.** The ✕ on a column header drops that
  column; the join between two headers drags width from one to the other; the ✕
  at the end of a row leaves that row out of this run.
- **Type straight onto the page.** Double-click the title, the opening note, or
  anything added, and type. Escape cancels, clicking away commits.
- **Blocks can be added**: a heading, a note, a rule, a gap, a forced page
  break. They land under whatever is selected and are dragged like everything
  else.
- **A tool bar across the top** replaces the control rail - Report (saved
  setups, save, reset), undo/redo, Add, Blocks, Data, Grouping, Rows, Page,
  zoom, an Editing/Clean-view switch, and Generate PDF. Every control that was
  in the rail is still there, in a panel that closes when it is not being used.
- **Undo and redo** over the whole setup, Ctrl+Z and Ctrl+Shift+Z.
- **A picked selection no longer breaks the page per department.** Arriving from
  "Report on these" opens with *Start each department on a new page* off, so
  three machines print as one run rather than three pages. It is the same
  checkbox as before, and still saved with the report.

**How it is built**

The handles live *inside* the preview iframe, in the new
`src/lib/reports/canvas.ts` - a string of plain browser JavaScript injected into
the document only when the builder asked for an editable preview. Measuring
every block from the parent and keeping it in step through each scroll, resize
and re-render is a second layout engine; inside the document,
`getBoundingClientRect` is simply the truth.

The iframe is now `sandbox="allow-scripts"` rather than `sandbox=""`. That is
still an opaque origin - the script cannot read this page, its cookies or its
storage - and the only thing it can do is post a message, which `ReportBuilder`
treats like a URL parameter: every id is checked against the setup it already
holds before it is acted on. Switching to **Clean view** puts `sandbox=""` back
and renders the document with no script at all.

**The page is one flat list of ids.** `config.layout` names every block in the
order it prints; `config.blocks` holds the ones somebody added;
`config.hiddenBlocks` the ones taken off; `config.groupOrder` the order the
departments were dragged into. All four are part of a saved report, because they
are decisions about the document rather than about the data. `normalizeReportConfig`
reconciles them the way it already reconciled sections - one entry per thing that
exists, nothing that does not, never throwing.

The three per-group sections sit in that list too, but never render at the top
level: they repeat inside every group, and their place in the list is only their
order relative to each other. `GROUPS` is where the run of groups itself lands,
which is what lets it be dragged above the summary or taken off entirely.

**Deliberate calls**

- **The PDF is untouched.** The handles and the script are written only when
  `meta.editable`, and `buildReportData` only sets that for a preview. A probe
  strips the attributes off an editable preview and compares it with a clean
  one: they are the same document apart from one unstyled wrapper around the run
  of groups, which exists so the whole run can be grabbed as one block.
- **Blocks stay in the flow rather than floating.** Free positioning would look
  like more freedom and print as a mess: this is a paginated document whose
  tables grow with the data, and a box pinned at 300px down page 2 means nothing
  once a department gains four machines. Everything is dragged, resized and
  deleted directly on the page; where it lands is a position in the document,
  not a coordinate.
- **The canvas forwards Ctrl+Z.** Once anything in the preview has been clicked
  the keyboard belongs to *that* document and the builder's own listener never
  sees the shortcut - undo would quietly stop working halfway through laying a
  page out. Delete is forwarded the same way and removes the selected block.
- **Undo collapses a run of typing.** A merge key on `commit` means a title
  typed letter by letter is one step back, not thirty.
- **Removing is two different things, on purpose.** A section is switched off -
  the state it has always had, and what stops its data being queried at all.
  Everything else goes into `hiddenBlocks`. A block someone added is deleted
  outright, because they added it.
- **Scroll position and selection survive the re-render.** Every edit rebuilds
  the document, so the canvas hands the parent its scroll offset and gets it
  back on load. Without it the page jumps to the top on every keystroke.

**Verified** on 2026-08-27 against `npm run dev` with two throwaway probes:

- **The document** - 13 checks through `/api/reports/preview`: a clean preview
  carries no editor and an editable one is the same document underneath; the
  page breaks disappear when the checkbox is off; hidden parts, hidden groups
  and added blocks all render as asked; the flow follows the layout and the
  groups follow `groupOrder`; every colgroup still sums to exactly 100 with
  hand-dragged widths; a setup saved before any of this still opens; and a
  layout full of rubbish ids still produces a document.
- **The screen** - 18 checks driving Chrome: the handles appear on all six
  top-level blocks and all three groups; hovering shows the bar; clicking opens
  the panel; ✕ removes and Ctrl+Z from inside the canvas puts it back; ↑ and a
  real pointer drag both move a block; the column ✕ drops that column from all
  three tables at once; dragging a join changes the widths and every row still
  totals 100; the row ✕ takes the row out; a heading added from the tool bar
  lands on the page and can be typed into in place; Clean view drops the chrome
  entirely. No page errors beyond the pre-existing `/favicon.ico` 404.
- **Saved reports** - a hand-laid-out page saves, comes back byte-identical, and
  renders the way it was left.
- **PDFs** - the default report is still 4 pages; three assets picked across
  three departments went from 4 pages to 3 with the breaks off; an added page
  break adds a page.

`npm run typecheck` is clean. The throwaway admin, its session and its saved
report were deleted afterwards - 2 users, 11 assets, 0 saved reports, 8
locations, as before.

**Known gaps**

- Blocks cannot be positioned freely on the sheet; see the deliberate call
  above. Nobody has asked for it and this document could not keep it.
- No images on the page - the only pictures are the asset photos in a table
  column. An image block would be a new block type plus somewhere to put the
  file.
- The four summary tiles can be removed but not reordered or reworded.
- Group order is per saved report, like column widths, not per person.
- A group taken off is remembered by its department id, so removing a group and
  then renaming that department still keeps it off. That is right, but a
  department that is deleted leaves a dead id in `hiddenBlocks`; it is harmless
  and kept deliberately, because ids come and go with the data.
- `next build` still has not been re-run - `next dev` was left running, and the
  two must never share `.next`.

### 2026-08-26 - Ticking assets on the Assets screen to report on them

**Why:** Asked for. The builder could already tick individual rows off, but only
once you were in it and only by unticking from everything that matched. The
natural way round is the other one: find the machines on the Assets screen -
where the filters, the search and the photos already are - tick them, and go
straight to a report about those.

**What changed**

- **A tick column on the assets table**, with a header tick that covers what is
  on screen (half-ticked when only some of it is), and a strip above the table:
  *N assets selected · Clear · Report on these*.
- The selection is **ids, not rows**, so it survives filtering. Tick two in
  Workshop, filter to IT, tick two more, and all four are still selected - the
  strip says how many are outside the current filter so the count never looks
  wrong.
- **"Report on these"** hands the ids to `/reports` through sessionStorage, the
  same one-shot `stashDraft`/`takeDraft` the add-asset form uses. Not the URL:
  two hundred cuids do not belong in a link, and a selection should not outlive
  the tab. The builder consumes it, so a later visit to `/reports` is clean.
- **`includeAssetIds` on the report request** - empty means no restriction, and
  non-empty means these assets and no others. It sits next to the exclusions and
  outside the setup, for the same reason: it names specific equipment, and a
  saved report has to outlive it.
- The builder shows a card saying where the assets came from, with **"Report on
  everything instead"** to drop the restriction.

**A picked set scopes the whole document, not just the asset table.** The first
version only filtered assets, and picking three IT assets produced a report with
a Printing section and a Workshop section - empty of equipment, but each still
carrying that department's purchase requests. Reading it, it looks like a bug.
So when a selection is active: empty department groups are not seeded, purchase
requests are narrowed to the departments the picked assets are actually in, and
the scope line reads "3 selected assets · IT" rather than "All departments".
Requests for *that* department still appear - they are the department's, not the
machine's - and the card on screen says so.

**The department scope is unaffected.** `includeAssetIds` narrows on top of the
existing `where`, it does not replace it, so a department head sending another
department's asset id gets an empty report rather than someone else's equipment.

**Verified** on 2026-08-26 with a throwaway probe: the strip counts correctly;
the selection survives a status filter and says how many are out of view; the
header tick selects all 11 and clears them again; "Report on these" lands on the
builder with the card showing 3; the asset tables in the document hold exactly
those three and no other; only one section is produced rather than three;
clearing widens it back to all 13 tags; a second visit to `/reports?from=selection`
finds nothing left to consume; and a throwaway department head sending an IT
asset id gets `assetCount: 0`. No page errors. A plain report is byte-for-byte
the same shape as before - 11 assets, 3 groups, 4 requests, 4 pages.
`npm run typecheck` is clean.

### 2026-08-26 - Reports became a builder

**Why:** Asked for. The reports page was a fixed form: one department or all of
them, three sections you could switch off, and a status filter. Everything else
about the document - what it covered, how it was broken up, which columns each
table had, what order the sections came in - was decided in the code. The ask
was a page where any of that can be arranged on screen, seen before it prints,
and kept for next time.

**What it does now**

- **Scope is multi-select.** Departments, locations (including *No location
  set*), categories and conditions are tick lists, plus a free-text search over
  name, tag, serial, notes, category and location. Empty means "no filter"
  everywhere, the same convention the old `statuses` had.
- **Grouped by whatever you choose** - department, location, category, condition
  or nothing. Every group carries its own stats, condition bar, asset table,
  requests and repairs.
- **Sections are dragged.** The five sections (summary, needs attention, assets,
  requests, repairs) reorder by drag or by the up/down buttons beside each, and
  switch off individually. The document renders them in that order; the per-group
  ones appear where the first of them falls.
- **Columns are chosen and dragged.** Each table's columns come from a registry -
  12 for assets, 13 for requests, 8 for repairs - reorder by dragging the chips,
  and width moves between neighbours by dragging the dividers on the width bar.
- **Rows are ticked off individually.** Everything that matched is listed, and
  unticking one keeps it out of this run. Unticking an asset takes its repairs
  with it, because a report listing a repair to a machine it does not contain
  reads as a mistake.
- **Live preview.** The right-hand pane is the real document, rendered by the
  real template through `POST /api/reports/preview`, debounced at 320ms.
- **Saved reports** are rows in the database, shared with everyone.

**New files**

| File | Owns |
| --- | --- |
| `src/lib/reports/columns.ts` | Every selectable column, its measured widths, and `solveColumnWidths`. No `server-only` - the browser draws the picker from it |
| `src/lib/reports/config.ts` | The setup's shape, defaults, and `normalizeReportConfig` |
| `src/app/api/reports/preview/route.ts` | The same document as HTML, plus the candidate rows |
| `src/app/api/report-presets/` | Saved reports: list, create, edit, delete |

**The width arithmetic is the load-bearing part.** `table-layout: fixed` does
not grow a column to fit, so a cell wider than its column draws over the next
one - the bug the 2026-08-25 work fixed by measuring seven tables by hand and
writing the percentages into each colgroup. Those numbers cannot be written down
any more, so every column carries what it needs instead:

- **`hardPx`** - below this the column *overlaps*. The solver never goes under
  it, and refuses the whole combination if the floors do not fit.
- **`softPx`** - the widest unbreakable word. Below this a wrapping cell splits
  mid-word; a strong preference, given up proportionally and reported as a tight
  fit.

`solveColumnWidths` turns those into integer percentages **summing to exactly
100**, which is the invariant the template always had. Hand-dragged widths are
clamped up to the hard floor and renormalised, so no amount of dragging can
produce an overlapping table.

**A header is a hard floor, and that is not obvious.** The first probe run had
six overflowing cells, all of them *headers*: "Department", "Category",
"Location" and "Asset" in a squeezed 12-column table. A `td` carries
`word-wrap: break-word` and a `th` does not, so a header neither wraps nor
breaks - it just runs over its neighbour. Every text column's `hardPx` is now the
width of its own header where that is wider than its content: Department 82,
Justification 89, Purchased 77, Category 66.

**Landscape exists because those floors are real.** Twelve asset columns need
746px and a portrait page has 688. Rather than refuse, the page can be turned:
landscape gives 1016px and the whole set fits. `pdf.ts` passes `landscape` to
`page.pdf()`, and the preview sheet resizes with it.

**Deliberate calls**

- **The default setup is the old report, exactly.** Same sections, same columns,
  same order, same 4 pages. Nobody has to rebuild what they already had. The one
  difference: "Needs attention" now appears in a single-department report too,
  where it used to be company-wide only. It can be switched off.
- **Row picks are not saved into a report.** They name specific asset ids, which
  go stale as equipment is replaced. The filters, grouping, sections and columns
  are what get saved.
- **Saved reports are shared and anyone may create one**, but only its author or
  an admin may change it. A department head who has worked out how they want
  their own equipment listed should be able to keep it; a shared list only stays
  useful if not everyone can rewrite everyone else's.
- **A shared setup is narrowed in the browser, not on the server.** The API still
  refuses a department the caller cannot see - the old rule, unchanged - and the
  builder simply never sends one, so a department head opening the company-wide
  report gets their own equipment and a note saying so.
- **Requests are listed once when grouping by anything but department.** A
  purchase request describes equipment that does not exist yet, so it has no
  shed, no category record and no condition to be grouped by.
- **"Start each section on a new page" is a checkbox, defaulting on.** Right for
  departments; grouping by location made 9 small groups and turned a 4-page
  report into 11.
- **The preview iframe is `sandbox=""`** - no scripts, no same-origin. Report HTML
  is built from user-entered data and should never be able to reach the page
  around it.
- **The setup is one JSON column, not thirty.** It is read and written whole, its
  shape will keep moving, and `normalizeReportConfig` is what makes an older one
  safe to open: it never throws, fills in what is missing, drops what it does not
  recognise, and says what it changed.

**Verified** on 2026-08-26 against `npm run dev`, with three throwaway probes
driving Chrome through the bundled Puppeteer:

- **Widths.** 12 setups rendered and every cell in every table measured with a
  `Range` against its column box - the default in all five groupings, all 12
  asset columns (refused in portrait, fits landscape), all 13 request columns
  landscape, all 8 repair columns, two columns, one column, and a set with absurd
  hand-dragged widths (2%/80%/2%/2%). **0 overflowing cells, 0 words wider than
  their column, every colgroup summing to exactly 100.**
- **The screen.** Preview renders; ticking a department narrows it; sections
  reorder by button and by real HTML5 drag; switching one off removes it from the
  document; adding a column puts it in the table; dragging a divider moves width
  between two columns and the row still totals 100; landscape widens the sheet;
  unticking a row takes it out; saving puts it in the shared list, it survives a
  reload, and reopening restores the section order. No page errors, and the only
  failing request on the page is the `/favicon.ico` 404 that was already there.
- **The boundary.** A throwaway department head sees only their own department in
  the picker and in the document; opening a company-wide saved report narrows it
  and says so; `POST /api/reports` and `/api/reports/preview` naming another
  department both 403; they may save their own report but not edit someone
  else's.

`npm run typecheck` is clean. The probes, a temporary repair record and the
throwaway user and presets were all deleted afterwards - 11 assets, 0 repairs,
2 users, 8 locations, 0 saved reports, as before.

**If a column is ever added or a label changed, re-measure.** The probe was about
200 lines: sign in with Puppeteer, `fetch('/api/reports/preview')` from inside
the page for each setup, `page.setContent(html)`, `emulateMediaType('print')`,
then lay a `Range` over every cell and compare its box with the cell's content
box. Going through the running app avoids the two traps the last harness hit -
no `server-only` to stub, and the probe is passed as source text because a
compiled `page.evaluate` callback references a `__name` helper the page does not
have. The preview sheet is deliberately the exact content box the PDF has, so
measuring the preview measures the paper.

Two things that cost time and would again:

- **A drag handle's listeners belong on the window.** The first version put
  `pointermove` on the divider with `setPointerCapture`. The first move
  re-renders the editor, capture stops delivering, and the divider moves 1% and
  goes dead - which a probe reported as a *pass*, because an unrelated re-solve
  had changed the numbers it was comparing.
- **A sandboxed iframe cannot be read from the parent.** `contentDocument` is
  null with `sandbox=""`. Read the `srcdoc` attribute instead.

**Known gaps**

- No CSV or Excel; PDF only, as asked.
- The section list is fixed at five. A "chart only" or "photo grid" section would
  be a new section key plus its renderer and nothing else - the machinery takes
  it.
- Column widths are per saved report, not per person.
- Assets are picked on the Assets screen or unticked in the builder; there is no
  way to pick a *purchase request* or a *repair* from its own screen the same
  way. Neither has been asked for.
- Grouping is one level deep. Department *then* location would need a group to
  become a tree.
- `next build` still has not been re-run - `next dev` was left running, and the
  two must never share `.next`.

### 2026-08-25 — PDF: tags stopped running under the asset name

**Why:** Reported. In the generated PDF the asset tag sat on top of the asset
name. Measuring the tables turned up the same fault in three more places.

**What was wrong.** `table.data` is `table-layout: fixed`, so a `nowrap` cell
whose text is wider than its column does not shrink or wrap - it just draws over
the next column. At A4 with 14mm margins the usable width is **688px**, and four
columns were narrower than their own contents:

| Column | Had | Needed |
| --- | --- | --- |
| Tag (asset tables) | 50px | 53px, and 76px for a `WRK-NUT-001` style tag |
| Purchased | 64px | 74-77px - this is why the headers read "PURCHASED COST" |
| Fixes | 36px | 41px, so the header was clipped at the page edge |
| Type / Priority (purchases) | 69px / 62px | 81px / 63px |

Cost was the opposite: 78px for a longest figure of 57px.

**What changed** — `src/lib/reports/template.ts` only.

- **Tags wrap now.** The three tag cells went from `mono nowrap` to
  `mono tag-cell`, and `.tag-cell` sets `white-space: normal`. Tags break at
  their own hyphens, so `WRK-NUT-001` stacks as `WRK-` / `NUT-001` instead of
  demanding a column wide enough for it in one line. Short legacy tags
  (`IT-002`) still fit on one line and do not wrap.
- **Every colgroup rebalanced from measurements, and each now sums to exactly
  100** (the asset table summed to 97 and let the renderer improvise the rest).
  The room came from Cost and from the two text columns that wrap anyway.
- Two constraints are written into the comments because they are easy to undo by
  accident: **Status cannot go below 17%** ("Needs replacement" is a nowrap pill
  needing 113px; 16% is 110px), and **Category cannot go below 11%** - at 10% the
  column is narrower than the word "Workstation", and `td` carries
  `word-wrap: break-word`, so it splits mid-word as "Workstatio / n". That was a
  regression this work introduced and then backed out.
- The purchase table got the same treatment: Type 10→12%, Priority 9→10%, both
  taken from "Requested item" (33→30%), which wraps.

**Verified** on 2026-08-25. A harness rendered the real report HTML at exactly
688px in Chrome under `print` media - the same content box `page.pdf()` produces -
and laid a `Range` over every cell in all 7 tables to compare the text's own box
with its column box. **Before:** 6 cells overflowing. **After:** none, in two
passes - once with the live tags, once with every tag rewritten to the long
`WRK-NUT-001` / `PRT-PRESS-014` form. The same probe checks for words wider than
their column (the mid-word break above); the only one left is a 29-character
`sdfsdfsdf…` string in a real asset note, which no column could hold. A real
company-wide PDF was generated through `POST /api/reports` afterwards: 4 pages,
same as before. `npm run typecheck` is clean.

The harness was a throwaway. Two things worth knowing if it is rebuilt:
`reports/data.ts` imports `server-only`, which throws outside Next (stub it via
`Module._load`), and `tsx` compiles `page.evaluate` callbacks with a `__name`
helper that does not exist in the page - pass the probe as source text instead.

### 2026-08-25 — Asset photos enlarge on hover and open full screen

**Why:** Asked for. A 50px square is enough to tell a row has a photo and not
enough to tell what the machine is.

**What changed**

- New **`src/components/PhotoThumb.tsx`**, used by the photo column of the
  assets table. It owns the whole behaviour: the thumbnail, the hover preview
  and the full-screen view. `AssetManager` just passes `src` and `name`.
- Hovering a thumbnail opens a 320px preview card after 130ms. It is
  **portalled to `<body>` and positioned in viewport coordinates** - it has to
  be, because `.table-wrap` scrolls horizontally and would otherwise clip it.
  The card is placed beside the row, flips to the left of the thumbnail near the
  right edge, and is clamped against **its full height** (image + 8px padding
  twice + the 26px caption, `CHROME` in the file) so the bottom rows do not hang
  off the screen. `.photo-pop-name` has a fixed height in CSS because that
  arithmetic depends on it.
- The card stays open while the pointer is on it, which is what makes the
  **Full screen** button in the image's bottom-left corner reachable. Leaving
  either the thumbnail or the card closes it after 140ms. Scrolling, resizing
  and Escape dismiss it outright rather than letting it sit at a stale position.
- **Full screen** is a `.lightbox` overlay - the photo on a near-black backdrop,
  the asset name underneath, closed by Escape, the ✕, or a click on the
  backdrop. Not the browser Fullscreen API: an overlay needs no permission and
  cannot be blocked. It sits at `z-index: 200`, above the modal backdrop's 100.
- The photo **fills the window** rather than sitting at its natural size. Uploads
  are capped at 640px on the long edge by `downscaleImage`, so this is an
  upscale and looks slightly soft - deliberate, since the question being asked is
  "which machine is this". No drop shadow on it: `object-fit: contain`
  letterboxes the box, and a shadow would outline empty space.
- The thumbnail is now a `<button>`: hover reaches nobody on a keyboard or a
  touchscreen, so focus opens the card and Enter/tap opens the photo full
  screen. Assets with no photo keep the plain letter tile and are not
  interactive.
- New `expand` icon in `icons.tsx`. That file's header said "for the sidebar";
  it now says most of them are.

**Verified** on 2026-08-25 in Chrome via the bundled Puppeteer, signed in as an
admin: all 11 rows hovered at 1400x900 and the card landed inside the window
every time; it survives the pointer moving onto it; **Full screen** opens the
overlay (image 1320x820 in a 1400x900 window), Escape and a backdrop click both
close it and unlock body scroll; scrolling dismisses a card (checked by name, not
just presence - a fresh card opens for whatever row slides under the pointer,
which is correct); at 420x620 the card flips left and stays inside; focus opens
the card and Enter opens full screen; an asset created without a photo showed the
letter tile and no hover card. No page errors. `npm run typecheck` is clean. The
photoless test asset and the throwaway admin were deleted afterwards - 2 users,
11 assets, 8 locations, as before.

Only the assets table uses this. The asset detail page still shows its photo
plainly.

### 2026-08-25 — "Create location" in the asset form opens a panel

**Why:** The create row was reachable with nothing typed into the location
picker, and clicking it then did nothing at all - `createLocation` took the
typed text as its argument and returned early on an empty string. From the
outside that is a dead button, which is what was reported: departments and
categories both give you somewhere to type, and locations did not.

**What changed** — `src/components/AssetManager.tsx` only.

- "+ Create location" now opens an `inline-panel` under the location row,
  prefilled with whatever was typed into the picker (empty is fine, you just
  type it in the panel). Same shape as the new-category panel above it:
  Name, hint, **Create location** / **Cancel**. Enter inside the panel creates
  the location rather than submitting the asset.
- Errors moved from the location `Field` into the panel, so a rejected name is
  still on screen to fix. The one that matters is the case-insensitive
  duplicate - "A location with that name already exists."
- On success the panel closes, the new location is selected in the picker and
  usable before `router.refresh()` has caught up (`addedLocations`, unchanged).
- Permissions are untouched: the row still only renders for an admin
  (`canCreateLocation`), and `POST /api/locations` still calls `requireAdmin`.
  A department head sees the picker and the "managed by an administrator" hint,
  as before.

**Verified** on 2026-08-25 against `npm run dev`, driving Chrome with the
bundled Puppeteer as an admin: clicking the row with an empty query opens the
panel (previously nothing happened); clicking it after typing prefills the name;
saving closes the panel, selects the location and shows "Clear location";
re-submitting the same name in different case keeps the panel open with the
duplicate error and the text intact. `npm run typecheck` is clean. The test
location and the throwaway admin used to sign in were deleted afterwards - the
DB is back to 8 locations and 2 users.

`next build` still has not been re-run (`next dev` was left running).

### 2026-08-22 — Reports carry no logo

**Why:** Asked for. The company name is the identity on the document now.

**What changed**

- The masthead prints the company name and tagline only. Both logo forms are
  gone: the `<img>` **and** the coloured two-letter badge that stood in when no
  image file was found. Removing only the image would have swapped one mark for
  another, which is not what "remove the logo" means.
- `loadLogoDataUri`, its cache and `ReportData.meta.logoDataUri` are deleted,
  along with the `.logo` / `.logo-fallback` CSS and the now-unused `node:fs` and
  `node:path` imports in `reports/data.ts`.
- **`COMPANY_LOGO_PATH` is no longer read**, and is gone from `config.branding`.
  A setting that silently does nothing is worse than no setting. The variable may
  still be sitting in `.env` - it is inert, and safe to delete when convenient.
- `public/branding/logo.png` was **left on disk**. Nothing references it, but
  deleting a file that was not asked about is not this change's job.

**Verified:** a company-wide PDF renders (4 pages) and the masthead was looked at
in Chrome - name and tagline left, "Internal report" and the date right, rule
underneath intact, no gap where the mark used to be.

### 2026-08-22 — Locations became real records

**Why:** `Asset.location` was free text, so nothing could be counted or filtered
by where a machine actually stands, and the same place drifted into several
spellings. The live data had one "warehouse 3" holding both an IT phone and a
Workshop part - which is also the argument for the shape below.

**What changed**

- New `Location` model. **Site-wide, not owned by a department** - the opposite
  call to `AssetCategory`, and the important one: a shed is one shed whoever's
  machine is in it. `Asset.location` (text) → `Asset.locationId` (relation,
  **nullable**).
- Migration `20260822000000_locations` backfills one Location per distinct
  free-text value before dropping the column, grouping case-insensitively and
  keeping the spelling used on the most assets. It raises rather than dropping
  the column if any asset would be orphaned. On this database: 8 locations, 10
  of 11 assets carried over, nothing lost.
- Migration `20260822000100_location_name_case_insensitive` adds a unique index
  on `lower(name)`. Found the hard way - the plain `@unique` happily accepted
  "bay 7" next to "Bay 7", which is the exact duplicate the table exists to
  prevent. Prisma cannot model an expression index, so it lives only in SQL;
  `migrate diff` still reports "empty migration", so it does not read as drift.
- New **Locations** tab (`/locations`), admin only. One flat table with an asset
  count and a "what is stored here" department breakdown per row.
- New API: `/api/locations` and `/api/locations/[id]`. Writes are `requireAdmin`;
  the GET is open to everyone, with the asset count narrowed to the caller's own
  department so the number matches what they would find in the assets table.
- Asset form: Location is now a `Combobox` instead of a text input, with a
  "+ Create location" row for admins that saves the typed name outright (no
  panel - a location is only a name). Plus a "Clear location" button, since the
  field is optional and a combobox cannot be emptied by deleting text.
- Assets table: a Location filter (including **"No location set"**, which is how
  you find unplaced machines), the location cell links to `?locationId=`, and
  free-text search still matches on location name.

**Deliberate calls**

- Site-wide rather than per department. Two departments saying "warehouse 3" do
  mean the same warehouse - unlike categories, where they would not mean the
  same group.
- Admin-only to write, unlike categories. A shared list is only worth having if
  one person curates it; a department head can still *pick* any location.
- The tab is hidden from department heads rather than shown read-only. They
  reach the same information by filtering the assets table by location.
- `locationId` is nullable and no location is invented for assets that never had
  one. The Air Compressor still has no place recorded, exactly as before.
- Renaming a location updates every asset showing it - the point of the table.
  Unlike a category code, a location name is not stamped into any asset tag, so
  there is nothing to keep stable.

**Known gaps**

- No bulk move: reassigning many assets to a different location is one asset at
  a time through the asset form, and deleting a location with assets is refused
  rather than offering to move them. Same shape as the category gap below.
- `Department.location` is still free text and unrelated to this table. It
  describes where a department sits, not where an asset stands; left alone.
- A location has no code, no parent and no capacity. If bays inside a shed ever
  need to nest, that is a new field, not a rename of this one.

### 2026-08-13 — Asset categories became real records

**Why:** `Asset.category` was free text, so the same group was spelled three ways
in one department, and asset tags could only be numbered per department
(`PRT-001`) — the label on a machine did not say what the machine was.

**What changed**

- New `AssetCategory` model, owned by a department, `name` and `code` unique per
  department. `Asset.category` (text) → `Asset.categoryId` (relation).
- Migration `20260813000000_asset_categories` backfills one category per distinct
  (department, category text) pair before dropping the old column, so nothing was
  lost. Codes were derived from the first three alphanumerics of the name.
- **Asset tags are now `DEPT-CAT-###`** (`WRK-NUT-004`). `nextAssetTag` takes a
  category, not a department. Existing `PRT-001`-style tags were left alone.
- Add-asset form: category and department are now `Combobox`es with type-ahead
  and a "+ Create …" row; a new category is created inline without leaving the
  form; "+ Create department" goes to `/departments/new` and comes back with the
  form still filled in and the new department selected (via `src/lib/form-draft.ts`).
- The asset-tag field previews the tag that will be issued and shows the last
  five tags in that category with their photos; the serial field lists serials
  already recorded in that category and warns on an exact match.
- New **Categories** tab (`/categories`): one card per department, add/edit/
  deactivate/delete its categories.
- New API: `/api/asset-categories` and `/api/asset-categories/[id]`. Creating a
  category is allowed for department heads, not admin-only.
- `?categoryId=` deep link on `/assets`, linked from the asset detail page and
  from the asset counts on the Categories screen.

**Deliberate calls**

- Categories are scoped to a department rather than global — the Categories
  screen is organised that way, and two departments naming a group the same
  thing do not mean the same thing.
- No denormalised category name on `Asset`: one source of truth, at the cost of
  an `include` in the handful of places that print it.
- A category's department cannot be edited. Every tag it has issued already
  starts with that department's code.
- Renaming a category or changing its code never rewrites existing tags.

**Known gaps**

- A photo chosen before stepping out to create a department is not preserved
  (a `File` cannot go into sessionStorage). The form says so when it restores.
- The "recently tagged" chips are read-only reminders; clicking one would only
  offer a tag that is already taken.
- Reassigning an asset to a different category is done one asset at a time
  through the asset form. There is no bulk move, and deleting a category with
  assets is refused rather than offering to move them.
