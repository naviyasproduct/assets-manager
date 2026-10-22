/**
 * The order of the Assets list, and the groups its colours mark.
 *
 * No `server-only`: the table arranges itself in the browser from the rows it
 * was given, so a drag shows at once and the server only has to store it.
 *
 * Two things can be set by hand, both per asset and both nullable:
 * - `listPosition`, written for a whole department at once on the first drag.
 *   Anything without one (added since, or renamed) flows in next to its group.
 * - `listGroup`, the group it was dragged into. Without one an asset is in the
 *   group its name puts it in: "Drilling tool 1mm" to "20mm" are one group.
 */

export type OrderableAsset = {
  id: string;
  assetTag: string;
  name: string;
  categoryCode: string;
  departmentId: string;
  departmentName: string;
  listGroup: string | null;
  listPosition: number | null;
};

/** Where a dragged row lands relative to the row under the pointer. */
export type DropZone = 'before' | 'into' | 'after';

export type GroupInfo = {
  key: string;
  /** Members in the same department, the row itself included. */
  size: number;
  /** Index into the tint palette, or null for a row on its own. */
  tint: number | null;
};

/** How many tints `globals.css` defines (`.grp-0` …). */
export const GROUP_TINTS = 6;

/** A group a row was dragged out of to stand alone, keyed so nothing else joins it. */
const OWN_PREFIX = 'own:';

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

export function groupKeyOf(asset: OrderableAsset): string {
  return asset.listGroup ?? familyKey(asset.name);
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

  // A group sits under the category most of it is filed in, so one row dragged
  // in from another category does not drag the whole group with it.
  const groupCategory = new Map<string, string>();
  const groupLabel = new Map<string, string>();
  for (const [key, group] of members) {
    const counts = new Map<string, number>();
    for (const row of group) counts.set(row.categoryCode, (counts.get(row.categoryCode) ?? 0) + 1);
    const [category] = [...counts].sort((a, b) => b[1] - a[1] || naturalCompare(a[0], b[0]))[0];
    groupCategory.set(key, category);
    // A row standing alone sorts by its own name, not by its id.
    groupLabel.set(key, key.startsWith(OWN_PREFIX) ? familyKey(group[0].name) : key);
  }

  return [...rows].sort((a, b) => {
    const ka = groupKeyOf(a);
    const kb = groupKeyOf(b);
    return (
      naturalCompare(groupCategory.get(ka)!, groupCategory.get(kb)!) ||
      naturalCompare(groupLabel.get(ka)!, groupLabel.get(kb)!) ||
      ka.localeCompare(kb) ||
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
    for (const row of departmentRows) {
      const key = groupKeyOf(row);
      sizes.set(key, (sizes.get(key) ?? 0) + 1);
    }
    for (const row of arrangeDepartment(departmentRows)) {
      const key = groupKeyOf(row);
      const size = sizes.get(key)!;
      let tint: number | null = null;
      if (size > 1) {
        const tintKey = `${row.departmentId}\u0000${key}`;
        if (!tints.has(tintKey)) tints.set(tintKey, tints.size % GROUP_TINTS);
        tint = tints.get(tintKey)!;
      }
      ordered.push(row);
      groups.set(row.id, { key, size, tint });
    }
  }

  return { ordered, groups };
}

/**
 * What a drop does to one department's order: where the row goes, and which
 * group it ends up in.
 *
 * - Dropped **onto** a row: it goes after that row and joins its group -
 *   which is also how two odd names nobody numbered become a group.
 * - Dropped **between** rows: it only moves, except that landing between two
 *   rows of one group puts it in that group. Landing beside its own group
 *   keeps it there; anywhere else it stands alone.
 */
export function applyDrop<T extends OrderableAsset>(
  departmentOrder: T[],
  movedId: string,
  targetId: string,
  zone: DropZone,
): { order: string[]; listGroup: string | null } | null {
  const moved = departmentOrder.find((row) => row.id === movedId);
  const target = departmentOrder.find((row) => row.id === targetId);
  if (!moved || !target || moved.id === target.id) return null;

  const rest = departmentOrder.filter((row) => row.id !== movedId);
  const at = rest.indexOf(target) + (zone === 'before' ? 0 : 1);
  const order = [...rest.slice(0, at), moved, ...rest.slice(at)];

  const own = familyKey(moved.name);
  const current = groupKeyOf(moved);
  const join = (key: string) => (key === own ? null : key);

  let listGroup: string | null;
  if (zone === 'into') {
    listGroup = join(groupKeyOf(target));
  } else {
    const above = rest[at - 1];
    const below = rest[at];
    const aboveKey = above ? groupKeyOf(above) : null;
    const belowKey = below ? groupKeyOf(below) : null;
    if (aboveKey !== null && aboveKey === belowKey) listGroup = join(aboveKey);
    else if (aboveKey === current || belowKey === current) listGroup = moved.listGroup;
    else {
      // Out on its own. If its name would still put it in a group elsewhere,
      // it needs a group of its own, or it would keep that group's colour.
      const namesake = rest.some((row) => groupKeyOf(row) === own);
      listGroup = namesake ? `${OWN_PREFIX}${moved.id}` : null;
    }
  }

  return { order: order.map((row) => row.id), listGroup };
}
