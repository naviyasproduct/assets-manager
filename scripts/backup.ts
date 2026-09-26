/**
 * Copies everything this system holds into a folder anyone can open.
 *
 *   npm run backup -- --out "D:\asset-backups"
 *
 * Two things live in one backup, because they answer two different questions.
 *
 * The **folders and CSVs** are for reading: open `assets/assets.csv` in Excel,
 * open `purchase-orders/JJCAM-5023/` and see that order's photographs under
 * names that say what they are. Nothing has to be installed and nothing has to
 * be restored to look at it. This is what makes the data stop being invisible.
 *
 * `database.sql` is for restoring: a `pg_dump` of the live database, which is
 * the only copy that can be put back exactly as it was, foreign keys and all.
 * The CSVs cannot do that - they are flattened for people, not for machines.
 *
 * Both are taken from the same moment, so they agree with each other.
 *
 * It only ever reads. Nothing in the system is changed by running this.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { toCsv } from './crm/csv';

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

/** tsx does not read .env, and both the storage root and the database are in it. */
function fromEnv(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  if (!fs.existsSync('.env')) return undefined;
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const match = new RegExp(`^\\s*${key}\\s*=\\s*(.*)\\s*$`).exec(line);
    if (match) return match[1].trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}

/**
 * A filename Windows will accept, short enough not to blow the 260-character
 * path limit once it is nested a few folders deep.
 */
function safe(name: string, max = 60): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim();
  return (cleaned || 'untitled').slice(0, max);
}

const money = (value: { toString(): string } | null) => (value === null ? '' : value.toString());
const date = (value: Date | null) => (value === null ? '' : value.toISOString().slice(0, 10));
const stamp = (value: Date | null) => (value === null ? '' : value.toISOString());

