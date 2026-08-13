# Internal Department & Asset Management System

A small, focused replacement for the one ERPNext use case: knowing what each
department owns, what condition it is in, what needs buying, and handing the CEO
a clean PDF to decide from.

Runs on a single office PC. Department heads and the CEO reach it over the LAN in
a normal browser. Only machine-fix videos are exposed to the internet, through a
Cloudflare Tunnel scoped to `/videos/*`.

---

## What it does

| Module | What it covers |
| --- | --- |
| **Departments** | Admin adds, edits and removes departments. Each owns its own assets. |
| **Assets** | Name, category, asset tag, serial, location, status, purchase date, cost, notes, and a photo. Status is one of *in use / idle / needs replacement / broken*. |
| **Purchase planning** | Department heads flag "we need to buy X", as a new purchase or a replacement linked to a specific machine. Admin approves or rejects. |
| **Reports** | On-demand PDF: executive summary, condition chart, asset lists, flagged purchases, and clickable repair-video links. |
| **Machine fixes** | Repair history per machine, with an uploaded video, so the same fault is not relearned from scratch. |

### Roles

- **Admin** - everything, across every department. Reviews purchase requests, manages users.
- **Department head** - their own department only. Cannot see or touch another department's data, and cannot generate the company-wide report.

Scoping is enforced server-side on every route, not just hidden in the UI.

---

## Requirements on the office PC

- **Node.js 20 or newer**
- **PostgreSQL 14 or newer**
- **A large local disk** for machine-fix videos
- Windows or Linux both work; the commands below note where they differ

---

## First-time setup

### 1. Get the code and install

```bash
git clone <your-repo-url> assets-manager
cd assets-manager
npm install
```

`npm install` downloads a private copy of Chromium for Puppeteer (~150 MB). That
is expected - it is what renders the PDFs.

If antivirus or a proxy blocks that download, you will see
`Could not find Chrome` the first time someone generates a report. Either
re-run the download:

```bash
npx puppeteer browsers install chrome
```

or skip it entirely and point the app at the Chrome/Edge already on the machine
by setting `PUPPETEER_EXECUTABLE_PATH` in `.env`.

### 2. Create the database

```sql
CREATE DATABASE assets_manager;
CREATE USER assets WITH ENCRYPTED PASSWORD 'pick-a-strong-password';
GRANT ALL PRIVILEGES ON DATABASE assets_manager TO assets;
```

### 3. Configure

```bash
cp .env.example .env
```

Then edit `.env`. The values that matter most:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Points at the local Postgres. |
| `SESSION_SECRET` | Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Changing it signs everyone out. |
| `VIDEO_STORAGE_DIR` | Absolute path on the **big** disk, e.g. `D:\assets-manager-videos`. Not the system drive. |
| `LAN_BASE_URL` | The address staff type, e.g. `http://192.168.1.50:3000`. |
| `PUBLIC_VIDEO_BASE_URL` | The Cloudflare Tunnel hostname. Leave blank until the tunnel is up. |
| `COMPANY_NAME`, `COMPANY_LOGO_PATH` | Branding at the top of every PDF. |

Drop your logo at `public/branding/logo.png` (PNG or SVG). If the file is
missing, the report falls back to a typeset wordmark - it still looks
deliberate, it just is not your logo.

### 4. Create the tables and seed

```bash
npx prisma migrate deploy
npm run seed
```

The initial migration is committed to the repo, so this creates every table
without needing to generate anything first.

The seed creates the Printing, Workshop and IT departments, an admin account,
and a handful of sample assets and purchase requests so you can generate a PDF
immediately and see the layout with real-looking data.

Default sign-in printed by the seed:

```
email:    admin@company.local
password: ChangeMe!2024
```

You are forced to change this on first sign-in.

### 5. Run it

```bash
npm run build
npm start
```

Open `http://<the-pc-lan-ip>:3000` from another machine on the network.

If it does not load from another PC, the firewall is almost always the cause:

```powershell
# Windows, run as Administrator
New-NetFirewallRule -DisplayName "Assets Manager" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
```

---

## Keeping it running (pm2)

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
```

### Surviving a reboot

**Linux:**

```bash
pm2 startup      # prints a command - run it
```

**Windows** - `pm2 startup` is not supported. Either:

```powershell
npm install -g pm2-installer   # installs pm2 as a Windows service
```

or add a Task Scheduler task: trigger *At startup*, action
`pm2 resurrect`, and tick *Run whether user is logged on or not*.

Useful day-to-day:

```bash
pm2 logs assets-manager     # tail the logs
pm2 restart assets-manager  # after a deploy
pm2 status
```

---

## Exposing only the videos (Cloudflare Tunnel)

The CEO needs to open a repair video from a phone, off-site. Nothing else may
leave the LAN.

```bash
cloudflared tunnel login
cloudflared tunnel create assets-videos
cloudflared tunnel route dns assets-videos fixes.yourdomain.com
```

Copy `deploy/cloudflared-config.yml` to `~/.cloudflared/config.yml` (Windows:
`C:\Users\<user>\.cloudflared\config.yml`), replace the tunnel ID, credentials
path and hostname, then:

```bash
cloudflared tunnel run assets-videos
```

Finally set `PUBLIC_VIDEO_BASE_URL="https://fixes.yourdomain.com"` in `.env` and
restart. Video links in new PDFs now work from anywhere.

### Why this is safe

Three independent layers, so one mistake is not enough to expose the app:

1. **Tunnel ingress rules** only match `/videos/...`; everything else returns 404 at Cloudflare.
2. **`src/middleware.ts`** returns 404 for any request that arrives with Cloudflare headers and is not a `/videos` path - so even a mis-edited tunnel config cannot expose the admin UI.
3. **Video URLs are capability links.** Each video gets a 24-byte random token. The URL cannot be guessed or walked, and deleting the video revokes it.

Video files never leave the office PC's disk. Cloudflare streams them through;
it does not store them.

### Run cloudflared as a service

```bash
# Linux
sudo cloudflared service install

