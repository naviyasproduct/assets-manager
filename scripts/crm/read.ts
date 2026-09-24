import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseDump, rowsOf, type Dump } from './dump';
import { readZip } from './zip';

/**
 * The old CRM (Rukovoditel), read as the records people actually kept in it.
 *
 * Rukovoditel stores user-defined entities: every screen is a row in
 * `app_entities`, every box on it a row in `app_fields`, and the data sits in
 * `app_entity_<id>` under column names like `field_419`. Those ids mean
 * nothing on their own, so everything here is looked up **by name** - "Local",
 * "P/O Number", "Quantity". A newer backup from the same install still works,
 * and a renamed field fails loudly instead of importing the wrong column.
 */

export type CrmStaff = { id: string; name: string; photo: string | null };
export type CrmDepartment = { id: string; name: string };
export type CrmSupplier = {
  key: string;
  company: string;
  country: string | null;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
};

export type CrmItem = {
  lineNo: string;
  item: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  amount: string;
  remarks: string;
  receivedDate: string;
  image: string | null;
};

export type CrmOrder = {
  number: string;
  kind: 'LOCAL' | 'OVERSEA';
  department: string;
  date: string;
  time: string;
  oldStatus: string;
  payments: string;
  delivery: string;
  supplierKey: string;
  requestedBy: string;
  issuedBy: string;
  checkedBy: string;
  authorizedBy: string;
  officer: string;
  attention: string;
  oldTotal: string;
  sheetImages: string[];
  billImages: string[];
  receivedImages: string[];
  items: CrmItem[];
};

export type Crm = {
  source: string;
  departments: CrmDepartment[];
  staff: CrmStaff[];
  suppliers: CrmSupplier[];
  orders: CrmOrder[];
  catalogue: Array<{ item: string; description: string; usedOnOrders: number }>;
  /** Original upload name -> file on disk. */
  files: Map<string, string>;
  warnings: string[];
};

const clean = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();

function unixDate(value: string): string {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/** The old "Time" box stores minutes since midnight: 630 -> 10:30. */
function minutesToTime(value: string): string {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Finds the newest `*.sql` or `*.sql.zip` under the CRM's backups folder. */
export function findBackup(crmRoot: string, chosen?: string): string {
  if (chosen) return path.resolve(chosen);

  const folder = path.join(crmRoot, 'backups');
  if (!fs.existsSync(folder)) {
    throw new Error(`No backups folder in ${crmRoot}. Pass --backup <file.sql|file.sql.zip>.`);
  }
  // Rukovoditel names them "<n>_<YYYY-MM-DD>_<HH-MM>_Rukovoditel_<version>.sql".
  // The name is what to trust: copying the folder (off a Drive download, say)
  // gives every file the same modified time, and picking by that silently
  // imports whichever one happened to land first.
  const candidates = fs
    .readdirSync(folder)
    .filter((name) => name.endsWith('.sql') || name.endsWith('.sql.zip'))
    .map((name) => ({
      name,
      stamp: /_(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})/.exec(name)?.slice(1).join('') ?? '',
      number: Number(/^(\d+)_/.exec(name)?.[1] ?? 0),
      at: fs.statSync(path.join(folder, name)).mtimeMs,
    }))
    .sort((a, b) => b.stamp.localeCompare(a.stamp) || b.number - a.number || b.at - a.at);

  if (candidates.length === 0) throw new Error(`No .sql or .sql.zip backup in ${folder}.`);
  if (candidates.length > 1) {
    console.log(
      `Backups found: ${candidates.map((c) => c.name).join(', ')}\n` +
        `Using the newest: ${candidates[0].name}. Pass --backup <file> to choose another.`,
    );
  }
  return path.join(folder, candidates[0].name);
}

function loadSql(file: string): string {
  const buffer = fs.readFileSync(file);
  if (!file.endsWith('.zip')) return buffer.toString('utf8');

  const entry = readZip(buffer).find((e) => e.name.endsWith('.sql'));
  if (!entry) throw new Error(`${path.basename(file)} holds no .sql file.`);
  return entry.data.toString('utf8');
}

/**
 * Every uploaded file, indexed by the name the database knows it as.
 *
 * The CRM saves uploads as `sha1(<original name>)` plus the extension, inside
 * a year/month/day folder, so the database's `1771486433_photo….jpg` has to be
 * hashed to be found. Older installs stored the plain name, which is why both
 * are indexed.
 */
export function indexUploads(crmRoot: string): Map<string, string> {
  const byStoredName = new Map<string, string>();
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        byStoredName.set(entry.name, full);
        byStoredName.set(path.parse(entry.name).name, full);
      }
    }
  };
  walk(path.join(crmRoot, 'uploads'));

  return {
    get(name: string) {
      const hashed = crypto.createHash('sha1').update(name).digest('hex');
      return byStoredName.get(hashed) ?? byStoredName.get(name);
    },
  } as unknown as Map<string, string>;
}

