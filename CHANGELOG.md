# Changelog

## [0.2.0](https://github.com/ChasingHunter/localvert/compare/v0.1.0...v0.2.0) (2026-09-26)


### Features

* **engine:** add tesseract for in-browser OCR ([74ca74c](https://github.com/ChasingHunter/localvert/commit/74ca74c7ea8a6e27fefb265101c02decd0227a8d))
* **engine:** camera raw decode via libraw ([c12fd89](https://github.com/ChasingHunter/localvert/commit/c12fd891f1a21202fa32847a99b5bd5c1d1ccf74))
* **engine:** compress pdfs by re-encoding embedded images ([bda0da5](https://github.com/ChasingHunter/localvert/commit/bda0da56360fc83a29c85db2b1865fb2cd1b2729))
* **engine:** encode to a target file size ([2498d4d](https://github.com/ChasingHunter/localvert/commit/2498d4d896e9ebf851d8c3019afb613afab04d0e))
* **engine:** heic decode via heic-to ([cbe4e39](https://github.com/ChasingHunter/localvert/commit/cbe4e395391ba2f0a0d3b5d4c1c014331a2baf04))
* **engine:** jsquash-avif decode and encode ([4b523e3](https://github.com/ChasingHunter/localvert/commit/4b523e35a7d77aad4b7997c395b00a1dcf7a08af))
* **engine:** jsquash-jpeg (mozjpeg) decode and encode ([1a52a65](https://github.com/ChasingHunter/localvert/commit/1a52a65a3fccaae29db69b714d3b59716e9eb638))
* **engine:** jsquash-jxl decode and encode ([7e000c8](https://github.com/ChasingHunter/localvert/commit/7e000c86fbaab9d58dce5f244facc56025bdfe86))
* **engine:** jsquash-png decode and encode ([589d0bd](https://github.com/ChasingHunter/localvert/commit/589d0bd5fb5624b6c4518acf7b66d99eb2fe35ca))
* **engine:** jsquash-resize high-quality resize ([cb773cd](https://github.com/ChasingHunter/localvert/commit/cb773cdb7387443f6aee5b5f462d335de8db6e44))
* **engine:** jsquash-webp decode and encode ([e1ae094](https://github.com/ChasingHunter/localvert/commit/e1ae09419ee626c366637ac601ebdd91635779fe))
* **engine:** lossless metadata stripping for jpeg, png and webp ([3316b8c](https://github.com/ChasingHunter/localvert/commit/3316b8c74a236f6ddaebbf1d3e89f7a9c9077e33))
* **engine:** password protect and unlock pdfs ([f7d4663](https://github.com/ChasingHunter/localvert/commit/f7d4663c8e3a7d1dafe8bd7754ac5426db89bbb8))
* **engine:** pdf structure edits via pdf-lib ([194c177](https://github.com/ChasingHunter/localvert/commit/194c177bfd6f4a0f33573b215d63cc26a8e39dee))
* **engine:** psd decode via @webtoon/psd ([6ac838a](https://github.com/ChasingHunter/localvert/commit/6ac838ae82d7c91dd46a295217a03ef27bf1b7ef))
* **engine:** raster pipeline — multi-step decode, transform, encode in one worker ([b9eed45](https://github.com/ChasingHunter/localvert/commit/b9eed45f212578045b170020181af527270c03c0))
* **engine:** raster to svg tracing ([ed34e57](https://github.com/ChasingHunter/localvert/commit/ed34e57e1ffd53349e06bfac1cada4f3d22029ff))
* **engine:** render pdf pages to images with pdf.js ([bd293c9](https://github.com/ChasingHunter/localvert/commit/bd293c945376c721f8206f75389e3c2dd8f0d9db))
* **engine:** rotate, delete, extract pages and images to pdf ([31f35bc](https://github.com/ChasingHunter/localvert/commit/31f35bca19a0414b5ba19db8ddd605f3350d3b64))
* **engine:** svg rasterisation via resvg ([aa15078](https://github.com/ChasingHunter/localvert/commit/aa15078c7bb6da3f2421db16761b85fcee7cb00f))
* **engine:** tiff decode via utif2 ([101ebed](https://github.com/ChasingHunter/localvert/commit/101ebedeb265fd9e243adc2e8e0677bb3cc0bce9))
* **jobs:** many-to-one and one-to-many jobs ([d470b14](https://github.com/ChasingHunter/localvert/commit/d470b147bd34b5396b3f569f20cba3121f25f210))
* **registry:** allow output-only formats with no magic bytes ([13edac5](https://github.com/ChasingHunter/localvert/commit/13edac501802e2fad0a312157ce6e84c7a674333))
* **registry:** camera raw format with extension-assisted detection ([095fa1d](https://github.com/ChasingHunter/localvert/commit/095fa1dc1cd8fea97800426d39d0c02b74d14ff8))
* **registry:** register the jxl format ([b1ff16d](https://github.com/ChasingHunter/localvert/commit/b1ff16da8a6ea6b40fb05d384e3feca66bd617f4))
* **registry:** tools declare file arity ([dec36c3](https://github.com/ChasingHunter/localvert/commit/dec36c34b76c4f8aa957ef055fbf37ba76533503))
* **tool:** compress pdf ([c8877d4](https://github.com/ChasingHunter/localvert/commit/c8877d47952b27ceefd889e60fa68aad04884906))
* **tool:** compress, resize and rotate images ([6c4376f](https://github.com/ChasingHunter/localvert/commit/6c4376f471f415f0ad750042bbdcd57f1da54393))
* **tool:** crop jpg, png and webp ([10ec4ed](https://github.com/ChasingHunter/localvert/commit/10ec4ed2ef910e54d9031c8120679c10b569a3d1))
* **tool:** heic, svg, tiff and psd to jpg and png ([1c2b3cf](https://github.com/ChasingHunter/localvert/commit/1c2b3cfd9a5f2edda86336b3b1e159a770a830ed))
* **tool:** image to text and searchable pdf with ocr ([1b7562c](https://github.com/ChasingHunter/localvert/commit/1b7562ca50a4e21a8345ada7c894139525af75ec))
* **tool:** jpg and png to webp, avif, jxl and between each other ([41437e2](https://github.com/ChasingHunter/localvert/commit/41437e290268d59d8028076dd26ea844b777c4ac))
* **tool:** merge pdf and split pdf ([ac8db85](https://github.com/ChasingHunter/localvert/commit/ac8db85a2fc603808738147681a2d6875b3d3c38))
* **tool:** pdf to jpg and png ([5b94615](https://github.com/ChasingHunter/localvert/commit/5b94615140bba9b744470527103b5c3fde73bc50))
* **tool:** png, jpg and webp to svg ([86ed3a6](https://github.com/ChasingHunter/localvert/commit/86ed3a6010fc9d140da386d7a78c97d21cf4d284))
* **tool:** raw to jpg and png ([6e1a4c0](https://github.com/ChasingHunter/localvert/commit/6e1a4c0a05d105a0fd212f8d3c2645d9a680e670))
* **tool:** rotate, delete, extract pages, images to pdf, protect and unlock pdf ([50794f5](https://github.com/ChasingHunter/localvert/commit/50794f5bd96b0745a9543d33d04277aad0996665))
* **tool:** strip exif and gps metadata from photos ([44f8702](https://github.com/ChasingHunter/localvert/commit/44f8702e318532396926619ba528125b03a8859d))
* **tool:** webp, avif and jxl to jpg and png ([2deeb28](https://github.com/ChasingHunter/localvert/commit/2deeb28633411a2c3ba417d35a3756353fdc6c80))
* **ui:** clearer option controls ([4317925](https://github.com/ChasingHunter/localvert/commit/4317925f289031294c17790c1f25e4080df5dda1))
* **ui:** explicit option step ([61bfccf](https://github.com/ChasingHunter/localvert/commit/61bfccf88835794a401efc87d36e2fb662ac6587))
* **ui:** home and tool page layout for many tools ([0e8b325](https://github.com/ChasingHunter/localvert/commit/0e8b325259374ed955502ec68ed7027d2f59c8e6))
* **ui:** interactive crop editor ([98dbf0d](https://github.com/ChasingHunter/localvert/commit/98dbf0d5472b00318d0df49dd3f7fb4435e11fb6))
* **ui:** show option fields only when relevant ([1de8770](https://github.com/ChasingHunter/localvert/commit/1de877099eff079d35d558902ae6eebbad3555cb))
* **ui:** site header, footer and category pages ([a40071b](https://github.com/ChasingHunter/localvert/commit/a40071bc36e98729bfa02bb1cb305e81efd712fe))


### Bug Fixes

* **engine:** jsquash-jpeg composites transparent pixels over the background colour ([06feed8](https://github.com/ChasingHunter/localvert/commit/06feed88771fdfd816f358e52ed983bab9e7f63b))
* **engine:** load libraw's emscripten glue at runtime instead of bundling it ([f2e5b8c](https://github.com/ChasingHunter/localvert/commit/f2e5b8ce570b01980649680a904bd6bbbfe3087d))
* **gen:** quote hyphenated engine ids as object keys ([cf5e691](https://github.com/ChasingHunter/localvert/commit/cf5e691287b2566c5e4a8bd9d8e32bef59544b50))
* resolve typecheck and lint fallout from merging the phase 1 branches ([a73a00a](https://github.com/ChasingHunter/localvert/commit/a73a00a80c8661f31895f9987d7b3bfa69910b8e))
* **test:** ops-tools defaults tests expect absent optional keys, not undefined ([e39e5ff](https://github.com/ChasingHunter/localvert/commit/e39e5ff5f33e7461d5f297dcc205ce34ee81963b))
* **test:** run browser test files sequentially and isolated ([93ab769](https://github.com/ChasingHunter/localvert/commit/93ab769bab8c5e8efba0e468edf02d4e72a844e7))
* **test:** scope jpg-to-png rejection e2e check to the job list heading ([f0aef6f](https://github.com/ChasingHunter/localvert/commit/f0aef6ffd3bd7e7f27fce98ab8e4bd26d3ad6a9d))
* **test:** sync engine assets before browser tests ([8464eee](https://github.com/ChasingHunter/localvert/commit/8464eee3cc0a23b5295c00dd4bd4428314c0e576))
* **test:** treat measureUserAgentSpecificMemory as optional ([a60503b](https://github.com/ChasingHunter/localvert/commit/a60503b95c139903a544aa47514b2912045d260b))
* **tool:** default jpgOptions quality/background at the schema level ([e969f80](https://github.com/ChasingHunter/localvert/commit/e969f8057ce881fd41d649785e1f9e0c18df8715))


### Refactoring

* **build:** derive engine versions and asset sizes from installed packages ([d2c2d74](https://github.com/ChasingHunter/localvert/commit/d2c2d74513d7141fcff8f8aae64b5fafa849eb96))
* **tool:** jpg-to-png through imagePipeline ([f811ec2](https://github.com/ChasingHunter/localvert/commit/f811ec276e9ef7459f96413270d59e04dacd3e58))
* **tool:** shared option schemas for all image tools ([0e7dcb0](https://github.com/ChasingHunter/localvert/commit/0e7dcb028812f78c10dc85053e86ae7ae4dc7f14))

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
