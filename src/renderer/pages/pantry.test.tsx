// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AddDatedLotModal, AddStockModal, PantryEditor, PantryManagementModal, UseStockModal } from "./pantry";

const item = {
  id: "pantry-1",
  name: "Olive oil",
  normalizedName: "olive oil",
  category: "Cooking",
  stockMode: "replenish-to-target" as const,
  warningThreshold: 1,
  warningUnit: "bottle",
  expirationWarningDays: 30,
  replenishmentTarget: 2,
  replenishmentUnit: "bottle",
  replenishmentQuantity: 1,
  notes: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  aliases: [{ id: "alias-1", label: "cooking oil", normalizedAlias: "cooking oil" }],
  locations: [{ id: "location-1", location: "Cupboard", normalizedLocation: "cupboard", quantity: 1, unit: "bottle", approximate: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", lots: [] }],
  packages: [{ id: "package-1", label: "one bottle", quantity: 1, unit: "bottle", dimension: "custom" as const, confirmed: false, enabled: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
  warningRules: [],
  status: "low" as const,
  usableQuantity: 1,
  dailyUsageQuantity: null,
  dailyUsageUnit: null,
  dailyUsageWarningDays: null,
  forecast: {
    state: "disabled" as const,
    reason: "missing-daily-usage" as const,
    severity: "info" as const,
    attention: false,
    remainingQuantity: null,
    remainingUnit: null,
    remainingDays: null,
    projectedRunOutAt: null,
    estimate: { isEstimate: true as const, source: "location-quantity" as const, evaluatedAt: "2026-01-01T00:00:00.000Z" },
  },
  attention: {
    id: null,
    source: null,
    expiresAt: null,
    suppressed: false,
    visible: true,
    stock: true,
    forecast: false,
    safety: false,
  },
};

describe("PantryManagementModal", () => {
  it("adds dated lots while creating a Pantry item", async () => {
    const onSave = vi.fn().mockResolvedValue(item);
    const onCreateLots = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<PantryManagementModal onClose={onClose} onSave={onSave} onCreateLots={onCreateLots} />);
    const dialog = screen.getAllByRole("dialog").at(-1)!;

    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Olive oil" } });
    fireEvent.change(within(dialog).getByLabelText("Location"), { target: { value: "Cupboard" } });
    fireEvent.change(within(dialog).getByLabelText("General unit"), { target: { value: "bottle" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add dated lot" }));
    fireEvent.change(within(dialog).getByLabelText("Lot 1 quantity"), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText("Lot 1 expires on"), { target: { value: "2026-10-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add item" }));

    await waitFor(() => expect(onCreateLots).toHaveBeenCalledWith("pantry-1", [expect.objectContaining({ location: "Cupboard", quantity: 2, unit: "bottle", expiresAt: "2026-10-01T23:59:59.000Z" })]));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("autofocuses the name and preserves editable inventory settings", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PantryManagementModal item={item} onClose={vi.fn()} onSave={onSave} />);

    expect(within(screen.getAllByRole("dialog").at(-1)!).getByRole("textbox", { name: "Name" })).toHaveFocus();
    expect(screen.getByDisplayValue("cooking oil")).toBeTruthy();
    expect(screen.getByDisplayValue("one bottle")).toBeTruthy();
    expect(within(screen.getAllByRole("dialog").at(-1)!).getAllByLabelText("Daily usage unit").at(-1)).toHaveValue("bottle");

    fireEvent.change(screen.getByDisplayValue("cooking oil"), {
      target: { value: "cooking oil, frying oil" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({
      aliases: [{ label: "cooking oil" }, { label: "frying oil" }],
      warningThreshold: 1,
      replenishmentTarget: 2,
      packages: [{ label: "one bottle", quantity: 1 }],
      locations: [{ location: "Cupboard", quantity: 1, unit: "bottle", approximate: false }],
    });
  });

  it("adds multiple dated lots after saving the item changes", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onAddLots = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<PantryManagementModal item={item} onClose={onClose} onSave={onSave} onAddLots={onAddLots} />);
    const dialog = screen.getAllByRole("dialog").at(-1)!;

    fireEvent.click(within(dialog).getByRole("button", { name: "Add dated lot" }));
    fireEvent.change(within(dialog).getByLabelText("Lot 1 quantity"), { target: { value: "2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add another lot" }));
    fireEvent.change(within(dialog).getByLabelText("Lot 2 quantity"), { target: { value: "3" } });
    fireEvent.change(within(dialog).getByLabelText("Lot 2 expires on"), { target: { value: "2026-10-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onAddLots).toHaveBeenCalledWith([
      expect.objectContaining({ location: "Cupboard", quantity: 2, unit: "bottle", expiresAt: null }),
      expect.objectContaining({ location: "Cupboard", quantity: 3, unit: "bottle", expiresAt: "2026-10-01T23:59:59.000Z" }),
    ]));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("inherits the General unit for new dated lots and supports resetting overrides", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PantryManagementModal onClose={vi.fn()} onSave={onSave} onCreateLots={vi.fn()} />);
    const dialog = screen.getAllByRole("dialog").at(-1)!;

    fireEvent.change(within(dialog).getByLabelText("General unit"), { target: { value: "bottle" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add dated lot" }));
    expect(within(dialog).getByLabelText("Lot 1 unit")).toHaveValue("bottle");

    fireEvent.change(within(dialog).getByLabelText("Lot 1 unit"), { target: { value: "case" } });
    expect(within(dialog).getByRole("button", { name: "Reset lot 1 unit to general unit" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset lot 1 unit to general unit" }));
    expect(within(dialog).getByLabelText("Lot 1 unit")).toHaveValue("bottle");
  });

  it("edits daily usage settings with accessible validation feedback", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PantryManagementModal item={item} onClose={vi.fn()} onSave={onSave} />);
    const dialog = screen.getAllByRole("dialog").at(-1)!;

    fireEvent.change(within(dialog).getByLabelText("Daily usage quantity"), { target: { value: "0" } });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Daily usage must be greater than zero.");
    expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("Daily usage quantity"), { target: { value: "0.5" } });
    fireEvent.change(within(dialog).getByLabelText("Forecast warning lead time in days"), { target: { value: "0" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ dailyUsageQuantity: 0.5, dailyUsageUnit: "bottle", dailyUsageWarningDays: 0 });
  });

  it("follows the general unit when related units are still inherited", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PantryManagementModal onClose={vi.fn()} onSave={onSave} />);
    const dialog = screen.getAllByRole("dialog").at(-1)!;
    const generalUnit = within(dialog).getByLabelText("General unit");

    fireEvent.change(generalUnit, { target: { value: "kg" } });

    expect(within(dialog).getByLabelText("Daily usage unit")).toHaveValue("kg");
  });

  it("shows reset buttons only for units that differ from the general unit", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PantryManagementModal item={item} onClose={vi.fn()} onSave={onSave} />);
    const dialog = screen.getAllByRole("dialog").at(-1)!;

    expect(within(dialog).queryByRole("button", { name: "Reset usage unit to general unit" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Reset package unit to general unit" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Reset lot unit to general unit" })).toBeNull();

    fireEvent.change(within(dialog).getByLabelText("Daily usage unit"), { target: { value: "tbsp" } });
    fireEvent.change(within(dialog).getByLabelText("Package unit"), { target: { value: "case" } });
    expect(within(dialog).getByRole("button", { name: "Reset usage unit to general unit" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Reset package unit to general unit" })).toBeTruthy();
  });

  it("submits a dated lot without submitting an item edit", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<AddDatedLotModal item={item} onClose={onClose} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText("New lot quantity"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("New lot best before"), { target: { value: "2026-09-20" } });
    fireEvent.change(screen.getByLabelText("New lot expires on"), { target: { value: "2026-09-25" } });
    fireEvent.click(screen.getByRole("button", { name: "Add dated lot" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      location: "Cupboard",
      quantity: 2,
      unit: "bottle",
      bestBeforeAt: "2026-09-20T23:59:59.000Z",
      expiresAt: "2026-09-25T23:59:59.000Z",
    })));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders dated lots in the item details", () => {
    const itemWithLot = {
      ...item,
      locations: [{
        ...item.locations[0],
        lots: [{ id: "lot-1", quantity: 2, unit: "bottle", approximate: true, bestBeforeAt: "2026-09-20T23:59:59.000Z", expiresAt: "2026-09-25T23:59:59.000Z", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
      }],
    };
    render(<PantryEditor item={itemWithLot} onStock={vi.fn()} onAddLot={vi.fn()} onRemoveLot={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onAttention={vi.fn()} onClearAttention={vi.fn()} />);

    expect(screen.getAllByText("Dated lots").length).toBeGreaterThan(0);
    expect(screen.getByText("Best before Sep 20 · Expires Sep 25 · Approximate")).toBeTruthy();
    expect(screen.getAllByText("2 bottle").length).toBeGreaterThan(0);
  });

  it("keeps Use stock enabled when only a dated lot has quantity", () => {
    const itemWithLot = {
      ...item,
      usableQuantity: 0,
      locations: [{ ...item.locations[0], quantity: 0, lots: [{ id: "lot-1", quantity: 2, unit: "bottle", approximate: false, bestBeforeAt: null, expiresAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }] }],
    };
    render(<PantryEditor item={itemWithLot} onStock={vi.fn()} onAddLot={vi.fn()} onRemoveLot={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onAttention={vi.fn()} onClearAttention={vi.fn()} />);

    expect(within(screen.getAllByRole("region", { name: "Olive oil details" }).at(-1)! ).getByRole("button", { name: /Use stock/ })).not.toBeDisabled();
  });

  it("does not show forecast information when daily usage is unset", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PantryManagementModal item={item} onClose={vi.fn()} onSave={onSave} />);

    expect(screen.queryByText("Daily usage is not configured.")).toBeNull();
  });

  it("offers dismiss and restore controls without replacing raw low status", () => {
    const onAttention = vi.fn();
    const onClearAttention = vi.fn();
    const mutedItem = { ...item, attention: { ...item.attention, id: "attention-1", source: "until-restocked" as const, suppressed: true, visible: false } };
    const { rerender } = render(<PantryEditor item={item} onStock={vi.fn()} onAddLot={vi.fn()} onRemoveLot={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onAttention={onAttention} onClearAttention={onClearAttention} />);
    const region = () => within(screen.getAllByRole("region", { name: "Olive oil details" }).at(-1)!);

    expect(region().getByText("Raw status: Low stock")).toBeTruthy();
    fireEvent.click(region().getByRole("button", { name: /Snooze 7 days/ }));
    expect(onAttention).toHaveBeenCalledWith("snooze");

    rerender(<PantryEditor item={mutedItem} onStock={vi.fn()} onAddLot={vi.fn()} onRemoveLot={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onAttention={onAttention} onClearAttention={onClearAttention} />);
    fireEvent.click(region().getByRole("button", { name: /Restore attention/ }));
    expect(onClearAttention).toHaveBeenCalledOnce();
  });

  it("keeps safety warning visibility and does not offer suppress controls for it", () => {
    const expiringItem = { ...item, status: "expiring-soon" as const, attention: { ...item.attention, stock: false, forecast: false, safety: true, visible: true } };
    render(<PantryEditor item={expiringItem} onStock={vi.fn()} onAddLot={vi.fn()} onRemoveLot={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onAttention={vi.fn()} onClearAttention={vi.fn()} />);

    const region = within(screen.getAllByRole("region", { name: "Olive oil details" }).at(-1)!);
    expect(region.getByRole("alert")).toHaveTextContent("Safety warnings remain visible");
    expect(region.queryByRole("button", { name: /Snooze 7 days/ })).toBeNull();
    expect(region.queryByRole("button", { name: /Until restocked/ })).toBeNull();
  });
});

describe("UseStockModal", () => {
  it("submits the selected dated lot and entered quantity", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const itemWithLots = {
      ...item,
      locations: [{ ...item.locations[0], quantity: 3, lots: [{ id: "lot-1", quantity: 2, unit: "bottle", approximate: false, bestBeforeAt: null, expiresAt: "2099-09-25T23:59:59.000Z", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }] }],
    };
    render(<UseStockModal item={itemWithLots} onClose={vi.fn()} onSave={onSave} />);
    const dialog = screen.getAllByRole("dialog").at(-1)!;

    fireEvent.change(within(dialog).getByRole("spinbutton"), { target: { value: "1.5" } });
    fireEvent.click(within(dialog).getByRole("radio", { name: /2 bottle dated lot/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Use stock" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ location: "Cupboard", quantity: 1.5, unit: "bottle", source: { type: "lot", lotId: "lot-1" } })));
  });
});

describe("AddStockModal", () => {
  it("previews package totals and submits a confirmed package purchase", async () => {
    const onPackageStock = vi.fn().mockResolvedValue(undefined);
    render(<AddStockModal item={{ ...item, packages: [{ ...item.packages[0], confirmed: true }] }} onClose={vi.fn()} onDirectStock={vi.fn()} onPackageStock={onPackageStock} />);
    const dialog = screen.getAllByRole("dialog").at(-1)!;

    fireEvent.click(within(dialog).getByRole("radio", { name: /Package purchase/ }));
    fireEvent.change(within(dialog).getByLabelText("Package count"), { target: { value: "3" } });
    expect(within(dialog).getByRole("status")).toHaveTextContent("Total received: 3 bottle");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add stock" }));

    await waitFor(() => expect(onPackageStock).toHaveBeenCalledWith(expect.objectContaining({ packageId: "package-1", packageCount: 3, mismatchResolution: "package", receivedUnit: "bottle" })));
  });

  it("requires a received quantity and unit for an incompatible package", () => {
    const incompatible = { ...item, locations: [{ ...item.locations[0], unit: "kg" }], packages: [{ ...item.packages[0], confirmed: true, unit: "bottle" }] };
    render(<AddStockModal item={incompatible} onClose={vi.fn()} onDirectStock={vi.fn()} onPackageStock={vi.fn()} />);
    const dialog = screen.getAllByRole("dialog").at(-1)!;

    fireEvent.click(within(dialog).getByRole("radio", { name: /Package purchase/ }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("bottle");
    expect(within(dialog).getByRole("button", { name: "Add stock" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Received quantity"), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText("Received unit"), { target: { value: "case" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Replace Cupboard unit/ }));
    expect(within(dialog).getByRole("button", { name: "Add stock" })).not.toBeDisabled();
  });
});
