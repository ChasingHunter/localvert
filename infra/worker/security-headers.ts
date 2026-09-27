/**
 * Same `Cross-Origin-Embedder-Policy` and `Content-Security-Policy` values
 * `public/_headers` sets for the static export. This Worker's xl-engine
 * responses bypass that layer entirely (see the CORP comment in
 * `objectHeaders`, `index.ts`), so anything the page's own isolation/CSP
 * promises has to be re-declared here too. `index.test.ts` asserts these
 * literals are byte-for-byte the same as the matching lines in
 * `public/_headers`, so the two files can never drift apart silently.
 *
 * COEP specifically: the libreoffice adapter starts its nested worker
 * (`browser.worker.global.js`, ADR-0012) as a real `new Worker(url)` fetched
 * from this origin's `/engines/xl/` prefix — Chrome refuses to start a
 * dedicated worker from a cross-origin-isolated page unless the WORKER
 * SCRIPT'S OWN response carries `Cross-Origin-Embedder-Policy: require-corp`
 * (a worker's COEP/CSP come from its own script response, not the page that
 * spawned it). Every other engine here is dynamic-`import()`ed, which has no
 * such requirement — libreoffice is the first R2-hosted classic worker
 * script this app ships, and the first to hit this gap.
 */
export const COEP = "require-corp";

export const CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob:; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
