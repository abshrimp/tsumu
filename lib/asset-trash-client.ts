/** Collect every Trash page without assuming the first 100 entries are all files. */
export async function loadAllTrash<T extends { path: string }>(
  fetchPage: (offset: number) => Promise<{ items: T[]; hasMore: boolean }>,
): Promise<T[]> {
  const byPath = new Map<string, T>();
  let offset = 0;
  while (true) {
    const page = await fetchPage(offset);
    for (const item of page.items) byPath.set(item.path, item);
    offset += page.items.length;
    if (!page.hasMore) return [...byPath.values()];
    if (!page.items.length || offset > 1_000_000) throw new Error("Could not load all Trash files");
  }
}
