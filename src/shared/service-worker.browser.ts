/**
 * Registers the shell's service worker (`public/sw.js`, ADR 0004, #48) — the
 * one thing this module does, because `src/client.tsx` already wrote down
 * that anything the worker might grow beyond precaching the shell belongs to
 * a later ticket, through `shared/observability.browser.ts`'s wrapper, not
 * this one.
 *
 * The twin of `src/shared/tick-store.browser.ts` in shape: the one module
 * that knows the browser API, with the fallback built in rather than left for
 * a caller to remember. No-op wherever `navigator.serviceWorker` does not
 * exist — a browser too old for it gets the plain responsive app ADR 0004
 * promises rather than a thrown error, and installing stays optional exactly
 * as it does for a browser that supports it and simply never adds the app to
 * a home screen.
 */
export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  void navigator.serviceWorker.register('/sw.js')
}
