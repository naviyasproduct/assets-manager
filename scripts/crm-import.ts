/**
 * Loads a CRM export package into this system.
 *
 *   npm run crm-import -- --from "D:\crm-package"            rehearsal, writes nothing
 *   npm run crm-import -- --from "D:\crm-package" --commit    writes it in
 *
 * Reads only the CSV files written by `npm run crm-export`; it knows nothing
 * about the old software. Nothing already in the system is changed: orders
 * whose number is already there are skipped, and departments, suppliers and
 * people are matched by name before any are created - so running it twice is
 * safe, and running it on a system that already has real data adds to it
 * rather than replacing it.
 *
 * What it cannot keep, it writes down instead of dropping: the old stage, the
 * four sign-off roles, delivery and payment terms and the typed total all go
 * into the order's note, and a line's unit ("2.25 Kg") into the line's details.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PrismaClient, type Prisma, type PurchaseOrderStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { fromCsv } from './crm/csv';

const prisma = new PrismaClient();

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : fallback;
}
const has = (name: string) => process.argv.includes(`--${name}`);

/** tsx does not read .env, and the photo folder is configured there. */
function storageRoot(): string {
  let configured = process.env.VIDEO_STORAGE_DIR;
  if (!configured && fs.existsSync('.env')) {
    for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
      const match = /^\s*VIDEO_STORAGE_DIR\s*=\s*(.*)\s*$/.exec(line);
      if (match) configured = match[1].trim().replace(/^["']|["']$/g, '').replace(/\\\\/g, '\\');
    }
  }
  return path.resolve(configured || './videos');
}

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const money = (value: string): number | null => {
  const n = Number(String(value).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) && n !== 0 ? Math.round(n * 100) / 100 : null;
};
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
const key = (value: string) => clean(value).toLowerCase();

/**
 * People are matched on the name itself, because the old system spelled the
 * same person several ways: "Mr. Nishantha" in the staff list, "Mr.Nishantha"
 * in the dropdown on an order. Titles and punctuation go, so both land on one
 * person instead of two half-empty ones.
 */
const personKey = (value: string) =>
  key(value)
    .replace(/^(mr|mrs|ms|miss|dr)\.?\s*/, '')
    .replace(/[^a-z0-9]/g, '');
const tidy = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 6 });

type Report = {
  created: string[];
  skipped: string[];
  notes: string[];
  noDepartment: string[];
  photos: number;
  photosMissing: number;
};

