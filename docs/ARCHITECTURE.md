# Architecture

A map of the system, written so a new session can find the right file without
reading everything. For *what changed lately* and environment quirks, see
[HANDOVER.md](HANDOVER.md).

---

## Shape

One Next.js 15 App Router application. Server Components read the database
directly through Prisma; the browser mutates through `/api/*` route handlers.
There is no separate backend and no client-side data store.

```
Server Component (page.tsx)  ──reads──▶  src/lib/queries.ts ──▶ Prisma ──▶ Postgres
        │ props (plain JSON)
        ▼
Client Component ('use client') ──fetch──▶ src/app/api/**/route.ts ──▶ Prisma
        │                                          │
        └── router.refresh() ◀── re-renders the server component with fresh data
```

`router.refresh()` after every successful write is the whole cache-invalidation
strategy. Every page is `export const dynamic = 'force-dynamic'`.

---

## Data model (`prisma/schema.prisma`)

```
Department ──< AssetCategory ──< Asset ──< MachineFix
     │                             ▲  ▲
     ├──< User                     │  └── Location   (site-wide)
     │     ▲                       │
     └──< PurchaseOrder ──< PurchaseOrderItem ──> basedOnAsset / receivedAsset
              │  │  │           │       └──> Supplier (optional, one of the order's)
              │  │  │           ├──> Unit           (site-wide: PCS, Kg, set)
              │  │  │           └──> CatalogueItem ──< CatalogueDescription
              │  │  └──< PurchaseOrderPhoto   (SHEET: the written list; RECEIVED: what came back)
              │  ├──< PurchaseOrderAssignee >── User    (who is looking after it)
              │  └──> User ×4                           (requested / issued / checked / authorized)
              └──< PurchaseOrderSupplier >── Supplier   (site-wide, LOCAL / INTERNATIONAL)

OrderListOption (site-wide; the four oversea dropdowns, suggestions only)
ReportPreset    (site-wide; a saved report *setup*, holds no records of its own)
```

- **Department** — `name`, `code` (unique, e.g. `WRK`). Owns everything below it.
- **User** — everyone who signs in; the Employees screen. `role` (ADMIN /
  DEPT_HEAD / EMPLOYEE) is a *template*: what someone may open is
  `permissions` (a Json of per-area overrides, only what differs from the
  template) laid over it by `resolveAccess` in `lib/permissions.ts`. ADMIN is
  always everything and is the only role that manages accounts. Scope is
  separate from access: `allDepartments` or one `departmentId`, and with
  neither they see only what they are assigned. Carries a profile - job
  title, phone, photo - shown wherever the person is assigned to an order.
- **AssetCategory** — a department's own grouping of equipment ("Nuts",
  "Presses"). `name` and `code` are unique *per department*, not globally:
  Welding in IT and Welding in Workshop are genuinely different groups.
  `isActive` retires a category without touching the assets in it.
- **Location** — a physical place: "Shed B", "warehouse 3". `name` is unique
  **site-wide**, and this is the one lookup table that is deliberately *not*
  owned by a department — one shed is one shed whoever's machine is in it, and
  the live data has a single "warehouse 3" holding both an IT phone and a
  Workshop part. Admin-only to write; everyone may read, because a department
  head has to be able to place their own asset. `isActive` retires it.
