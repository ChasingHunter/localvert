import { describe, expect, it } from "vitest";
import {
  formatMB,
  PDF_COMPRESS_LADDER,
  pdfTargetNote,
  runCompressLadder,
} from "./pdf-compress-target";

describe("runCompressLadder", () => {
  it("stops at the first step that fits the target", async () => {
    const sizes = [500_000, 300_000, 150_000, 90_000, 60_000, 40_000];
    let calls = 0;
    const result = await runCompressLadder(
      PDF_COMPRESS_LADDER,
      200_000,
      async (_step) => {
        const size = sizes[calls] as number;
        calls++;
        return size;
      },
    );
    expect(result.hit).toBe(true);
    expect(result.totalBytes).toBe(150_000);
    expect(calls).toBe(3); // stopped at the third step, never tried the rest
  });

  it("hits on the very first step when it already fits", async () => {
    const result = await runCompressLadder(
      PDF_COMPRESS_LADDER,
      1_000_000,
      async () => 400_000,
    );
    expect(result.hit).toBe(true);
    expect(result.step).toBe(PDF_COMPRESS_LADDER[0]);
  });

  it("returns the smallest result when nothing fits, having tried every step", async () => {
    const sizes = [900_000, 800_000, 700_000, 750_000, 600_000, 650_000];
    let calls = 0;
    const result = await runCompressLadder(
      PDF_COMPRESS_LADDER,
      100_000,
      async () => {
        const size = sizes[calls] as number;
        calls++;
        return size;
      },
    );
    expect(calls).toBe(PDF_COMPRESS_LADDER.length);
    expect(result.hit).toBe(false);
    expect(result.totalBytes).toBe(600_000); // the smallest of the six, not the last tried
  });
});

describe("formatMB", () => {
  it("shows one decimal, dropping a trailing .0", () => {
    expect(formatMB(3.14 * 1024 * 1024)).toBe("3.1 MB");
    expect(formatMB(19.4 * 1024 * 1024)).toBe("19.4 MB");
    expect(formatMB(20 * 1024 * 1024)).toBe("20 MB");
    expect(formatMB(112 * 1024 * 1024)).toBe("112 MB");
  });
});

describe("pdfTargetNote", () => {
  it("explains when the non-image bytes alone exceed the target", () => {
    const note = pdfTargetNote({
      targetBytes: 2 * 1024 * 1024,
      nonImageBytes: 3.1 * 1024 * 1024,
    });
    expect(note).toBe(
      "The text and fonts alone are 3.1 MB, so 2 MB isn't possible.",
    );
  });

  it("reports a hit with the percentage of target reached", () => {
    const note = pdfTargetNote({
      targetBytes: 20 * 1024 * 1024,
      nonImageBytes: 1 * 1024 * 1024,
      result: {
        step: PDF_COMPRESS_LADDER[0] as (typeof PDF_COMPRESS_LADDER)[number],
        totalBytes: 19.4 * 1024 * 1024,
        hit: true,
      },
    });
    expect(note).toBe("19.4 MB, 97% of your 20 MB target.");
  });

  it("reports the smallest reachable size when the whole ladder overshoots", () => {
    const note = pdfTargetNote({
      targetBytes: 5 * 1024 * 1024,
      nonImageBytes: 1 * 1024 * 1024,
      result: {
        step: PDF_COMPRESS_LADDER[5] as (typeof PDF_COMPRESS_LADDER)[number],
        totalBytes: 23 * 1024 * 1024,
        hit: false,
      },
    });
    expect(note).toBe("The smallest we could make it is about 23 MB.");
  });
});
