-- Employees become accounts with a profile, and access becomes per area.
ALTER TYPE "Role" ADD VALUE 'EMPLOYEE';

ALTER TABLE "User"
  ADD COLUMN "permissions" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "allDepartments" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "jobTitle" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "photoRelativePath" TEXT,
  ADD COLUMN "photoMimeType" TEXT,
  ADD COLUMN "photoUploadedAt" TIMESTAMP(3);

-- Nobody's view changes: admins already saw everything, and an existing
-- department head keeps exactly their one department. The flag is set on
-- admins only so the column tells the truth if one is ever demoted.
UPDATE "User" SET "allDepartments" = true WHERE "role" = 'ADMIN';
