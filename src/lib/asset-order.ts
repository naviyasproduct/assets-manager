/**
 * The order of the Inventory list, and the groups it labels.
 *
 * No `server-only`: the table arranges itself in the browser from the rows it
 * was given, so a drag shows at once and the server only has to store it.
 *
 * A group is a batch - items bought or made together, typed on the asset as
 * "Milling drill" or "B-2026-14". An asset with no batch is grouped by its
 * name with the sizes taken out, so "Drilling tool 1mm" to "20mm" still sit
 * together before anyone has typed a batch for them.
 *
 * The one thing set by hand is `listPosition`, written for a whole department
 * at once on the first drag. Anything without one (added since, renamed,
 * re-batched) flows in next to its group. A drag only ever moves a row: which
 * batch it is in is the asset's own data, changed on the asset.
 */

export type OrderableAsset = {
  id: string;
  assetTag: string;
  name: string;
  categoryCode: string;
  departmentId: string;
  departmentName: string;
  batch: string | null;
  listPosition: number | null;
};

export type GroupInfo = {
  key: string;
  /** What the label over the group says: its batch, or the shared name. */
  label: string;
  /** True when the label is a batch someone typed, not one read off the names. */
  isBatch: boolean;
  /** Members in the same department, the row itself included. */
  size: number;
  /** Index into the tint palette, or null for a row on its own. */
  tint: number | null;
};

/** How many tints `globals.css` defines (`.grp-0` …). */
export const GROUP_TINTS = 6;

// Units only count as part of a size when they follow a number, so "1 mm" and
// "1mm" read the same and the word "mm" never survives into a group name.
const UNIT =
  '(?:mm|cm|m|in|inch|inches|ft|kg|g|t|ton|tons|tonne|l|ltr|ml|v|kv|w|kw|hp|a|amp|amps|bar|psi|rpm|port|ports|pcs|pc)';
const NUMBER_SPACE_UNIT = new RegExp(`(\\d)\\s+${UNIT}(?![a-z])`, 'g');
const FILLER = new Set(['x', 'by', '-', '/', '&', '+']);

/**
 * The name with its sizes taken out: "Ejector pin 3.5mm X 350mm" is
 * "ejector pin", "Tap M8" is "tap". Any word holding a digit goes, because
 * that is where sizes, model numbers and counts live - and those are exactly
 * what differs between things that belong together.
 */
export function familyKey(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[×*]/g, ' x ')
    .replace(NUMBER_SPACE_UNIT, '$1')
    .split(/[\s,;:()[\]]+/)
    .filter((word) => word && !/\d/.test(word) && !FILLER.has(word));
  const key = words.join(' ');
  // A name that is nothing but numbers is its own family.
  return key || name.trim().toLowerCase();
}

/** "Milling  Drill" and "milling drill" are one batch. */
export function batchKey(batch: string): string {
  return batch.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * A batch and a family of the same words are the same group, so typing
 * "Vise" on two vises does not split them from the vise next to them.
 */
export function groupKeyOf(asset: Pick<OrderableAsset, 'batch' | 'name'>): string {
  return asset.batch?.trim() ? batchKey(asset.batch) : familyKey(asset.name);
}

const CHUNKS = /(\d+(?:\.\d+)?)/;

/**
 * Text compared as text and numbers as numbers, decimals included: 2mm before
 * 10mm, 1.5mm between 1mm and 2mm. `Intl.Collator`'s numeric mode reads
 * "3.25" as 3 and 25 and so puts it after "3.5".
 */
export function naturalCompare(a: string, b: string): number {
  const x = a.toLowerCase().split(CHUNKS);
  const y = b.toLowerCase().split(CHUNKS);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    // split() with a capture group puts the numbers at the odd indexes.
    const diff = i % 2 === 1 ? Number(x[i]) - Number(y[i]) : x[i].localeCompare(y[i]);
    if (diff !== 0) return diff;
  }
  return x.length - y.length || a.localeCompare(b);
}

/** The automatic order: category, then group, then size, then tag. */
function autoOrder<T extends OrderableAsset>(rows: T[]): T[] {
  const members = new Map<string, T[]>();
  for (const row of rows) {
    const key = groupKeyOf(row);
    members.set(key, [...(members.get(key) ?? []), row]);
  }

  // A group sits under the category most of it is filed in, so one odd member
  // filed elsewhere does not drag the whole group with it.
  const groupCategory = new Map<string, string>();
  for (const [key, group] of members) {
    const counts = new Map<string, number>();
    for (const row of group) counts.set(row.categoryCode, (counts.get(row.categoryCode) ?? 0) + 1);
    const [category] = [...counts].sort((a, b) => b[1] - a[1] || naturalCompare(a[0], b[0]))[0];
    groupCategory.set(key, category);
  }

  return [...rows].sort((a, b) => {
    const ka = groupKeyOf(a);
    const kb = groupKeyOf(b);
    return (
      naturalCompare(groupCategory.get(ka)!, groupCategory.get(kb)!) ||
      naturalCompare(ka, kb) ||
      naturalCompare(a.name, b.name) ||
      naturalCompare(a.assetTag, b.assetTag)
    );
  });
}