async function main() {
  const from = arg('from');
  const commit = has('commit');
  const emailDomain = arg('email-domain', 'old-crm.local')!;
  const overseaDepartment = arg('oversea-department', 'Imports')!;
  const defaultDepartment = arg('default-department', 'Unsorted')!;
  // The old system had one "Attachment" box, and in practice it holds more
  // photographs of the paperwork, so those sit with the written order rather
  // than pretending to be pictures of what arrived. A bill is different: it
  // comes back with the goods, so it always goes there.
  const attachmentsAs = arg('attachments-as', 'sheet') === 'received' ? 'RECEIVED' : 'SHEET';

  if (!from) {
    console.error('Usage: npm run crm-import -- --from "<package folder>" [--commit]');
    console.error('  --oversea-department <name>   where oversea orders go (default: Imports)');
    console.error('  --default-department <name>   for orders with no department (default: Unsorted)');
    console.error('  --admin <email>               whose name goes on the imported orders');
    console.error('  --attachments-as sheet|received  where the loose photos go (default: sheet)');
    process.exit(1);
  }

  const dir = path.resolve(from);
  const read = (file: string) => {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) throw new Error(`${file} is missing from ${dir}`);
    return fromCsv(fs.readFileSync(full, 'utf8'));
  };

  const orders = read('orders.csv');
  const lines = read('order-items.csv');
  const suppliers = read('suppliers.csv');
  const employees = read('employees.csv');
  const imagesDir = path.join(dir, 'images');

  // Attachments that were never photographs - PDFs, a spreadsheet. The app has
  // nowhere to show them, so each order's note says what it had and the files
  // stay in the package under files/.
  const otherFiles = new Map<string, string[]>();
  if (fs.existsSync(path.join(dir, 'other-files.csv'))) {
    for (const row of read('other-files.csv')) {
      const list = otherFiles.get(row.belongsTo) ?? [];
      // The name the person gave it, with the upload timestamp trimmed off.
      list.push(row.name.replace(/^\d{10,}_/, ''));
      otherFiles.set(row.belongsTo, list);
    }
  }

  const admin = arg('admin')
    ? await prisma.user.findUnique({ where: { email: arg('admin')!.toLowerCase() } })
    : await prisma.user.findFirst({ where: { role: 'ADMIN', isActive: true }, orderBy: { createdAt: 'asc' } });

  if (!admin) throw new Error('No administrator account to import as. Pass --admin <email>.');

  console.log(commit ? 'Importing for real.' : 'Rehearsal - nothing will be written. Add --commit to write.');
  console.log(`Package: ${dir}`);
  console.log(`Orders in package: ${orders.length}, lines: ${lines.length}`);
  console.log(`Importing as: ${admin.name} <${admin.email}>\n`);

  const report: Report = { created: [], skipped: [], notes: [], noDepartment: [], photos: 0, photosMissing: 0 };

  // --- Departments ------------------------------------------------------------
  const departmentIds = new Map<string, string>();
  const existingDepartments = await prisma.department.findMany();
  for (const d of existingDepartments) departmentIds.set(key(d.name), d.id);

  async function departmentFor(name: string): Promise<string> {
    const wanted = clean(name) || defaultDepartment;
    const found = departmentIds.get(key(wanted));
    if (found) return found;

    // A code is required and must be unique; the app builds asset tags from it.
    const base = wanted.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || 'DEP';
    let code = base;
    for (let n = 2; await prisma.department.findFirst({ where: { code } }); n++) {
      code = `${base.slice(0, 2)}${n}`;
    }
    report.created.push(`department "${wanted}" (${code})`);
    if (!commit) {
      departmentIds.set(key(wanted), `dry-run-${wanted}`);
      return `dry-run-${wanted}`;
    }
    const made = await prisma.department.create({
      data: { name: wanted, code, description: 'Brought over from the old CRM.' },
    });
    departmentIds.set(key(wanted), made.id);
    return made.id;
  }

  // --- Suppliers ---------------------------------------------------------------
  const supplierIds = new Map<string, string>();
  for (const s of await prisma.supplier.findMany()) supplierIds.set(key(s.name), s.id);

  for (const row of suppliers) {
    const name = clean(row.name);
    if (!name || supplierIds.has(key(name))) continue;
    report.created.push(`supplier "${name}"`);
    if (!commit) {
      supplierIds.set(key(name), `dry-run-${name}`);
      continue;
    }
    const made = await prisma.supplier.create({
      data: {
        name,
        kind: row.kind === 'LOCAL' ? 'LOCAL' : 'INTERNATIONAL',
        contactPerson: clean(row.contactPerson) || null,
        country: clean(row.country) || null,
        phone: clean(row.phone) || null,
        email: clean(row.email).toLowerCase() || null,
        notes: 'Brought over from the old CRM.',
      },
    });
    supplierIds.set(key(name), made.id);
  }

  // --- People -------------------------------------------------------------------
  const peopleIds = new Map<string, string>();
  const takenEmails = new Set<string>();
  for (const u of await prisma.user.findMany()) {
    peopleIds.set(personKey(u.name), u.id);
    takenEmails.add(u.email);
  }

  for (const row of employees) {
    const name = clean(row.name);
    if (!name) continue;
    if (peopleIds.has(personKey(name))) {
      report.notes.push(`"${name}" is the same person as one already here - not added twice`);
      continue;
    }

    // "Mr. Chab Sophorn" -> chab.sophorn@<domain>, never colliding.
    const slug =
      key(name).replace(/^(mr|mrs|ms|miss|dr)\.?\s*/, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') ||
      'person';
    let email = `${slug}@${emailDomain}`;
    for (let n = 2; takenEmails.has(email); n++) email = `${slug}${n}@${emailDomain}`;
    takenEmails.add(email);

    report.created.push(`employee "${name}" (${email}, cannot sign in yet)`);
    if (!commit) {
      peopleIds.set(personKey(name), `dry-run-${name}`);
      continue;
    }
    const made = await prisma.user.create({
      data: {
        name,
        email,
        // Unusable until an administrator sets a real one on the Employees page.
        passwordHash: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12),
        role: 'EMPLOYEE',
        isActive: false,
        mustChangePassword: true,
        jobTitle: 'From the old CRM',
      },
    });
    peopleIds.set(personKey(name), made.id);
    if (row.photo) await attachPhoto('people', made.id, row.photo, async (relativePath, mimeType) => {
      await prisma.user.update({
        where: { id: made.id },
        data: { photoRelativePath: relativePath, photoMimeType: mimeType, photoUploadedAt: new Date() },
      });
    });
  }

  /** Counts a photo the way the real run would, without copying anything. */
  function countPhoto(fileName: string) {
    if (!fileName) return;
    if (fs.existsSync(path.join(imagesDir, fileName))) report.photos += 1;
    else report.photosMissing += 1;
  }

  /** Copies one packaged photo into the app's storage and hands back its path. */
  async function attachPhoto(
    group: 'people' | 'suppliers' | 'orders',
    ownerId: string,
    fileName: string,
    save: (relativePath: string, mimeType: string) => Promise<void>,
    label = 'photo',
  ): Promise<boolean> {
    const source = path.join(imagesDir, fileName);
    if (!fs.existsSync(source)) {
      report.photosMissing += 1;
      return false;
    }
    report.photos += 1;
    if (!commit) return true;

    const extension = path.extname(fileName).toLowerCase() || '.jpg';
    if (!MIME[extension]) {
      // Should not happen - the export keeps non-photos out of these columns.
      report.notes.push(`${fileName} is not a picture; skipped.`);
      return false;
    }
    const suffix = crypto.randomBytes(6).toString('hex');
    const relativePath = path.posix.join('images', group, ownerId, `${label}-${suffix}${extension}`);
    const target = path.join(storageRoot(), relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    await save(relativePath, MIME[extension] ?? 'image/jpeg');
    return true;
  }

  // --- Orders ---------------------------------------------------------------------
  const linesByOrder = new Map<string, Array<Record<string, string>>>();
  for (const line of lines) {
    const list = linesByOrder.get(line.orderNumber) ?? [];
    list.push(line);
    linesByOrder.set(line.orderNumber, list);
  }

  const existingNumbers = new Set(
    (await prisma.purchaseOrder.findMany({ select: { number: true } })).map((o) => o.number),
  );

  const unmatchedNames = new Set<string>();
  let imported = 0;
  let importedLines = 0;
  let moneyTotal = 0;

  for (const row of orders) {
    const number = clean(row.number);
    if (existingNumbers.has(number)) {
      report.skipped.push(number);
      continue;
    }

    const departmentId = await departmentFor(
      row.kind === 'OVERSEA' ? overseaDepartment : row.department,
    );
    if (row.kind === 'LOCAL' && !clean(row.department)) {
      report.noDepartment.push(number);
    }

    const stage = key(row.oldStatus);
    const status: PurchaseOrderStatus =
      row.kind === 'LOCAL' || stage === 'received'
        ? 'COMPLETED'
        : 'PENDING';

    const when = row.date ? new Date(`${row.date}T00:00:00`) : new Date();

    // Everything the new system has no box for, kept as words.
    const people = [
      row.requestedBy && `Requested by ${row.requestedBy}`,
      row.issuedBy && `Issued by ${row.issuedBy}`,
      row.checkedBy && `Checked by ${row.checkedBy}`,
      row.authorizedBy && `Authorised by ${row.authorizedBy}`,
      row.officer && `From ${row.officer}`,
      row.attention && `Attention ${row.attention}`,
    ].filter(Boolean);

    const note = [
      `From the old CRM: ${number}${row.date ? `, ${row.date}` : ''}${row.time ? ` ${row.time}` : ''}.`,
      people.join(' · ') || null,
      [
        row.oldStatus && `Old stage: ${row.oldStatus}`,
        row.payments && `Payment: ${row.payments}`,
        row.delivery && `Delivery: ${row.delivery}`,
      ].filter(Boolean).join(' · ') || null,
      money(row.oldTotal) !== null ? `Total recorded then: $${money(row.oldTotal)!.toFixed(2)}` : null,
      otherFiles.has(number)
        ? `Also had ${otherFiles.get(number)!.length} attachment(s) that are not photos, kept in the ` +
          `export's files/ folder: ${otherFiles.get(number)!.join(', ')}`
        : null,
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 1900);

    for (const name of [row.requestedBy, row.issuedBy, row.checkedBy, row.authorizedBy]) {
      if (clean(name) && !peopleIds.has(personKey(name))) unmatchedNames.add(clean(name));
    }

    const assignees = [...new Set(
      [row.requestedBy, row.issuedBy, row.checkedBy, row.authorizedBy]
        .map(clean)
        .filter(Boolean)
        .map((name) => peopleIds.get(personKey(name)))
        .filter((id): id is string => Boolean(id) && !id!.startsWith('dry-run')),
    )];

    const supplierId = row.supplier ? supplierIds.get(key(row.supplier)) : undefined;

    const items = (linesByOrder.get(row.number) ?? []).map((line, index) => {
      const quantity = Number(line.quantity);
      const price = money(line.unitPrice);
      const amount = money(line.amount);
      const whole = Number.isInteger(quantity) && quantity >= 1 && quantity <= 9999;
      const matches =
        price !== null && amount !== null && Math.abs(price * quantity - amount) < 0.005;

      // Money is what reports add up, so it is kept exactly. Where a fractional
      // quantity or a fraction-of-a-cent price cannot survive the new columns,
      // the line becomes one unit priced at the old total, and the real figures
      // are written into its details.
      const exact = whole && (matches || amount === null);
      const details = [
        line.description,
        exact
          ? null
          : `${tidy(quantity)}${line.unit ? ` ${line.unit}` : ''} × $${tidy(Number(line.unitPrice))}` +
            (amount === null ? '' : ` = $${amount.toFixed(2)}`),
        exact && line.unit ? `In ${line.unit}` : null,
        line.remarks,
        line.receivedDate && `Received ${line.receivedDate}`,
      ]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 900);

      const value = exact ? price : (amount ?? price);
      if (value !== null) moneyTotal += value * (exact ? quantity : 1);

      return {
        position: index,
        name: clean(line.item) || clean(line.description) || 'Item',
        details: details || null,
        quantity: exact ? quantity : 1,
        boughtUnitPrice: value,
        photo: line.image,
      };
    });

    importedLines += items.length;
    imported += 1;

    if (!commit) {
      for (const item of items) countPhoto(item.photo);
      for (const field of ['sheetImages', 'billImages', 'receivedImages'] as const) {
        for (const fileName of (row[field] ?? '').split(';').filter(Boolean)) countPhoto(fileName);
      }
      continue;
    }

    const order = await prisma.purchaseOrder.create({
      data: {
        number,
        status,
        note,
        departmentId,
        createdById: admin.id,
        createdAt: when,
        sentAt: when,
        completedAt: status === 'COMPLETED' ? when : null,
        completedById: status === 'COMPLETED' ? admin.id : null,
        ...(supplierId && !supplierId.startsWith('dry-run')
          ? { suppliers: { create: [{ supplierId }] } }
          : {}),
        ...(assignees.length ? { assignees: { create: assignees.map((userId) => ({ userId })) } } : {}),
        items: {
          create: items.map((item) => ({
            position: item.position,
            name: item.name,
            details: item.details,
            quantity: item.quantity,
            boughtUnitPrice: item.boughtUnitPrice as Prisma.Decimal | null,
            ...(supplierId && !supplierId.startsWith('dry-run') ? { supplierId } : {}),
          })),
        },
      },
      include: { items: { orderBy: { position: 'asc' } } },
    });

    for (const [index, item] of items.entries()) {
      if (!item.photo) continue;
      const created = order.items[index];
      await attachPhoto('orders', order.id, item.photo, async (relativePath, mimeType) => {
        await prisma.purchaseOrderItem.update({
          where: { id: created.id },
          data: { photoRelativePath: relativePath, photoMimeType: mimeType, photoUploadedAt: new Date() },
        });
      }, `item-${created.id}`);
    }

    for (const [kind, field] of [
      ['SHEET', 'sheetImages'],
      ['RECEIVED', 'billImages'],
      [attachmentsAs, 'receivedImages'],
    ] as const) {
      for (const fileName of (row[field] ?? '').split(';').filter(Boolean)) {
        await attachPhoto('orders', order.id, fileName, async (relativePath, mimeType) => {
          await prisma.purchaseOrderPhoto.create({
            data: { orderId: order.id, kind, relativePath, mimeType, uploadedById: admin.id },
          });
        }, kind === 'SHEET' ? 'sheet' : 'received');
      }
    }
  }

  console.log('--- what this does ---');
  const grouped = new Map<string, number>();
  for (const line of report.created) {
    const kind = line.split(' ')[0];
    grouped.set(kind, (grouped.get(kind) ?? 0) + 1);
  }
  for (const [kind, count] of grouped) console.log(`  ${count} new ${kind}${count === 1 ? '' : 's'}`);
  console.log(`  ${imported} orders with ${importedLines} lines`);
  console.log(`  ${report.photos} photos${report.photosMissing ? `, ${report.photosMissing} missing from the package` : ''}`);
  const otherCount = [...otherFiles.values()].reduce((sum, list) => sum + list.length, 0);
  if (otherCount) {
    console.log(
      `  ${otherCount} attachments are not photos (PDFs and the like) - named in each order's note, ` +
        `files kept in the package's files/ folder`,
    );
  }
  console.log(`  $${moneyTotal.toFixed(2)} of purchases`);
  if (report.skipped.length) {
    console.log(`  ${report.skipped.length} orders already in the system, left alone`);
  }
  if (unmatchedNames.size) {
    console.log(
      `
  ${unmatchedNames.size} names on orders matched nobody in employees.csv, so those orders ` +
        `have no one assigned (the names are still in each order's note):`,
    );
    for (const name of unmatchedNames) console.log(`    ${name}`);
  }
  if (report.noDepartment.length) {
    console.log(
      `\n  ${report.noDepartment.length} orders had no department in the old system and went to ` +
        `"${defaultDepartment}": ${report.noDepartment.join(', ')}`,
    );
  }
  for (const note of report.notes) console.log(`\n  ${note}`);
  if (report.created.length && report.created.length <= 30) {
    console.log('\n--- created ---');
    for (const line of report.created) console.log(`  ${line}`);
  }
  console.log(
    commit
      ? '\nDone. Open Purchasing to see them.'
      : '\nNothing was written. Run it again with --commit when this looks right.',
  );
}

main()
  .catch((error) => {
    console.error('\nImport failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
