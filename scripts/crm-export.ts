/**
 * Packs the old CRM into a folder that can be carried on a disk.
 *
 *   npm run crm-export -- --from "D:\jjc-crm" --out "D:\crm-package"
 *
 * The package is CSV files plus the photos they name - no PHP, no MySQL, and
 * nothing that has to be installed to read it. Open the CSVs in Excel to see
 * exactly what will be imported before anything touches the database.
 *
 * It never writes to the CRM folder, and never to the database. The other half
 * is `npm run crm-import`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readCrm, type CrmOrder } from './crm/read';
import { toCsv } from './crm/csv';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const from = arg('from');
  const out = arg('out') ?? 'crm-export';
  const withImages = !has('no-images');

  if (!from) {
    console.error(
      'Usage: npm run crm-export -- --from "<old CRM folder>" [--out <folder>] [--backup <file.sql|.zip>] [--no-images]',
    );
    process.exit(1);
  }
  if (!fs.existsSync(from)) {
    console.error(`There is no folder at ${from}`);
    process.exit(1);
  }

  const crm = readCrm(path.resolve(from), arg('backup'));
  console.log(`Read ${crm.source}`);

  const outDir = path.resolve(out);
  fs.mkdirSync(outDir, { recursive: true });
  const write = (name: string, text: string) => fs.writeFileSync(path.join(outDir, name), text, 'utf8');

  // --- Photos ----------------------------------------------------------------
  // Copied under the name the CRM stored them by, so a photo used twice is
  // copied once and the CSV can point at it.
  const imagesDir = path.join(outDir, 'images');
  const filesDir = path.join(outDir, 'files');
  const copied = new Map<string, string>();
  const missing: string[] = [];
  const others: Array<{ belongsTo: string; name: string; file: string }> = [];
  let bytes = 0;

  /** The old "Attachment" box took anything; only pictures can be shown as one. */
  function isImage(file: string): boolean {
    const head = Buffer.alloc(4);
    const handle = fs.openSync(file, 'r');
    fs.readSync(handle, head, 0, 4, 0);
    fs.closeSync(handle);
    return (
      (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) || // jpeg
      head.toString('latin1') === 'PNG' ||
      head.toString('latin1') === 'RIFF' || // webp
      head.toString('latin1', 0, 3) === 'GIF'
    );
  }

  const take = (name: string, belongsTo = ''): string => {
    if (!name) return '';
    const cacheKey = `${name}`;
    if (copied.has(cacheKey)) return copied.get(cacheKey)!;

    const source = (crm.files as unknown as { get(n: string): string | undefined }).get(name);
    if (!source) {
      missing.push(name);
      copied.set(cacheKey, '');
      return '';
    }
    const stored = path.basename(source);

    // A PDF or a spreadsheet cannot be a photo. It still travels with the
    // package, under its real name, and the import writes it into the order's
    // note so nobody has to go looking for something they did not know existed.
    if (!isImage(source)) {
      others.push({ belongsTo, name, file: stored });
      if (withImages) {
        fs.mkdirSync(filesDir, { recursive: true });
        const target = path.join(filesDir, stored);
        if (!fs.existsSync(target)) fs.copyFileSync(source, target);
        bytes += fs.statSync(source).size;
      }
      copied.set(cacheKey, '');
      return '';
    }

    if (withImages) {
      fs.mkdirSync(imagesDir, { recursive: true });
      const target = path.join(imagesDir, stored);
      if (!fs.existsSync(target)) fs.copyFileSync(source, target);
      bytes += fs.statSync(source).size;
    }
    copied.set(cacheKey, stored);
    return stored;
  };

  const takeAll = (names: string[], belongsTo = '') =>
    names.map((name) => take(name, belongsTo)).filter(Boolean).join(';');

  // --- The tables --------------------------------------------------------------
  write(
    'departments.csv',
    toCsv(crm.departments.map((d) => ({ name: d.name })), ['name']),
  );

  write(
    'employees.csv',
    toCsv(
      crm.staff.map((s) => ({ name: s.name, photo: s.photo ? take(s.photo) : '' })),
      ['name', 'photo'],
    ),
  );

  write(
    'suppliers.csv',
    toCsv(
      crm.suppliers.map((s) => ({
        name: s.company,
        kind: 'INTERNATIONAL',
        contactPerson: s.contactPerson ?? '',
        country: s.country ?? '',
        phone: s.phone ?? '',
        email: s.email ?? '',
      })),
      ['name', 'kind', 'contactPerson', 'country', 'phone', 'email'],
    ),
  );

  const supplierName = new Map(crm.suppliers.map((s) => [s.key, s.company]));
  const orderRow = (o: CrmOrder) => ({
    number: o.number,
    kind: o.kind,
    department: o.department,
    date: o.date,
    time: o.time,
    oldStatus: o.oldStatus,
    payments: o.payments,
    delivery: o.delivery,
    supplier: supplierName.get(o.supplierKey) ?? '',
    requestedBy: o.requestedBy,
    issuedBy: o.issuedBy,
    checkedBy: o.checkedBy,
    authorizedBy: o.authorizedBy,
    officer: o.officer,
    attention: o.attention,
    oldTotal: o.oldTotal,
    lines: o.items.length,
    sheetImages: takeAll(o.sheetImages, o.number),
    billImages: takeAll(o.billImages, o.number),
    receivedImages: takeAll(o.receivedImages, o.number),
  });

  const orders = crm.orders.map(orderRow);
  write(
    'orders.csv',
    toCsv(orders, [
      'number', 'kind', 'department', 'date', 'time', 'oldStatus', 'payments', 'delivery',
      'supplier', 'requestedBy', 'issuedBy', 'checkedBy', 'authorizedBy', 'officer', 'attention',
      'oldTotal', 'lines', 'sheetImages', 'billImages', 'receivedImages',
    ]),
  );

  const lines = crm.orders.flatMap((order, orderIndex) =>
    order.items.map((item, index) => ({
      orderNumber: order.number,
      position: index + 1,
      lineNo: item.lineNo,
      item: item.item,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      amount: item.amount,
      remarks: item.remarks,
      receivedDate: item.receivedDate,
      image: item.image ? take(item.image, order.number) : '',
      _order: orderIndex,
    })),
  );
  write(
    'order-items.csv',
    toCsv(lines, [
      'orderNumber', 'position', 'lineNo', 'item', 'description', 'quantity', 'unit',
      'unitPrice', 'amount', 'remarks', 'receivedDate', 'image',
    ]),
  );

  // Everything that came off the old system but is not a photograph.
  write(
    'other-files.csv',
    toCsv(others, ['belongsTo', 'name', 'file']),
  );

  // Kept for reference: the new system has no catalogue of its own, so this is
  // the only place the unused entries survive.
  write(
    'item-catalogue.csv',
    toCsv(crm.catalogue, ['item', 'description', 'usedOnOrders']),
  );

  const manifest = {
    exportedAt: new Date().toISOString(),
    source: crm.source,
    from: path.resolve(from),
    counts: {
      orders: crm.orders.length,
      orderLines: lines.length,
      departments: crm.departments.length,
      employees: crm.staff.length,
      suppliers: crm.suppliers.length,
      catalogue: crm.catalogue.length,
      images: [...copied.values()].filter(Boolean).length,
      imagesMissing: missing.length,
      otherFiles: others.length,
    },
    imagesIncluded: withImages,
    imageBytes: bytes,
    warnings: [...crm.warnings, ...(missing.length ? [`${missing.length} photos are named in the CRM but not on its disk.`] : [])],
    missingImages: missing,
  };
  write('manifest.json', JSON.stringify(manifest, null, 2) + '\n');

  write(
    'README.txt',
    [
      'JJC CRM export',
      '==============',
      '',
      `Taken from ${crm.source} on ${new Date().toDateString()}.`,
      '',
      'What is here:',
      '  orders.csv          one row per purchase order',
      '  order-items.csv     one row per line of an order',
      '  suppliers.csv       the oversea suppliers, with their contact details',
      '  employees.csv       the staff named on the orders',
      '  departments.csv     the departments the orders belong to',
      '  item-catalogue.csv  every item name the old system knew, for reference',
      '  other-files.csv     attachments that are not photos (PDFs and the like)',
      '  images/             every photo the CSVs name',
      '  files/              the attachments that are not photos, kept as they were',
      '',
      'To load it into the Asset Manager, on the PC that runs it:',
      '',
      '  npm run crm-import -- --from "<this folder>"            (a rehearsal: changes nothing)',
      '  npm run crm-import -- --from "<this folder>" --commit    (writes it in)',
      '',
      'The rehearsal prints exactly what it would create. Run it first.',
      'Running the import twice does not duplicate anything: orders already',
      'there are left alone.',
      '',
    ].join('\n'),
  );

  console.log(`\nWrote ${outDir}`);
  console.log(`  orders            ${manifest.counts.orders}`);
  console.log(`  order lines       ${manifest.counts.orderLines}`);
  console.log(`  suppliers         ${manifest.counts.suppliers}`);
  console.log(`  employees         ${manifest.counts.employees}`);
  console.log(`  departments       ${manifest.counts.departments}`);
  console.log(`  catalogue rows    ${manifest.counts.catalogue}`);
  console.log(
    `  photos            ${manifest.counts.images}` +
      (withImages ? ` (${(bytes / 1e6).toFixed(0)} MB copied)` : ' (not copied: --no-images)'),
  );
  if (others.length) console.log(`  other files       ${others.length} (PDFs etc, in files/)`);
  if (missing.length) console.log(`  photos missing    ${missing.length} (listed in manifest.json)`);
  for (const warning of crm.warnings) console.log(`  ! ${warning}`);
}

main().catch((error) => {
  console.error('\nExport failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
