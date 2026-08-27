-- Saved report setups.
--
-- Written by hand and applied with `prisma migrate deploy`: `migrate dev` fails
-- on this database with P3014 because the `assets` role cannot create the
-- shadow database (see HANDOVER.md).

CREATE TABLE "ReportPreset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "config" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportPreset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportPreset_name_key" ON "ReportPreset"("name");

CREATE INDEX "ReportPreset_createdById_idx" ON "ReportPreset"("createdById");

-- The author is kept only to show who saved it. Deleting a user must not
-- delete a report the whole office relies on, so the row survives without one.
ALTER TABLE "ReportPreset" ADD CONSTRAINT "ReportPreset_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Names are unique case-insensitively, the same rule Location gained for the
-- same reason: a shared list is only worth having if "Monthly CEO report" and
-- "monthly ceo report" cannot both sit in it. Prisma cannot model an expression
-- index, so it lives here only - `migrate diff` still reports no drift.
CREATE UNIQUE INDEX "ReportPreset_name_lower_key" ON "ReportPreset" (lower("name"));
