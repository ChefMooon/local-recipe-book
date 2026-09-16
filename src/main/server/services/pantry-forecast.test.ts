import { describe, expect, it } from "vitest";
import { calculatePantryForecast } from "./pantry-forecast";

const now = new Date("2026-01-01T00:00:00.000Z");

describe("calculatePantryForecast", () => {
  it("sums compatible location quantities and returns an exact estimate", () => {
    const result = calculatePantryForecast({
      dailyUsageQuantity: 0.5,
      dailyUsageUnit: "l",
      dailyUsageWarningDays: 2,
      locations: [
        { quantity: 500, unit: "ml", approximate: false, expired: false },
        { quantity: 0.5, unit: "l", approximate: false, expired: false },
      ],
      now,
    });

    expect(result).toMatchObject({
      state: "available",
      severity: "warning",
      attention: true,
      remainingQuantity: 1.0,
      remainingUnit: "l",
      remainingDays: 2,
      projectedRunOutAt: "2026-01-03T00:00:00.000Z",
    });
  });

  it("marks zero stock as critical and immediately actionable", () => {
    const result = calculatePantryForecast({
      dailyUsageQuantity: 1,
      dailyUsageUnit: "count",
      dailyUsageWarningDays: 7,
      locations: [{ quantity: 0, unit: "count", approximate: false, expired: false }],
      now,
    });

    expect(result).toMatchObject({ state: "available", severity: "critical", attention: true, remainingDays: 0 });
  });

  it("marks forecasts at or below the warning lead time as actionable", () => {
    const aboveWarning = calculatePantryForecast({
      dailyUsageQuantity: 1,
      dailyUsageUnit: "count",
      dailyUsageWarningDays: 2,
      locations: [{ quantity: 3, unit: "count", approximate: false, expired: false }],
      now,
    });
    const atWarning = calculatePantryForecast({
      dailyUsageQuantity: 1,
      dailyUsageUnit: "count",
      dailyUsageWarningDays: 2,
      locations: [{ quantity: 2, unit: "count", approximate: false, expired: false }],
      now,
    });

    expect(aboveWarning).toMatchObject({ remainingDays: 3, severity: "info", attention: false });
    expect(atWarning).toMatchObject({ remainingDays: 2, severity: "warning", attention: true });
  });

  it("does not estimate stock that is already expired", () => {
    const result = calculatePantryForecast({
      dailyUsageQuantity: 1,
      dailyUsageUnit: "kg",
      dailyUsageWarningDays: 7,
      locations: [{ quantity: 5, unit: "kg", approximate: false, expired: true }],
      now,
    });

    expect(result).toMatchObject({ state: "unavailable", reason: "expired-stock", attention: true, remainingDays: null });
  });

  it("returns typed unavailable states without inventing a numeric estimate", () => {
    const base = { dailyUsageQuantity: 1, dailyUsageUnit: "kg", dailyUsageWarningDays: 7, now };
    expect(calculatePantryForecast({ ...base, locations: [] })).toMatchObject({ state: "unavailable", reason: "missing-stock", remainingDays: null });
    expect(calculatePantryForecast({ ...base, locations: [{ quantity: 1, unit: "kg", approximate: true, expired: false }] })).toMatchObject({ state: "unavailable", reason: "approximate-stock" });
    expect(calculatePantryForecast({ ...base, locations: [{ quantity: 1, unit: "count", approximate: false, expired: false }] })).toMatchObject({ state: "unavailable", reason: "incompatible-unit" });
  });

  it("disables forecasting when daily usage is unset", () => {
    expect(calculatePantryForecast({
      dailyUsageQuantity: null,
      dailyUsageUnit: null,
      dailyUsageWarningDays: null,
      locations: [{ quantity: 1, unit: "kg", approximate: false, expired: false }],
      now,
    })).toMatchObject({ state: "disabled", reason: "missing-daily-usage", attention: false });
  });
});