/**
 * One department's rows in display order. Rows placed by hand keep their
 * places; every other row goes in after the row the automatic order would put
 * before it - or, when its group has been moved by hand, in among its group.
 */
function arrangeDepartment<T extends OrderableAsset>(rows: T[]): T[] {
  const auto = autoOrder(rows);
  const placed = rows
    .filter((row) => row.listPosition !== null)
    .sort((a, b) => a.listPosition! - b.listPosition!);
  if (placed.length === 0) return auto;
  if (placed.length === rows.length) return placed;

  const autoIndex = new Map(auto.map((row, index) => [row.id, index]));
  const isPlaced = new Set(placed.map((row) => row.id));

  auto.forEach((row, index) => {
    if (isPlaced.has(row.id)) return;
    const key = groupKeyOf(row);
    const groupAt = placed
      .map((other, at) => ({ other, at }))
      .filter(({ other }) => groupKeyOf(other) === key);

    let at: number;
    if (groupAt.length > 0) {
      // After the last member that comes before it automatically, or ahead of
      // the group when it is the smallest size.
      const before = groupAt.filter(({ other }) => autoIndex.get(other.id)! < index);
      at = before.length > 0 ? before[before.length - 1].at + 1 : groupAt[0].at;
    } else {
      // Every row ahead of it in the automatic order is placed by now.
      const previous = index > 0 ? auto[index - 1] : null;
      at = previous ? placed.findIndex((other) => other.id === previous.id) + 1 : 0;
    }
    placed.splice(at, 0, row);
    isPlaced.add(row.id);
  });

  return placed;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Every row in display order - departments by name, each arranged on its own,
 * because a hand-made order belongs to one department - and the group each
 * row is in. Tints go round the palette in order of appearance, so groups next
 * to each other never share one. Work it out on the whole list, not a filtered
 * one, so a search does not repaint the groups.
 */
export function arrangeAssets<T extends OrderableAsset>(
  rows: T[],
): { ordered: T[]; groups: Map<string, GroupInfo> } {
  const byDepartment = new Map<string, T[]>();
  for (const row of rows) {
    byDepartment.set(row.departmentId, [...(byDepartment.get(row.departmentId) ?? []), row]);
  }

  const departments = [...byDepartment.values()].sort(
    (a, b) =>
      a[0].departmentName.localeCompare(b[0].departmentName) ||
      a[0].departmentId.localeCompare(b[0].departmentId),
  );

  const ordered: T[] = [];
  const groups = new Map<string, GroupInfo>();
  const tints = new Map<string, number>();

  for (const departmentRows of departments) {
    const sizes = new Map<string, number>();
    // The batch as typed on its first member; a group read off names has none.
    const batchText = new Map<string, string>();
    for (const row of departmentRows) {
      const key = groupKeyOf(row);
      sizes.set(key, (sizes.get(key) ?? 0) + 1);
      const typed = row.batch?.trim();
      if (typed && !batchText.has(key)) batchText.set(key, typed.replace(/\s+/g, ' '));
    }
    for (const row of arrangeDepartment(departmentRows)) {
      const key = groupKeyOf(row);
      const size = sizes.get(key)!;
      const typed = batchText.get(key);
      let tint: number | null = null;
      // A typed batch is a group even of one; a shared name needs two.
      if (size > 1 || typed) {
        const tintKey = `${row.departmentId}\u0000${key}`;
        if (!tints.has(tintKey)) tints.set(tintKey, tints.size % GROUP_TINTS);
        tint = tints.get(tintKey)!;
      }
      ordered.push(row);
      groups.set(row.id, { key, label: typed ?? capitalise(key), isBatch: !!typed, size, tint });
    }
  }

  return { ordered, groups };
}

/**
 * One department's order with a row moved to sit before or after another.
 * Null when there is nothing to move.
 */
export function moveInOrder(
  departmentOrder: string[],
  movedId: string,
  targetId: string,
  side: 'before' | 'after',
): string[] | null {
  if (movedId === targetId || !departmentOrder.includes(movedId) || !departmentOrder.includes(targetId)) return null;
  const rest = departmentOrder.filter((id) => id !== movedId);
  const at = rest.indexOf(targetId) + (side === 'before' ? 0 : 1);
  const order = [...rest.slice(0, at), movedId, ...rest.slice(at)];
  return order.every((id, i) => id === departmentOrder[i]) ? null : order;
}
