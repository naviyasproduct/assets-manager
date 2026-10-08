import 'server-only';
import ExcelJS from 'exceljs';
import type { AssetStatus } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '@/lib/db';
import { assertDepartmentAccess, type SessionUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { loadDepartmentOptions } from '@/lib/queries';
import { nextAssetTag } from '@/lib/asset-tag';
import {
  ASSET_STATUS_LABELS,
  ASSET_STATUS_ORDER,
  assetTagPrefix,
  highestTagNumber,
} from '@/lib/format';
import {
  ASSET_IMPORT_MAX_ROWS,
  assetCategoryCreateSchema,
  assetCreateSchema,
  locationCreateSchema,
} from '@/lib/validation';

/**
 * Adding many assets at once from an Excel sheet.
 *
 * The sheet is handed out by the system (`buildImportTemplate`) and comes back
 * filled in. Columns are found by their heading, not their position, so a
 * column dragged elsewhere still reads - but the headings themselves are the
 * contract and must not be renamed.
 *
 * People write names, not ids: "Workshop", "Welding", "Shed B". Each is matched
 * to a record here, case-insensitively. A category or location that does not
 * exist yet is created along with the assets rather than refused, because the
 * person filling the sheet is the one who knows what the equipment is - the
 * same reasoning that lets the asset form create them. Both are listed before
 * anything is written, so a misspelling is caught at the check, not afterwards.
 *
 * Photos are not part of the sheet. They are added one asset at a time.
 */

type ColumnKey =
  | 'department'
  | 'category'
  | 'name'
  | 'quantity'
  | 'serialNumber'
  | 'status'
  | 'location'
  | 'purchaseDate'
  | 'unitCost'
  | 'notes'
  | 'assetTag';

type Column = {
  key: ColumnKey;
  header: string;
  required?: boolean;
  width: number;
  note: string;
};

const COLUMNS: Column[] = [
  // First, at the owner's request (2026-10-08): the tag is what is read off a
  // labelled item. Order is cosmetic - columns are found by heading.
  {
    key: 'assetTag',
    header: 'Asset tag',
    width: 16,
    note:
      'Leave blank and the system numbers it (e.g. WRK-MAC-005). Fill in only when ' +
      'the item already has a label stuck on it.',
  },
  {
    key: 'department',
    header: 'Department',
    required: true,
    width: 18,
    note: 'Pick from the list. The department must already exist in the system.',
  },
  {
    key: 'category',
    header: 'Category',
    required: true,
    width: 22,
    note:
      'Pick from the list, or type a new one. A new category is made for that ' +
      'department when the sheet is added - check the spelling.',
  },
  {
    key: 'name',
    header: 'Asset name',
    required: true,
    width: 34,
    note: 'What the thing is, e.g. "Miller MIG Welder 252".',
  },
  {
    key: 'quantity',
    header: 'How many',
    width: 11,
    note: 'Whole number. Blank means 1. Identical items (five of the same chair) can share one row.',
  },
  {
    key: 'serialNumber',
    header: 'Serial number',
    width: 20,
    note: 'From the maker\'s plate, if it has one.',
  },
  {
    key: 'status',
    header: 'Status',
    width: 19,
    note: 'In use, Idle, Needs replacement or Broken. Blank means In use.',
  },
  {
    key: 'location',
    header: 'Location',
    width: 24,
    note: 'Where it is. Pick from the list, type a new place, or leave blank.',
  },
  {
    key: 'purchaseDate',
    header: 'Purchase date',
    width: 15,
    note: 'A date such as 2024-03-15 or 15/03/2024 (day first). Blank if unknown.',
  },
  {
    key: 'unitCost',
    header: 'Cost of one unit',
    width: 17,
    note: 'The price of ONE item, numbers only - not the total for the row. Blank if unknown.',
  },
  {
    key: 'notes',
    header: 'Notes',
    width: 40,
    note: 'Anything worth knowing about it.',
  },
];

const HEADER_TO_KEY = new Map(COLUMNS.map((column) => [normalize(column.header), column.key]));
const COLUMN_BY_KEY = new Map(COLUMNS.map((column) => [column.key, column]));

/** How many rows the dropdowns reach. More can be typed; they just have no list. */
const TEMPLATE_ROWS = 1000;

const SHEET_NAME = 'Assets';
const LISTS_NAME = 'Lists';

// ---------------------------------------------------------------------------
// The blank sheet
// ---------------------------------------------------------------------------

/**
 * The sheet to fill in, with today's departments, categories and locations as
 * dropdowns. Built per person: someone scoped to one department is only
 * offered that department and its categories.
 */
export async function buildImportTemplate(user: SessionUser): Promise<Buffer> {
  const departments = await loadDepartmentOptions(user);
  const [categories, locations] = await Promise.all([
    prisma.assetCategory.findMany({
      where: { departmentId: { in: departments.map((d) => d.id) }, isActive: true },
      orderBy: [{ department: { name: 'asc' } }, { name: 'asc' }],
      select: { name: true, code: true, department: { select: { name: true } } },
    }),
    prisma.location.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { name: true },
    }),
  ]);

  const book = new ExcelJS.Workbook();
  book.creator = 'Assets manager';
  book.created = new Date();

  const sheet = book.addWorksheet(SHEET_NAME, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = COLUMNS.map((column) => ({
    header: column.required ? `${column.header} *` : column.header,
    key: column.key,
    width: column.width,
  }));

  const header = sheet.getRow(1);
  header.height = 22;
  header.eachCell((cell, col) => {
    const column = COLUMNS[col - 1];
    cell.font = { bold: true, color: { argb: 'FF1F2937' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: column.required ? 'FFFDE68A' : 'FFE5E7EB' },
    };
    cell.alignment = { vertical: 'middle' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } } };
    cell.note = column.note;
  });

  // Column-wide formats, so a typed date or price shows the way it is meant
  // without every one of the thousand rows being created up front.
  sheet.getColumn('purchaseDate').numFmt = 'yyyy-mm-dd';
  sheet.getColumn('unitCost').numFmt = '#,##0.00';

  // --- Lists: what the dropdowns offer -----------------------------------
  const lists = book.addWorksheet(LISTS_NAME);
  const uniqueCategoryNames = [...new Set(categories.map((c) => c.name))];
  const statusLabels = ASSET_STATUS_ORDER.map((status) => ASSET_STATUS_LABELS[status]);

  lists.columns = [
    { header: 'Departments', width: 20 },
    { header: '', width: 3 },
    { header: 'Categories', width: 24 },
    { header: '', width: 3 },
    { header: 'Locations', width: 26 },
    { header: '', width: 3 },
    { header: 'Statuses', width: 20 },
    { header: '', width: 3 },
    { header: 'Category', width: 24 },
    { header: 'In department', width: 20 },
    { header: 'Code', width: 8 },
  ];
  lists.getRow(1).font = { bold: true };
  departments.forEach((d, i) => (lists.getCell(i + 2, 1).value = d.name));
  uniqueCategoryNames.forEach((name, i) => (lists.getCell(i + 2, 3).value = name));
  locations.forEach((l, i) => (lists.getCell(i + 2, 5).value = l.name));
  statusLabels.forEach((label, i) => (lists.getCell(i + 2, 7).value = label));
  // Which department each category belongs to, since one dropdown cannot
  // narrow itself to the department picked on the same row.
  categories.forEach((c, i) => {
    lists.getCell(i + 2, 9).value = c.name;
    lists.getCell(i + 2, 10).value = c.department.name;
    lists.getCell(i + 2, 11).value = c.code;
  });
  lists.getCell(1, 13).value = `As of ${new Date().toISOString().slice(0, 10)}. Download a fresh sheet to pick up anything added since.`;
  lists.getCell(1, 13).font = { italic: true, color: { argb: 'FF6B7280' } };
  await lists.protect('', { selectLockedCells: true, selectUnlockedCells: true });

  const range = (col: string, count: number) => `${LISTS_NAME}!$${col}$2:$${col}$${count + 1}`;

  // Department and status are closed lists. Category and location only warn:
  // a name not on the list is how a new one is asked for.
  const dropdowns: [ColumnKey, string | null, 'stop' | 'warning', string][] = [
    ['department', departments.length ? range('A', departments.length) : null, 'stop',
      'Pick a department from the list.'],
    ['category', uniqueCategoryNames.length ? range('C', uniqueCategoryNames.length) : null, 'warning',
      'That category is not on the list yet. Keep it to create a new category for this department.'],
    ['location', locations.length ? range('E', locations.length) : null, 'warning',
      'That location is not on the list yet. Keep it to create a new location.'],
    ['status', range('G', statusLabels.length), 'stop',
      'Pick In use, Idle, Needs replacement or Broken.'],
  ];

  // One rule per column range. Setting `cell.dataValidation` on every cell
  // instead makes ExcelJS merge them in text order (A10 before A2), which
  // writes overlapping ranges that Excel offers to "repair" on opening.
  const validations = (sheet as unknown as {
    dataValidations: { add(range: string, rule: ExcelJS.DataValidation): void };
  }).dataValidations;
  const columnRange = (key: ColumnKey) => {
    const letter = sheet.getColumn(key).letter;
    return `${letter}2:${letter}${TEMPLATE_ROWS + 1}`;
  };

  for (const [key, formula, errorStyle, error] of dropdowns) {
    if (!formula) continue;
    validations.add(columnRange(key), {
      type: 'list',
      allowBlank: true,
      formulae: [formula],
      showErrorMessage: true,
      errorStyle,
      error,
    });
  }
  validations.add(columnRange('quantity'), {
    type: 'whole',
    operator: 'greaterThanOrEqual',
    allowBlank: true,
    formulae: [1],
    showErrorMessage: true,
    errorStyle: 'stop',
    error: 'How many must be a whole number, 1 or more.',
  });
  validations.add(columnRange('unitCost'), {
    type: 'decimal',
    operator: 'greaterThanOrEqual',
    allowBlank: true,
    formulae: [0],
    showErrorMessage: true,
    errorStyle: 'stop',
    error: 'Numbers only - the price of one item.',
  });

  addInstructions(book);

  return Buffer.from(await book.xlsx.writeBuffer());
}

