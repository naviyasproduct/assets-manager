# Bringing the old CRM across

The purchase history before this system lived in a Rukovoditel install ("JJC
CRM"): local and oversea purchase orders, their photographs, the staff named on
them and the suppliers they were bought from. This is how that data gets into
the Asset Manager.

It happens in two steps, on purpose. **The data never goes through GitHub** -
it is a quarter of a gigabyte of photographs and real supplier contacts, and it
belongs to the office, not to the repository. Only the two scripts are shared;
the data travels on a disk.

```
  old CRM folder  ──npm run crm-export──▶  package folder  ──npm run crm-import──▶  Asset Manager
   (Rukovoditel)                          (CSV + photos)                              (Postgres)
   on any PC                              carried on a disk                    on the PC that runs the app
```

---

## Step 1 - make the package

Anywhere you have a copy of the old CRM folder (the one with `backups/`,
`uploads/` and `index.php` in it):

```bash
npm run crm-export -- --from "D:\jjc-crm" --out "D:\crm-package"
```

It reads the **newest** backup in `backups/` - it says which one, and
`--backup <file>` picks a different one - and writes:

| In the package | What it is |
| --- | --- |
| `orders.csv` | one row per purchase order |
| `order-items.csv` | one row per line of an order |
| `suppliers.csv` | the oversea suppliers, with contact, country, phone, email |
| `employees.csv` | the staff named on orders |
| `departments.csv` | the departments orders belong to |
| `item-catalogue.csv` | every item name the old system knew, for reference |
| `other-files.csv` | attachments that are not photographs |
| `images/` | every photograph the CSVs name |
| `files/` | the attachments that are not photographs, as they were |
| `manifest.json` | where it came from, what is in it, anything missing |

The CSVs open in Excel. **Read them before importing** - that is the point of
this step. Nothing is written to the CRM folder and nothing touches a database.

`--no-images` makes a small package of the figures alone, for a quick look.

## Step 2 - load it in

On the PC that runs the Asset Manager, with the package on a disk or copied
across:

```bash
npm run crm-import -- --from "D:\crm-package"             # a rehearsal: writes nothing
npm run crm-import -- --from "D:\crm-package" --commit    # writes it in
```

The rehearsal prints exactly what the real run would create. Run it first, read
it, then add `--commit`.

**Running it twice is safe.** An order whose number is already there is left
alone, and departments, suppliers and people are matched by name before any new
ones are made. It only ever adds; nothing already in the system is changed or
removed.

| Option | Default | For |
| --- | --- | --- |
| `--oversea-department <name>` | `Imports` | Oversea orders had no department in the old system |
| `--default-department <name>` | `Unsorted` | The handful of local orders with no department |
| `--admin <email>` | the first administrator | Whose name goes on the imported orders |
| `--attachments-as sheet\|received` | `sheet` | Where the loose photographs go |
| `--email-domain <domain>` | `old-crm.local` | The addresses made up for imported staff |

---

## What becomes what

| Old CRM | Asset Manager |
| --- | --- |
| Local order `0008` | Purchase order **JJC-LO-P.O-0008**, Completed |
| Oversea order `4952` | Purchase order **JJCAM-4952**, in **Imports**, with its supplier |
| Order line | Item line: name, quantity, the price actually paid, its photograph |
| "PO Image" and attachments | **The written order** photos |
| "Bill Image" | **What was bought** photos |
| Staff | Employees, with their photograph - **deactivated**, see below |
| Oversea "To" | Supplier (international) with contact, country, phone, email |
| Department | Department, matched by name or created |

**The stages.** Local orders are all bought and priced, so they arrive
*Completed*. Oversea orders follow their old stage: *Received* → Completed,
*Ordered* and *On the way* → Pending, *Postponed* and *Cancelled* → Pending
with the old stage in the note.

**The people cannot sign in.** Every imported employee is created deactivated
with an unusable password, so the names and faces show on the orders but nobody
gains access. To let one of them in: Employees → Edit → set a password and
reactivate.

**Money is kept exactly.** A line's price times its quantity always comes to
what the old system recorded. Where that could not be expressed - a fractional
quantity like `2.25 Kg`, or a price of `$0.625` that has no two-decimal form -
the line is stored as one unit at the old line total, and the real figures go
into the line's details: `2.25 Kg × $5 = $11.25`. About 25 lines of 778.

## What has no home here, and where it went instead

Nothing is dropped silently. Everything below is written into the order's note
or the line's details, where it stays readable:

- **The four sign-off roles.** The old orders record *requested / issued /
  checked / authorised by*; this system has one list of people assigned. All
  four names go into the note, and the people themselves are assigned to the
  order.
- **Units** (`PCS`, `Kg`, `set`). Into the line's details, as "In PCS".
- **Old stage, payment and delivery terms, "from" and "attention"** on oversea
  orders. Into the note.
- **The total typed into the old system.** Into the note as "Total recorded
  then". Worth knowing: the old totals were typed by hand and do not always
  match their own lines - across the whole history they differ by about
  $4,200. This system always adds the lines up, so a few orders will show a
  different total from the old paperwork. The old figure is in the note.
- **Attachments that are not photographs** (21 PDFs and a spreadsheet). Named
  in the order's note, with the files themselves in the package's `files/`.
- **The 465-item catalogue.** The names live on as order lines. The catalogue
  itself has no equivalent here - the item box on a new order suggests
  equipment from the Assets list, not old catalogue entries. `item-catalogue.csv`
  keeps the full list, including the six entries no order ever used.
- **The old CRM's two login accounts.** Not imported; this system has its own.

## If it goes wrong

- **"The old CRM has no 'Local' screen"** - the export looks up screens and
  boxes by name (`Local`, `P/O Number`, `Quantity`), so a renamed screen stops
  it rather than importing the wrong column. Rename it back, or say which
  backup to read with `--backup`.
- **Photos missing from the package.** `manifest.json` lists them. Ten photos
  were referenced by the CRM but were already gone from its own disk.
- **Wrong backup.** The export prints which one it chose. Pass `--backup`.
- **To undo an import**, before anyone has edited the imported orders: delete
  the orders whose number starts `JJC-LO-P.O-` or `JJCAM-`, the users whose
  email ends `@old-crm.local`, and the suppliers and departments whose note or
  description reads "Brought over from the old CRM.". Their photographs sit in
  `<VIDEO_STORAGE_DIR>/images/orders/` and `/images/people/`.
