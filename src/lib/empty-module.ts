// Deliberately empty. `next.config.ts` aliases the node `crypto` module to this
// file for browser bundles so Turbopack does not ship its crypto-browserify
// polyfill (about 459 KB, plus a vm-browserify shim that calls `eval`).
export {};
