import type { PantryAttentionPayload, PantryAttentionSource } from "@shared/schemas/pantry-attention-schemas";
import type { PantryItemPayload } from "@shared/types";

export type PantryAttentionView = {
  id: string | null;
  source: PantryAttentionSource | null;
  expiresAt: string | null;
  suppressed: boolean;
  visible: boolean;
  stock: boolean;
  forecast: boolean;
  safety: boolean;
};

type AttentionInput = {
  status: PantryItemPayload["status"];
  forecast: Pick<PantryItemPayload["forecast"], "state" | "attention">;
  persisted: PantryAttentionPayload | null;
  linkedActive: boolean;
  now?: Date;
};

export function derivePantryAttention({ status, forecast, persisted, linkedActive, now = new Date() }: AttentionInput): PantryAttentionView {
  const stock = status === "low" || status === "empty";
  const forecastAttention = forecast.attention;
  const numericForecast = forecast.state === "available" && forecastAttention;
  const safety = status === "expiring-soon" || status === "expired" || (forecast.state === "unavailable" && forecastAttention);
  const snoozeActive = persisted?.active === true && persisted.source === "snooze" && persisted.expiresAt != null && new Date(persisted.expiresAt).getTime() > now.getTime();
  const untilRestockedActive = persisted?.active === true && persisted.source === "until-restocked";
  const groceryLinkActive = persisted?.active === true && persisted.source === "grocery-link" && linkedActive;
  const suppressed = Boolean(snoozeActive || untilRestockedActive || groceryLinkActive) && (stock || numericForecast);

  return {
    id: persisted?.id ?? null,
    source: suppressed ? persisted?.source ?? null : null,
    expiresAt: snoozeActive ? persisted?.expiresAt ?? null : null,
    suppressed,
    visible: safety || ((stock || numericForecast) && !suppressed),
    stock,
    forecast: forecastAttention,
    safety,
  };
}
