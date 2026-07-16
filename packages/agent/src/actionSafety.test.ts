import { describe, expect, it } from "vitest";
import {
  hasCredentialLikeUrlData,
  hasDestructiveActionLanguage,
  isSecretLikeValue,
  normalizeHttpOrigin,
} from "./actionSafety.js";

describe("action safety", () => {
  it.each(["Delete account", "Publish changes", "Submit order", "Invite teammate"])(
    "classifies destructive language: %s",
    (value) => expect(hasDestructiveActionLanguage(value)).toBe(true),
  );

  it("rejects credential-bearing and non-HTTP origins", () => {
    expect(hasCredentialLikeUrlData("https://example.test/?api_key=secret-value-123456789")).toBe(
      true,
    );
    expect(normalizeHttpOrigin("javascript:alert(1)")).toBeUndefined();
    expect(normalizeHttpOrigin("https://user:pass@example.test/path")).toBeUndefined();
    expect(normalizeHttpOrigin("https://example.test/path")).toBe("https://example.test");
  });

  it("fails closed for malformed URLs and fragments", () => {
    expect(hasCredentialLikeUrlData("not a URL")).toBe(true);
    expect(hasCredentialLikeUrlData("https://example.test/#%E0%A4%A")).toBe(true);
  });

  it("recognizes secret-like runtime values without classifying demo data", () => {
    expect(isSecretLikeValue("sk-example123456789")).toBe(true);
    expect(isSecretLikeValue("aaaaaaaa.bbbb.cccc")).toBe(true);
    expect(isSecretLikeValue("Demo Person")).toBe(false);
  });
});
