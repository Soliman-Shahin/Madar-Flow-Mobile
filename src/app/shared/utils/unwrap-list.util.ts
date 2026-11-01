/**
 * List endpoints answer either with a bare array or with the API envelope
 * (`{ data: [...] }` or `{ data: { data: [...] } }`). Normalises all three shapes to an array.
 */
export function unwrapList<T>(response: unknown): T[] {
  if (Array.isArray(response)) return response as T[];
  const outer = (response as { data?: unknown } | null | undefined)?.data;
  const inner = (outer as { data?: unknown } | null | undefined)?.data;
  if (Array.isArray(inner)) return inner as T[];
  if (Array.isArray(outer)) return outer as T[];
  return [];
}
