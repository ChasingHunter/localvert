import { describe, expect, it } from "vitest";
import { enginesNeedingConsent } from "@/lib/engines/consent";
import ffmpeg from "@/lib/engines/ffmpeg/adapter";
import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import aviToMp3 from "./avi-to-mp3";
import flvToMp3 from "./flv-to-mp3";
import wmvToMp3 from "./wmv-to-mp3";

describe.each([
  ["avi", aviToMp3],
  ["wmv", wmvToMp3],
  ["flv", flvToMp3],
] as const)("%s-to-mp3", (format, tool) => {
  it("is one ffmpeg transcode step that the ffmpeg adapter supports", () => {
    expect(tool.pipeline).toHaveLength(1);
    expect(tool.pipeline[0]?.op).toBe("transcode");
    expect(tool.pipeline[0]?.candidates.map((c) => c.engine)).toEqual([
      "ffmpeg",
    ]);
    expect(ffmpeg.supports("transcode", format, "mp3")).toBe(true);
  });

  it("asks for the ffmpeg download consent", () => {
    expect(enginesNeedingConsent(tool, ENGINE_MANIFEST)).toEqual(["ffmpeg"]);
  });
});
