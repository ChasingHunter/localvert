import { describe, expect, it } from "vitest";
import { rewrapCachedResponse } from "./sw-helpers";

describe("rewrapCachedResponse", () => {
  it("drops the response's URL, keeping status/statusText/headers/body", async () => {
    // `Response.url` is read-only and only ever populated by the platform
    // (fetch, caches.match) — there's no public constructor for a Response
    // that already has one. `fetch()`-ing a `data:` URL is the cheapest way
    // to get a real Response with `.url` set, without a network round trip
    // or a local server, to stand in for what `caches.match()` would hand
    // the plugin in the service worker.
    const cached = await fetch(
      "data:text/javascript,bootstrap%20script%20body",
    );
    expect(cached.url).not.toBe("");
    expect(cached.status).toBe(200);

    const rewrapped = rewrapCachedResponse(cached);

    expect(rewrapped.url).toBe("");
    expect(rewrapped.status).toBe(cached.status);
    expect(rewrapped.statusText).toBe(cached.statusText);
    expect(rewrapped.headers.get("content-type")).toBe(
      cached.headers.get("content-type"),
    );
    await expect(rewrapped.text()).resolves.toBe("bootstrap script body");
  });
});
