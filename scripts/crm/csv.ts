/**
 * The package format between the two halves of the migration.
 *
 * CSV on purpose: the export can be opened in Excel and checked by the people
 * whose data it is, and the import has no idea the old system was Rukovoditel -
 * it only reads these columns. Fields are quoted when they have to be, and
 * newlines inside a field survive the round trip.
 */

export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const cell = (value: unknown): string => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((column) => cell(row[column])).join(','));
  // A trailing newline, so `type file.csv` and git diffs behave.
  return lines.join('\r\n') + '\r\n';
}

export function fromCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  // Excel writes a BOM; it must not become part of the first column's name.
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  while (i < text.length) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const header = rows.shift();
  if (!header) return [];

  return rows
    .filter((r) => r.some((value) => value !== ''))
    .map((r) => {
      const out: Record<string, string> = {};
      header.forEach((column, index) => {
        out[column.trim()] = r[index] ?? '';
      });
      return out;
    });
}
