# libraw adapter fixtures

`adapter.browser.test.ts` looks for `sample.dng` here and gates its real-decode
assertions on whether it exists (`describe.skipIf`) — no fixture, no failing
CI, just a smaller test.

No free, license-clean tiny camera raw sample was found for this slice. Every
real-world CR2/NEF/DNG/... sample turned up while writing this adapter was
either copyrighted press/sample material with unclear redistribution terms,
or tens of megabytes — too large for this repo and not needed to exercise the
decode path.

What's needed: a **public-domain or CC0** DNG, **≤ 200 KB**, small enough that
its own pixel dimensions don't matter (the tests only check that decoding
succeeds and that the output is plausible-shaped and fully opaque). A synthetic
DNG built by a small script (rather than a real camera capture) would be fine
too, as long as libraw can actually decode it.

Once `sample.dng` is added here, the gated tests in `adapter.browser.test.ts`
start running automatically — no code change needed.
