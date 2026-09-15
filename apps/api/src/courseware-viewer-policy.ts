export function coursewareViewerHeaders() {
  return {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Content-Security-Policy": "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; font-src data:; object-src 'none'; frame-src 'none'; frame-ancestors 'self'; form-action 'none'; base-uri 'none'"
  } as const;
}
