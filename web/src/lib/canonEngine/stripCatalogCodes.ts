const CATALOG_CODE_PATTERN = /\b[A-E]\d{2}\b/g;

/** Recursively removes retrieval_code keys and scrubs stray catalog codes from strings. */
export function stripCatalogCodes<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(CATALOG_CODE_PATTERN, "").replace(/\s{2,}/g, " ").trim() as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => stripCatalogCodes(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "retrieval_code") continue;
      out[k] = stripCatalogCodes(v);
    }
    return out as unknown as T;
  }
  return value;
}