function addInstructions(book: ExcelJS.Workbook) {
  const help = book.addWorksheet('How to fill');
  help.getColumn(1).width = 4;
  help.getColumn(2).width = 110;

  const lines: (string | [string, 'title' | 'head'])[] = [
    ['Adding assets from this sheet', 'title'],
    '',
    ['Filling it in', 'head'],
    'One row per asset on the "Assets" sheet, starting on row 2. Do not change row 1 - the system reads the column names.',
    'Department, Category and Asset name (marked *) are required. Everything else may be left blank.',
    'Identical items - five of the same chair - can go on one row with "How many" set to 5.',
    'Category: pick from the list. A name that is not on the list creates a new category in that department, so check the spelling.',
    'The "Lists" sheet shows which department each existing category belongs to.',
    'Location: pick from the list, type a new place, or leave blank.',
    'Purchase date: 2024-03-15 or 15/03/2024 (day first). Leave blank if unknown.',
    'Cost of one unit: the price of ONE item, not the total for the row.',
    'Asset tag: leave blank and the system gives the next number (e.g. WRK-MAC-005). Only fill it in if the item already has a label on it.',
    'Photos are not part of the sheet. After the assets are added, open each one on the Assets screen and add its photo.',
    '',
    ['Uploading it', 'head'],
    'Save the file, then on the Assets screen click "Import from Excel" and choose it.',
    'The system checks every row first and lists any problem by its row number. Nothing is added until every row is right.',
    'Once the check passes it shows the tags each asset will get, and any new categories or locations. Click "Add" to add them all.',
    'Do not upload the same sheet twice - it would add the same assets again. Start the next batch on a fresh sheet.',
  ];

  lines.forEach((line, i) => {
    const cell = help.getCell(i + 1, 2);
    if (Array.isArray(line)) {
      cell.value = line[0];
      cell.font = line[1] === 'title' ? { bold: true, size: 15 } : { bold: true, size: 12 };
    } else {
      cell.value = line;
      cell.alignment = { wrapText: true, vertical: 'top' };
    }
  });

  // A worked example, kept here rather than on the Assets sheet so it can
  // never be uploaded by mistake.
  const start = lines.length + 2;
  help.getCell(start, 2).value = 'Example rows';
  help.getCell(start, 2).font = { bold: true, size: 12 };

  const example = book.addWorksheet('Example');
  example.columns = COLUMNS.map((column) => ({
    header: column.required ? `${column.header} *` : column.header,
    key: column.key,
    width: column.width,
  }));
  example.getRow(1).font = { bold: true };
  example.addRow({
    department: 'Workshop',
    category: 'Welding',
    name: 'Miller MIG Welder 252',
    quantity: 1,
    serialNumber: 'MG252-88412',
    status: 'In use',
    location: 'Workshop, welding bay',
    purchaseDate: new Date(Date.UTC(2021, 4, 12)),
    unitCost: 285000,
    notes: 'Gas regulator replaced 2024',
  });
  example.addRow({
    department: 'IT',
    category: 'Workstation',
    name: 'Office chair, black mesh',
    quantity: 6,
    status: 'In use',
    location: 'Main office',
    unitCost: 18500,
  });
  example.addRow({
    department: 'Workshop',
    category: 'Compressors',
    name: 'Atlas Copco GA11 compressor',
    status: 'Needs replacement',
    notes: 'A new category - created when the sheet is added',
  });
  example.getColumn('purchaseDate').numFmt = 'yyyy-mm-dd';
  example.getColumn('unitCost').numFmt = '#,##0.00';
  help.getCell(start + 1, 2).value = 'See the "Example" sheet. It is never read when uploading.';
}

