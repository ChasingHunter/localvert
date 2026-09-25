# Changelog

## 0.1.0 (2026-09-25)


### Features

* **build:** core bundle budget and engine-leak gate ([4eb467d](https://github.com/ChasingHunter/localvert/commit/4eb467dcd0b7cb07b068f6511a68c8e30fc0c845))
* **build:** sync engine assets from npm and upload xl engines to r2 ([568f391](https://github.com/ChasingHunter/localvert/commit/568f3918983cd81955cc8dcb92f9b31cf80ce808))
* **engine:** adapter contracts, engine errors and a worker typecheck program ([299e502](https://github.com/ChasingHunter/localvert/commit/299e502bbebd65aea50a17eb996be45f7a219374))
* **engine:** canvas adapter for jpg, png and webp ([f340eed](https://github.com/ChasingHunter/localvert/commit/f340eedbe60a62941de95de5eb5e682fb2ad5cf7))
* **infra:** cloudflare worker with static assets and r2-backed xl engines ([77f5379](https://github.com/ChasingHunter/localvert/commit/77f53797fd1f5f6e07f20108c712e9f19763bd75))
* **jobs:** job engine and store over real engine and zip workers ([fdd5548](https://github.com/ChasingHunter/localvert/commit/fdd55480e9bbe226c56be149a9f02bad5c9d3d95))
* **pwa:** service worker with offline shell and immutable engine cache ([9f6f36e](https://github.com/ChasingHunter/localvert/commit/9f6f36e7e4c0dbde5e358111447fd1debcf7059f))
* **registry:** derive EngineId from generated engine ids ([bf25d90](https://github.com/ChasingHunter/localvert/commit/bf25d90ed159d40a30685fbf9396393bc6b92a9a))
* **registry:** generate tool barrel and engine manifest with pnpm gen ([0624ce6](https://github.com/ChasingHunter/localvert/commit/0624ce6d1d875cc1d99d6d98eec4b622ca709962))
* **registry:** per-tool loaders so pages bundle only their own tool ([01abebd](https://github.com/ChasingHunter/localvert/commit/01abebd460651115c1b8c48e86f1818e587a02b9))
* **registry:** tool definition contract and format table with magic bytes ([70db7ce](https://github.com/ChasingHunter/localvert/commit/70db7ce97901ce9de0361fd55749eac76fcacf29))
* **router:** capability probes and pipeline engine resolution ([6623cf5](https://github.com/ChasingHunter/localvert/commit/6623cf57541e0d57eebe5fd6f6fddfe0fe6b2cd0))
* **security:** security headers and per-page hashed script CSP ([05e8b61](https://github.com/ChasingHunter/localvert/commit/05e8b615e3d9617687126a7d79f0a2c3defb994c))
* **sinks:** streaming zip with backpressure, blob and file system sinks ([982c9be](https://github.com/ChasingHunter/localvert/commit/982c9be49506aec33027bbeea6c65d4e72e309dc))
* **tool:** add jpg to png via canvas engine ([b287af7](https://github.com/ChasingHunter/localvert/commit/b287af79df03726ca020afcd59db82bbfc2bd574))
* **ui:** primitives, content-sniffing dropzone and schema-driven options form ([c3d3040](https://github.com/ChasingHunter/localvert/commit/c3d304099a84b36aa65bcbb54bdb7fc2e363c12d))
* **worker:** engine host and worker pool with cancellation and heavy-engine ttl ([9c63176](https://github.com/ChasingHunter/localvert/commit/9c63176ec3df2e45e5ecfbb31bbee75ac7ab4c27))


### Bug Fixes

* **build:** exclude nomodule chunks from the core budget ([881b120](https://github.com/ChasingHunter/localvert/commit/881b12014829df2f969887aa20fc249323324f9c))
* **pwa:** keep the url fragment on worker scripts served by the service worker ([065d7ae](https://github.com/ChasingHunter/localvert/commit/065d7aeade88e296ae5af019a93bedfb29e1022f))
* **worker:** reject instead of hanging when a worker fails to load ([4389b05](https://github.com/ChasingHunter/localvert/commit/4389b0575a4407ce0a5797c8870a8422ef3830bc))


### Performance

* **ui:** lazy-load the job engine and options form on tool pages ([423046e](https://github.com/ChasingHunter/localvert/commit/423046e33556fffcd2557f7ad3aacfa8127de6cb))