async function main() {
  const out = arg('out');
  if (!out) {
    console.error(
      'Usage: npm run backup -- --out "<folder>" [--no-images] [--no-videos] [--no-database]',
    );
    process.exit(1);
  }

  const storage = path.resolve(fromEnv('VIDEO_STORAGE_DIR') ?? './videos');
  const withImages = !has('no-images');
  const withVideos = !has('no-videos');
  const withDatabase = !has('no-database');

  const now = new Date();
  const folder = `asset-manager-backup_${now.toISOString().slice(0, 10)}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const root = path.join(path.resolve(out), folder);
  fs.mkdirSync(root, { recursive: true });

  console.log(`Writing ${root}`);
  console.log(`Photos and videos are read from ${storage}\n`);

  let copied = 0;
  let missing = 0;
  let bytes = 0;

  /** Copies one stored file to a readable name. Returns the name it was given. */
  function take(relativePath: string | null, into: string, called: string): string {
    if (!relativePath) return '';
    const source = path.join(storage, relativePath);
    if (!fs.existsSync(source)) {
      missing += 1;
      return '';
    }
    const named = `${safe(called)}${path.extname(relativePath) || '.jpg'}`;
    fs.mkdirSync(into, { recursive: true });

    // Two things can share a name - two assets called "Drill" - so the second
    // gets a number rather than overwriting the first.
    let target = path.join(into, named);
    for (let n = 2; fs.existsSync(target); n++) {
      target = path.join(into, `${safe(called)} (${n})${path.extname(relativePath) || '.jpg'}`);
    }
    fs.copyFileSync(source, target);
    bytes += fs.statSync(source).size;
    copied += 1;
    return path.basename(target);
  }

  const write = (file: string, text: string) => {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text, 'utf8');
  };

  // --- Reference lists ---------------------------------------------------------
  const departments = await prisma.department.findMany({ orderBy: { name: 'asc' } });
  write(
    'reference/departments.csv',
    toCsv(
      departments.map((d) => ({
        code: d.code,
        name: d.name,
        description: d.description ?? '',
        location: d.location ?? '',
        active: d.isActive ? 'yes' : 'no',
      })),
      ['code', 'name', 'description', 'location', 'active'],
    ),
  );

  const categories = await prisma.assetCategory.findMany({
    orderBy: { name: 'asc' },
    include: { department: { select: { name: true } } },
  });
  write(
    'reference/categories.csv',
    toCsv(
      categories.map((c) => ({
        department: c.department.name,
        code: c.code,
        name: c.name,
        active: c.isActive ? 'yes' : 'no',
      })),
      ['department', 'code', 'name', 'active'],
    ),
  );

  const locations = await prisma.location.findMany({ orderBy: { name: 'asc' } });
  write(
    'reference/locations.csv',
    toCsv(
      locations.map((l) => ({
        name: l.name,
        description: l.description ?? '',
        active: l.isActive ? 'yes' : 'no',
      })),
      ['name', 'description', 'active'],
    ),
  );

  const units = await prisma.unit.findMany({ orderBy: { sortOrder: 'asc' } });
  write(
    'reference/units.csv',
    toCsv(
      units.map((u) => ({ name: u.name, active: u.isActive ? 'yes' : 'no' })),
      ['name', 'active'],
    ),
  );

  const catalogue = await prisma.catalogueItem.findMany({
    orderBy: { name: 'asc' },
    include: { descriptions: { select: { text: true }, orderBy: { text: 'asc' } } },
  });
  write(
    'reference/catalogue.csv',
    toCsv(
      catalogue.map((c) => ({ item: c.name, descriptions: c.descriptions.map((d) => d.text).join(' | ') })),
      ['item', 'descriptions'],
    ),
  );

  const dropdowns = await prisma.orderListOption.findMany({ orderBy: [{ kind: 'asc' }, { value: 'asc' }] });
  write(
    'reference/order-dropdowns.csv',
    toCsv(
      dropdowns.map((o) => ({ list: o.kind, value: o.value, active: o.isActive ? 'yes' : 'no' })),
      ['list', 'value', 'active'],
    ),
  );

  console.log(
    `reference      ${departments.length} departments, ${categories.length} categories, ` +
      `${locations.length} locations, ${units.length} units, ${catalogue.length} catalogue items`,
  );

  // --- Assets -------------------------------------------------------------------
  const assets = await prisma.asset.findMany({
    orderBy: { assetTag: 'asc' },
    include: {
      category: { select: { name: true } },
      department: { select: { name: true } },
      location: { select: { name: true } },
      _count: { select: { fixes: true } },
    },
  });

  write(
    'assets/assets.csv',
    toCsv(
      assets.map((a) => ({
        tag: a.assetTag,
        name: a.name,
        department: a.department.name,
        category: a.category.name,
        location: a.location?.name ?? '',
        quantity: String(a.quantity),
        status: a.status,
        serialNumber: a.serialNumber ?? '',
        purchaseDate: date(a.purchaseDate),
        unitCost: money(a.unitCost),
        repairs: String(a._count.fixes),
        notes: a.notes ?? '',
        photo: withImages
          ? take(a.photoRelativePath, path.join(root, 'assets/photos'), `${a.assetTag} ${a.name}`)
          : '',
      })),
      [
        'tag', 'name', 'department', 'category', 'location', 'quantity', 'status',
        'serialNumber', 'purchaseDate', 'unitCost', 'repairs', 'notes', 'photo',
      ],
    ),
  );
  console.log(`assets         ${assets.length}`);

  // --- People and suppliers ------------------------------------------------------
  const people = await prisma.user.findMany({
    orderBy: { name: 'asc' },
    include: { department: { select: { name: true } } },
  });
  write(
    'people/employees.csv',
    toCsv(
      people.map((p) => ({
        name: p.name,
        email: p.email,
        role: p.role,
        jobTitle: p.jobTitle ?? '',
        phone: p.phone ?? '',
        department: p.department?.name ?? (p.allDepartments ? 'All departments' : ''),
        active: p.isActive ? 'yes' : 'no',
        lastSignedIn: stamp(p.lastLoginAt),
        photo: withImages
          ? take(p.photoRelativePath, path.join(root, 'people/photos'), p.name)
          : '',
      })),
      ['name', 'email', 'role', 'jobTitle', 'phone', 'department', 'active', 'lastSignedIn', 'photo'],
    ),
  );

  const suppliers = await prisma.supplier.findMany({ orderBy: { name: 'asc' } });
  write(
    'suppliers/suppliers.csv',
    toCsv(
      suppliers.map((s) => ({
        name: s.name,
        kind: s.kind,
        contactPerson: s.contactPerson ?? '',
        phone: s.phone ?? '',
        altPhone: s.altPhone ?? '',
        email: s.email ?? '',
        website: s.website ?? '',
        address: [s.address, s.city, s.country].filter(Boolean).join(', '),
        notes: s.notes ?? '',
        active: s.isActive ? 'yes' : 'no',
        logo: withImages
          ? take(s.photoRelativePath, path.join(root, 'suppliers/logos'), s.name)
          : '',
      })),
      [
        'name', 'kind', 'contactPerson', 'phone', 'altPhone', 'email', 'website',
        'address', 'notes', 'active', 'logo',
      ],
    ),
  );
  console.log(`people         ${people.length}, suppliers ${suppliers.length}`);

  // --- Purchase orders ------------------------------------------------------------
  // Each order also gets a folder of its own named after its number, so the
  // photographs can be found by somebody who has never seen a CSV.
  const orders = await prisma.purchaseOrder.findMany({
    orderBy: { number: 'asc' },
    include: {
      department: { select: { name: true } },
      createdBy: { select: { name: true } },
      completedBy: { select: { name: true } },
      requestedBy: { select: { name: true } },
      issuedBy: { select: { name: true } },
      checkedBy: { select: { name: true } },
      authorizedBy: { select: { name: true } },
      suppliers: { include: { supplier: { select: { name: true } } } },
      assignees: { include: { user: { select: { name: true } } } },
      photos: { orderBy: { createdAt: 'asc' } },
      items: {
        orderBy: { position: 'asc' },
        include: {
          unit: { select: { name: true } },
          category: { select: { name: true } },
          supplier: { select: { name: true } },
          receivedAsset: { select: { assetTag: true } },
          basedOnAsset: { select: { assetTag: true, photoRelativePath: true } },
        },
      },
    },
  });

  const orderRows = [];
  const lineRows = [];

  for (const order of orders) {
    const dir = path.join(root, 'purchase-orders', safe(order.number, 40));

    let sheets = 0;
    let received = 0;
    if (withImages) {
      for (const photo of order.photos) {
        if (photo.kind === 'SHEET') {
          sheets += 1;
          take(photo.relativePath, dir, `written order ${sheets}`);
        } else {
          received += 1;
          take(photo.relativePath, dir, `what was bought ${received}`);
        }
      }
    }

    orderRows.push({
      number: order.number,
      kind: order.kind,
      status: order.status,
      department: order.department.name,
      written: date(order.createdAt),
      writtenBy: order.createdBy.name,
      sentOut: date(order.sentAt),
      completed: date(order.completedAt),
      completedBy: order.completedBy?.name ?? '',
      suppliers: order.suppliers.map((s) => s.supplier.name).join(' | '),
      lookingAfterIt: order.assignees.map((a) => a.user.name).join(' | '),
      requestedBy: order.requestedBy?.name ?? '',
      issuedBy: order.issuedBy?.name ?? '',
      checkedBy: order.checkedBy?.name ?? '',
      authorizedBy: order.authorizedBy?.name ?? '',
      from: order.originFrom ?? '',
      attention: order.attention ?? '',
      delivery: order.deliveryTerms ?? '',
      payment: order.paymentTerms ?? '',
      lines: String(order.items.length),
      note: order.note ?? '',
      folder: `purchase-orders/${safe(order.number, 40)}`,
    });

    for (const [index, item] of order.items.entries()) {
      const photo = withImages
        ? take(
            item.photoRelativePath ?? item.basedOnAsset?.photoRelativePath ?? null,
            path.join(dir, 'items'),
            `${index + 1} ${item.name}`,
          )
        : '';
      lineRows.push({
        order: order.number,
        line: String(index + 1),
        item: item.name,
        details: item.details ?? '',
        quantity: item.quantity.toString(),
        unit: item.unit?.name ?? '',
        unitPrice: money(item.boughtUnitPrice),
        category: item.category?.name ?? '',
        boughtFrom: item.supplier?.name ?? '',
        arrived: date(item.receivedDate),
        nowAsset: item.receivedAsset?.assetTag ?? '',
        photo: photo ? `purchase-orders/${safe(order.number, 40)}/items/${photo}` : '',
      });
    }
  }

  write(
    'purchase-orders/orders.csv',
    toCsv(orderRows, [
      'number', 'kind', 'status', 'department', 'written', 'writtenBy', 'sentOut',
      'completed', 'completedBy', 'suppliers', 'lookingAfterIt', 'requestedBy',
      'issuedBy', 'checkedBy', 'authorizedBy', 'from', 'attention', 'delivery',
      'payment', 'lines', 'note', 'folder',
    ]),
  );
  write(
    'purchase-orders/order-items.csv',
    toCsv(lineRows, [
      'order', 'line', 'item', 'details', 'quantity', 'unit', 'unitPrice',
      'category', 'boughtFrom', 'arrived', 'nowAsset', 'photo',
    ]),
  );
  console.log(`orders         ${orders.length} with ${lineRows.length} lines`);

  // --- Repairs, and the videos of them ---------------------------------------------
  const fixes = await prisma.machineFix.findMany({
    orderBy: { fixedAt: 'desc' },
    include: {
      asset: { select: { assetTag: true, name: true } },
      recordedBy: { select: { name: true } },
    },
  });

  write(
    'repairs/repairs.csv',
    toCsv(
      fixes.map((fix) => ({
        assetTag: fix.asset.assetTag,
        asset: fix.asset.name,
        fixedAt: date(fix.fixedAt),
        title: fix.title,
        symptom: fix.symptom ?? '',
        description: fix.description,
        fixedBy: fix.fixedByName,
        recordedBy: fix.recordedBy.name,
        video: withVideos
          ? take(
              fix.videoRelativePath,
              path.join(root, 'repairs/videos', safe(fix.asset.assetTag, 30)),
              `${date(fix.fixedAt)} ${fix.title}`,
            )
          : '',
      })),
      [
        'assetTag', 'asset', 'fixedAt', 'title', 'symptom', 'description',
        'fixedBy', 'recordedBy', 'video',
      ],
    ),
  );
  console.log(`repairs        ${fixes.length}`);

  // --- The database itself ----------------------------------------------------------
  let database: string | null = null;
  if (withDatabase) {
    const url = fromEnv('DATABASE_URL');
    const exe = findPgDump();
    if (!url) {
      console.log('database       skipped - no DATABASE_URL');
    } else if (!exe) {
      console.log('database       skipped - pg_dump was not found (see README.txt)');
    } else {
      const target = path.join(root, 'database.sql');
      const { url: dumpUrl, schema } = forPgDump(url);
      const result = spawnSync(
        exe,
        [
          '--no-owner',
          '--no-privileges',
          ...(schema ? [`--schema=${schema}`] : []),
          '--file',
          target,
          dumpUrl,
        ],
        { encoding: 'utf8' },
      );
      if (result.status === 0) {
        database = 'database.sql';
        console.log(`database       ${(fs.statSync(target).size / 1e6).toFixed(1)} MB`);
      } else {
        console.log(`database       FAILED: ${(result.stderr || '').trim().split('\n')[0]}`);
      }
    }
  }

  // --- What it is, in the folder ------------------------------------------------------
  const manifest = {
    takenAt: now.toISOString(),
    storageRoot: storage,
    counts: {
      assets: assets.length,
      orders: orders.length,
      orderLines: lineRows.length,
      people: people.length,
      suppliers: suppliers.length,
      departments: departments.length,
      categories: categories.length,
      locations: locations.length,
      repairs: fixes.length,
    },
    files: { copied, missing, bytes },
    database,
    includes: { images: withImages, videos: withVideos, database: Boolean(database) },
  };
  write('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

  write(
    'README.txt',
    [
      'Asset Manager backup',
      '====================',
      '',
      `Taken ${now.toLocaleString()}.`,
      '',
      'WHAT IS IN HERE',
      '',
      '  assets/assets.csv            every machine on record',
      '  assets/photos/               their photographs, named by tag',
      '  purchase-orders/orders.csv   every order',
      '  purchase-orders/order-items.csv   every line of every order',
      '  purchase-orders/<NUMBER>/    that order\'s photographs:',
      '                                 "written order 1.jpg"  the paper it came from',
      '                                 "what was bought 1.jpg"  what turned up',
      '                                 items/  a photo per line',
      '  people/employees.csv         everyone, with their photographs in people/photos/',
      '  suppliers/suppliers.csv      every supplier, logos in suppliers/logos/',
      '  repairs/repairs.csv          every repair, videos in repairs/videos/<TAG>/',
      '  reference/                   departments, categories, locations, units, catalogue',
      '  manifest.json                what was taken, and when',
      database ? '  database.sql                 the database itself (see below)' : '',
      '',
      'The CSVs open in Excel. Nothing here needs the system running to read.',
      '',
      'TO PUT IT BACK',
      '',
      database
        ? [
            '  The CSVs are for reading, not for restoring - they are flattened for',
            '  people. To restore the system exactly as it was:',
            '',
            '    1. createdb assets_manager           (a fresh, empty database)',
            '    2. psql -d assets_manager -f database.sql',
            '    3. copy the photo and video folders back to VIDEO_STORAGE_DIR',
            '       (this backup came from: ' + storage + ')',
            '',
            '  Restoring over a database that already has data will fail. Restore',
            '  into an empty one.',
          ].join('\n')
        : [
            '  This backup has NO database.sql, so it can be read but not restored.',
            '  pg_dump was not found when it was taken. Install the PostgreSQL',
            '  client tools, or run the backup on the PC that hosts the database,',
            '  and take another one.',
          ].join('\n'),
      '',
      'WHERE THE LIVE DATA ACTUALLY LIVES',
      '',
      '  The records      in PostgreSQL, on the PC that runs the system.',
      `  The photos       ${storage}\\images\\`,
      `  The videos       ${storage}\\`,
      '',
      '  Both are needed. The database holds the file NAMES; the folder holds',
      '  the files. One without the other is half a backup, which is why this',
      '  script takes them together.',
      '',
    ]
      .filter((line) => line !== '')
      .join('\n'),
  );

  console.log(`\nfiles copied   ${copied} (${(bytes / 1e6).toFixed(0)} MB)`);
  if (missing) console.log(`files missing  ${missing} - named in the data but not on disk`);
  console.log(`\nDone. ${root}`);
}

/**
 * Prisma's connection string carries parameters libpq has never heard of -
 * `schema`, `connection_limit`, `pgbouncer` - and pg_dump refuses the whole URL
 * over any one of them. They are taken off here, and `schema` is handed back so
 * it can be passed properly as `--schema=`.
 */
function forPgDump(raw: string): { url: string; schema: string | null } {
  try {
    const parsed = new URL(raw);
    const schema = parsed.searchParams.get('schema');
    for (const key of [...parsed.searchParams.keys()]) {
      // Everything libpq understands stays; the rest is Prisma's own.
      if (!['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'connect_timeout', 'application_name'].includes(key)) {
        parsed.searchParams.delete(key);
      }
    }
    return { url: parsed.toString(), schema };
  } catch {
    return { url: raw, schema: null };
  }
}

/**
 * pg_dump is not on PATH in a default Windows PostgreSQL install, so the usual
 * places are tried before giving up. PGDUMP overrides all of it.
 */
function findPgDump(): string | null {
  const configured = fromEnv('PGDUMP');
  if (configured && fs.existsSync(configured)) return configured;

  const onPath = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['pg_dump'], {
    encoding: 'utf8',
  });
  if (onPath.status === 0) {
    const first = onPath.stdout.split('\n')[0]?.trim();
    if (first && fs.existsSync(first)) return first;
  }

  for (const version of ['17', '16', '15', '14']) {
    const guess = `C:\\Program Files\\PostgreSQL\\${version}\\bin\\pg_dump.exe`;
    if (fs.existsSync(guess)) return guess;
  }
  return null;
}

main()
  .catch((error) => {
    console.error('\nBackup failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