- **Asset** — belongs to exactly one department **and** one of that department's
  categories. `assetTag` is globally unique. `locationId` is **nullable**: a lot
  of older equipment has never had a place written down, and requiring one would
  block editing those rows for every other reason. `quantity` (default 1) is how
  many identical units the row stands for — five of the same chair are one
  record, not five, because they share a tag, a location and a repair history.
  **`unitCost` is what one unit cost**; the record's value is `unitCost ×
  quantity`, which is what the department tiles and the report's "Recorded
  purchase value" sum. The form can take a total instead, and divides it to
  the cent before sending - only the per-unit figure is ever stored. Counts in
  the app and in a report are still counts of records.
- **Supplier** — a shop or firm things are bought from. Site-wide like
  Location, `kind` LOCAL or INTERNATIONAL (the two tabs), full contact details
  and a logo. Retired rather than deleted once any order names it, so an old
  order still prints where it was bought.
- **PurchaseOrder** — a record, not a document: `number` (`PO-2026-0001`,
  issued by `nextOrderNumber` behind an advisory lock), `status` NEW → PENDING
  → COMPLETED (the three tabs), `kind` LOCAL or OVERSEA (a filter, not a second
  screen), a department, a note, several suppliers, several assignees, photos
  of the written list, and lines. An oversea order also carries the terms
  agreed with the shipper (`originFrom`, `attention`, `deliveryTerms`,
  `paymentTerms`) as **text, not keys** — the wording varies and an order must
  keep what it was sent with. Four further people — requested / issued /
  checked / authorized by — are the boxes at the foot of the paper order and
  are *not* `assignees`: one is a record of what happened, the other is ongoing
  work and is what grants "assigned only" access.
- **Unit / OrderListOption / CatalogueItem** — the small vocabularies an order
  is written in, all managed at `/purchasing/lists`. A unit is referenced, so
  renaming one follows every line and a unit in use is retired rather than
  deleted. A list option is only a suggestion — nothing points at it. A
  catalogue name is *copied* onto the line, so renaming or deleting an entry
  never rewrites an order.
- **PurchaseOrderItem** — one line: name, details, `quantity`
  (`Decimal(12,3)` — `2.25 Kg` is a real line) with an optional `Unit`, an
  optional category (the order department's, checked in the API), optionally
  the asset it was picked from (`basedOnAsset`, for its name and photo) or the
  catalogue entry it was named from, optionally which of the order's suppliers
  it comes from, its own photo, `receivedDate`, `codeNo`, and
  `boughtUnitPrice` (`Decimal(12,4)` — `$0.625` each is normal on a small unit)
  once bought. **No price exists before then**: nobody knows it, and a guessed
  figure in a system reads as a real one. `receivedAsset` is the asset the line
  went into on arrival - a new one made from it, or the one it topped up - and
  is not unique, because many lines top up one asset over the years.
- **ReportPreset** — a saved way of *building* a report, not a report. Its whole
  setup is one `Json` column: read and written as a unit, expected to keep
  changing shape, and made safe on the way out by `normalizeReportConfig` rather
  than by a migration every time a column is added to a table. Site-wide like
  Location, and the only lookup table anyone may add to — editing and deleting
  are restricted to its author or an admin. Since the page became something you
  lay out by hand, that Json also carries the **layout**: the order of every
  block, the blocks somebody added themselves, the parts they took off, and
  **`textOverrides`** — every fixed label they worded differently, keyed by the
  template id that renders it.

### Asset tags

`<department code>-<category code>-<number>`, e.g. `WRK-NUT-004`. The number
counts within that department+category pair.

- Generated by `nextAssetTag` in `src/lib/asset-tag.ts`, inside the caller's
  transaction, behind a Postgres advisory lock keyed on the category so two
  people adding assets at once cannot claim the same number.
- The browser previews the same number with `previewNextAssetTag` in
  `src/lib/format.ts` — the pure helpers live there, not in `asset-tag.ts`,
  because that module is `server-only`.
- Tags predating this scheme (`PRT-001`) and hand-typed ones stay valid; they
  are simply skipped when working out the next number. **Tags are never
  rewritten** — they are physical labels stuck on real machines, so renaming a
  category or changing its code only affects assets added afterwards.

---

## Where the data lives

Two stores, and both are needed:

- **PostgreSQL** holds every record, including the *name* of each file.
- **`VIDEO_STORAGE_DIR`** holds the files themselves, under folders named by
  record id. Paths in the database are always RELATIVE to this root, so the
  folder can be moved without a data migration - which is also why nothing in
  it is named after what it is.

`npm run backup` copies both at one moment: readable CSVs and per-order photo
folders for people, `database.sql` for restoring. See
[BACKUP.md](BACKUP.md).

---

## Invariants

These are enforced in code and easy to break by accident.

| Rule | Where |
| --- | --- |
| Every route and page checks access for its area | `requireAccess` / `requireAnyAccess` in `src/lib/auth.ts` for routes, `requirePageAccess` in `page-auth.ts` for pages. Access is resolved once, when the session is read, so a check is a lookup - no query - and a change on the Employees screen applies on that person's next request. The UI hiding a button is a convenience only |
| Someone scoped to one department only ever sees that department | `departmentScopeFilter`, `assertDepartmentAccess`, `seesAllDepartments` in `src/lib/auth.ts`. Seeing all is opt-in (`allDepartments`) so a department that is deleted, which nulls `departmentId`, shrinks someone's view instead of widening it |
| Only an admin manages accounts and access | `requireAdmin` in the user routes. There is no Edit level on the employees area on purpose: whoever could edit accounts could raise their own access |
| A block in the report is never torn across a page | `break-inside: avoid` in `reports/template.ts` on the title block, its details grid, the closing line and every added block; headings carry `break-after: avoid`. A report split at the fold looks like nobody read it before sending it |
| A line measured out (a fractional quantity) can never become an asset | Checked in `POST /api/purchase-orders/[id]/to-assets` before anything is written, and mirrored in the checklist. Assets are counted one by one; rounding `2.25 Kg` to 2 would invent stock that was never bought |
| An order keeps the words it was written with | The oversea terms are text columns, not keys into `OrderListOption`, and a catalogue name is copied onto the line rather than referenced. Editing or deleting a list entry must never rewrite an order that has already gone out |
| An order is seen by whoever is assigned to it, and beyond that by purchasing View in its department | `visibleOrdersWhere` / `loadOrderFacts` in `src/lib/purchase-order.ts`, used by every order route and page. An order someone may not see is a 404, not a 403. Managing it needs purchasing Edit; *working* it (photos of what came back, prices, completing) is also open to its assignees |
| An order line goes into the assets once | `to-assets` refuses a line with `receivedAssetId` set, and an order with any such line cannot be deleted - it is the record of where the equipment came from |
| A supplier on an order is never deleted | The route refuses and offers deactivation; the join is `onDelete: Restrict` as a backstop |
| An asset's category must belong to the asset's department | `assertCategoryInDepartment` in `src/lib/asset-category.ts`, called from both asset write routes. A foreign key cannot express it |
| Changing departments needs departments Edit, and adding one also needs a view of every department | The department routes. Someone scoped to one department would create a department they then could not see |
| Changing **locations** needs locations Edit | The location routes. By default only an admin has it: a location is shared by the whole site, so one person curating the list is what keeps "Shed B" from becoming three rows |
| Location names are unique **case-insensitively** | A `lower(name)` expression index (`Location_name_lower_key`), added in its own migration because Prisma cannot model it in the schema. The plain `@unique` alone would let "Shed B" and "shed b" coexist |
| Categories can be created from the asset form and the order form as well as their own screen | `POST /api/asset-categories` accepts categories, assets *or* purchasing Edit. Deliberate: the person writing up the asset or the order is the one who knows what the thing is, and blocking them is what produced free-text categories in the first place |
| Nothing that holds records is hard-deleted | Departments and categories offer deactivation (`?mode=deactivate`) instead |
| A report never covers a department the caller cannot see | `resolveDepartments` in `src/lib/reports/data.ts`, which refuses rather than narrowing. The builder narrows a shared setup before sending, so it never has to |
| A report table always fits the page | `solveColumnWidths` in `src/lib/reports/columns.ts`. Every colgroup sums to exactly 100 and no column goes under its `hardPx` — the width at which `table-layout: fixed` starts drawing cells over each other. A header is part of that floor: a `th` neither wraps nor breaks |
| A stored report setup always opens | `normalizeReportConfig` in `src/lib/reports/config.ts`. It never throws: missing sections are filled in, unknown ones dropped, and whatever it changed is reported to the screen. The layout is reconciled the same way — one entry per thing that really exists, in the order it was left |
| Wording changed on the canvas is what prints | `words()` in `src/lib/reports/template.ts` resolves every fixed label through `config.textOverrides` before rendering, so the preview and the PDF read from one place. An override that was cleared falls back to the default in the template — the wording is never stored twice |
| The printed document carries no trace of the editor | `renderReportHtml` writes the canvas handles and injects `reports/canvas.ts` only when `meta.editable`, and `buildReportData` only sets that for a preview. The one structural difference is an unstyled wrapper around the run of groups |
| Nothing in the canvas can reach the app around it | The preview iframe is `sandbox="allow-scripts"` — an opaque origin, so no access to the parent, its cookies or its storage. It talks by `postMessage`, and `ReportBuilder` checks every id in a message against the setup it already holds |
| An Excel import adds every row or none | `commitImport` in `src/lib/asset-import.ts` runs in one transaction, and the route refuses `mode=import` while any row has a problem. The file is re-read and re-checked on import rather than trusted from the check |
| Every write goes through a zod schema | `src/lib/validation.ts` |
| Every error response is `{ error, fields? }` | `src/lib/api.ts` (`ok`, `fail`, `handleRouteError`) |

---

## Where things live

### `src/lib`

| File | Owns |
| --- | --- |
| `auth.ts` | Sessions (HMAC'd token in the DB, raw token in the cookie), password hashing, `requireAccess` and the department-scope checks. The session user carries `access`, resolved once per request |
| `permissions.ts` | The areas, their levels, what each level says on screen, the role templates, `resolveAccess` and `can`. No `server-only`: the Employees grid and the sidebar read it too |
| `purchase-order.ts` | Who may see, manage and work an order; the PO number; the checks a foreign key cannot make about an order's contents; writing its lines; reading it out as `OrderDetail`; the options the order form picks from |
| `order-types.ts` | The `OrderDetail` shape the Purchasing screens are typed against. No `server-only` |
| `order-print.ts` | The printed order for the buyer: one block per supplier with its contact details, each line with its photo and a tick box, the assigned people with their faces. Every photo inlined, like the report |
| `image-upload.ts` | The receive-and-serve halves of every photo route except the asset one (people, suppliers, orders, order lines) |
| `page-auth.ts` | `requirePageUser()` — the redirect-based gate both page layouts run (signed in, and past `mustChangePassword`) — and `requirePageAccess()`, which sends someone without access to a screen home rather than to an error. Separate from `auth.ts` because it pulls in `next/navigation`, which API routes have no use for |
| `nav.ts` | The one list of destinations, each naming the area that opens it; only the ones the person may open are listed. The sidebar and the landing-page tiles both read it, so a screen cannot appear in one and be missing from the other. No `server-only`: `NavLinks` is a client component |
| `validation.ts` | Every input rule, zod. One place, on purpose |
| `api.ts` | Route response helpers and error → HTTP mapping |
| `queries.ts` | Shared reads for Server Components (`loadAssets`, `loadDepartmentOptions`, `loadAssetCategoryOptions`, `loadLocationOptions`) and the Prisma row → `AssetRow` mapping. `loadLocationOptions` takes no user: the list is site-wide |
| `asset-tag.ts` | `nextAssetTag` (server-only, transactional) |
| `asset-category.ts` | The "category belongs to this department" check |
| `asset-import.ts` | Adding assets from Excel: builds the blank sheet - one visible sheet, its dropdowns fed from a very hidden one, reads a filled one by column heading, checks each row against `assetCreateSchema` after matching names to records, and writes the lot in one transaction. Creates missing categories (and locations, with locations Edit) on the way |
| `format.ts` | Money/date formatting, enum labels, tag helpers. Runs in the browser, on the server *and* inside the PDF template, so a number is never formatted two ways |
| `client.ts` | The browser fetch wrapper (`api()`), image downscaling, video upload with progress |
| `form-draft.ts` | One-shot sessionStorage hand-offs between two screens: the add-asset form surviving a trip to the new-department page, and assets ticked on the Assets screen arriving at the report builder. Every read is a take |
| `image-storage.ts` / `video-storage.ts` | Files on disk under `VIDEO_STORAGE_DIR`; paths stored relative so the root can move |
| `reports/` | `columns.ts` is the column registry and the width solver, `config.ts` the setup shape, the page layout and its normaliser, `data.ts` gathers, `template.ts` renders HTML, `canvas.ts` is the editing chrome injected into the preview, `pdf.ts` drives Puppeteer (`renderHtmlToPdf` is shared with the order printout). `columns.ts` and `config.ts` deliberately carry no `server-only`: the builder in the browser works from the same definitions the PDF does. The PURCHASES section is one row per purchase-order line |

### `src/components`

Client components. `ui.tsx` holds the shared pieces (`Field`, `Alert`, `Modal`,
`ConfirmDialog`, pills, `EmptyState`); each `*Manager.tsx` is one screen's table
plus its form modal.

**A picker inside a modal claims Escape with `preventDefault`, not
`stopPropagation`.** The App Router hydrates React at `document`, so React's
delegated listener and `Modal`'s own key handler are on the same node and
stopping propagation between them does nothing. `Modal` ignores an Escape that
is already `defaultPrevented`, so the first one shuts the open dropdown and the
second closes the form.

- `Combobox.tsx` — type-ahead picker that only ever returns an id, with a
  "+ Create …" row pinned to the bottom. Used for department, category and
  location in the asset form; each "+ Create" opens an inline panel there (the
  department one leaves for `/departments/new` and comes back via the draft).
  Matches starting with the query sort above matches merely containing it.
- `AssetPicker.tsx` — the opposite trade to `Combobox`: it hands back **text**,
  and the list of matching equipment (each row a photo, name, category,
  condition and tag) is a shortcut rather than a constraint. That is what an
  order line needs, because most lines are for something nobody owns yet.
  Nothing is highlighted until you arrow onto it, so Enter submits the form
  for someone writing in a new item. Catalogue names come after the equipment
  matches — no photo, no tag, just a name and the descriptions it has been
  bought in — because a name typed before is a weaker match than a machine on
  record with the same name.
- `OrderListsManager.tsx` — `/purchasing/lists`: units, the four oversea
  dropdowns and the item catalogue on one screen. Three small lists, none big
  enough to deserve a screen of its own.
- `OrderView.tsx` — one order, and the dialogs that move it on. Its
  "add to assets" dialog files each arrived line: one department for the whole
  dialog (categories belong to a department, so a per-line department would put
  a different category list on every row), then a category and a location per
  line, each able to make a new one in place rather than sending someone away
  mid-dialog.
- `OrderList.tsx` — the Purchasing tabs as one table: a row per order, the
  written-order photo and the item photos through `PhotoThumb` so both enlarge
  on hover. The photo strip never wraps, because a list whose rows are
  different heights is a grid with extra steps.
- `ColumnPicker.tsx` — the "Columns" button over a table and
  `useHiddenColumns`, which remembers the hidden ones per browser in
  localStorage. A preference about reading a table on one PC, not data, so it
  is never in the database and a blocked storage just shows everything.
- `EmployeeManager.tsx` — the Employees screen: the staff directory for anyone
  with view access, and for an admin the accounts, the role and scope, and the
  permission grid. Also exports `Avatar`, the face used wherever a person is.
- `SupplierManager.tsx` — the Suppliers screen (Local / International tabs) and
  `SupplierCard`, which the order page reuses.
- `OrderList.tsx`, `OrderEditor.tsx`, `OrderView.tsx` — Purchasing: the three
  tabs of order cards; writing up a whole order (lines picked from equipment or
  written in, each with a photo, a category made on the spot if need be, the
  suppliers and the people); and one order with whatever the viewer may do
  next - send it out, complete it with prices (per unit or per line), add what
  came back into the assets. `OrderView` only follows `order.can`, which the
  server worked out.
- `PhotoThumb.tsx` — the asset photo in a table: hover enlarges it, and the
  preview carries a button that opens the photo full screen. The preview and the
  full-screen overlay are portalled to `<body>` and placed in viewport
  coordinates, because `.table-wrap` scrolls horizontally and clips anything
  that grows outside a cell.
- `AssetManager.tsx` — the assets table and the add/edit form. Also owns the
  tick column: selected ids (not rows, so a selection survives filtering) and
  "Report on these", which hands them to the builder through `form-draft.ts`. Also computes the
  next-tag preview, the recently-tagged chips and the serial-number suggestions
  client-side from the `assets` array it was already given; none of that costs an
  extra request.
- `AssetImport.tsx` — the "Import from Excel" dialog on the Assets screen: the blank-sheet link, then choosing a sheet checks it at once and lists problems by row, new categories and locations, warnings, and the tags each row will get; Add sends the same file again to import.
- `AssetCategoryManager.tsx` — the Categories screen: one card per department,
  its categories inside.
- `ReportBuilder.tsx` — the report studio: a tool bar over the document itself.
  Everything on the screen edits one object, and the page in the middle is that
  object rendered by the PDF's own template through `/api/reports/preview` —
  there is no second description of what a report looks like. The handles on
  that page (drag, resize, ✕, type-in-place) live *inside* the iframe, in
  `reports/canvas.ts`, and reach this component by `postMessage`; every id in a
  message is checked against the setup before it is acted on. The panels in the
  bar are the same controls as ever, and the list in **Blocks** is the keyboard
  route to everything the page offers by pointer. Undo is a stack of past
  setups; keystrokes are collapsed into one step by a merge key, and the canvas
  forwards Ctrl+Z because once it has been clicked the keyboard is in *its*
  document.
- `LocationManager.tsx` — the Locations screen. One flat table, not cards: a
  location has no owning department to group it under. The "what is stored here"
  column is the department breakdown, which is the thing that would be invisible
  if locations were scoped the way categories are.

### `scripts/`

Command-line jobs, run with `tsx`, outside the app: `create-admin.ts` is the
way back in when nobody can sign in, and `crm-export.ts` / `crm-import.ts`
carry the old CRM's purchase history across (see
[CRM-IMPORT.md](CRM-IMPORT.md)). The `crm/` folder beside them reads that
system - its zip backups, its MySQL dump and its entity-attribute-value
schema - and none of it is imported by the app itself. The two halves meet at
a folder of CSVs and photos, so the import knows nothing about Rukovoditel and
the data never has to pass through GitHub.

`backup.ts` copies this system rather than the old one, and writes both halves
of it at one moment - CSVs and per-order photo folders to read, `pg_dump` to
restore from ([BACKUP.md](BACKUP.md)). It only reads, so it is safe while
people are working.

### `src/app`

- `page.tsx` — the landing page, a launcher of tinted tiles and nothing else.
  It sits at the root rather than in `(app)/` **on purpose**: that group's layout
  is what draws the sidebar, and here the tiles *are* the navigation. Moving this
  file into `(app)/` would put a sidebar beside them saying the same thing twice.
  It queries nothing, so it never waits on the database.
- `(app)/` — every screen that has a sidebar. The layout is the real auth gate
  (middleware only checks that a cookie exists) and also blocks on
  `mustChangePassword`. Because the landing page needs the same gate without the
  sidebar, that check lives in `lib/page-auth.ts` and both call it.
- `api/` — all mutations.
- `videos/[token]/` — deliberately **public**, standalone HTML, reachable through
  the Cloudflare Tunnel. Access control is the unguessable token.

---

## Conventions worth matching

- Types shared between a page and its client component are exported from the
  component (`AssetRow`, `DepartmentOption`, `AssetCategoryOption` all come from
  `AssetManager.tsx`) and imported by `queries.ts`.
- Server Components pass plain JSON only — `Decimal` and `BigInt` are converted
  in `src/lib/serialize.ts`, dates become ISO strings.
- Styling is class names in `globals.css`; no CSS modules, no framework.
- Comments carry the reasoning ("why not a `<select>` here"), never a narration
  of the line below.
