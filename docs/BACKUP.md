# Where the data lives, and how to copy it

Two things make up this system's data, and a backup is only a backup if it has
both.

| What | Where |
| --- | --- |
| **The records** - assets, orders, people, suppliers, repairs | A PostgreSQL database on the PC that runs the system. `DATABASE_URL` in `.env` says which. |
| **The files** - every photograph and repair video | A folder on disk, `VIDEO_STORAGE_DIR` in `.env`. On the office PC that is `D:\assets-manager-videos`. |

They depend on each other. The database stores only the *name* of a file
(`images/<id>/photo.jpg`); the folder holds the file itself. Copy one without
the other and you have half a system.

Inside the storage folder nothing is named after what it is - the folders are
record ids, because that is what makes renaming an asset free. That is fine for
the app and useless for a person, which is what the backup fixes.

---

## Taking one

```bash
npm run backup -- --out "D:\asset-backups"
```

It reads and copies. It never changes anything, so it is safe to run while
people are using the system.

Each run makes its own dated folder, so nothing is overwritten:

```
D:\asset-backups\asset-manager-backup_2026-09-25_1221\
```

| Option | For |
| --- | --- |
| `--no-images` | The figures alone, in seconds, for a quick look |
| `--no-videos` | Skip repair videos, which are by far the biggest thing here |
| `--no-database` | The readable copy only, with no `database.sql` |

## What is in it

```
README.txt                     what this is, and how to put it back
manifest.json                  what was taken, when, and anything missing
database.sql                   the database itself - the only restorable copy

assets/
  assets.csv                   every machine: tag, name, department, cost, condition
  photos/                      "WRK-002 Miller MIG Welder 252.jpg"

purchase-orders/
  orders.csv                   one row per order
  order-items.csv              one row per line of every order
  JJCAM-5023/                  a folder per order, named by its number
    written order 1.jpg          the paper it came from
    what was bought 1.jpg        what turned up
    items/1 Liqed.jpg            a photo per line

people/employees.csv           everyone, photos in people/photos/
suppliers/suppliers.csv        every supplier, logos in suppliers/logos/
repairs/repairs.csv            every repair, videos in repairs/videos/<TAG>/
reference/                     departments, categories, locations, units, catalogue
```

**The CSVs open in Excel.** That is the point of them - the data stops being
something only the system can see. Every photo is under a name that says what
it is, so `purchase-orders/JJCAM-5023/` can be opened by anyone.

## Reading it versus restoring it

These are two different jobs and the backup does both, on purpose.

- **To read** - open the CSVs and the folders. Nothing to install.
- **To restore** - use `database.sql`. The CSVs cannot do it: they are
  flattened for people, joined up and stripped of the ids that hold the records
  together.

```bash
createdb assets_manager_restored
psql -d assets_manager_restored -f database.sql
```

Then copy the photo and video folders back to `VIDEO_STORAGE_DIR`, and point
`DATABASE_URL` at the restored database.

Restore into an **empty** database. Running it over one that already has these
tables will fail partway, which is worse than failing at the start.

## If `database.sql` is missing

The backup says `database skipped - pg_dump was not found`. `pg_dump` ships
with PostgreSQL but is not on the PATH in a default Windows install, so the
script looks in `C:\Program Files\PostgreSQL\<version>\bin\`. If it lives
somewhere else, put the full path in `.env`:

```
PGDUMP="C:\Program Files\PostgreSQL\16\bin\pg_dump.exe"
```

Without it the backup is still worth having - it just cannot be restored from.

## How often

Nothing schedules this. It is one command, and the honest advice is to run it
**before anything risky** - a migration, an import, a version change - and on a
regular day of the week besides. Keep the last few folders; each is complete on
its own and none depends on another.

A backup on the same disk as the system is not a backup. Copy the folder to a
USB disk or another machine.
