/** Tags nest with "/", e.g. "Status/Retired" sits under "Status". */
export const TAG_SEPARATOR = "/";

/** Recipes with this tag are hidden from the recipe list unless asked for. */
export const RETIRED_TAG = "Status/Retired";

/** Status tags describe one recipe's test history, so duplicates don't inherit them. */
export const STATUS_PREFIX = "Status/";

/** Whether `tag` is `path` or nested somewhere under it. */
export function tagWithin(tag: string, path: string): boolean {
  const t = tag.toLowerCase();
  const p = path.toLowerCase();
  return t === p || t.startsWith(p + TAG_SEPARATOR);
}

export function hasTag(tags: readonly string[] | undefined, path: string): boolean {
  return (tags ?? []).some((t) => tagWithin(t, path));
}

export function isRetired(tags: readonly string[] | undefined): boolean {
  return hasTag(tags, RETIRED_TAG);
}

/** The last level of a tag path, for display under its parent. */
export function tagLeaf(path: string): string {
  return path.slice(path.lastIndexOf(TAG_SEPARATOR) + 1);
}

/** Trim each level and drop empty ones, as the server does. */
export function cleanTag(tag: string): string {
  return tag
    .split(TAG_SEPARATOR)
    .map((p) => p.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join(TAG_SEPARATOR);
}

/**
 * Every tag path in use, with each parent level included, mapped to how many
 * recipes sit at or under it ("Base/Chocolate" also counts toward "Base").
 */
export function tagCounts(tagLists: readonly (readonly string[] | undefined)[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tags of tagLists) {
    const paths = new Set<string>();
    for (const tag of tags ?? []) {
      const parts = tag.split(TAG_SEPARATOR);
      for (let i = 1; i <= parts.length; i++) paths.add(parts.slice(0, i).join(TAG_SEPARATOR));
    }
    for (const p of paths) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return counts;
}

/** The tag paths one level below `parent` (top level when null), sorted. */
export function childTags(counts: ReadonlyMap<string, number>, parent: string | null): string[] {
  const depth = parent ? parent.split(TAG_SEPARATOR).length + 1 : 1;
  return [...counts.keys()]
    .filter((p) => p.split(TAG_SEPARATOR).length === depth && (!parent || tagWithin(p, parent)))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
