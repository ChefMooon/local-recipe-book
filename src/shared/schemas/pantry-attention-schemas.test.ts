import { describe, expect, it } from "vitest";
import {
  PantryAttentionMutationSchema,
  PantryGroceryLinkLifecycleSchema,
} from "./pantry-attention-schemas";

describe("Pantry attention shared schemas", () => {
  it("requires a seven-day-style expiry for snooze and no expiry for restock mute", () => {
    expect(PantryAttentionMutationSchema.safeParse({
      source: "snooze",
      operationIdentity: "operation-1",
    }).success).toBe(false);
    expect(PantryAttentionMutationSchema.safeParse({
      source: "until-restocked",
      expiresAt: "2026-09-22T00:00:00.000Z",
      operationIdentity: "operation-2",
    }).success).toBe(false);
  });

  it("requires an exact link identity for linked attention and lifecycle updates", () => {
    expect(PantryAttentionMutationSchema.safeParse({
      source: "grocery-link",
      operationIdentity: "operation-3",
    }).success).toBe(false);
    expect(PantryGroceryLinkLifecycleSchema.parse({
      linkId: "link-1",
      status: "checked",
      operationIdentity: "operation-4",
      reviewIdentity: "review-4",
    })).toMatchObject({ linkId: "link-1", status: "checked" });
  });
});