/** A URL-safe slug. Empty input, or input with nothing usable, gets a fallback. */
export function slugify(value, fallback = "org") {
  const s = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || fallback;
}

/**
 * Find a slug nobody is using, by asking rather than guessing.
 *
 * `taken` answers whether a candidate exists. The loop is bounded because an
 * unbounded one against a broken predicate hangs the request rather than
 * failing it, and a caller can always retry.
 */
export async function uniqueSlug(base, taken, limit = 50) {
  const root = slugify(base);
  if (!(await taken(root))) return root;
  for (let i = 2; i <= limit; i++) {
    const candidate = `${root}-${i}`;
    if (!(await taken(candidate))) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}
