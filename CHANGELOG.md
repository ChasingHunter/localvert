# Changelog

## [0.6.0](https://github.com/ChasingHunter/localvert/compare/v0.5.1...v0.6.0) (2026-10-01)


### Features

* **tool:** images in pdf to word ([60faef6](https://github.com/ChasingHunter/localvert/commit/60faef603721ec09fd5117583f3160c994517e25))


### Bug Fixes

* **tool:** tell people when pdf to word leaves pictures out ([6f80184](https://github.com/ChasingHunter/localvert/commit/6f8018446e1f647533379250b1a19c2b47e33045))

## [0.5.1](https://github.com/ChasingHunter/localvert/compare/v0.5.0...v0.5.1) (2026-10-01)


### Performance

* **build:** fail check-sizes when zod lands in a first-load chunk ([7547936](https://github.com/ChasingHunter/localvert/commit/7547936aa2f6e7b492bec263c09288642caa3f38))
* **ui:** keep zod off the main thread on tool pages ([e5ef151](https://github.com/ChasingHunter/localvert/commit/e5ef15184264955f1d304bbc398008e56ce5c694))

## [0.5.0](https://github.com/ChasingHunter/localvert/compare/v0.4.0...v0.5.0) (2026-10-01)


### Features

* **pwa:** accept files from the share sheet ([157200f](https://github.com/ChasingHunter/localvert/commit/157200f8dc3ce0ecbc52020389f87b001127b0a8))
* **pwa:** app icons and web manifest ([ae0417e](https://github.com/ChasingHunter/localvert/commit/ae0417eca183ef44298694c7dd6a6b1ec2cee370))
* **pwa:** open files from the OS with an installed app ([c95dc42](https://github.com/ChasingHunter/localvert/commit/c95dc426fadbf89f281891df786f6b68a5069d5e))
* **ui:** storage page to see and clear downloaded converters ([257c51a](https://github.com/ChasingHunter/localvert/commit/257c51a075708003c3112ba703e3688605933980))


### Bug Fixes

* **a11y:** add a skip-to-content link ([4810441](https://github.com/ChasingHunter/localvert/commit/48104415184b008c51889c81640f56f2ac2469d7))
* **a11y:** alt text on editor images, keyboard-scrollable page viewport ([b09a0db](https://github.com/ChasingHunter/localvert/commit/b09a0db27e64d4cc5ad32fc7092ef4a9d80fbb04))
* **a11y:** move focus into the crop and trim editors, 24px crop handles ([9f766d4](https://github.com/ChasingHunter/localvert/commit/9f766d4476bb3acb0fcde71769e1d7e5c1c3f85a))
* **a11y:** name slider thumbs and underline the consent dialog's links ([0dbcd22](https://github.com/ChasingHunter/localvert/commit/0dbcd22bc1f3700bf46f2ea7af9b61f98d56920a))
* **build:** serve the flat RSC segment names the client prefetches ([311c852](https://github.com/ChasingHunter/localvert/commit/311c852d12914f0e18d871d92dcf47247800839b))


### Performance

* **engine:** drop the node crypto polyfill from the pdfium worker ([a4613f0](https://github.com/ChasingHunter/localvert/commit/a4613f007b1f65952d806f40c533cd6ec2d488a7))
* **ui:** hold the converter's footprint while a tool loads ([bb98d87](https://github.com/ChasingHunter/localvert/commit/bb98d8794cb43110046555a305f8e6e1954e955d))
* **ui:** lighter Fraunces file and preloaded fonts ([3cd3390](https://github.com/ChasingHunter/localvert/commit/3cd3390d6559f19b754d3b458b445bdb12973665))

## [0.4.0](https://github.com/ChasingHunter/localvert/compare/v0.3.0...v0.4.0) (2026-10-01)


### Features

* **audio:** smart compression modes for compress-audio (ADR-0017) ([e1469a5](https://github.com/ChasingHunter/localvert/commit/e1469a586ea403d24b6efb8100383c3fe6b5b307))
* **converter:** catalog helpers for the from-to picker ([194e7d3](https://github.com/ChasingHunter/localvert/commit/194e7d3b943f8795fbd2bbd2b6922f2518a3ab6b))
* **converter:** detection grouping and announcement helpers ([a12ca27](https://github.com/ChasingHunter/localvert/commit/a12ca27af639f11b9e40a11e214a7806914c0db4))
* **converter:** file handoff store ([4fadc91](https://github.com/ChasingHunter/localvert/commit/4fadc91c5ecaee7c23ef9616ec1203732730e29f))
* **converter:** from-to picker island on home, category and tool pages ([c7efcf8](https://github.com/ChasingHunter/localvert/commit/c7efcf8da93d183f1c08b5b774255fdd573aedb8))
* **editor:** font picker and match-document for FreeText ([44ea58d](https://github.com/ChasingHunter/localvert/commit/44ea58d389794b16c78238e09f2d877651e07c6a))
* **engine:** off-main-thread size probe for video/audio/pdf ([7cf3fba](https://github.com/ChasingHunter/localvert/commit/7cf3fba90dcedcc92af52139e315658cf76c3390))
* **engine:** pre-run size estimate math for video/audio/pdf compress ([97926a3](https://github.com/ChasingHunter/localvert/commit/97926a306d7f604951ae43614e57bfa1f78eddb0))
* **engine:** shared byte formatting + ADR-0017 result-note builder ([641358f](https://github.com/ChasingHunter/localvert/commit/641358f00b5cf310b9be8399215e3de769cc077f))
* **engine:** smart compression core math (ADR-0017) ([fe47f2f](https://github.com/ChasingHunter/localvert/commit/fe47f2f3d7c0851201e4fefbcfdc882e5fc2be04))
* **engine:** wire smart compression into jsquash-jpeg (ADR-0017) ([5aff724](https://github.com/ChasingHunter/localvert/commit/5aff72483f361ec044341bfca204d554dd61b467))
* **engine:** wire smart compression into jsquash-png (ADR-0017) ([db9fe1a](https://github.com/ChasingHunter/localvert/commit/db9fe1a9910cfe4f34af8fad5dcf221e93fb00c8))
* **engine:** wire smart compression into jsquash-webp (ADR-0017) ([2797a1d](https://github.com/ChasingHunter/localvert/commit/2797a1d857b2f3ce19b4d65256b9fbb93f741d54))
* **pdf:** smart compression modes for compress-pdf (ADR-0017) ([9db0562](https://github.com/ChasingHunter/localvert/commit/9db0562440eda9825b65df03f1e1226399750bca))
* **registry:** format aliases for search ([5d368e3](https://github.com/ChasingHunter/localvert/commit/5d368e340071a97b337f0478e9aa6d4439203dbc))
* **registry:** tool rank and a generated from/to catalog ([f4be14c](https://github.com/ChasingHunter/localvert/commit/f4be14cffeefc39072d29ba2a52c1fbdd0e7cdfa))
* **seo:** absolute canonicals, sitemap and robots for localvert.dpdns.org ([34333ce](https://github.com/ChasingHunter/localvert/commit/34333ce8072b4bc1bedd12addb95d451120e2368))
* **seo:** llms.txt and site structured data ([e96def3](https://github.com/ChasingHunter/localvert/commit/e96def37258483b7196396b1d281b15e4a4bb218))
* **seo:** short answers and structured data on tool pages ([ac78e5c](https://github.com/ChasingHunter/localvert/commit/ac78e5c3278615d57b6d63d2f87d3ab4336658ab))
* **tool:** compress-video target size, reduce by %, and best quality (ADR-0017) ([d83fd4c](https://github.com/ChasingHunter/localvert/commit/d83fd4c9344b6ec21092d71c6299fc3b348a0880))
* **tool:** recommended compression by default for compress pdf ([045d388](https://github.com/ChasingHunter/localvert/commit/045d388275ce34ea555dd68c5d9a0cc2155e7aa6))
* **tool:** resize images by percentage by default ([4d4b785](https://github.com/ChasingHunter/localvert/commit/4d4b7859f7f72a858034a586e1086cb314013e85))
* **tool:** stage compress-video/audio/pdf's target/percent modes with a size estimate ([12e051f](https://github.com/ChasingHunter/localvert/commit/12e051f01f244f32a8f276fde4603a1337f873ce))
* **ui:** accessible combobox ([618807a](https://github.com/ChasingHunter/localvert/commit/618807ac8a4dd7fe5ffdb5b11cb3722f3d75fe9c))
* **ui:** bump options-form inputs/selects to the 8px radius tier ([0d69e43](https://github.com/ChasingHunter/localvert/commit/0d69e430fd652a872c931caa26c52e72dcad3eca))
* **ui:** combobox state machine ([58ba150](https://github.com/ChasingHunter/localvert/commit/58ba1509a1e670df2b99b972cf103847e967d181))
* **ui:** comparison index page ([9743d07](https://github.com/ChasingHunter/localvert/commit/9743d07536f17e009c1ffadcf29871b24d11a5d0))
* **ui:** comparison pages ([cece0e8](https://github.com/ChasingHunter/localvert/commit/cece0e8b87a126a40932990394ac7e1ff55ac581))
* **ui:** compress menu and convert link in the header ([d17168b](https://github.com/ChasingHunter/localvert/commit/d17168b30d6f3a02a2be8aa9d0a5044364a67a1f))
* **ui:** design tokens and self-hosted fonts (ADR-0016) ([8f79591](https://github.com/ChasingHunter/localvert/commit/8f79591d69e95c0f2bc00774e44a27e788b067b4))
* **ui:** header search ([1581305](https://github.com/ChasingHunter/localvert/commit/1581305194faf9f780732ab29d74fa97a932a4a5))
* **ui:** home page redesign with the sentence converter ([16e8ab1](https://github.com/ChasingHunter/localvert/commit/16e8ab10c1eb1f7f1799d7cd57702746bc2628f2))
* **ui:** light/dark theme toggle ([094df6d](https://github.com/ChasingHunter/localvert/commit/094df6d39005023d91e8a471df81e78ccd0e19f8))
* **ui:** make-a-file-smaller page ([13ee8f2](https://github.com/ChasingHunter/localvert/commit/13ee8f27bd84750fff9fde976e5516f05c735bc3))
* **ui:** one privacy line per tool page, not four ([5609432](https://github.com/ChasingHunter/localvert/commit/5609432648b6287cf663907ec647ed3a22084f31))
* **ui:** pdf hub with grouped tools ([0dac171](https://github.com/ChasingHunter/localvert/commit/0dac171b5276950bc554ae0de915399dc6d4953e))
* **ui:** popular tools on every category page ([cf560e2](https://github.com/ChasingHunter/localvert/commit/cf560e230bc843b8845b11a679d156c09aceda74))
* **ui:** preview and set trim points for video tools ([ffe9e6f](https://github.com/ChasingHunter/localvert/commit/ffe9e6faf3087a3429d53b55b89f5185d87ecd7b))
* **ui:** privacy page ([5540076](https://github.com/ChasingHunter/localvert/commit/55400761cd2ffa61b55b746b627dc6f06698ca51))
* **ui:** promise-first home ([eb0acde](https://github.com/ChasingHunter/localvert/commit/eb0acde362b17c8d2fd887a2636c764b947d0be2))
* **ui:** readable option labels, percent quality, fewer needless fields ([4a94a6c](https://github.com/ChasingHunter/localvert/commit/4a94a6c427367c4e2be232e41768d9aa1f44bb81))
* **ui:** redesign category, 404 and offline pages to ADR-0016 ([f053327](https://github.com/ChasingHunter/localvert/commit/f053327b1960e98a2e302b5ef5a32a04d9fd1f03))
* **ui:** redesign job rows as simple lines, not cards ([fcd9b7e](https://github.com/ChasingHunter/localvert/commit/fcd9b7e48042ebad2458b822f038a0cbac456454))
* **ui:** redesign tool page to ADR-0016 (Fraunces h1, side-column options) ([29288d2](https://github.com/ChasingHunter/localvert/commit/29288d23cea5926bab2209787c4f3f0dc28962b7))
* **ui:** redesigned header and footer ([0cbd2be](https://github.com/ChasingHunter/localvert/commit/0cbd2bee65c4f24ec0211d62ba1c0b0defa594d5))
* **ui:** restyle consent dialog, crop editor and file-order-list ([a781223](https://github.com/ChasingHunter/localvert/commit/a7812239452a55b4e886055cf76bf39fc0e0a4a7))
* **ui:** reuse the home hero converter on category pages ([38de34d](https://github.com/ChasingHunter/localvert/commit/38de34dfc90149c3d236a9314d2dd48bc49de203))
* **ui:** run again with new settings ([7662129](https://github.com/ChasingHunter/localvert/commit/7662129a15bae73cb8642913a3732df3664773f2))
* **ui:** sentence pickers as inline pills, quieter drop area, icon theme toggle ([61057be](https://github.com/ChasingHunter/localvert/commit/61057be225d6b48d60988da66ed1c512992748c6))
* **ui:** support a disabled combobox ([045b135](https://github.com/ChasingHunter/localvert/commit/045b1351902a94862a681167ab99a175f47db7f9))
* **ui:** thumbnails in the image-to-pdf order list ([46261d2](https://github.com/ChasingHunter/localvert/commit/46261d2f87541900eae2211fa849b74a71238391))


### Bug Fixes

* **a11y:** drop the word "convert" from the dropzone's aria-label ([b134977](https://github.com/ChasingHunter/localvert/commit/b1349777214035b14832279553a65d3a38ba12e7))
* **audio:** drop banned word and align formatMB rounding ([2e95e89](https://github.com/ChasingHunter/localvert/commit/2e95e89fe2b9a7284a07b0691a84e115fea0684a))
* **converter:** category pages offer only their own formats ([8336ab9](https://github.com/ChasingHunter/localvert/commit/8336ab955d9c5d01fa8fa5cc568af84d84e03583))
* **converter:** label spreadsheets on the document page as a PDF source ([10e782c](https://github.com/ChasingHunter/localvert/commit/10e782ca01063cef73365b01ac3e43b9f69baa83))
* **editor:** let the export cluster wrap so the toolbar fits at 390px ([2fbac81](https://github.com/ChasingHunter/localvert/commit/2fbac81c69d9402809fb658c87f6ac01a8b0fb85))
* **engine:** a compress target bigger than the file returns the original ([950d6d0](https://github.com/ChasingHunter/localvert/commit/950d6d05a9429687363da094f5351dcb8141a768))
* **engine:** canvas conversions stop promptly when cancelled ([37d639d](https://github.com/ChasingHunter/localvert/commit/37d639d1877509e1ec89dfacf5c7b14955402d4d))
* **engine:** cap mediabunny video/audio bitrate at the source's own ([b3ba764](https://github.com/ChasingHunter/localvert/commit/b3ba76475a66f84ba2623af639052b640d046d08))
* **engine:** detect and retry stalled engine downloads ([8cc2808](https://github.com/ChasingHunter/localvert/commit/8cc28088b169ce2c1537f4b515f8128e6afd6285))
* **engine:** don't misreport already-under-target compression as a percent ([7c9c059](https://github.com/ChasingHunter/localvert/commit/7c9c059fbd92144e1d70ef3e324185db7cd7951f))
* **engine:** don't misreport compress-pdf's lightest-step undershoot ([d2713bf](https://github.com/ChasingHunter/localvert/commit/d2713bf218e9cef019e006fb17f3e3b3626f1be6))
* **engine:** heic decode under the production CSP ([3c8ebe8](https://github.com/ChasingHunter/localvert/commit/3c8ebe8a7ddd386365ed98f078524e97756bc8c4))
* **engine:** notes name the target you typed and drop em dashes ([3ef7109](https://github.com/ChasingHunter/localvert/commit/3ef710911827dcd35c0e19f2523b253a1abe9ca0))
* **engine:** pdf notes show small results in KB; test the already-under wording ([bf34ba0](https://github.com/ChasingHunter/localvert/commit/bf34ba0c98f74fc108cbca3e8fa2ddf229ec414d))
* **engine:** reject a trim start past the end of the video ([aee5f6b](https://github.com/ChasingHunter/localvert/commit/aee5f6bf364cd1a2f5cda968f61a10563fae0225))
* **engine:** retry a libreoffice boot that hangs instead of spinning forever ([a820221](https://github.com/ChasingHunter/localvert/commit/a8202213ca55638cd7403c4e52bf2d31f9ecabbd))
* **engine:** round every mediabunny video/audio bitrate to an integer ([27cb32c](https://github.com/ChasingHunter/localvert/commit/27cb32cce29054d7484ee165a5f004eed04a4ebd))
* **engine:** run libraw under the production CSP ([f3b23a5](https://github.com/ChasingHunter/localvert/commit/f3b23a5f2c5d997c90d153699f66e68548ad3001))
* **estimate:** don't promise pdf target sizes we might miss ([97dde5e](https://github.com/ChasingHunter/localvert/commit/97dde5e0aabfeb7a11614877b4bb9312ef7b5eef))
* **pdf:** split ranges on commas and explain bad page ranges ([2da9e5b](https://github.com/ChasingHunter/localvert/commit/2da9e5bc32be8205f30c07b9f11ec97e0decc3bf))
* **tool:** compress-video never makes a file bigger ([37004b1](https://github.com/ChasingHunter/localvert/commit/37004b190f8c75ae60b2acc5464ac25c565a80f7))
* **tool:** plain, human tool descriptions ([eb3b9b9](https://github.com/ChasingHunter/localvert/commit/eb3b9b920ba83ef38161a060898e646109c58064))
* **ui:** center the engine consent dialog and rewrite its copy ([44f28ad](https://github.com/ChasingHunter/localvert/commit/44f28ade6002b7da452e83d90fe9860b36be5981))
* **ui:** drop remaining em dashes from user-facing copy ([1badd26](https://github.com/ChasingHunter/localvert/commit/1badd267d6e8570c0f922107543317ba92cdd8ce))
* **ui:** drop the pdf editor's duplicate empty-state heading and privacy note ([db5cdc4](https://github.com/ChasingHunter/localvert/commit/db5cdc43039e26f76c457ff9d5b8fe57416dc18b))
* **ui:** drop the redundant privacy line under the home drop area ([73c5865](https://github.com/ChasingHunter/localvert/commit/73c5865feef043857f7ed3992e05d28e5181cd0f))
* **ui:** focus the primary action in the consent dialog, align category width ([f903126](https://github.com/ChasingHunter/localvert/commit/f90312621a3c9643acec08c78da7b4b18c462253))
* **ui:** hide empty options column on crop tools and pluralise file counts ([85ba7e3](https://github.com/ChasingHunter/localvert/commit/85ba7e3902ea0ea2d0051834a003b422320912b2))
* **ui:** hug-content pills, pill-level focus ring, short home link labels ([677323c](https://github.com/ChasingHunter/localvert/commit/677323c536c60368a64e2c1d72df7f2482da3c12))
* **ui:** keep the iLovePDF comparison to what the sources support ([5323ffb](https://github.com/ChasingHunter/localvert/commit/5323ffb1b3b0419cd9b1b1381ab811ce575ee654))
* **ui:** left-align the privacy and comparison pages ([68ca510](https://github.com/ChasingHunter/localvert/commit/68ca510ca8ca3bc81faa37d5f52258ccba3595df))
* **ui:** list the compress menu in the /compress page order ([78dbdaa](https://github.com/ChasingHunter/localvert/commit/78dbdaaf7bee5012693dbd98b80a48e927c0be26))
* **ui:** pill input still wasn't hugging content — browser's default size ([e2d8ea3](https://github.com/ChasingHunter/localvert/commit/e2d8ea325a02af58a32295b3b63cfb386b7f66c8))
* **ui:** render the no-flash theme script as literal HTML, not next/script ([2db43aa](https://github.com/ChasingHunter/localvert/commit/2db43aa7a716b7ce48e272321789fe71c45ca082))
* **ui:** say so when a tool's code is slow to load or fails, instead of spinning forever ([f8f14ee](https://github.com/ChasingHunter/localvert/commit/f8f14ee1033079bca2b47120e27aede63e0b68c1))
* **ui:** scope the Popular chip e2e test to its own landmark ([2cc039d](https://github.com/ChasingHunter/localvert/commit/2cc039d7b96dc18337c2774973a6062314d57fe8))


### Performance

* **engine:** fix pdfjs font/cmap fetches silently failing in-worker ([e2655a9](https://github.com/ChasingHunter/localvert/commit/e2655a95116e7922f472b442c5cec6e2c50be0c8))
* **engine:** serve engine assets from paths without '@' ([9bbc780](https://github.com/ChasingHunter/localvert/commit/9bbc780001e981a36c403e8c70196849956e3d75))
* **engine:** speed up SSIM ~9x for the compression search hot path ([ca2077e](https://github.com/ChasingHunter/localvert/commit/ca2077e1971f2b9e8d43e6246440e68ca1dd1a82))
* **ui:** keep tailwind-merge out of the combobox so the converter fits its budget ([4742aa6](https://github.com/ChasingHunter/localvert/commit/4742aa6fa9a6b13bf12334c674093239b8466cd5))
* **ui:** keep the estimate maths out of every tool page's first load ([ccb4c19](https://github.com/ChasingHunter/localvert/commit/ccb4c197466b8958fed3f3a3d7ad70510d603c6e))
* **ui:** load the engine consent dialog on demand ([7cf2b21](https://github.com/ChasingHunter/localvert/commit/7cf2b21673d2bccc3a067f8447e53a34e4fbc70d))

## [0.3.0](https://github.com/ChasingHunter/localvert/compare/v0.2.0...v0.3.0) (2026-09-27)


### Features

* **engine:** decode and encode gif, bmp and ico in the raster pipeline ([d65d224](https://github.com/ChasingHunter/localvert/commit/d65d22455398fe755d9f35fa9aaf93d1e604103d))
* **engine:** docx writer engine ([5461f0b](https://github.com/ChasingHunter/localvert/commit/5461f0b999d487e9bbcf919daa5719ed8f230cc3))
* **engine:** pdfjs extractLayout op for structural PDF extraction ([c22f4c2](https://github.com/ChasingHunter/localvert/commit/c22f4c2d361990abea2938dd9e79ba5298aa65f9))
* **tool:** aac and opus to mp3 ([9137c74](https://github.com/ChasingHunter/localvert/commit/9137c7472bac89150cd41eff9f3cd80f07e4f080))
* **tool:** add page numbers to pdf ([59c34b2](https://github.com/ChasingHunter/localvert/commit/59c34b2f1fa70ab220e77707c2396d10027004ef))
* **tool:** compress audio ([9cf9311](https://github.com/ChasingHunter/localvert/commit/9cf9311e1a2476d78cd1b13776443e8f8f61c2fd))
* **tool:** compress png losslessly or with palette reduction ([52b5744](https://github.com/ChasingHunter/localvert/commit/52b5744043ccf067c822d8d1e29ae3eb310c40be))
* **tool:** compress-jpg modes with a lossless default ([e0b9502](https://github.com/ChasingHunter/localvert/commit/e0b95028f7aa2fe1276b950126903c2e1c0eb65e))
* **tool:** compress-webp modes with a lossless default ([7186323](https://github.com/ChasingHunter/localvert/commit/7186323ff3e6c60f8609160c79138eb39488aa99))
* **tool:** epub to pdf ([b13a6ea](https://github.com/ChasingHunter/localvert/commit/b13a6eacf8bdb2022bb59d57341013377eb48e09))
* **tool:** gif, bmp and ico conversions ([9310447](https://github.com/ChasingHunter/localvert/commit/9310447d8c4288170d59e2369b62830a935bf502))
* **tool:** jpg to pdf and png to pdf ([9291a09](https://github.com/ChasingHunter/localvert/commit/9291a099f61aad990b3d91388f886b34a2205a3e))
* **tool:** lossless compress-pdf mode ([9f2b032](https://github.com/ChasingHunter/localvert/commit/9f2b032c2ccb54727879fc8991e85f8ea379f427))
* **tool:** m4a and flac to wav ([cb342a2](https://github.com/ChasingHunter/localvert/commit/cb342a230ae860120b59e68a798e088a3005c7b1))
* **tool:** mp4, mov and webm to mp3 ([0467f7c](https://github.com/ChasingHunter/localvert/commit/0467f7c92b280c0e87132127186b8077bad5f23b))
* **tool:** pdf to text ([f47c783](https://github.com/ChasingHunter/localvert/commit/f47c783cfca6fb77e6a30760bea3ca679215db0f))
* **tool:** pdf to word ([84778d7](https://github.com/ChasingHunter/localvert/commit/84778d755efcfd028b5690542f6fd09f4ab980c7))
* **tool:** txt and html to pdf ([a2347cb](https://github.com/ChasingHunter/localvert/commit/a2347cbbff209a05c26d9c2135f7200dde948a2b))
* **tool:** watermark pdf ([65cc2a8](https://github.com/ChasingHunter/localvert/commit/65cc2a8a86f5c6bc77dd27189039f26bbc7d1d29))
* **tool:** wma to mp3 ([e97aad6](https://github.com/ChasingHunter/localvert/commit/e97aad62b4b3399434ce1bef7138546cc37172bb))
* **ui:** readable labels for select options ([1500382](https://github.com/ChasingHunter/localvert/commit/1500382413dec787fabb3b181e2af973bf1b124a))


### Bug Fixes

* **engine:** brand m4a output as M4A and accept isom-branded .m4a files ([bb9b6c4](https://github.com/ChasingHunter/localvert/commit/bb9b6c4d960945b786e1d850c1043575bd768176))
* **tool:** give compress-jpg/webp target-size a real default, not required+showWhen ([95520b5](https://github.com/ChasingHunter/localvert/commit/95520b5743f82560b187d58e95d2a1f5179b00a7))

## [0.2.0](https://github.com/ChasingHunter/localvert/compare/v0.1.0...v0.2.0) (2026-09-27)


### Features

* **editor:** draw, type or upload a signature and place it ([b7659e1](https://github.com/ChasingHunter/localvert/commit/b7659e1978518f6e511cfde0ce6a18dd87df1a2a))
* **editor:** edit existing text in place ([43b97a8](https://github.com/ChasingHunter/localvert/commit/43b97a8e8d44fc8bd7334809373b546b79ca56b0))
* **editor:** fill pdf forms and optionally flatten on export ([1f28480](https://github.com/ChasingHunter/localvert/commit/1f2848032c6ee46217e2569f9a1626c5b9034de3))
* **editor:** mark and permanently redact text and areas ([b264fb0](https://github.com/ChasingHunter/localvert/commit/b264fb0c9df730a229fe9b35751774faab4ca5e2))
* **editor:** multi-page viewer with zoom, thumbnails and plugin-based annotations ([a026a71](https://github.com/ChasingHunter/localvert/commit/a026a71e3667a3bc0b882f126864a93e49db40cf))
* **editor:** page organizer - reorder, rotate, delete, insert blank or pdf ([eefc236](https://github.com/ChasingHunter/localvert/commit/eefc2366d64e2b6f2c88cb69919815ab90149c61))
* **editor:** pdfium engine in our worker behind embedpdf (spike go) ([9577f08](https://github.com/ChasingHunter/localvert/commit/9577f0853fc2ed540c0303d364db57cae6cc9487))
* **editor:** print, pinch zoom and opt-in local draft autosave ([48289ce](https://github.com/ChasingHunter/localvert/commit/48289ce8cf5ea6c52983004582e15df1fb6c140e))
* **editor:** search, copy and keyboard shortcuts ([f1eb899](https://github.com/ChasingHunter/localvert/commit/f1eb89911679a79a627d962b0ba71024dac32c1a))
* **editor:** worker-safe pdfium rendering ([e7b2cad](https://github.com/ChasingHunter/localvert/commit/e7b2cad24274aa850e8ae8448e2f0572a9cae23d))
* **engine:** add ffmpeg engine for legacy video containers ([87b4b69](https://github.com/ChasingHunter/localvert/commit/87b4b6957f427495cb2160a744a83f55796fa387))
* **engine:** add libreoffice office-to-pdf engine ([6a17b1a](https://github.com/ChasingHunter/localvert/commit/6a17b1a9f4dffd22d14515f58b4141b5cfbbd93a))
* **engine:** add tesseract for in-browser OCR ([74ca74c](https://github.com/ChasingHunter/localvert/commit/74ca74c7ea8a6e27fefb265101c02decd0227a8d))
* **engine:** camera raw decode via libraw ([c12fd89](https://github.com/ChasingHunter/localvert/commit/c12fd891f1a21202fa32847a99b5bd5c1d1ccf74))
* **engine:** compress pdfs by re-encoding embedded images ([bda0da5](https://github.com/ChasingHunter/localvert/commit/bda0da56360fc83a29c85db2b1865fb2cd1b2729))
* **engine:** consent flag in the engine manifest ([2631f1c](https://github.com/ChasingHunter/localvert/commit/2631f1ca5994b0550b5211eab9633f688ae5c42c))
* **engine:** data engine for csv, json, yaml and xlsx ([b83c178](https://github.com/ChasingHunter/localvert/commit/b83c178dd3df5d8e6ed68f9a4ce09767d11d804b))
* **engine:** encode to a target file size ([2498d4d](https://github.com/ChasingHunter/localvert/commit/2498d4d896e9ebf851d8c3019afb613afab04d0e))
* **engine:** heic decode via heic-to ([cbe4e39](https://github.com/ChasingHunter/localvert/commit/cbe4e395391ba2f0a0d3b5d4c1c014331a2baf04))
* **engine:** jsquash-avif decode and encode ([4b523e3](https://github.com/ChasingHunter/localvert/commit/4b523e35a7d77aad4b7997c395b00a1dcf7a08af))
* **engine:** jsquash-jpeg (mozjpeg) decode and encode ([1a52a65](https://github.com/ChasingHunter/localvert/commit/1a52a65a3fccaae29db69b714d3b59716e9eb638))
* **engine:** jsquash-jxl decode and encode ([7e000c8](https://github.com/ChasingHunter/localvert/commit/7e000c86fbaab9d58dce5f244facc56025bdfe86))
* **engine:** jsquash-png decode and encode ([589d0bd](https://github.com/ChasingHunter/localvert/commit/589d0bd5fb5624b6c4518acf7b66d99eb2fe35ca))
* **engine:** jsquash-resize high-quality resize ([cb773cd](https://github.com/ChasingHunter/localvert/commit/cb773cdb7387443f6aee5b5f462d335de8db6e44))
* **engine:** jsquash-webp decode and encode ([e1ae094](https://github.com/ChasingHunter/localvert/commit/e1ae09419ee626c366637ac601ebdd91635779fe))
* **engine:** lossless metadata stripping for jpeg, png and webp ([3316b8c](https://github.com/ChasingHunter/localvert/commit/3316b8c74a236f6ddaebbf1d3e89f7a9c9077e33))
* **engine:** mediabunny audio encoding incl. mp3 ([ca04b80](https://github.com/ChasingHunter/localvert/commit/ca04b80d1c2a4d89fd1761d84c3625c770dcde08))
* **engine:** mediabunny video engine ([5d353af](https://github.com/ChasingHunter/localvert/commit/5d353af9a0bd1e29e7dcd821f7fa975c53fa7435))
* **engine:** password protect and unlock pdfs ([f7d4663](https://github.com/ChasingHunter/localvert/commit/f7d4663c8e3a7d1dafe8bd7754ac5426db89bbb8))
* **engine:** pdf structure edits via pdf-lib ([194c177](https://github.com/ChasingHunter/localvert/commit/194c177bfd6f4a0f33573b215d63cc26a8e39dee))
* **engine:** psd decode via @webtoon/psd ([6ac838a](https://github.com/ChasingHunter/localvert/commit/6ac838ae82d7c91dd46a295217a03ef27bf1b7ef))
* **engine:** raster pipeline — multi-step decode, transform, encode in one worker ([b9eed45](https://github.com/ChasingHunter/localvert/commit/b9eed45f212578045b170020181af527270c03c0))
* **engine:** raster to svg tracing ([ed34e57](https://github.com/ChasingHunter/localvert/commit/ed34e57e1ffd53349e06bfac1cada4f3d22029ff))
* **engine:** render pdf pages to images with pdf.js ([bd293c9](https://github.com/ChasingHunter/localvert/commit/bd293c945376c721f8206f75389e3c2dd8f0d9db))
* **engine:** rotate, delete, extract pages and images to pdf ([31f35bc](https://github.com/ChasingHunter/localvert/commit/31f35bca19a0414b5ba19db8ddd605f3350d3b64))
* **engine:** svg rasterisation via resvg ([aa15078](https://github.com/ChasingHunter/localvert/commit/aa15078c7bb6da3f2421db16761b85fcee7cb00f))
* **engine:** tiff decode via utif2 ([101ebed](https://github.com/ChasingHunter/localvert/commit/101ebedeb265fd9e243adc2e8e0677bb3cc0bce9))
* **engine:** typst engine for markdown to pdf ([9d9f5ee](https://github.com/ChasingHunter/localvert/commit/9d9f5eed1397d0fb794dc218ba764b94e9e1c68d))
* **jobs:** many-to-one and one-to-many jobs ([d470b14](https://github.com/ChasingHunter/localvert/commit/d470b147bd34b5396b3f569f20cba3121f25f210))
* **jobs:** stream large outputs through opfs ([f40b537](https://github.com/ChasingHunter/localvert/commit/f40b537701effb3cc8bbba421174f261a989f37b))
* **registry:** accept plain-text formats by extension ([4c3a6bc](https://github.com/ChasingHunter/localvert/commit/4c3a6bcfedd15364a75dc197d535238a7180ed8e))
* **registry:** allow output-only formats with no magic bytes ([13edac5](https://github.com/ChasingHunter/localvert/commit/13edac501802e2fad0a312157ce6e84c7a674333))
* **registry:** app-mode tools and session engines ([f88351f](https://github.com/ChasingHunter/localvert/commit/f88351fd5febac0e5eeeb45b5ec0e7dcb42dfdc7))
* **registry:** camera raw format with extension-assisted detection ([095fa1d](https://github.com/ChasingHunter/localvert/commit/095fa1dc1cd8fea97800426d39d0c02b74d14ff8))
* **registry:** recognize office document formats ([33f7eee](https://github.com/ChasingHunter/localvert/commit/33f7eee4f940840bc29749262f825fd540b2e4bb))
* **registry:** register the jxl format ([b1ff16d](https://github.com/ChasingHunter/localvert/commit/b1ff16da8a6ea6b40fb05d384e3feca66bd617f4))
* **registry:** tools declare file arity ([dec36c3](https://github.com/ChasingHunter/localvert/commit/dec36c34b76c4f8aa957ef055fbf37ba76533503))
* **tool:** accept mkv in video to gif and extract audio ([986d5e2](https://github.com/ChasingHunter/localvert/commit/986d5e2afe1336acf14e3338b45dddf72b1ee629))
* **tool:** add avi, wmv and flv to mp4 ([91d95d3](https://github.com/ChasingHunter/localvert/commit/91d95d3378ab72acc69ef0b78c9ea144d98cf2cf))
* **tool:** audio conversions and extract audio ([df5bc5f](https://github.com/ChasingHunter/localvert/commit/df5bc5f224bc8b69653497a16879e66ef3b8a0fa))
* **tool:** compress pdf ([c8877d4](https://github.com/ChasingHunter/localvert/commit/c8877d47952b27ceefd889e60fa68aad04884906))
* **tool:** compress, resize and rotate images ([6c4376f](https://github.com/ChasingHunter/localvert/commit/6c4376f471f415f0ad750042bbdcd57f1da54393))
* **tool:** crop jpg, png and webp ([10ec4ed](https://github.com/ChasingHunter/localvert/commit/10ec4ed2ef910e54d9031c8120679c10b569a3d1))
* **tool:** csv conversions ([c74e63c](https://github.com/ChasingHunter/localvert/commit/c74e63ca70a0b3e6015f11cf8f79a87656ffc1ec))
* **tool:** data format conversions ([0047a15](https://github.com/ChasingHunter/localvert/commit/0047a15bc7ab63657505d8cd0add879bbe88b33d))
* **tool:** flatten pdf forms ([965ed36](https://github.com/ChasingHunter/localvert/commit/965ed36b881bb000bf3de736cdc74ad1e2b6e00c))
* **tool:** heic, svg, tiff and psd to jpg and png ([1c2b3cf](https://github.com/ChasingHunter/localvert/commit/1c2b3cfd9a5f2edda86336b3b1e159a770a830ed))
* **tool:** image to text and searchable pdf with ocr ([1b7562c](https://github.com/ChasingHunter/localvert/commit/1b7562ca50a4e21a8345ada7c894139525af75ec))
* **tool:** jpg and png to webp, avif, jxl and between each other ([41437e2](https://github.com/ChasingHunter/localvert/commit/41437e290268d59d8028076dd26ea844b777c4ac))
* **tool:** markdown to pdf ([68842a0](https://github.com/ChasingHunter/localvert/commit/68842a0ddb152d6e51da3a0d5c69a665f1679ff8))
* **tool:** merge pdf and split pdf ([ac8db85](https://github.com/ChasingHunter/localvert/commit/ac8db85a2fc603808738147681a2d6875b3d3c38))
* **tool:** mp4 to webm ([bfce566](https://github.com/ChasingHunter/localvert/commit/bfce566022e40a0e05c88bb8b70332c36c202855))
* **tool:** pdf editor with annotations ([7dcf0b3](https://github.com/ChasingHunter/localvert/commit/7dcf0b3fd855fb13ff9399fd37cc13452c98603a))
* **tool:** pdf to jpg and png ([5b94615](https://github.com/ChasingHunter/localvert/commit/5b94615140bba9b744470527103b5c3fde73bc50))
* **tool:** png, jpg and webp to svg ([86ed3a6](https://github.com/ChasingHunter/localvert/commit/86ed3a6010fc9d140da386d7a78c97d21cf4d284))
* **tool:** protect-pdf requires a password before running ([ca7a4a2](https://github.com/ChasingHunter/localvert/commit/ca7a4a2aab50fba1768690fcffac2d865a6e44ab))
* **tool:** raw to jpg and png ([6e1a4c0](https://github.com/ChasingHunter/localvert/commit/6e1a4c0a05d105a0fd212f8d3c2645d9a680e670))
* **tool:** reorder pdf pages ([ad01e50](https://github.com/ChasingHunter/localvert/commit/ad01e50aa23553309378eea10decd9ad28fb2652))
* **tool:** rotate, delete, extract pages, images to pdf, protect and unlock pdf ([50794f5](https://github.com/ChasingHunter/localvert/commit/50794f5bd96b0745a9543d33d04277aad0996665))
* **tools:** add word/excel/powerpoint to PDF ([64a8046](https://github.com/ChasingHunter/localvert/commit/64a80468fcdca3aee09cc48272e012befcccf228))
* **tool:** sanitize pdf — strip metadata, javascript and attachments ([ef0b1d4](https://github.com/ChasingHunter/localvert/commit/ef0b1d4c0be71f459b40e821aa910d0699eec692))
* **tool:** scanned pdf to searchable pdf ([a796469](https://github.com/ChasingHunter/localvert/commit/a796469c47fa9fff01ff0e7703646933c2ae9b53))
* **tool:** strip exif and gps metadata from photos ([44f8702](https://github.com/ChasingHunter/localvert/commit/44f8702e318532396926619ba528125b03a8859d))
* **tool:** trim, mute, resize, compress and rotate video ([c43d28d](https://github.com/ChasingHunter/localvert/commit/c43d28d49cb1642a1fcddae7ebfbe1d3d53404f3))
* **tool:** video container conversions ([9c14f08](https://github.com/ChasingHunter/localvert/commit/9c14f086b5dc277d30092830f85a84951c5e419d))
* **tool:** video to gif with gifenc ([71ac4be](https://github.com/ChasingHunter/localvert/commit/71ac4beee2a53cdb318af117cdbc49026a7a19a5))
* **tool:** webp, avif and jxl to jpg and png ([2deeb28](https://github.com/ChasingHunter/localvert/commit/2deeb28633411a2c3ba417d35a3756353fdc6c80))
* **ui:** ask before downloading a gpl engine ([47f2651](https://github.com/ChasingHunter/localvert/commit/47f2651cc65a1a279f180e3ff43aaf4a5744a5ac))
* **ui:** clearer option controls ([4317925](https://github.com/ChasingHunter/localvert/commit/4317925f289031294c17790c1f25e4080df5dda1))
* **ui:** explicit option step ([61bfccf](https://github.com/ChasingHunter/localvert/commit/61bfccf88835794a401efc87d36e2fb662ac6587))
* **ui:** home and tool page layout for many tools ([0e8b325](https://github.com/ChasingHunter/localvert/commit/0e8b325259374ed955502ec68ed7027d2f59c8e6))
* **ui:** interactive crop editor ([98dbf0d](https://github.com/ChasingHunter/localvert/commit/98dbf0d5472b00318d0df49dd3f7fb4435e11fb6))
* **ui:** show option fields only when relevant ([1de8770](https://github.com/ChasingHunter/localvert/commit/1de877099eff079d35d558902ae6eebbad3555cb))
* **ui:** site header, footer and category pages ([a40071b](https://github.com/ChasingHunter/localvert/commit/a40071bc36e98729bfa02bb1cb305e81efd712fe))


### Bug Fixes

* **editor:** add Close toolbar action to return to the drop zone ([261d88d](https://github.com/ChasingHunter/localvert/commit/261d88d971170b363ffd7ec31b70fbe008f7d480))
* **editor:** close the pre-redaction copy before reopening the redacted pdf ([f2cf459](https://github.com/ChasingHunter/localvert/commit/f2cf459c795562d27611a870b9d9eaa6088daeee))
* **editor:** copyToClipboard emitted text but never wrote it to the clipboard ([d10f2eb](https://github.com/ChasingHunter/localvert/commit/d10f2eb798dcf0fccfd29d5a730709d8fae1c6e4))
* **editor:** flatten forms with pdf-lib so no fields remain ([dac31ab](https://github.com/ChasingHunter/localvert/commit/dac31abf58e6357155bfa5feeb01afd9c5ec1570))
* **editor:** form controls keep their own state while the engine catches up ([3a56b09](https://github.com/ChasingHunter/localvert/commit/3a56b09d332625fdb74d36284a0ab8a6fccf8843))
* **editor:** keep the pdf engine out of every tool page's first load ([6cd68ac](https://github.com/ChasingHunter/localvert/commit/6cd68accfb8064dab6524c67339a06efcadef4d7))
* **editor:** let freshly placed images be dragged ([192b569](https://github.com/ChasingHunter/localvert/commit/192b56917b09196b2bda9f0170370730e841e8a3))
* **editor:** one indexeddb opener creates every store so drafts and signatures both persist ([1ddbf0b](https://github.com/ChasingHunter/localvert/commit/1ddbf0bfb910aef237fb97a2dd7efbce4c006d24))
* **editor:** organizer tile actions fit their tile ([1718699](https://github.com/ChasingHunter/localvert/commit/1718699c4cacd33dea233cddbf7fdbda53c2c0af))
* **editor:** place images and signatures via the stamp tool's image source ([e4e97a2](https://github.com/ChasingHunter/localvert/commit/e4e97a2a4bed5817191b58454eb5f70e534e63b7))
* **editor:** search debounce effect restarted itself before ever finishing ([2d14368](https://github.com/ChasingHunter/localvert/commit/2d14368ad14b7542fb04043b0b0715e627b21561))
* **editor:** stamp reactivation, annotation drag/nudge, per-tool styling ([48d62af](https://github.com/ChasingHunter/localvert/commit/48d62af1c21e8d3cb3fce4f6b47779272ce87737))
* **editor:** substitute fonts only for embedded subsets when editing text ([5c875c0](https://github.com/ChasingHunter/localvert/commit/5c875c0a7debc3b55121a0baea263599a0a050e0))
* **editor:** tool definitions name their app instead of importing its ui ([d563e51](https://github.com/ChasingHunter/localvert/commit/d563e510de58cccfb3d26ed8562ea3d6ef75d359))
* **engine:** close mediabunny OPFS output correctly on success and failure ([fd1f925](https://github.com/ChasingHunter/localvert/commit/fd1f9255472bc0201245abee4941b5c670f24459))
* **engine:** give each ocr page render its own copy of the pdf bytes ([6408fbb](https://github.com/ChasingHunter/localvert/commit/6408fbbf9be1b4b4dda46f2549d22a538d3746ba))
* **engine:** jsquash-jpeg composites transparent pixels over the background colour ([06feed8](https://github.com/ChasingHunter/localvert/commit/06feed88771fdfd816f358e52ed983bab9e7f63b))
* **engine:** load libraw's emscripten glue at runtime instead of bundling it ([f2e5b8c](https://github.com/ChasingHunter/localvert/commit/f2e5b8ce570b01980649680a904bd6bbbfe3087d))
* **engine:** prespawn enough libreoffice pthreads that spreadsheets don't deadlock ([0a1adce](https://github.com/ChasingHunter/localvert/commit/0a1adce65c9772e70c3b4144b81ebea81625d17a))
* **engine:** register the libFLAC wasm encoder for wav-to-flac ([f35041c](https://github.com/ChasingHunter/localvert/commit/f35041cbde2a89f0ac7724a7a68f6d902f8afaf4))
* **engine:** replace libreoffice's embind code generation so it runs under our csp ([6d906ae](https://github.com/ChasingHunter/localvert/commit/6d906ae3819dcfef4a8a7bc056529c5d4bb4b3c8))
* **engine:** replace typst's Function-constructor stubs so it runs under our csp ([f8695c2](https://github.com/ChasingHunter/localvert/commit/f8695c20abb5b568a91eec9b652b5d6071d88182))
* **gen:** quote hyphenated engine ids as object keys ([cf5e691](https://github.com/ChasingHunter/localvert/commit/cf5e691287b2566c5e4a8bd9d8e32bef59544b50))
* **infra:** only pass a range to r2 when the client sent a Range header ([585e23b](https://github.com/ChasingHunter/localvert/commit/585e23b97d016d09603e9c5f0694e4216c39147a))
* **infra:** send COEP + CSP on R2 engine responses; surface real worker errors ([b7abb48](https://github.com/ChasingHunter/localvert/commit/b7abb487c3c42807bd0240fca410199eaffe7945))
* **jobs:** fail fast with a clear message when an engine can't load offline ([e06e064](https://github.com/ChasingHunter/localvert/commit/e06e064b3cd3e369b724264955a17f068924f0b1))
* resolve typecheck and lint fallout from merging the phase 1 branches ([a73a00a](https://github.com/ChasingHunter/localvert/commit/a73a00a80c8661f31895f9987d7b3bfa69910b8e))
* **security:** meta csp must not narrow worker-src below the header policy ([5907a18](https://github.com/ChasingHunter/localvert/commit/5907a18542f8d71c5dc9ebd0a5cdb336cf666871))
* **test:** guard seed-r2-local's main() to the CLI entry point only ([e159e32](https://github.com/ChasingHunter/localvert/commit/e159e321cbf46f85954dae7ba02bb21d458793b0))
* **test:** import upload-r2 with its .ts extension so node can run the seed script ([6b97441](https://github.com/ChasingHunter/localvert/commit/6b9744190dcd0e3f8ee5f66a8c9bbf72e18b7add))
* **test:** ops-tools defaults tests expect absent optional keys, not undefined ([e39e5ff](https://github.com/ChasingHunter/localvert/commit/e39e5ff5f33e7461d5f297dcc205ce34ee81963b))
* **test:** run browser test files sequentially and isolated ([93ab769](https://github.com/ChasingHunter/localvert/commit/93ab769bab8c5e8efba0e468edf02d4e72a844e7))
* **test:** scope jpg-to-png rejection e2e check to the job list heading ([f0aef6f](https://github.com/ChasingHunter/localvert/commit/f0aef6ffd3bd7e7f27fce98ab8e4bd26d3ad6a9d))
* **test:** seed-r2-local fails loudly when an r2 engine has nothing staged ([7cdfe1b](https://github.com/ChasingHunter/localvert/commit/7cdfe1b19e789805054220e7c5baca6ae7637b33))
* **test:** sync engine assets before browser tests ([8464eee](https://github.com/ChasingHunter/localvert/commit/8464eee3cc0a23b5295c00dd4bd4428314c0e576))
* **test:** treat measureUserAgentSpecificMemory as optional ([a60503b](https://github.com/ChasingHunter/localvert/commit/a60503b95c139903a544aa47514b2912045d260b))
* **tool:** default jpgOptions quality/background at the schema level ([e969f80](https://github.com/ChasingHunter/localvert/commit/e969f8057ce881fd41d649785e1f9e0c18df8715))
* **tool:** mute-video's hidden option needs a label or the options form throws ([6eee87f](https://github.com/ChasingHunter/localvert/commit/6eee87f616468352e2b9df29fb30c9153582729b))
* **tool:** raw-to-png's option meta must precede its default so the form can read it ([c43a3ea](https://github.com/ChasingHunter/localvert/commit/c43a3eaf00bc7bb96d3c012fc22ae40bdc940554))
* **tool:** require a value for delete-pdf-pages' Pages field ([2edd199](https://github.com/ChasingHunter/localvert/commit/2edd199388ae7b5fceff2fca4da75361645ddce1))
* **worker:** map a run-step network failure to the offline message ([57479b6](https://github.com/ChasingHunter/localvert/commit/57479b6b9323e0b40a1c95517f7766363f4bc78a))


### Refactoring

* **build:** derive engine versions and asset sizes from installed packages ([d2c2d74](https://github.com/ChasingHunter/localvert/commit/d2c2d74513d7141fcff8f8aae64b5fafa849eb96))
* **engine:** audio conversions use the shared mediabunny output ([317e713](https://github.com/ChasingHunter/localvert/commit/317e713ec4996350b1d851a98bcdf40d205d1dbc))
* **engine:** shared mediabunny conversion output ([d8e206e](https://github.com/ChasingHunter/localvert/commit/d8e206e4c7869ebe81687ae33310063df7b28047))
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
