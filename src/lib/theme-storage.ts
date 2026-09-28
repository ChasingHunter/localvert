/**
 * The `localStorage` key the theme toggle persists its choice under.
 * Deliberately its own plain module (no `"use client"`): the no-flash
 * inline script in `src/app/layout.tsx` (a server component) needs this
 * exact string at build time to inline into the page, and importing a
 * named export from a `"use client"` module into a server component
 * doesn't reliably give you the real value — Next treats the whole module
 * as a client boundary, so `ThemeToggle`'s own copy of this constant came
 * back `undefined` there and silently produced `localStorage.getItem(undefined)`
 * (caught, but a real bug: the toggle's persisted choice was never read back
 * before paint). Both `ThemeToggle` (client) and the root layout (server)
 * import this same neutral module instead.
 */
export const THEME_STORAGE_KEY = "localvert-theme";
