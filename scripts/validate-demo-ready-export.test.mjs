import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateProbeContract } from "./validate-demo-ready-export.mjs";

const validProbe = {
  streams: [
    {
      codec_type: "video",
      codec_name: "h264",
      pix_fmt: "yuv420p",
      width: 1280,
      height: 720,
      r_frame_rate: "30/1",
      avg_frame_rate: "30/1",
    },
  ],
  format: {
    format_name: "mov,mp4,m4a,3gp,3g2,mj2",
  },
};

describe("demo-ready ffprobe contract validation", () => {
  it("accepts the documented mp4-demo media contract", () => {
    assert.deepEqual(validateProbeContract(validProbe), []);
  });

  it("rejects valid media that does not match the documented mp4-demo contract", () => {
    const errors = validateProbeContract({
      streams: [
        {
          codec_type: "video",
          codec_name: "hevc",
          pix_fmt: "yuv444p",
          width: 1920,
          height: 1080,
          r_frame_rate: "60/1",
          avg_frame_rate: "60/1",
        },
      ],
      format: {
        format_name: "matroska,webm",
      },
    });

    assert.deepEqual(errors, [
      "Expected MP4-compatible container.",
      "Expected H.264 video stream.",
      "Expected yuv420p pixel format.",
      "Expected 1280x720 dimensions.",
      "Expected 30 fps frame rate.",
    ]);
  });
});
