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

`next build` has not been re-run since the Locations work - `next dev` was left
running, and the two must never share `.next` (see below).

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