// ---------------------------------------------------------------------------
// Reading a filled sheet
// ---------------------------------------------------------------------------

type CellValue = string | number | Date | boolean;

export type SheetRow = { row: number; values: Partial<Record<ColumnKey, CellValue>> };

/** A sheet that cannot be read at all - as opposed to a row that is wrong. */
export class SheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheetError';
  }
}

export async function readImportSheet(data: ArrayBuffer): Promise<SheetRow[]> {
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(data);
  } catch {
    throw new SheetError(
      'That file could not be opened as an Excel sheet. Save it as an .xlsx file and try again.',
    );
  }

  const sheet = book.getWorksheet(SHEET_NAME) ?? book.worksheets[0];
  if (!sheet) throw new SheetError('That file has no sheets in it.');

  const columnOf = new Map<ColumnKey, number>();
  sheet.getRow(1).eachCell((cell, col) => {
    const raw = readCell(cell.value);
    const key = typeof raw === 'string' ? HEADER_TO_KEY.get(normalize(raw)) : undefined;
    if (key && !columnOf.has(key)) columnOf.set(key, col);
  });

  const missing = COLUMNS.filter((c) => c.required && !columnOf.has(c.key)).map((c) => `"${c.header}"`);
  if (missing.length > 0) {
    throw new SheetError(
      `This does not look like the asset import sheet - row 1 has no ${missing.join(', ')} ` +
        `column. Download the blank sheet from this window and fill that in.`,
    );
  }

  const rows: SheetRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values: SheetRow['values'] = {};
    let filled = false;
    for (const [key, col] of columnOf) {
      const value = readCell(row.getCell(col).value);
      if (value !== null) {
        values[key] = value;
        filled = true;
      }
    }
    // Excel keeps rows that were only formatted or cleared; only filled ones count.
    if (filled) rows.push({ row: rowNumber, values });
  });

  if (rows.length === 0) {
    throw new SheetError(
      'The sheet has no assets in it yet. Fill in one row per asset, starting on row 2.',
    );
  }
  if (rows.length > ASSET_IMPORT_MAX_ROWS) {
    throw new SheetError(
      `The sheet has ${rows.length} rows. Split it into sheets of ${ASSET_IMPORT_MAX_ROWS} or fewer.`,
    );
  }

  return rows;
}

