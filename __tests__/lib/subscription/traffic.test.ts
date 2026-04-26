import { describe, it, expect } from "vitest";
import { formatSubscriptionUserinfo, formatShadowrocketStatusLine } from "@/lib/subscription/traffic";

describe("formatSubscriptionUserinfo", () => {
  it("emits upload/download in bytes with total=0 expire=0 (= unlimited)", () => {
    const s = formatSubscriptionUserinfo({ upload: 12345, download: 67890 });
    expect(s).toBe("upload=12345; download=67890; total=0; expire=0");
  });

  it("handles zero traffic gracefully", () => {
    expect(formatSubscriptionUserinfo({ upload: 0, download: 0 })).toBe(
      "upload=0; download=0; total=0; expire=0"
    );
  });
});

describe("formatShadowrocketStatusLine", () => {
  it("formats GB with 2-decimal precision and uses ∞ for the no-quota fields", () => {
    const oneGiB = 1024 * 1024 * 1024;
    const s = formatShadowrocketStatusLine({ upload: oneGiB, download: 2 * oneGiB });
    expect(s).toBe("STATUS=↑:1.00GB,↓:2.00GB,✓:∞,〇:∞,⊖:∞");
  });

  it("renders zero traffic", () => {
    expect(formatShadowrocketStatusLine({ upload: 0, download: 0 })).toBe(
      "STATUS=↑:0.00GB,↓:0.00GB,✓:∞,〇:∞,⊖:∞"
    );
  });
});
