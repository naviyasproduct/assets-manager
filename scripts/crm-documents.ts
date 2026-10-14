/**
 * Attaches the CRM package's PDFs and Office files to orders already in the
 * system - for an install whose orders were imported before documents existed.
 *
 *   npm run crm-documents -- --from "D:\crm-package"            rehearsal, writes nothing
 *   npm run crm-documents -- --from "D:\crm-package" --commit    attaches them
 *
 * Running it twice is safe: a file already on its order is left alone.
 */
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { storageRoot } from './crm/storage';
import { attachOrderDocuments, printDocumentReport } from './crm/documents';

const prisma = new PrismaClient();

async function main() {
  const index = process.argv.indexOf('--from');
  const dir = index !== -1 ? process.argv[index + 1] : undefined;
  if (!dir || !fs.existsSync(dir)) throw new Error('Pass --from "<package folder>" (the one holding other-files.csv).');
  const commit = process.argv.includes('--commit');

  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  console.log(commit ? '--- attaching ---' : '--- rehearsal: nothing is written ---');
  const report = await attachOrderDocuments({
    prisma,
    dir,
    storageRoot: storageRoot(),
    commit,
    uploadedById: admin?.id ?? null,
  });
  printDocumentReport(report, commit);
  if (!commit && report.attached) console.log('\nRun again with --commit to attach them.');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
