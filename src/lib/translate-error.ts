/**
 * Translate an API error response using the "errors" namespace.
 * API routes return translation keys (e.g., "validation.nameRequired")
 * with optional interpolation params.
 */
export function translateError(
  error: { message?: string; params?: Record<string, string | number> } | undefined,
  te: (key: string, params?: Record<string, string | number>) => string,
  fallback: string
): string {
  if (error?.message) {
    return te(error.message, error.params);
  }
  return fallback;
}
