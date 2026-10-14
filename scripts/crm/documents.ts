import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { fromCsv } from './csv';

/**
 * Brings the package's non-photo attachments (other-files.csv + files/) in as
 * order documents. Shared by crm-import, for a fresh load, and crm-documents,
 * for a system whose orders were imported before documents existed.
 *
 * Safe to run again: a file whose name is already on that order is skipped.
 * The storage layout matches src/lib/document-storage.ts, which a script cannot
 * import because of its `server-only` guard.
 */

const TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export type DocumentReport = {
  attached: number;
  alreadyThere: number;
  noOrder: string[];
  missingFile: string[];
  unsupported: string[];
};

export async function attachOrderDocuments(options: {
  prisma: PrismaClient;
  dir: string;
  storageRoot: string;
  commit: boolean;
  uploadedById: string | null;
}): Promise<DocumentReport> {
  const { prisma, dir, storageRoot, commit, uploadedById } = options;
  const report: DocumentReport = { attached: 0, alreadyThere: 0, noOrder: [], missingFile: [], unsupported: [] };

  const csv = path.join(dir, 'other-files.csv');
  if (!fs.existsSync(csv)) return report;

  for (const row of fromCsv(fs.readFileSync(csv, 'utf8'))) {
    // The name the person gave it, with the upload timestamp trimmed off.
    const fileName = row.name.replace(/^\d{10,}_/, '');
    const ext = path.extname(fileName).toLowerCase();
    const mimeType = TYPES[ext];
    if (!mimeType) {
      report.unsupported.push(`${row.belongsTo}: ${fileName}`);
      continue;
    }

    const source = path.join(dir, 'files', row.file);
    if (!fs.existsSync(source)) {
      report.missingFile.push(`${row.belongsTo}: ${fileName}`);
      continue;
    }

    const order = await prisma.purchaseOrder.findUnique({
      where: { number: row.belongsTo },
      select: { id: true, documents: { select: { fileName: true } } },
    });
    if (!order) {
      report.noOrder.push(`${row.belongsTo}: ${fileName}`);
      continue;
    }
    if (order.documents.some((d) => d.fileName === fileName)) {
      report.alreadyThere += 1;
      continue;
    }

    report.attached += 1;
    if (!commit) continue;

    const stem = path.basename(fileName, ext).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60) || 'document';
    const relativePath = path.posix.join(
      'documents',
      'orders',
      order.id,
      `${stem}-${crypto.randomBytes(6).toString('hex')}${ext}`,
    );
    const target = path.join(storageRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    await prisma.purchaseOrderDocument.create({
      data: {
        orderId: order.id,
        fileName,
        relativePath,
        mimeType,
        sizeBytes: fs.statSync(target).size,
        uploadedById,
      },
    });
  }
  return report;
}

export function printDocumentReport(report: DocumentReport, commit: boolean): void {
  console.log(`  ${report.attached} documents ${commit ? 'attached' : 'to attach'}`);
  if (report.alreadyThere) console.log(`  ${report.alreadyThere} already on their order, left alone`);
  for (const [label, list] of [
    ['no order with that number', report.noOrder],
    ['file missing from the package', report.missingFile],
    ['not a PDF, Word or Excel file', report.unsupported],
  ] as const) {
    if (list.length === 0) continue;
    console.log(`  ${list.length} skipped - ${label}:`);
    for (const line of list) console.log(`    ${line}`);
  }
}