/** Whatever Excel stored, reduced to a plain value; blank text is no value. */
function readCell(value: ExcelJS.CellValue | undefined): CellValue | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const text = value.trim();
    return text === '' ? null : text;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if ('richText' in value) return readCell(value.richText.map((part) => part.text).join(''));
  if ('formula' in value || 'sharedFormula' in value) {
    return readCell((value as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
  }
  if ('hyperlink' in value) return readCell(value.text);
  if ('error' in value) return value.error;
  return null;
}

// ---------------------------------------------------------------------------
// Checking the rows
// ---------------------------------------------------------------------------

export type ImportRowReport = {
  row: number;
  name: string;
  department: string;
  category: string;
  location: string;
  quantity: number | null;
  /** The tag it was given in the sheet, or the one it will be numbered. Blank on a row with problems. */
  assetTag: string;
  problems: string[];
  warnings: string[];
};

export type ImportReport = {
  rows: ImportRowReport[];
  newCategories: { department: string; name: string; code: string }[];
  newLocations: string[];
  /** Rows with at least one problem. Nothing is added while this is above 0. */
  problemCount: number;
};

type AssetData = z.output<typeof assetCreateSchema>;

/**
 * What `commitImport` writes. A new category or location is referred to by a
 * placeholder id until the transaction has created it.
 */
export type ImportPlan = {
  rows: AssetData[];
  newCategories: { placeholder: string; name: string; code: string; departmentId: string }[];
  newLocations: { placeholder: string; name: string }[];
};

const NEW_CATEGORY = 'new-category:';
const NEW_LOCATION = 'new-location:';

export async function planImport(
  user: SessionUser,
  sheetRows: SheetRow[],
): Promise<{ report: ImportReport; plan: ImportPlan }> {
  const departments = await loadDepartmentOptions(user);
  const departmentIds = departments.map((d) => d.id);
  const [categories, locations, assets] = await Promise.all([
    prisma.assetCategory.findMany({
      where: { departmentId: { in: departmentIds } },
      select: { id: true, name: true, code: true, departmentId: true, isActive: true },
    }),
    prisma.location.findMany({ select: { id: true, name: true, isActive: true } }),
    prisma.asset.findMany({
      select: { assetTag: true, serialNumber: true, name: true, departmentId: true, categoryId: true },
    }),
  ]);

  const departmentByName = new Map<string, (typeof departments)[number]>();
  for (const d of departments) {
    departmentByName.set(normalize(d.name), d);
    departmentByName.set(normalize(d.code), d);
  }
  const categoryByKey = new Map(categories.map((c) => [`${c.departmentId}|${normalize(c.name)}`, c]));
  const locationByName = new Map(locations.map((l) => [normalize(l.name), l]));

  // Tags are unique site-wide, so every tag counts - including ones in
  // departments this person cannot see.
  const issuedTags = assets.map((a) => a.assetTag);
  const takenTags = new Set(issuedTags.map((tag) => tag.toLowerCase()));
  // A serial already on record is worth a second look, but only one this
  // person may see - the warning names the asset.
  const serialOwner = new Map<string, string>();
  // The same name in the same category is how a sheet uploaded twice shows
  // itself when its rows carry no serial numbers.
  const nameOwner = new Map<string, string>();
  for (const a of assets) {
    if (!departmentIds.includes(a.departmentId)) continue;
    if (a.serialNumber) serialOwner.set(a.serialNumber.trim().toLowerCase(), a.assetTag);
    nameOwner.set(`${a.categoryId}|${normalize(a.name)}`, a.assetTag);
  }

  const canCreateLocation = can(user.access, 'locations', 'EDIT');

  const plan: ImportPlan = { rows: [], newCategories: [], newLocations: [] };
  const report: ImportReport = { rows: [], newCategories: [], newLocations: [], problemCount: 0 };
  const plannedCategory = new Map<string, { placeholder: string; code: string; departmentCode: string }>();
  const plannedLocation = new Map<string, string>();
  const sheetTags = new Map<string, number>();
  const sheetSerials = new Map<string, number>();

  for (const { row, values } of sheetRows) {
    const problems: string[] = [];
    const warnings: string[] = [];

    const departmentText = asText(values.department);
    const categoryText = tidy(asText(values.category));
    const locationText = tidy(asText(values.location));

    // --- department
    const department = departmentText ? departmentByName.get(normalize(departmentText)) : undefined;
    if (!departmentText) problems.push('Department is empty.');
    else if (!department) {
      problems.push(`Department "${departmentText}" is not one you can add assets to. Pick one from the list.`);
    }

    // --- category: existing, or a new one for this department
    let categoryId: string | null = null;
    let categoryCode: string | null = null;
    if (!categoryText) problems.push('Category is empty.');
    else if (department) {
      const key = `${department.id}|${normalize(categoryText)}`;
      const existing = categoryByKey.get(key);
      const planned = plannedCategory.get(key);
      if (existing && !existing.isActive) {
        problems.push(`Category "${existing.name}" in ${department.name} has been retired. Pick another, or bring it back on the Categories screen first.`);
      } else if (existing) {
        categoryId = existing.id;
        categoryCode = existing.code;
      } else if (planned) {
        categoryId = planned.placeholder;
        categoryCode = planned.code;
      } else {
        const code = freeCategoryCode(categoryText, department.id, categories, plan.newCategories);
        const parsed = assetCategoryCreateSchema.safeParse({
          name: categoryText,
          code,
          departmentId: department.id,
        });
        if (!parsed.success) {
          problems.push(`New category "${categoryText}": ${parsed.error.issues[0].message}`);
        } else {
          const placeholder = `${NEW_CATEGORY}${plan.newCategories.length}`;
          plan.newCategories.push({ placeholder, name: categoryText, code: parsed.data.code, departmentId: department.id });
          report.newCategories.push({ department: department.name, name: categoryText, code: parsed.data.code });
          plannedCategory.set(key, { placeholder, code: parsed.data.code, departmentCode: department.code });
          categoryId = placeholder;
          categoryCode = parsed.data.code;
        }
      }
    }

    // --- location: optional, existing or new
    let locationId: string | null = null;
    if (locationText) {
      const key = normalize(locationText);
      const existing = locationByName.get(key);
      if (existing && !existing.isActive) {
        problems.push(`Location "${existing.name}" has been retired. Pick another, or leave it blank.`);
      } else if (existing) {
        locationId = existing.id;
      } else if (plannedLocation.has(key)) {
        locationId = plannedLocation.get(key)!;
      } else if (!canCreateLocation) {
        problems.push(`Location "${locationText}" does not exist. Ask an admin to add it on the Locations screen, or leave it blank.`);
      } else {
        const parsed = locationCreateSchema.safeParse({ name: locationText });
        if (!parsed.success) {
          problems.push(`New location "${locationText}": ${parsed.error.issues[0].message}`);
        } else {
          const placeholder = `${NEW_LOCATION}${plan.newLocations.length}`;
          plan.newLocations.push({ placeholder, name: locationText });
          report.newLocations.push(locationText);
          plannedLocation.set(key, placeholder);
          locationId = placeholder;
        }
      }
    }

    // --- the plain columns
    const status = readStatus(values.status, problems);
    const quantity = readWhole(values.quantity, problems);
    const purchaseDate = readDate(values.purchaseDate, problems);
    const unitCost = readMoney(values.unitCost, problems);
    const givenTag = asText(values.assetTag);
    const serialNumber = asText(values.serialNumber);

    if (givenTag) {
      const lower = givenTag.toLowerCase();
      if (takenTags.has(lower)) problems.push(`Asset tag ${givenTag} is already on another asset.`);
      else if (sheetTags.has(lower)) problems.push(`Asset tag ${givenTag} is also on row ${sheetTags.get(lower)}.`);
      else sheetTags.set(lower, row);
    }

    if (serialNumber) {
      const lower = serialNumber.toLowerCase();
      const owner = serialOwner.get(lower);
      if (owner) warnings.push(`Serial number ${serialNumber} is already on ${owner} - is this the same item?`);
      else if (sheetSerials.has(lower)) warnings.push(`Serial number ${serialNumber} is also on row ${sheetSerials.get(lower)}.`);
      else sheetSerials.set(lower, row);
    }

    const name = asText(values.name);
    const sameName = name && categoryId ? nameOwner.get(`${categoryId}|${normalize(name)}`) : undefined;
    if (sameName && warnings.length === 0) {
      warnings.push(`${sameName} already has this name in this category - has this row been added before?`);
    }

    // The same rules the asset form is held to. Ids are known by now, so
    // only the remaining fields can fail here.
    const parsed = assetCreateSchema.safeParse({
      name: name ?? '',
      departmentId: department?.id ?? 'unknown',
      categoryId: categoryId ?? 'unknown',
      status: status ?? undefined,
      quantity: quantity ?? undefined,
      assetTag: givenTag ?? '',
      serialNumber: serialNumber ?? '',
      locationId: locationId ?? '',
      purchaseDate: purchaseDate ?? '',
      unitCost: unitCost,
      notes: asText(values.notes) ?? '',
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const column = COLUMN_BY_KEY.get(issue.path[0] as ColumnKey);
        problems.push(
          column && issue.code === 'too_big'
            ? `${column.header} is too long (${issue.maximum} characters at most).`
            : issue.message,
        );
      }
    }

    let assetTag = '';
    if (problems.length === 0 && parsed.success) {
      // Numbered the way `nextAssetTag` will number it, in sheet order, so the
      // check shows the labels that will actually be printed.
      if (givenTag) assetTag = givenTag;
      else if (department && categoryCode) {
        const prefix = assetTagPrefix(department.code, categoryCode);
        assetTag = `${prefix}${String(highestTagNumber(issuedTags, prefix) + 1).padStart(3, '0')}`;
      }
      issuedTags.push(assetTag);
      plan.rows.push(parsed.data);
    } else {
      report.problemCount++;
    }

    report.rows.push({
      row,
      name: asText(values.name) ?? '',
      department: department?.name ?? departmentText ?? '',
      category: categoryText ?? '',
      location: locationText ?? '',
      quantity: parsed.success ? parsed.data.quantity : null,
      assetTag,
      problems,
      warnings,
    });
  }

  return { report, plan };
}

/**
 * Writes the whole plan or none of it. Run only on a plan with no problems.
 *
 * Rows are created in sheet order with `nextAssetTag`, the same numbering the
 * form uses, so the tags match what the check showed unless someone else
 * added to one of the same categories in between.
 */
export async function commitImport(
  user: SessionUser,
  plan: ImportPlan,
): Promise<{ id: string; assetTag: string }[]> {
  for (const row of plan.rows) assertDepartmentAccess(user, row.departmentId);

  return prisma.$transaction(
    async (tx) => {
      const ids = new Map<string, string>();

      for (const category of plan.newCategories) {
        const created = await tx.assetCategory.create({
          data: { name: category.name, code: category.code, departmentId: category.departmentId },
          select: { id: true },
        });
        ids.set(category.placeholder, created.id);
      }
      for (const location of plan.newLocations) {
        const created = await tx.location.create({
          data: { name: location.name },
          select: { id: true },
        });
        ids.set(location.placeholder, created.id);
      }

      const created: { id: string; assetTag: string }[] = [];
      for (const row of plan.rows) {
        const categoryId = ids.get(row.categoryId) ?? row.categoryId;
        const locationId = row.locationId ? (ids.get(row.locationId) ?? row.locationId) : null;
        const assetTag = row.assetTag ?? (await nextAssetTag(tx, categoryId));

        created.push(
          await tx.asset.create({
            data: {
              assetTag,
              name: row.name,
              quantity: row.quantity,
              categoryId,
              departmentId: row.departmentId,
              status: row.status,
              serialNumber: row.serialNumber ?? null,
              locationId,
              purchaseDate: row.purchaseDate ?? null,
              unitCost: row.unitCost ?? null,
              notes: row.notes ?? null,
            },
            select: { id: true, assetTag: true },
          }),
        );
      }
      return created;
    },
    // Two thousand rows each take a tag lock and an insert; the default five
    // seconds is meant for a single form.
    { maxWait: 10_000, timeout: 180_000 },
  );
}

// ---------------------------------------------------------------------------
// Cell readers. Each records its own problem and returns null when it has one.
// ---------------------------------------------------------------------------

function normalize(text: string): string {
  return text.replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Collapses runs of spaces, so "Shed  B" from a sloppy paste matches "Shed B". */
function tidy(text: string | null): string | null {
  return text === null ? null : text.replace(/\s+/g, ' ').trim();
}

function asText(value: CellValue | undefined): string | null {
  if (value === undefined) return null;
  if (value instanceof Date) return isoDate(value);
  return String(value).trim() || null;
}

const STATUS_BY_WORD = new Map<string, AssetStatus>();
for (const status of ASSET_STATUS_ORDER) {
  STATUS_BY_WORD.set(normalize(ASSET_STATUS_LABELS[status]), status);
  STATUS_BY_WORD.set(normalize(status.replace(/_/g, ' ')), status);
}

function readStatus(value: CellValue | undefined, problems: string[]): AssetStatus | null {
  const text = asText(value);
  if (!text) return null;
  const status = STATUS_BY_WORD.get(normalize(text.replace(/[_-]/g, ' ')));
  if (!status) problems.push(`Status "${text}" is not one of: In use, Idle, Needs replacement, Broken.`);
  return status ?? null;
}

function readWhole(value: CellValue | undefined, problems: string[]): number | null {
  if (value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) {
    problems.push(`How many "${String(value)}" is not a number.`);
    return null;
  }
  // Out-of-range and fractional values are left to the asset schema's wording.
  return n;
}

function readMoney(value: CellValue | undefined, problems: string[]): number | null {
  if (value === undefined) return null;
  if (typeof value === 'number') return value;
  // Prices get typed the way they are written on an invoice.
  const cleaned = String(value).replace(/^(rs\.?|lkr|\$)\s*/i, '').replace(/[,\s]/g, '');
  const n = Number(cleaned);
  if (cleaned === '' || !Number.isFinite(n)) {
    problems.push(`Cost of one unit "${String(value)}" is not a number.`);
    return null;
  }
  return n;
}

/** To YYYY-MM-DD, which is what the asset schema reads. */
function readDate(value: CellValue | undefined, problems: string[]): string | null {
  if (value === undefined) return null;
  if (value instanceof Date) return isoDate(value);

  // A date typed into a cell with no date format arrives as Excel's day count.
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    return isoDate(new Date(Date.UTC(1899, 11, 30) + value * 86_400_000));
  }

  const text = String(value).trim();
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (match) return validDate(+match[1], +match[2], +match[3], text, problems);
  // Day first, the way dates are written here: 15/03/2024.
  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
  if (match) return validDate(+match[3], +match[2], +match[1], text, problems);

  problems.push(`Purchase date "${text}" is not a date. Write it as 2024-03-15 or 15/03/2024.`);
  return null;
}

function validDate(year: number, month: number, day: number, text: string, problems: string[]) {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    problems.push(`Purchase date "${text}" is not a real date.`);
    return null;
  }
  return isoDate(d);
}

/**
 * Excel dates carry no timezone; ExcelJS hands them back as midnight UTC, so
 * the UTC parts are the day that was typed.
 */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function suggestCode(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase();
}

/** The form's suggested code, with a number added if the department already uses it. */
function freeCategoryCode(
  name: string,
  departmentId: string,
  existing: { code: string; departmentId: string }[],
  planned: { code: string; departmentId: string }[],
): string {
  const used = new Set(
    [...existing, ...planned].filter((c) => c.departmentId === departmentId).map((c) => c.code.toUpperCase()),
  );
  const base = suggestCode(name);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!used.has(`${base}${n}`)) return `${base}${n}`;
  }
}