class Schema {
  private entities: Array<Record<string, string>>;
  private fields: Array<Record<string, string>>;

  constructor(dump: Dump) {
    this.entities = rowsOf(dump, 'app_entities');
    this.fields = rowsOf(dump, 'app_fields');
  }

  entity(name: string, parentOf?: string): string {
    const parentId = parentOf ? this.entity(parentOf) : undefined;
    const found = this.entities.find(
      (e) => clean(e.name) === clean(name) && (parentId === undefined || e.parent_id === parentId),
    );
    if (!found) {
      throw new Error(
        `The old CRM has no "${name}" screen${parentOf ? ` under "${parentOf}"` : ''}. ` +
          `It has: ${this.entities.map((e) => e.name.trim()).join(', ')}.`,
      );
    }
    return found.id;
  }

  /** `field_<id>` for a box on a screen; the first name that matches wins. */
  column(entityId: string, ...names: string[]): string {
    for (const name of names) {
      const found = this.fields.find(
        (f) => f.entities_id === entityId && clean(f.name) === clean(name),
      );
      if (found) return `field_${found.id}`;
    }
    const available = this.fields
      .filter((f) => f.entities_id === entityId && f.name.trim())
      .map((f) => f.name.trim());
    throw new Error(
      `No box called ${names.map((n) => `"${n}"`).join(' or ')} on entity ${entityId}. ` +
        `It has: ${available.join(', ')}.`,
    );
  }
}

