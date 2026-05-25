// Source / expansion tracking. Every piece of content (hero class, villain
// group, henchman group, mastermind, scheme) carries an optional `source` ID
// pointing at one of these entries. Sandbox lists group their contents by
// source so it's clear which expansion each card belongs to.
//
// Adding a new expansion:
//   1. Add its ID to the `SourceId` union below.
//   2. Add a matching entry to `SOURCES` with the display name and a short
//      label for compact UIs.
//   3. Set `source: '<new-id>'` on each new card/group in that expansion.
// Existing content that omits `source` defaults to 'base' via getSource().

/** All known expansion / source identifiers. */
export type SourceId =
  | 'base';
  // Future expansions go here, e.g.:
  // | 'dark-city'
  // | 'fantastic-four'
  // | 'guardians-of-the-galaxy'

export type SourceMeta = {
  id: SourceId;
  /** Full display name shown in source headers. */
  name: string;
  /** Compact label for tight UI chips / badges. */
  shortName: string;
};

/** Display metadata for every known source. Keyed by SourceId. */
export const SOURCES: Record<SourceId, SourceMeta> = {
  base: {
    id: 'base',
    name: 'Marvel Legendary (Base Set)',
    shortName: 'Base',
  },
};

/** Stable display order — base first, then alphabetical by name. New
 *  expansions land in the alphabetical bucket unless explicitly reordered. */
export const SOURCE_ORDER: SourceId[] = Object.values(SOURCES)
  .sort((a, b) => (a.id === 'base' ? -1 : b.id === 'base' ? 1 : a.name.localeCompare(b.name)))
  .map(s => s.id);

/** Resolve a card / group's source, defaulting to 'base' when unset. */
export function getSource(item: { source?: SourceId } | null | undefined): SourceId {
  return item?.source ?? 'base';
}

/** Group an array of cards / groups by their source. Returns the groups in
 *  SOURCE_ORDER (base first). Empty source buckets are omitted. */
export function groupBySource<T extends { source?: SourceId } | object>(
  items: readonly T[],
): Array<{ source: SourceMeta; items: T[] }> {
  const buckets = new Map<SourceId, T[]>();
  for (const item of items) {
    const src = getSource(item as { source?: SourceId });
    if (!buckets.has(src)) buckets.set(src, []);
    buckets.get(src)!.push(item);
  }
  return SOURCE_ORDER
    .filter(id => buckets.has(id))
    .map(id => ({ source: SOURCES[id], items: buckets.get(id)! }));
}
