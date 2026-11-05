import { describe, expect, it } from "vitest";
import { providerName } from "../lib/providers";

describe("provider display names", () => {
  it("names every built-in provider", () => {
    expect(providerName("real-debrid")).toBe("Real-Debrid");
    expect(providerName("torbox")).toBe("TorBox");
    expect(providerName("premiumize")).toBe("Premiumize");
    expect(providerName("alldebrid")).toBe("AllDebrid");
  });

  it("falls back to the id for unknown providers", () => {
    expect(providerName("mystery")).toBe("mystery");
  });
});
