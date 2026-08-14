# assets-manager — working notes for Claude

Internal Department & Asset Management System. Next.js 15 (App Router) +
Prisma + PostgreSQL, run on one office PC over the LAN. Single deployment,
no multi-tenancy, no public sign-up.

## Read these first, before opening source files

1. **[docs/HANDOVER.md](docs/HANDOVER.md)** — current state, what changed last,
   environment gotchas, how to run and verify things.
2. **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — the map: data model,
   where each concern lives, and the invariants that must not be broken.

They exist so a session does not have to re-read the whole codebase. **Keep them
current**: when you finish a piece of work, update HANDOVER.md (what changed and
why, new gotchas) and ARCHITECTURE.md (only if the shape of the system moved).
Stale notes are worse than none.

## Commands

```bash
npm run dev          # dev server on :3000
npm run typecheck    # tsc --noEmit — the real gate, `npm run lint` is not configured
npm run build        # prisma generate && next build
npm run seed         # idempotent; sample data only when the DB has no assets
npx prisma migrate deploy   # apply migrations (NOT `migrate dev` — see HANDOVER)
```

## House rules for changes here

- **Server-side authorisation on every route.** `requireUser` / `requireAdmin` /
  `assertDepartmentAccess` — never rely on the UI hiding something.
- **All input rules live in `src/lib/validation.ts`** (zod), and every API
  response uses the one error shape: `{ error, fields? }`.
- Comments explain *why*, not what. Match the surrounding density and tone —
  plain sentences, no cheerleading, no restating the code.
- Light theme only, no CSS framework: styles are hand-written in
  `src/app/globals.css` and shared through class names.
- Nothing external at render time (no CDN fonts/icons/scripts). The office PC's
  connection has blocked binary downloads before, and the PDF renderer must work
  offline.