export function readCrm(crmRoot: string, backupFile?: string): Crm {
  const file = findBackup(crmRoot, backupFile);
  const dump = parseDump(loadSql(file));
  const schema = new Schema(dump);
  const warnings: string[] = [];

  const rows = (entityId: string) => rowsOf(dump, `app_entity_${entityId}`);
  const list = (value: string) => value.split(',').map((v) => v.trim()).filter(Boolean);

  // --- The lookup screens ---------------------------------------------------
  const departmentEntity = schema.entity('Department');
  const departmentName = schema.column(departmentEntity, 'Department Name');
  const departments = rows(departmentEntity).map((r) => ({ id: r.id, name: r[departmentName].trim() }));

  const staffEntity = schema.entity('Staff');
  const staffName = schema.column(staffEntity, 'Name');
  const staffPhoto = schema.column(staffEntity, 'Image');
  const staff = rows(staffEntity).map((r) => ({
    id: r.id,
    name: r[staffName].trim(),
    photo: r[staffPhoto].trim() || null,
  }));

  const catalogueEntity = schema.entity('Item List');
  const catalogueName = schema.column(catalogueEntity, 'Items');
  const itemNames = new Map(rows(catalogueEntity).map((r) => [r.id, r[catalogueName].trim()]));

  const descriptionEntity = schema.entity('Description', 'Item List');
  const descriptionText = schema.column(descriptionEntity, 'Description');
  const descriptions = new Map(
    rows(descriptionEntity).map((r) => [r.id, { text: r[descriptionText].trim(), of: r.parent_item_id }]),
  );

  const unitEntity = schema.entity('Units');
  const unitName = schema.column(unitEntity, 'Units');
  const unitNames = new Map(rows(unitEntity).map((r) => [r.id, r[unitName].trim()]));

  const unitValueEntity = schema.entity('Values', 'Units');
  const unitValueName = schema.column(unitValueEntity, 'Values');
  const unitValues = new Map(rows(unitValueEntity).map((r) => [r.id, r[unitValueName].trim()]));

  // --- Dropdown lists -------------------------------------------------------
  const choices = new Map(rowsOf(dump, 'app_global_lists_choices').map((r) => [r.id, r]));
  const choiceName = (id: string) => choices.get(id)?.name?.trim() ?? '';

  // --- Suppliers, from the "To" tree ---------------------------------------
  // The levels are contact person > country > company > phone > email, so a
  // stored path like "257,260,261,262,263" is one supplier spelled out.
  const suppliers = new Map<string, CrmSupplier>();
  const supplierFor = (pathValue: string): string => {
    const ids = list(pathValue);
    if (ids.length === 0) return '';
    const parts = ids.map(choiceName);
    const company = parts[2] || parts[0];
    if (!company) return '';
    const key = ids.join('-');
    if (!suppliers.has(key)) {
      suppliers.set(key, {
        key,
        company,
        country: parts[1] || null,
        contactPerson: parts[0] || null,
        phone: parts[3] || null,
        email: parts[4] || null,
      });
    }
    return key;
  };

  // --- Local orders ---------------------------------------------------------
  const local = schema.entity('Local');
  const L = {
    number: schema.column(local, 'P/O Number'),
    date: schema.column(local, 'Date'),
    time: schema.column(local, 'Time'),
    sheet: schema.column(local, 'PO Image'),
    attachments: schema.column(local, 'Attachment'),
    total: schema.column(local, 'Total Amount $', 'Total Amount'),
    department: schema.column(local, 'Department'),
    requested: schema.column(local, 'Requested by'),
    issued: schema.column(local, 'Issued by'),
    checked: schema.column(local, 'Checked by'),
    authorized: schema.column(local, 'Authorized by'),
  };

  const localItems = schema.entity('Items', 'Local');
  const LI = {
    no: schema.column(localItems, 'No'),
    item: schema.column(localItems, 'Add Item'),
    description: schema.column(localItems, 'Description-A'),
    quantity: schema.column(localItems, 'Quantity'),
    unit: schema.column(localItems, 'Units'),
    price: schema.column(localItems, 'Unit Price'),
    amount: schema.column(localItems, 'Amount'),
    image: schema.column(localItems, 'Image'),
    remarks: schema.column(localItems, 'Re-Marks', 'Re-marks'),
  };

  // --- Oversea orders -------------------------------------------------------
  const oversea = schema.entity('Oversea');
  const O = {
    number: schema.column(oversea, 'P/O Number'),
    date: schema.column(oversea, 'Date'),
    time: schema.column(oversea, 'Time'),
    sheet: schema.column(oversea, 'PO Image'),
    bill: schema.column(oversea, 'Bill Image'),
    attachments: schema.column(oversea, 'Attachment'),
    total: schema.column(oversea, 'Total Amount $', 'Total Amount'),
    to: schema.column(oversea, 'To'),
    from: schema.column(oversea, 'From'),
    attention: schema.column(oversea, 'Attention'),
    delivery: schema.column(oversea, 'Delivery'),
    authorized: schema.column(oversea, 'Authorized'),
    payments: schema.column(oversea, 'Payments'),
    status: schema.column(oversea, 'Status'),
  };

  const overseaItems = schema.entity('Items', 'Oversea');
  const OI = {
    no: schema.column(overseaItems, 'No'),
    item: schema.column(overseaItems, 'Add Item'),
    description: schema.column(overseaItems, 'Description'),
    quantity: schema.column(overseaItems, 'Quantity'),
    unit: schema.column(overseaItems, 'Unit'),
    price: schema.column(overseaItems, 'Unit Price USD $', 'Unit Price'),
    amount: schema.column(overseaItems, 'Total amount USD $', 'Amount'),
    image: schema.column(overseaItems, 'Image'),
    remarks: schema.column(overseaItems, 'Re-marks', 'Re-Marks'),
    received: schema.column(overseaItems, 'Received Date'),
  };

  const departmentById = new Map(departments.map((d) => [d.id, d.name]));
  const staffById = new Map(staff.map((s) => [s.id, s.name]));
  const usedItems = new Map<string, number>();

  const lineFrom = (
    row: Record<string, string>,
    map: typeof LI | typeof OI,
    units: Map<string, string>,
  ): CrmItem => {
    const itemId = row[map.item];
    if (itemId) usedItems.set(itemId, (usedItems.get(itemId) ?? 0) + 1);
    const description = descriptions.get(row[map.description])?.text ?? '';
    const received = 'received' in map ? unixDate(row[(map as typeof OI).received]) : '';

    return {
      lineNo: row[map.no] ?? '',
      item: itemNames.get(itemId) ?? '',
      description,
      quantity: row[map.quantity] ?? '',
      unit: units.get(row[map.unit]) ?? '',
      unitPrice: row[map.price] ?? '',
      amount: row[map.amount] ?? '',
      remarks: (row[map.remarks] ?? '').trim(),
      receivedDate: received,
      image: (row[map.image] ?? '').trim() || null,
    };
  };

  const byOrder = (entityId: string) => {
    const out = new Map<string, Array<Record<string, string>>>();
    for (const row of rows(entityId)) {
      const list = out.get(row.parent_item_id) ?? [];
      list.push(row);
      out.set(row.parent_item_id, list);
    }
    return out;
  };

  const localLines = byOrder(localItems);
  const overseaLines = byOrder(overseaItems);
  const orders: CrmOrder[] = [];

  for (const row of rows(local)) {
    const lines = (localLines.get(row.id) ?? []).sort(
      (a, b) => Number(a[LI.no] || 0) - Number(b[LI.no] || 0),
    );
    orders.push({
      // The number is stored bare; the prefix lives in the form's settings.
      number: `JJC-LO-P.O-${row[L.number].trim()}`,
      kind: 'LOCAL',
      department: departmentById.get(row[L.department]) ?? '',
      date: unixDate(row[L.date]),
      time: minutesToTime(row[L.time]),
      oldStatus: '',
      payments: '',
      delivery: '',
      supplierKey: '',
      requestedBy: staffById.get(row[L.requested]) ?? '',
      issuedBy: staffById.get(row[L.issued]) ?? '',
      checkedBy: staffById.get(row[L.checked]) ?? '',
      authorizedBy: staffById.get(row[L.authorized]) ?? '',
      officer: '',
      attention: '',
      oldTotal: row[L.total] ?? '',
      sheetImages: list(row[L.sheet]),
      billImages: [],
      receivedImages: list(row[L.attachments]),
      items: lines.map((line) => lineFrom(line, LI, unitNames)),
    });
  }

  for (const row of rows(oversea)) {
    const lines = (overseaLines.get(row.id) ?? []).sort(
      (a, b) => Number(a[OI.no] || 0) - Number(b[OI.no] || 0),
    );
    orders.push({
      number: `JJCAM-${row[O.number].trim()}`,
      kind: 'OVERSEA',
      department: '',
      date: unixDate(row[O.date]),
      time: minutesToTime(row[O.time]),
      oldStatus: choiceName(row[O.status]),
      payments: choiceName(row[O.payments]),
      delivery: choiceName(row[O.delivery]),
      supplierKey: supplierFor(row[O.to]),
      requestedBy: '',
      issuedBy: '',
      checkedBy: '',
      authorizedBy: choiceName(row[O.authorized]),
      officer: choiceName(row[O.from]),
      attention: choiceName(row[O.attention]),
      oldTotal: row[O.total] ?? '',
      sheetImages: list(row[O.sheet]),
      billImages: list(row[O.bill]),
      receivedImages: list(row[O.attachments]),
      items: lines.map((line) => lineFrom(line, OI, unitValues)),
    });
  }

  const seen = new Set<string>();
  for (const order of orders) {
    if (seen.has(order.number)) warnings.push(`Two orders share the number ${order.number}.`);
    seen.add(order.number);
  }

  const catalogue = [...itemNames.entries()].flatMap(([id, item]) => {
    const own = [...descriptions.values()].filter((d) => d.of === id && d.text);
    const used = usedItems.get(id) ?? 0;
    return own.length > 0
      ? own.map((d) => ({ item, description: d.text, usedOnOrders: used }))
      : [{ item, description: '', usedOnOrders: used }];
  });

  return {
    source: path.basename(file),
    departments,
    staff,
    suppliers: [...suppliers.values()],
    orders: orders.sort((a, b) => a.number.localeCompare(b.number)),
    catalogue,
    files: indexUploads(crmRoot),
    warnings,
  };
}