# Windows (Administrator)
cloudflared service install
```

---

## Deploying an update

From your machine: push to GitHub. Then over AnyDesk/TeamViewer on the office PC:

```bash
cd assets-manager
git pull
npm install
npx prisma migrate deploy     # applies new migrations, never resets data
npm run build
pm2 restart assets-manager
```

`prisma migrate deploy` is the production command - it applies pending
migrations and nothing else. Never run `migrate dev` or `migrate reset` on the
office PC; those can drop data.

---

## Asset photos

Each asset can carry a photo. It appears as a thumbnail in the asset tables and
in the PDF report, so equipment is recognisable at a glance rather than only by
tag.

**Where they live.** In an `images/` subfolder of the same storage root as the
repair videos, so there is still one directory to back up:

```
<VIDEO_STORAGE_DIR>/
  images/<assetId>/photo-<random>.jpg     ← asset photos
  <assetId>/<token>/<filename>.mp4        ← repair videos
```

**They are not public.** Only `/videos/*` is exposed through the Cloudflare
Tunnel. Photos are internal data, so they are served from
`/api/assets/<id>/photo`, behind the session and re-checked against the user's
department. A request carrying Cloudflare headers gets a 404 like the rest of
the app.

They still appear in the PDF off-site, because the report base64-inlines them
into the document itself rather than linking to them - the same reason the logo
is inlined.

**Sizing is handled in the browser.** `downscaleImage` in `src/lib/client.ts`
shrinks the picture to 640px and re-encodes it as JPEG *before* upload, so a
4 MB phone photo is stored as roughly 40 KB. This is deliberate: every photo is
embedded into every PDF that lists the asset, so full-resolution originals would
produce reports too large to email - and it avoids needing a native image
library (`sharp`) on the office PC. The report also enforces a total photo
budget and drops thumbnails past it rather than emitting a huge file.

## Backups

Two things need backing up, and they are separate:

```bash
# 1. The database - departments, assets, purchase requests, fix records
pg_dump -U assets assets_manager > backup_$(date +%Y%m%d).sql

# 2. The video files AND asset photos
#    Just copy VIDEO_STORAGE_DIR - it holds both (photos are in its images/ subfolder).
```

A database restored without the video directory leaves fix records whose links
404. Keep them in step.

---

## Recovering a lost admin password

On the office PC:

```bash
npm run create-admin -- --email boss@company.local --name "Jane Doe" --password "a-long-password"
```

Creates the account if it does not exist, or resets and re-promotes it if it
does.

---

## How the PDF is built

Deliberately **not** a charting or reporting library. `src/lib/reports/template.ts`
generates hand-laid-out HTML/CSS, and Puppeteer renders it to A4. That is what
makes the output identical every time.

Things that keep it stable, and that you should preserve if you edit the
template:

- **No external resources.** No web fonts, no remote images, no scripts. Puppeteer renders with `setContent` and network requests blocked, so anything external would silently disappear from a document that goes to the CEO. The logo is inlined as a base64 data URI.
- **Only system fonts.** A missing font would reflow the whole document.
- **Table headers repeat** across pages (`display: table-header-group`) and rows never split (`break-inside: avoid`).
- **Headings are glued to their content** (`break-after: avoid`), so a heading cannot strand itself at the foot of a page.
- **`print-color-adjust: exact`** - without it, headless Chrome drops every background colour and the status pills vanish.
- **Money is tabular-figure aligned** so columns of numbers line up.

To change the look, edit the `STYLES` string in that file and regenerate a
report. To change what data appears, edit `src/lib/reports/data.ts`.

Rejected purchase requests are intentionally excluded from reports - the
document is for deciding what to buy next, not re-litigating what was already
turned down.

---

## Project layout

```
prisma/schema.prisma        Data model
prisma/seed.ts              Departments, admin, sample data

src/lib/auth.ts             Sessions, password hashing, role checks
src/lib/validation.ts       Every input rule, in one file (zod)
src/lib/video-storage.ts    Streaming upload, byte ranges, path safety
src/lib/reports/data.ts     Gathers everything a report needs
src/lib/reports/template.ts The CEO-facing document (HTML/CSS)
src/lib/reports/pdf.ts      Puppeteer renderer

src/middleware.ts           Session gate + Cloudflare tunnel containment
src/app/api/*               All mutations
src/app/videos/*            PUBLIC: watch page + range-streaming video route
src/app/(app)/*             The authenticated UI
```

---

## Notes and deliberate limits

- **Cookies are not `secure`.** The LAN runs plain HTTP, so a `secure` cookie would never be sent and login would silently fail. This is correct for a LAN-only deployment; if you ever put the whole app behind HTTPS, flip it in `src/lib/auth.ts`.
- **Deleting a department with assets is refused.** It offers deactivation instead, so history is not destroyed by a stray click.
- **Deactivating a user does not delete them.** Purchase requests and repair records still need to say who raised them.
- **Reports are generated fresh, never cached.** A stale PDF is worse than a slow one when someone is deciding what to spend money on.
