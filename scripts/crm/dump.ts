/**
 * Reads a MySQL dump into plain tables, without a MySQL server.
 *
 * The old CRM's backups are `CREATE TABLE` + `INSERT INTO … VALUES (…),(…);`
 * and nothing else, so the whole file can be turned into rows in memory. Only
 * what the migration needs is understood; anything else is skipped rather than
 * guessed at.
 */

export type Table = { columns: string[]; rows: string[][] };
export type Dump = Map<string, Table>;

/** Values in one `(…)` group. Handles \' \\ and '' escapes, and NULL. */
function readTuple(text: string, start: number): { values: (string | null)[]; next: number } {
  const values: (string | null)[] = [];
  let i = start;

  while (i < text.length) {
    const c = text[i];

    if (c === ')') return { values, next: i + 1 };
    if (c === ',' || c === ' ' || c === '\n' || c === '\r' || c === '\t') {
      i += 1;
      continue;
    }

    if (c === "'") {
      i += 1;
      let out = '';
      while (i < text.length) {
        if (text[i] === '\\') {
          const next = text[i + 1];
          out += next === 'n' ? '\n' : next === 'r' ? '\r' : next === 't' ? '\t' : next === '0' ? '\0' : next;
          i += 2;
        } else if (text[i] === "'") {
          if (text[i + 1] === "'") {
            out += "'";
            i += 2;
          } else {
            i += 1;
            break;
          }
        } else {
          out += text[i];
          i += 1;
        }
      }
      values.push(out);
      continue;
    }

    // Unquoted: a number, or NULL.
    let out = '';
    while (i < text.length && text[i] !== ',' && text[i] !== ')') {
      out += text[i];
      i += 1;
    }
    const trimmed = out.trim();
    values.push(trimmed.toUpperCase() === 'NULL' ? null : trimmed);
  }

  throw new Error('Unterminated row in the dump.');
}

export function parseDump(sql: string): Dump {
  const tables: Dump = new Map();

  for (const match of sql.matchAll(
    /CREATE TABLE(?: IF NOT EXISTS)? `?(\w+)`?\s*\(([\s\S]*?)\n\)\s*ENGINE/g,
  )) {
    const columns: string[] = [];
    for (const line of match[2].split('\n')) {
      const column = /^\s*`(\w+)`\s+\w/.exec(line);
      if (column) columns.push(column[1]);
    }
    tables.set(match[1], { columns, rows: [] });
  }

  for (const match of sql.matchAll(/INSERT INTO `?(\w+)`?(?:\s*\([^)]*\))?\s+VALUES/g)) {
    const table = tables.get(match[1]);
    if (!table) continue;

    let i = match.index! + match[0].length;
    while (i < sql.length) {
      while (i < sql.length && sql[i] !== '(' && sql[i] !== ';') i += 1;
      if (i >= sql.length || sql[i] === ';') break;
      const { values, next } = readTuple(sql, i + 1);
      if (values.length === table.columns.length) {
        table.rows.push(values.map((v) => v ?? ''));
      }
      i = next;
    }
  }

  return tables;
}

/** One table as objects keyed by column name. */
export function rowsOf(dump: Dump, table: string): Array<Record<string, string>> {
  const found = dump.get(table);
  if (!found) return [];
  return found.rows.map((row) => {
    const out: Record<string, string> = {};
    found.columns.forEach((column, index) => {
      out[column] = row[index] ?? '';
    });
    return out;
  });
}
