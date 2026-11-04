// @vitest-environment node
import { describe, expect, it } from "vitest";
import { canonicalMessage, signMessage, verifyMessage } from "@/convex/lib/hmac";

describe("automation message signing", () => {
  it("binds timestamp, method, path and exact body", async () => {
    const message = canonicalMessage("123", "post", "/api/n8n/reminders", '{"ok":true}');
    const signature = await signMessage("a-long-test-secret", message);
    expect(signature).toMatch(/^[a-f0-9]{64}$/);
    await expect(verifyMessage("a-long-test-secret", message, signature)).resolves.toBe(true);
    await expect(verifyMessage("a-long-test-secret", `${message}x`, signature)).resolves.toBe(false);
  });

  it("rejects malformed signatures without throwing", async () => {
    await expect(verifyMessage("secret", "message", "not-hex")).resolves.toBe(false);
  });
});
