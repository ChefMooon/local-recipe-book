import { describe, expect, it } from "vitest";
import { derivePantryAttention } from "./pantry-attention-policy";

const baseInput = {
  status: "low" as const,
  forecast: {
    state: "available" as const,
    attention: false,
  },
};

function persisted(source: "snooze" | "until-restocked" | "grocery-link", expiresAt: string | null = null) {
  return {
    id: "attention-1",
    pantryItemId: "pantry-1",
    source,
    expiresAt,
    groceryLinkId: source === "grocery-link" ? "link-1" : null,
    operationIdentity: "operation-1",
    reviewIdentity: null,
    active: true,
    closedAt: null,
    closeReason: null,
    createdAt: "2026-09-15T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z",
  };
}

describe("derivePantryAttention", () => {
  it("hides stock attention during an active seven-day snooze without changing raw status", () => {
    const result = derivePantryAttention({
      ...baseInput,
      persisted: persisted("snooze", "2026-09-22T00:00:00.000Z"),
      linkedActive: false,
      now: new Date("2026-09-16T00:00:00.000Z"),
    });

    expect(result).toMatchObject({ source: "snooze", suppressed: true, visible: false, stock: true });
  });

  it("restores attention after snooze expiry", () => {
    const result = derivePantryAttention({
      ...baseInput,
      persisted: persisted("snooze", "2026-09-16T00:00:00.000Z"),
      linkedActive: false,
      now: new Date("2026-09-17T00:00:00.000Z"),
    });

    expect(result).toMatchObject({ source: null, suppressed: false, visible: true });
  });

  it("keeps expiring and unavailable forecast safety attention visible", () => {
    const expiring = derivePantryAttention({
      status: "expiring-soon",
      forecast: { state: "available", attention: false },
      persisted: persisted("until-restocked"),
      linkedActive: false,
    });
    const unavailable = derivePantryAttention({
      status: "ok",
      forecast: { state: "unavailable", attention: true },
      persisted: persisted("snooze", "2099-01-01T00:00:00.000Z"),
      linkedActive: false,
    });

    expect(expiring).toMatchObject({ safety: true, visible: true, suppressed: false });
    expect(unavailable).toMatchObject({ safety: true, visible: true });
  });

  it("applies an active until-restocked mute to low and numeric forecast attention", () => {
    const result = derivePantryAttention({
      status: "ok",
      forecast: { state: "available", attention: true },
      persisted: persisted("until-restocked"),
      linkedActive: false,
    });

    expect(result).toMatchObject({ suppressed: true, visible: false, forecast: true });
  });
});
