/**
 * Reads just enough of a JPEG's header to decide whether it can go into a
 * `.docx` untouched: the pixel size and the number of colour components from
 * the first start-of-frame marker. Word shows 1-component (grey) and
 * 3-component (YCbCr/RGB) JPEGs; a 4-component (CMYK/YCCK) JPEG, which PDFs
 * use for print images, comes out with inverted or wrong colours, so those
 * get re-rendered to PNG instead. Pure; no decoding.
 */
export interface JpegInfo {
  width: number;
  height: number;
  components: number;
}

export function readJpegInfo(bytes: Uint8Array): JpegInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    let marker = bytes[i + 1] ?? 0;
    // Fill bytes: any run of 0xFF before the marker code.
    while (marker === 0xff && i + 2 < bytes.length) {
      i++;
      marker = bytes[i + 1] ?? 0;
    }
    i += 2;
    // Markers with no length: SOI, EOI, RSTn, TEM.
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd9)
    ) {
      if (marker === 0xd9) return null;
      continue;
    }
    if (i + 2 > bytes.length) return null;
    const length = ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0);
    if (length < 2) return null;
    // SOF0-SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      if (i + 8 > bytes.length) return null;
      const height = ((bytes[i + 3] ?? 0) << 8) | (bytes[i + 4] ?? 0);
      const width = ((bytes[i + 5] ?? 0) << 8) | (bytes[i + 6] ?? 0);
      const components = bytes[i + 7] ?? 0;
      if (width === 0 || height === 0) return null;
      return { width, height, components };
    }
    i += length;
  }
  return null;
}
