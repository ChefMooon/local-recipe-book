import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Archive,
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowsDownUp,
  CaretDown,
  Check,
  Circle,
  MagnifyingGlass,
  Package,
  Plus,
  Trash,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import type { PantryItemPayload, PantryLotPayload, PantrySummaryPayload } from "@shared/types";
import type {
  CreatePantryItemInput,
  PantryLotInput,
  UpdatePantryItemInput,
} from "@shared/schemas/pantry-schemas";
import { pantryUnitDimension, type PantryPackageStockActionInput } from "@shared/schemas/pantry-schemas";
import { Button } from "@/components/ui/button";
import { ModalShell } from "@/components/ui/ModalShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { RouteErrorState } from "@/components/ui/route-error-state";
import { fetchJson, isRateLimitedApiError } from "@/lib/api";
import { ApiPaths } from "@shared/api/types";
import { isServerConfigReady } from "@/lib/config";
import { useServerConfig } from "@/lib/use-server-config";

import styles from "./pantry.module.css";
import groceryStyles from "@/components/grocery-list/grocery-list.module.css";

type Filter = "all" | "low-stock" | "empty" | "expiring-soon" | "expired" | "always-available" | "track-quantity" | "replenish-to-target" | "recent-updates" | "forecast-attention";
type Sort = "name" | "updated" | "category" | "status";
type DatedLotDraft = Omit<PantryLotInput, "quantity" | "unit" | "bestBeforeAt" | "expiresAt"> & { id?: string; quantity: string; unit: string; lotUnitLinked?: boolean; bestBeforeAt: string; expiresAt: string };
type PackageDraft = { id?: string; label: string; quantity: string; unit: string; confirmed: boolean; enabled: boolean };

const filters: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All items" },
  { id: "low-stock", label: "Low stock" },
  { id: "empty", label: "Empty" },
  { id: "expiring-soon", label: "Expiring soon" },
  { id: "expired", label: "Expired" },
  { id: "always-available", label: "Always available" },
  { id: "track-quantity", label: "Track quantity" },
  { id: "replenish-to-target", label: "Replenish to target" },
  { id: "recent-updates", label: "Recent updates" },
  { id: "forecast-attention", label: "Forecast attention" },
];

const statusLabels: Record<PantryItemPayload["status"], string> = {
  ok: "In stock",
  low: "Low stock",
  empty: "Empty",
  "expiring-soon": "Expiring soon",
  expired: "Expired",
};

function formatQuantity(item: PantryItemPayload) {
  if (item.stockMode === "always-available") return "Always available";
  if (item.usableQuantity == null) return "No quantity recorded";
  const unit = item.locations.find((location) => location.unit)?.unit;
  return `${item.usableQuantity} ${unit ?? "units"}`;
}

function formatUpdated(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(value));
}

function getLocationLabel(item: PantryItemPayload) {
  return item.locations.map((location) => location.location).join(", ") || "Unspecified";
}

function formatForecast(item: PantryItemPayload) {
  if (item.forecast.state === "unavailable") {
    const reasons: Record<NonNullable<typeof item.forecast.reason>, string> = {
      "missing-daily-usage": "Daily usage is not configured.",
      "missing-stock": "Forecast unavailable: stock quantity or unit is missing.",
      "approximate-stock": "Forecast unavailable: stock is approximate.",
      "incompatible-unit": "Forecast unavailable: stock units are incompatible.",
      "expired-stock": "Forecast unavailable: all eligible stock is expired.",
    };
    return reasons[item.forecast.reason ?? "missing-stock"];
  }
  const days = item.forecast.remainingDays ?? 0;
  const remaining = `${days.toFixed(1)} days remaining`;
  const projected = item.forecast.projectedRunOutAt ? `Estimated run-out ${formatUpdated(item.forecast.projectedRunOutAt)}` : "Run-out date unavailable";
  return `${remaining}. ${projected}.`;
}

const volumeToMl: Record<string, number> = { ml: 1, l: 1000, tsp: 4.92892, tbsp: 14.7868, "fl oz": 29.5735, cup: 236.588, pt: 473.176, qt: 946.353 };
const weightToG: Record<string, number> = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592 };
function previewConversion(quantity: number, from: string, to: string) {
  if (from === to) return quantity;
  if (pantryUnitDimension(from) !== pantryUnitDimension(to)) return null;
  if (pantryUnitDimension(from) === "volume" && volumeToMl[from] && volumeToMl[to]) return quantity * volumeToMl[from] / volumeToMl[to];
  if (pantryUnitDimension(from) === "weight" && weightToG[from] && weightToG[to]) return quantity * weightToG[from] / weightToG[to];
  return null;
}

const sortOptions: Array<{ value: Sort; label: string }> = [
  { value: "updated", label: "Recently updated" },
  { value: "name", label: "Name" },
  { value: "category", label: "Category" },
  { value: "status", label: "Status" },
];

function PantrySortSelect({ value, onChange }: { value: Sort; onChange: (value: Sort) => void }) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(value);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = "pantry-sort-options";
  const selectedOption = sortOptions.find((option) => option.value === value) ?? sortOptions[0];

  useEffect(() => {
    setHighlighted(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const moveHighlight = (direction: 1 | -1) => {
    const currentIndex = sortOptions.findIndex((option) => option.value === highlighted);
    const nextIndex = (currentIndex + direction + sortOptions.length) % sortOptions.length;
    setHighlighted(sortOptions[nextIndex].value);
  };

  const selectOption = (nextValue: Sort) => {
    onChange(nextValue);
    setOpen(false);
  };

  return <div className={styles.sortMenu} ref={rootRef}>
    <button
      aria-controls={listboxId}
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-label="Sort Pantry"
      className={styles.sortTrigger}
      onClick={() => setOpen((current) => !current)}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          if (!open) setOpen(true);
          moveHighlight(event.key === "ArrowDown" ? 1 : -1);
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (open) selectOption(highlighted);
          else setOpen(true);
        } else if (event.key === "Escape") {
          setOpen(false);
        }
      }}
      type="button"
    >
      <span>{selectedOption.label}</span>
      <CaretDown aria-hidden="true" size={14} weight="bold" />
    </button>
    {open ? <div className={styles.sortOptions} id={listboxId} role="listbox" aria-label="Sort Pantry options">
      {sortOptions.map((option) => <button
        aria-selected={option.value === value}
        className={`${styles.sortOption} ${option.value === value ? styles.sortOptionSelected : ""} ${option.value === highlighted ? styles.sortOptionHighlighted : ""}`}
        key={option.value}
        onClick={() => selectOption(option.value)}
        role="option"
        type="button"
      >
        <span>{option.label}</span>
        {option.value === value ? <Check aria-hidden="true" size={14} weight="bold" /> : null}
      </button>)}
    </div> : null}
  </div>;
}

export function AddStockModal({ item, onClose, onDirectStock, onPackageStock }: {
  item: PantryItemPayload;
  onClose: () => void;
  onDirectStock: (input: { location: string; quantity: number; unit: string }) => Promise<void>;
  onPackageStock: (input: PantryPackageStockActionInput) => Promise<void>;
}) {
  const [mode, setMode] = useState<"direct" | "package">("direct");
  const [location, setLocation] = useState(item.locations[0]?.location ?? "Unspecified");
  const selectedLocation = item.locations.find((entry) => entry.location === location) ?? item.locations[0];
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState(selectedLocation?.unit ?? "count");
  const [packageId, setPackageId] = useState(item.packages.find((pack) => pack.enabled && pack.confirmed)?.id ?? "");
  const [packageCount, setPackageCount] = useState("1");
  const [receivedQuantity, setReceivedQuantity] = useState("");
  const [receivedUnit, setReceivedUnit] = useState("");
  const [replaceLocationUnit, setReplaceLocationUnit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pack = item.packages.find((entry) => entry.id === packageId);
  const count = Number(packageCount);
  const packageTotal = pack ? pack.quantity * count : 0;
  const locationUnit = selectedLocation?.unit ?? "count";
  const convertedTotal = pack ? previewConversion(packageTotal, pack.unit, locationUnit) : null;
  const mismatch = Boolean(pack && convertedTotal == null);
  const customResolution = mismatch && receivedUnit.trim() !== "";
  const validDirect = Number.isFinite(Number(quantity)) && Number(quantity) > 0 && unit.trim() !== "";
  const validPackage = Boolean(pack && Number.isInteger(count) && count > 0 && (!mismatch || (customResolution && Number(receivedQuantity) > 0 && replaceLocationUnit)));
  const submit = async () => {
    setSaving(true); setError(null);
    try {
      if (mode === "direct") await onDirectStock({ location, quantity: Number(quantity), unit: unit.trim() });
      else if (pack) await onPackageStock({ packageId: pack.id, location, packageCount: count, mismatchResolution: mismatch ? "custom-unit" : "package", receivedQuantity: mismatch ? Number(receivedQuantity) : undefined, receivedUnit: mismatch ? receivedUnit.trim() : pack.unit, replaceLocationUnit });
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to add stock."); } finally { setSaving(false); }
  };
  return <ModalShell open title="Add stock" eyebrow={item.name} subtitle="Choose a direct quantity or record one or more purchased packages." ariaLabel={`Add stock to ${item.name}`} closeDisabled={saving} onClose={onClose} className={styles.modal} footerLeft={<button className={groceryStyles.btnGhost} disabled={saving} onClick={onClose} type="button">Cancel</button>} footerRight={<button className={groceryStyles.btnCreate} disabled={saving || (mode === "direct" ? !validDirect : !validPackage)} onClick={() => { void submit(); }} type="button">{saving ? "Saving..." : "Add stock"}</button>}>
    <fieldset className={styles.stockSources}><legend>Stock entry</legend><label className={`${styles.stockSource} ${mode === "direct" ? styles.stockSourceSelected : ""}`}><input checked={mode === "direct"} name="stock-entry-mode" onChange={() => setMode("direct")} type="radio" /><span><strong>Direct quantity</strong><small>Enter the amount received in the location unit.</small></span></label><label className={`${styles.stockSource} ${mode === "package" ? styles.stockSourceSelected : ""}`}><input checked={mode === "package"} name="stock-entry-mode" onChange={() => setMode("package")} type="radio" /><span><strong>Package purchase</strong><small>Use a confirmed package equivalence and a package count.</small></span></label></fieldset>
    <div className={styles.formGrid}><label className={styles.field}><span>Location</span><select value={location} onChange={(event) => setLocation(event.target.value)}>{item.locations.map((entry) => <option key={entry.id} value={entry.location}>{entry.location}</option>)}</select></label>{mode === "direct" ? <><label className={styles.field}><span>Quantity</span><input autoFocus inputMode="decimal" min="0" step="any" type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><label className={styles.field}><span>Unit</span><input value={unit} onChange={(event) => setUnit(event.target.value)} /></label></> : <><label className={styles.field}><span>Package</span><select value={packageId} onChange={(event) => setPackageId(event.target.value)}><option value="">Select a confirmed package</option>{item.packages.filter((entry) => entry.enabled).map((entry) => <option disabled={!entry.confirmed} key={entry.id} value={entry.id}>{entry.label} ({entry.quantity} {entry.unit}){entry.confirmed ? "" : " · Unconfirmed"}</option>)}</select></label><label className={styles.field}><span>Package count</span><input inputMode="numeric" min="1" step="1" type="number" value={packageCount} onChange={(event) => setPackageCount(event.target.value)} /></label></>}</div>
    {mode === "package" && pack ? <><p className={mismatch ? styles.stockWarning : styles.stockSummary} role={mismatch ? "alert" : "status"}>{mismatch ? `This package provides ${packageTotal} ${pack.unit}, but ${location} uses ${locationUnit}. Enter the received quantity and unit to explicitly replace this location unit.` : `Total received: ${packageTotal} ${pack.unit}${convertedTotal != null && pack.unit !== locationUnit ? ` = ${convertedTotal} ${locationUnit}` : ""}.`}</p>{mismatch ? <div className={styles.formGrid}><label className={styles.field}><span>Received quantity</span><input inputMode="decimal" min="0" step="any" type="number" value={receivedQuantity} onChange={(event) => setReceivedQuantity(event.target.value)} /></label><label className={styles.field}><span>Received unit</span><input value={receivedUnit} onChange={(event) => setReceivedUnit(event.target.value)} placeholder={locationUnit} /></label><label className={styles.checkboxField}><input type="checkbox" checked={replaceLocationUnit} onChange={(event) => setReplaceLocationUnit(event.target.checked)} /><span>Replace {location} unit with the received unit</span></label></div> : null}</> : null}
    {error ? <p className={styles.formError} role="alert">{error}</p> : null}
  </ModalShell>;
}

export function PantryManagementModal({
  onClose,
  onSave,
  item,
  onAddLots,
  onCreateLots,
  onUpdateLots,
}: {
  onClose: () => void;
  onSave: (input: CreatePantryItemInput | UpdatePantryItemInput) => Promise<PantryItemPayload | void>;
  item?: PantryItemPayload | null;
  onAddLots?: (inputs: PantryLotInput[]) => Promise<void>;
  onCreateLots?: (itemId: string, inputs: PantryLotInput[]) => Promise<void>;
  onUpdateLots?: (inputs: Array<PantryLotInput & { id: string }>) => Promise<void>;
}) {
  const initialUnit = item?.locations[0]?.unit ?? "";
  const [name, setName] = useState(item?.name ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const [stockMode, setStockMode] = useState<CreatePantryItemInput["stockMode"]>((item?.stockMode as CreatePantryItemInput["stockMode"]) ?? "always-available");
  const [location, setLocation] = useState(item?.locations[0]?.location ?? "");
  const [quantity, setQuantity] = useState(item?.locations[0]?.quantity?.toString() ?? "");
    const [unit, setUnit] = useState(item?.locations[0]?.unit ?? "count");
  const [aliases, setAliases] = useState(item?.aliases.map((alias) => alias.label).join(", ") ?? "");
  const [warningThreshold, setWarningThreshold] = useState(item?.warningThreshold?.toString() ?? "");
  const [expirationWarningDays, setExpirationWarningDays] = useState(item?.expirationWarningDays?.toString() ?? "");
  const [replenishmentTarget, setReplenishmentTarget] = useState(item?.replenishmentTarget?.toString() ?? "");
  const [replenishmentQuantity, setReplenishmentQuantity] = useState(item?.replenishmentQuantity?.toString() ?? "");
  const [replenishmentUnit, setReplenishmentUnit] = useState(item?.replenishmentUnit ?? initialUnit);
  const [dailyUsageQuantity, setDailyUsageQuantity] = useState(item?.dailyUsageQuantity?.toString() ?? "");
  const [dailyUsageUnit, setDailyUsageUnit] = useState(item?.dailyUsageUnit ?? initialUnit);
  const [dailyUsageUnitLinked, setDailyUsageUnitLinked] = useState(!item?.dailyUsageUnit);
  const [dailyUsageWarningDays, setDailyUsageWarningDays] = useState(item?.dailyUsageWarningDays?.toString() ?? "");
  const [packageDrafts, setPackageDrafts] = useState<PackageDraft[]>(() => item?.packages.map((pack) => ({ id: pack.id, label: pack.label, quantity: pack.quantity.toString(), unit: pack.unit, confirmed: pack.confirmed, enabled: pack.enabled })) ?? []);
  const [lotDrafts, setLotDrafts] = useState<DatedLotDraft[]>(() => item?.locations.flatMap((entry) => entry.lots.map((lot) => ({
    id: lot.id,
    location: entry.location,
    quantity: lot.quantity.toString(),
    unit: lot.unit ?? "",
    lotUnitLinked: false,
    approximate: lot.approximate,
    bestBeforeAt: lot.bestBeforeAt ? lot.bestBeforeAt.slice(0, 10) : "",
    expiresAt: lot.expiresAt ? lot.expiresAt.slice(0, 10) : "",
  }))) ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const updateGeneralUnit = (nextUnit: string) => {
    const previousUnit = unit;
    setUnit(nextUnit);
    if (!dailyUsageUnit || dailyUsageUnit === previousUnit) {
      setDailyUsageUnit(nextUnit);
      setDailyUsageUnitLinked(true);
    }
    if (!replenishmentUnit || replenishmentUnit === previousUnit) setReplenishmentUnit(nextUnit);
    setLotDrafts((drafts) => drafts.map((draft) => draft.lotUnitLinked ? { ...draft, unit: nextUnit } : draft));
  };
  const differsFromGeneralUnit = (value: string) => value.trim().toLowerCase() !== unit.trim().toLowerCase();
  const dailyUsageError = dailyUsageQuantity && !dailyUsageUnit.trim()
    ? "Enter a daily usage unit or clear the daily usage quantity."
    : dailyUsageUnit.trim() && !dailyUsageQuantity
          ? dailyUsageUnitLinked ? null : "Enter a daily usage quantity or clear the daily usage unit."
      : dailyUsageQuantity && (!Number.isFinite(Number(dailyUsageQuantity)) || Number(dailyUsageQuantity) <= 0)
        ? "Daily usage must be greater than zero."
        : dailyUsageWarningDays && (!Number.isInteger(Number(dailyUsageWarningDays)) || Number(dailyUsageWarningDays) < 0)
          ? "Warning lead time must be a whole number of days.": null;
  const invalidLot = lotDrafts.some((draft) => draft.quantity === "" || !Number.isFinite(Number(draft.quantity)) || Number(draft.quantity) < 0 || !draft.unit.trim());
  const canSave = name.trim().length > 0 && !dailyUsageError && !invalidLot;
  const addLotDraft = () => setLotDrafts((drafts) => [...drafts, { location: location.trim() || item?.locations[0]?.location || "Unspecified", quantity: "", unit, lotUnitLinked: true, approximate: false, bestBeforeAt: "", expiresAt: "" }]);
  const updateLotDraft = (index: number, patch: Partial<DatedLotDraft>) => setLotDrafts((drafts) => drafts.map((draft, draftIndex) => draftIndex === index ? { ...draft, ...patch } : draft));
  const removeLotDraft = (index: number) => setLotDrafts((drafts) => drafts.filter((_, draftIndex) => draftIndex !== index));

  return (
    <ModalShell
      open
      title={item ? "Edit Pantry item" : "Add Pantry item"}
      eyebrow="Inventory"
      subtitle={item ? "Update the item details and inventory settings." : "Create a household item and choose how its stock should be handled."}
      ariaLabel={item ? "Edit Pantry item" : "Add Pantry item"}
      closeDisabled={saving}
      onClose={onClose}
      className={styles.modal}
      footerLeft={<>{packageDrafts[0] && packageDrafts[0].unit.trim().toLowerCase() !== unit.trim().toLowerCase() ? <button aria-label="Reset package unit to general unit" className={styles.unitReset} disabled={saving} onClick={() => setPackageDrafts((drafts) => drafts.map((entry, index) => index === 0 ? { ...entry, unit } : entry))} type="button"><ArrowCounterClockwise aria-hidden="true" size={16} /></button> : null}<button className={groceryStyles.btnGhost} disabled={saving} onClick={onClose} type="button">Cancel</button></>}
      footerRight={<button className={groceryStyles.btnCreate} disabled={!canSave || saving} onClick={async () => {
        if (!canSave) return;
        setSaving(true);
        try {
          const aliasInputs = aliases.split(",").map((alias) => alias.trim()).filter(Boolean).map((label) => ({ label }));
          const packageInputs = packageDrafts.filter((draft) => draft.label.trim() && draft.quantity && draft.unit.trim() && Number(draft.quantity) > 0).map((draft) => ({ id: draft.id, label: draft.label.trim(), quantity: Number(draft.quantity), unit: draft.unit.trim(), dimension: pantryUnitDimension(draft.unit), confirmed: draft.confirmed, enabled: draft.enabled }));
          const savedItem = await onSave({
            name: name.trim(),
            category: category.trim() || "Other",
            stockMode,
            aliases: aliasInputs,
            packages: packageInputs,
            warningThreshold: warningThreshold ? Number(warningThreshold) : null,
            warningUnit: warningThreshold ? unit.trim() || null : null,
            expirationWarningDays: expirationWarningDays ? Number(expirationWarningDays) : null,
            replenishmentTarget: replenishmentTarget ? Number(replenishmentTarget) : null,
            replenishmentUnit: replenishmentTarget ? replenishmentUnit.trim() || null : null,
            replenishmentQuantity: replenishmentQuantity ? Number(replenishmentQuantity) : null,
            dailyUsageQuantity: dailyUsageQuantity ? Number(dailyUsageQuantity) : null,
            dailyUsageUnit: dailyUsageQuantity ? dailyUsageUnit.trim() || null : null,
            dailyUsageWarningDays: dailyUsageWarningDays !== "" ? Number(dailyUsageWarningDays) : null,
            locations: [{ location: location.trim() || "Unspecified", quantity: quantity ? Number(quantity) : null, unit: unit.trim() || null, approximate: false }],
            ...(item ? {} : { warningRules: [] }),
          });
          const lotInputs = lotDrafts.map((draft) => ({
              location: draft.location.trim() || "Unspecified",
              quantity: Number(draft.quantity),
              unit: draft.unit.trim() || null,
              approximate: draft.approximate,
              bestBeforeAt: draft.bestBeforeAt ? new Date(`${draft.bestBeforeAt}T23:59:59.000Z`).toISOString() : null,
              expiresAt: draft.expiresAt ? new Date(`${draft.expiresAt}T23:59:59.000Z`).toISOString() : null,
            }));
          if (!item && savedItem?.id && onCreateLots && lotInputs.length > 0) {
            await onCreateLots(savedItem.id, lotInputs);
          }
          if (item && onUpdateLots) {
            const updates = lotDrafts.flatMap((draft, index) => draft.id ? [{ id: draft.id, ...lotInputs[index] }] : []);
            if (updates.length > 0) await onUpdateLots(updates);
          }
          if (item && onAddLots) {
            const additions = lotDrafts.flatMap((draft, index) => draft.id ? [] : [lotInputs[index]]);
            if (additions.length > 0) await onAddLots(additions);
          }
          onClose();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Unable to add Pantry item.");
        } finally {
          setSaving(false);
        }
      }} type="button">{saving ? "Saving..." : item ? "Save changes" : "Add item"}</button>}
    >
      <div className={styles.formGrid}>
        <label className={styles.field}><span>Name</span><input data-autofocus="true" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Olive oil" /></label>
        <label className={styles.field}><span>Category</span><input value={category} onChange={(event) => setCategory(event.target.value)} /></label>
        <label className={styles.field}><span>Stock mode</span><select value={stockMode} onChange={(event) => setStockMode(event.target.value as CreatePantryItemInput["stockMode"])}><option value="always-available">Always available</option><option value="track-quantity">Track quantity</option><option value="replenish-to-target">Replenish to target</option></select></label>
        <label className={styles.field}><span>Aliases</span><input value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder="e.g. olive oil, cooking oil" /></label>
        <label className={styles.field}><span>Location</span><input value={location} onChange={(event) => setLocation(event.target.value)} /></label>
        {stockMode !== "always-available" ? <>
          <label className={styles.field}><span>Starting quantity</span><input inputMode="decimal" type="number" min="0" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="Optional" /></label>
          <label className={styles.field}><span>General unit</span><input value={unit} onChange={(event) => updateGeneralUnit(event.target.value)} placeholder="e.g. bottle, kg" /></label>
        </> : null}
        {stockMode === "always-available" ? <label className={styles.field}><span>General unit</span><input value={unit} onChange={(event) => updateGeneralUnit(event.target.value)} placeholder="e.g. bottle, kg" /></label> : null}
        <label className={styles.field}><span>Warning threshold</span><input inputMode="decimal" type="number" min="0" value={warningThreshold} onChange={(event) => setWarningThreshold(event.target.value)} placeholder="Optional" /></label>
        <label className={styles.field}><span>Expiration warning days</span><input inputMode="numeric" type="number" min="0" value={expirationWarningDays} onChange={(event) => setExpirationWarningDays(event.target.value)} placeholder="Optional" /></label>
        <fieldset className={styles.fieldset} aria-describedby={dailyUsageError ? "daily-usage-error" : undefined}><legend>Daily usage forecast</legend><label className={styles.field}><span>Used per day</span><input aria-label="Daily usage quantity" inputMode="decimal" type="number" min="0" step="any" value={dailyUsageQuantity} onChange={(event) => setDailyUsageQuantity(event.target.value)} placeholder="Optional" /></label><label className={styles.field}><span>Usage unit</span><span className={styles.unitInput}><input aria-label="Daily usage unit" value={dailyUsageUnit} onChange={(event) => { setDailyUsageUnit(event.target.value); setDailyUsageUnitLinked(false); }} placeholder="Uses general unit" />{differsFromGeneralUnit(dailyUsageUnit) ? <button aria-label="Reset usage unit to general unit" className={styles.unitReset} onClick={() => { setDailyUsageUnit(unit); setDailyUsageUnitLinked(true); }} title="Reset to general unit" type="button"><ArrowCounterClockwise aria-hidden="true" size={16} /></button> : null}</span></label><label className={styles.field}><span>Warning lead time (days)</span><input aria-label="Forecast warning lead time in days" inputMode="numeric" type="number" min="0" step="1" value={dailyUsageWarningDays} onChange={(event) => setDailyUsageWarningDays(event.target.value)} placeholder="Optional" /></label></fieldset>
        {stockMode === "replenish-to-target" ? <>
          <label className={styles.field}><span>Restock target</span><input inputMode="decimal" type="number" min="0" value={replenishmentTarget} onChange={(event) => setReplenishmentTarget(event.target.value)} /></label>
          <label className={styles.field}><span>Restock quantity</span><input inputMode="decimal" type="number" min="0" value={replenishmentQuantity} onChange={(event) => setReplenishmentQuantity(event.target.value)} /></label>
          <label className={styles.field}><span>Restock unit</span><input value={replenishmentUnit} onChange={(event) => setReplenishmentUnit(event.target.value)} /></label>
        </> : null}
        <fieldset className={styles.fieldset}><legend>Package equivalences</legend>{packageDrafts.map((draft, index) => <div className={styles.lotEntry} key={draft.id ?? `package-${index}`}><div className={styles.lotEntryHeader}><strong>Package {index + 1}</strong><button aria-label={`Remove package ${index + 1}`} className={styles.removeLot} onClick={() => setPackageDrafts((drafts) => drafts.filter((_, draftIndex) => draftIndex !== index))} type="button"><X aria-hidden="true" /></button></div><label className={styles.field}><span>Label</span><input aria-label={`Package ${index + 1} label`} value={draft.label} onChange={(event) => setPackageDrafts((drafts) => drafts.map((entry, draftIndex) => draftIndex === index ? { ...entry, label: event.target.value } : entry))} placeholder="e.g. one bottle" /></label><label className={styles.field}><span>Quantity</span><input aria-label={`Package ${index + 1} quantity`} inputMode="decimal" type="number" min="0" value={draft.quantity} onChange={(event) => setPackageDrafts((drafts) => drafts.map((entry, draftIndex) => draftIndex === index ? { ...entry, quantity: event.target.value } : entry))} /></label><label className={styles.field}><span>Unit</span><input aria-label={index === 0 ? "Package unit" : `Package ${index + 1} unit`} value={draft.unit} onChange={(event) => setPackageDrafts((drafts) => drafts.map((entry, draftIndex) => draftIndex === index ? { ...entry, unit: event.target.value } : entry))} placeholder="Uses general unit" /></label><label className={styles.checkboxField}><input type="checkbox" checked={draft.confirmed} onChange={(event) => setPackageDrafts((drafts) => drafts.map((entry, draftIndex) => draftIndex === index ? { ...entry, confirmed: event.target.checked } : entry))} /><span>Confirmed equivalence</span></label><label className={styles.checkboxField}><input type="checkbox" checked={draft.enabled} onChange={(event) => setPackageDrafts((drafts) => drafts.map((entry, draftIndex) => draftIndex === index ? { ...entry, enabled: event.target.checked } : entry))} /><span>Enabled for purchases</span></label></div>)}<button className={styles.addLotButton} onClick={() => setPackageDrafts((drafts) => [...drafts, { label: "", quantity: "", unit, confirmed: true, enabled: true }])} type="button"><Plus aria-hidden="true" /> Add package</button></fieldset>
        {(onAddLots || onCreateLots || onUpdateLots) ? <fieldset className={styles.fieldset}><legend>Dated lots</legend>{lotDrafts.map((draft, index) => <div className={styles.lotEntry} key={draft.id ?? `lot-${index}`}><div className={styles.lotEntryHeader}><strong>{draft.id ? `Current lot ${index + 1}` : `New lot ${index + 1}`}</strong>{draft.id ? <span className={styles.lotSavedHint}>Saved lot</span> : <button aria-label={`Remove lot ${index + 1}`} className={styles.removeLot} onClick={() => removeLotDraft(index)} type="button"><X aria-hidden="true" /></button>}</div><label className={styles.field}><span>Location</span><select value={draft.location} onChange={(event) => updateLotDraft(index, { location: event.target.value })}>{(item?.locations ?? []).map((entry) => <option key={entry.id} value={entry.location}>{entry.location}</option>)}{!(item?.locations ?? []).some((entry) => entry.location === "Unspecified") ? <option value="Unspecified">Unspecified</option> : null}</select></label><label className={styles.field}><span>Quantity</span><input aria-label={`Lot ${index + 1} quantity`} inputMode="decimal" type="number" min="0" step="any" value={draft.quantity} onChange={(event) => updateLotDraft(index, { quantity: event.target.value })} /></label><label className={styles.field}><span>Unit</span><span className={styles.unitInput}><input aria-label={`Lot ${index + 1} unit`} value={draft.unit} onChange={(event) => updateLotDraft(index, { unit: event.target.value, lotUnitLinked: false })} placeholder="Uses general unit" />{!draft.id && draft.unit.trim().toLowerCase() !== unit.trim().toLowerCase() ? <button aria-label={`Reset lot ${index + 1} unit to general unit`} className={styles.unitReset} onClick={() => updateLotDraft(index, { unit, lotUnitLinked: true })} title="Reset to general unit" type="button"><ArrowCounterClockwise aria-hidden="true" size={16} /></button> : null}</span></label><label className={styles.field}><span>Best before</span><input aria-label={`Lot ${index + 1} best before`} type="date" value={draft.bestBeforeAt} onChange={(event) => updateLotDraft(index, { bestBeforeAt: event.target.value })} /></label><label className={styles.field}><span>Expires on</span><input aria-label={`Lot ${index + 1} expires on`} type="date" value={draft.expiresAt} onChange={(event) => updateLotDraft(index, { expiresAt: event.target.value })} /></label><label className={styles.checkboxField}><input type="checkbox" checked={draft.approximate} onChange={(event) => updateLotDraft(index, { approximate: event.target.checked })} /><span>Quantity is approximate</span></label></div>)}<button className={styles.addLotButton} onClick={addLotDraft} type="button"><Plus aria-hidden="true" /> {lotDrafts.length ? "Add another lot" : "Add dated lot"}</button></fieldset> : null}
      </div>
      {dailyUsageError ? <p className={styles.formError} id="daily-usage-error" role="alert">{dailyUsageError}</p> : null}
      {error ? <p className={styles.formError} role="alert">{error}</p> : null}
    </ModalShell>
  );
}

function toDateLabel(value: string | null) {
  return value ? formatUpdated(value) : "Not set";
}

function hasDatedLotStock(item: PantryItemPayload) {
  return item.locations.some((location) => location.lots.some((lot) => lot.quantity > 0));
}

type UseStockSource = { type: "earliest-expiring-lots" } | { type: "aggregate" } | { type: "lot"; lotId: string };

export function UseStockModal({ item, onClose, onSave }: { item: PantryItemPayload; onClose: () => void; onSave: (input: { location: string; quantity: number; unit: string; approximate: boolean; source: UseStockSource }) => Promise<void> }) {
  const [location, setLocation] = useState(item.locations[0]?.location ?? "Unspecified");
  const selectedLocation = item.locations.find((entry) => entry.location === location) ?? item.locations[0];
  const [quantity, setQuantity] = useState("1");
  const [source, setSource] = useState<UseStockSource>({ type: "earliest-expiring-lots" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const unit = selectedLocation?.unit ?? selectedLocation?.lots.find((lot) => lot.unit)?.unit ?? "count";
  const lots = selectedLocation?.lots.filter((lot) => lot.quantity > 0) ?? [];
  const datedLotQuantity = lots.filter((lot) => lot.unit === unit).reduce((total, lot) => total + lot.quantity, 0);
  const aggregateQuantity = selectedLocation?.quantity ?? 0;
  const mismatch = Math.abs(aggregateQuantity - datedLotQuantity) > 1e-8;
  const requestedQuantity = Number(quantity);
  const selectedLot = source.type === "lot" ? lots.find((lot) => lot.id === source.lotId) : null;
  const sourceQuantity = source.type === "aggregate" ? Math.max(0, aggregateQuantity - datedLotQuantity) : source.type === "lot" ? selectedLot?.quantity ?? 0 : lots.filter((lot) => !lot.expiresAt || new Date(lot.expiresAt).getTime() > Date.now()).reduce((total, lot) => total + lot.quantity, 0);
  const invalid = !Number.isFinite(requestedQuantity) || requestedQuantity <= 0 || (source.type === "aggregate" && requestedQuantity > sourceQuantity) || (source.type === "lot" && requestedQuantity > sourceQuantity);

  return <ModalShell open title="Use stock" eyebrow="Inventory" subtitle={`Choose how much of ${item.name} to use and where it should come from.`} ariaLabel={`Use stock from ${item.name}`} closeDisabled={saving} onClose={onClose} className={styles.modal} footerLeft={<button className={groceryStyles.btnGhost} disabled={saving} onClick={onClose} type="button">Cancel</button>} footerRight={<button className={groceryStyles.btnCreate} disabled={invalid || saving} onClick={async () => { if (invalid || !selectedLocation) return; setSaving(true); setError(null); try { await onSave({ location: selectedLocation.location, quantity: requestedQuantity, unit, approximate: false, source }); onClose(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to use stock."); } finally { setSaving(false); } }} type="button">{saving ? "Saving..." : "Use stock"}</button>}>
    <div className={styles.formGrid}>
      <label className={styles.field}><span>Location</span><select value={selectedLocation?.location ?? location} onChange={(event) => { setLocation(event.target.value); setSource({ type: "earliest-expiring-lots" }); }}>{item.locations.map((entry) => <option key={entry.id} value={entry.location}>{entry.location}</option>)}</select></label>
      <label className={styles.field}><span>Quantity</span><input autoFocus data-autofocus="true" inputMode="decimal" min="0" step="any" type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
    </div>
    <fieldset className={styles.stockSources}><legend>Use from</legend><label className={`${styles.stockSource} ${source.type === "earliest-expiring-lots" ? styles.stockSourceSelected : ""}`}><input checked={source.type === "earliest-expiring-lots"} name="use-stock-source" onChange={() => setSource({ type: "earliest-expiring-lots" })} type="radio" /><span><strong>Earliest-expiring dated lots</strong><small>{sourceQuantity} {unit} available{lots.some((lot) => lot.expiresAt && new Date(lot.expiresAt).getTime() <= Date.now()) ? " · expired lots require explicit choice" : ""}</small></span></label><label className={`${styles.stockSource} ${source.type === "aggregate" ? styles.stockSourceSelected : ""}`}><input checked={source.type === "aggregate"} name="use-stock-source" onChange={() => setSource({ type: "aggregate" })} type="radio" /><span><strong>Unassigned stock</strong><small>{Math.max(0, aggregateQuantity - datedLotQuantity)} {unit} available</small></span></label>{lots.map((lot) => <label className={`${styles.stockSource} ${source.type === "lot" && source.lotId === lot.id ? styles.stockSourceSelected : ""}`} key={lot.id}><input checked={source.type === "lot" && source.lotId === lot.id} name="use-stock-source" onChange={() => setSource({ type: "lot", lotId: lot.id })} type="radio" /><span><strong>{lot.quantity} {lot.unit ?? unit} dated lot</strong><small>{lot.expiresAt ? `Expires ${toDateLabel(lot.expiresAt)}` : "No expiration date"}{lot.expiresAt && new Date(lot.expiresAt).getTime() <= Date.now() ? " · Expired" : ""}{lot.approximate ? " · Approximate" : ""}</small></span></label>)}</fieldset>
    <p className={mismatch ? styles.stockWarning : styles.stockSummary} role={mismatch ? "alert" : "status"}>{mismatch ? `Aggregate stock is ${aggregateQuantity} ${unit}, while dated lots total ${datedLotQuantity} ${unit}. Choose the source explicitly.` : `Available stock: ${aggregateQuantity} ${unit}`}</p>
    {invalid && quantity !== "" ? <p className={styles.formError} role="alert">The selected source does not have enough stock for this quantity.</p> : null}
    {error ? <p className={styles.formError} role="alert">{error}</p> : null}
  </ModalShell>;
}

export function AddDatedLotModal({
  item,
  onClose,
  onSave,
}: {
  item: PantryItemPayload;
  onClose: () => void;
  onSave: (input: { location: string; quantity: number; unit: string | null; approximate: boolean; bestBeforeAt: string | null; expiresAt: string | null }) => Promise<void>;
}) {
  const [location, setLocation] = useState(item.locations[0]?.location ?? "Unspecified");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState(item.locations.find((entry) => entry.unit)?.unit ?? "");
  const [bestBeforeAt, setBestBeforeAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [approximate, setApproximate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canSave = quantity !== "" && Number.isFinite(Number(quantity)) && Number(quantity) >= 0;

  const toIsoDate = (value: string) => value ? new Date(`${value}T23:59:59.000Z`).toISOString() : null;

  return <ModalShell
    open
    title="Add dated lot"
    eyebrow={item.name}
    subtitle="Record a quantity with optional best-before and expiration dates."
    ariaLabel={`Add dated lot to ${item.name}`}
    closeDisabled={saving}
    onClose={onClose}
    className={styles.modal}
    footerLeft={<button className={groceryStyles.btnGhost} disabled={saving} onClick={onClose} type="button">Cancel</button>}
    footerRight={<button className={groceryStyles.btnCreate} disabled={!canSave || saving} onClick={async () => {
      if (!canSave) return;
      setSaving(true);
      setError(null);
      try {
        await onSave({
          location: location.trim() || "Unspecified",
          quantity: Number(quantity),
          unit: unit.trim() || null,
          approximate,
          bestBeforeAt: toIsoDate(bestBeforeAt),
          expiresAt: toIsoDate(expiresAt),
        });
        onClose();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to add dated lot.");
      } finally {
        setSaving(false);
      }
    }} type="button">{saving ? "Saving..." : "Add dated lot"}</button>}
  >
    <div className={styles.formGrid}>
      <label className={styles.field}><span>Location</span><select value={location} onChange={(event) => setLocation(event.target.value)}>{item.locations.map((entry) => <option key={entry.id} value={entry.location}>{entry.location}</option>)}{!item.locations.some((entry) => entry.location === "Unspecified") ? <option value="Unspecified">Unspecified</option> : null}</select></label>
      <label className={styles.field}><span>Quantity</span><input aria-label="New lot quantity" autoFocus inputMode="decimal" type="number" min="0" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
      <label className={styles.field}><span>Unit</span><input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="e.g. bottle, kg" /></label>
      <label className={styles.field}><span>Best before</span><input aria-label="New lot best before" type="date" value={bestBeforeAt} onChange={(event) => setBestBeforeAt(event.target.value)} /></label>
      <label className={styles.field}><span>Expires on</span><input aria-label="New lot expires on" type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
      <label className={styles.checkboxField}><input type="checkbox" checked={approximate} onChange={(event) => setApproximate(event.target.checked)} /><span>Quantity is approximate</span></label>
    </div>
    {error ? <p className={styles.formError} role="alert">{error}</p> : null}
  </ModalShell>;
}

export function PantryEditor({ item, onStock, onAddLot, onRemoveLot, onEdit, onDelete }: { item: PantryItemPayload; onStock: (type: "add" | "consume" | "mark-empty") => void; onAddLot: () => void; onRemoveLot: (lot: PantryLotPayload, location: string) => void; onEdit: () => void; onDelete: () => void }) {
  const lotDates = item.locations.flatMap((location) => location.lots.map((lot) => lot.expiresAt).filter(Boolean) as string[]);
  const earliestExpiry = lotDates.sort()[0];
  const hasNoUsableStock = item.usableQuantity != null && item.usableQuantity <= 0 && !hasDatedLotStock(item);
  const isEmpty = item.status === "empty" || hasNoUsableStock;

  return <section className={styles.editor} aria-label={`${item.name} details`}>
    <div className={styles.editorTopline}><span className={styles.eyebrow}>{item.category}</span><span className={`${styles.status} ${styles[`status-${item.status}`]}`}><Circle weight="fill" aria-hidden="true" /> {statusLabels[item.status]}</span></div>
    <h2>{item.name}</h2>
    <p className={styles.editorMeta}>Updated {formatUpdated(item.updatedAt)} · {getLocationLabel(item)}</p>
    <div className={styles.editorStatus}><strong>{formatQuantity(item)}</strong>{earliestExpiry ? <span><Warning aria-hidden="true" /> Expires {formatUpdated(earliestExpiry)}</span> : <span>No dated lots recorded</span>}</div>
    {item.forecast.state !== "disabled" ? <div className={`${styles.forecast} ${item.forecast.attention ? styles.forecastAttention : ""}`} role="status"><strong>{item.forecast.attention ? "Forecast attention" : "Usage forecast"}</strong><span>{formatForecast(item)}</span></div> : null}
    <div className={styles.quickActions} aria-label="Quick stock actions">
      <Button onClick={() => onStock("add")}><Plus aria-hidden="true" /> Add stock</Button>
      <Button disabled={hasNoUsableStock} onClick={() => onStock("consume")} variant="outline"><Check aria-hidden="true" /> Use stock</Button>
      <Button disabled={isEmpty} onClick={() => onStock("mark-empty")} variant="danger"><X aria-hidden="true" /> Mark empty</Button>
    </div>
    <div className={styles.detailGroup}><div className={styles.detailHeading}><h3>Dated lots</h3><Button onClick={onAddLot} variant="outline"><Plus aria-hidden="true" /> Add dated lot</Button></div>{item.locations.some((location) => location.lots.length) ? item.locations.flatMap((location) => location.lots.map((lot) => <div className={styles.detailRow} key={lot.id}><span>{location.location}<small className={styles.detailSubtext}>{lot.quantity <= 0 ? "Used up" : lot.bestBeforeAt ? `Best before ${toDateLabel(lot.bestBeforeAt)}` : "Best-before date not set"} · {lot.expiresAt ? `Expires ${toDateLabel(lot.expiresAt)}` : "No expiration date"}{lot.approximate ? " · Approximate" : ""}</small></span><strong>{lot.quantity} {lot.unit ?? "units"}</strong><Button aria-label={`Remove dated lot from ${location.location}`} onClick={() => onRemoveLot(lot, location.location)} variant="danger"><Trash aria-hidden="true" /> Remove</Button></div>)) : <p className={styles.muted}>No dated lots recorded.</p>}</div>
    <div className={styles.detailGroup}><h3>Locations</h3>{item.locations.length ? item.locations.map((location) => <div className={styles.detailRow} key={location.id}><span>{location.location}</span><strong>{location.quantity == null ? "No quantity" : `${location.quantity} ${location.unit ?? "units"}`}</strong></div>) : <p className={styles.muted}>No locations recorded.</p>}</div>
    <div className={styles.detailGroup}><h3>Packages</h3>{item.packages.length ? item.packages.map((pack) => <div className={styles.detailRow} key={pack.id}><span><Package aria-hidden="true" /> {pack.label}</span><strong>{pack.quantity} {pack.unit}{pack.confirmed ? "" : " · Unconfirmed"}</strong></div>) : <p className={styles.muted}>No package equivalences configured.</p>}</div>
    <div className={styles.detailGroup}><h3>Inventory settings</h3><div className={styles.detailRow}><span>Mode</span><strong>{item.stockMode.replaceAll("-", " ")}</strong></div>{item.warningThreshold != null ? <div className={styles.detailRow}><span>Warning threshold</span><strong>{item.warningThreshold} {item.warningUnit ?? "units"}</strong></div> : null}{item.replenishmentTarget != null ? <div className={styles.detailRow}><span>Restock target</span><strong>{item.replenishmentTarget} {item.replenishmentUnit ?? "units"}</strong></div> : null}{item.dailyUsageQuantity != null ? <div className={styles.detailRow}><span>Daily usage</span><strong>{item.dailyUsageQuantity} {item.dailyUsageUnit}</strong></div> : null}{item.dailyUsageWarningDays != null ? <div className={styles.detailRow}><span>Forecast lead time</span><strong>{item.dailyUsageWarningDays} days</strong></div> : null}</div>
    <div className={styles.editorFooter}><Button onClick={onEdit} variant="outline">Edit item</Button><Button onClick={onDelete} variant="danger"><Trash aria-hidden="true" /> Delete item</Button></div>
  </section>;
}

export default function PantryPage() {
  const config = useServerConfig();
  const apiReady = isServerConfigReady(config);
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>(() => {
    const requested = searchParams.get("filter") as Filter | null;
    return requested && filters.some((entry) => entry.id === requested) ? requested : "all";
  });
  const [sort, setSort] = useState<Sort>("updated");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileEditor, setMobileEditor] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PantryItemPayload | null>(null);
  const [deletingItem, setDeletingItem] = useState<PantryItemPayload | null>(null);
  const [lotItem, setLotItem] = useState<PantryItemPayload | null>(null);
  const [useStockItem, setUseStockItem] = useState<PantryItemPayload | null>(null);
  const [addStockItem, setAddStockItem] = useState<PantryItemPayload | null>(null);
  const [removingLot, setRemovingLot] = useState<{ item: PantryItemPayload; lot: PantryLotPayload; location: string } | null>(null);
  const [pendingStockAction, setPendingStockAction] = useState<"consume" | "mark-empty" | null>(null);

  const listQuery = useQuery({
    queryKey: ["pantry", { search, filter, sort }],
    enabled: apiReady,
    queryFn: () => fetchJson<{ data: PantryItemPayload[] }>(`${ApiPaths.pantry}?${new URLSearchParams({ search, filter, sort, direction: sort === "name" ? "asc" : "desc" })}`).then((response) => response.data),
    placeholderData: (previousData) => previousData,
  });
  const summaryQuery = useQuery({ queryKey: ["pantry", "summary"], enabled: apiReady, queryFn: () => fetchJson<{ data: PantrySummaryPayload }>(ApiPaths.pantrySummary).then((response) => response.data) });
  const createMutation = useMutation({ mutationFn: (input: CreatePantryItemInput) => fetchJson<{ data: PantryItemPayload }>(ApiPaths.pantry, { method: "POST", body: JSON.stringify(input) }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pantry"] }) });
  const updateMutation = useMutation({ mutationFn: ({ id, input }: { id: string; input: UpdatePantryItemInput }) => fetchJson<{ data: PantryItemPayload }>(ApiPaths.pantryItem(id), { method: "PATCH", body: JSON.stringify(input) }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pantry"] }) });
  const stockMutation = useMutation({ mutationFn: ({ id, type, unit, location, quantity, source }: { id: string; type: "add" | "consume" | "mark-empty"; unit: string; location?: string; quantity?: number | null; source?: UseStockSource }) => fetchJson<{ data: PantryItemPayload }>(ApiPaths.pantryItemStock(id), { method: "POST", body: JSON.stringify({ type, location: location ?? "Unspecified", quantity: quantity ?? (type === "mark-empty" ? null : 1), unit, source }) }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pantry"] }) });
  const packageStockMutation = useMutation({ mutationFn: ({ id, input }: { id: string; input: PantryPackageStockActionInput }) => fetchJson<{ data: PantryItemPayload }>(ApiPaths.pantryItemPackageStock(id), { method: "POST", body: JSON.stringify(input) }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pantry"] }) });
  const lotMutation = useMutation({ mutationFn: ({ id, input }: { id: string; input: PantryLotInput }) => fetchJson(ApiPaths.pantryItemLots(id), { method: "POST", body: JSON.stringify(input) }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pantry"] }) });
  const updateLotMutation = useMutation({ mutationFn: ({ id, lotId, input }: { id: string; lotId: string; input: PantryLotInput }) => fetchJson(ApiPaths.pantryItemLot(id, lotId), { method: "PATCH", body: JSON.stringify(input) }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pantry"] }) });
  const removeLotMutation = useMutation({ mutationFn: ({ id, lotId }: { id: string; lotId: string }) => fetchJson(ApiPaths.pantryItemLot(id, lotId), { method: "DELETE" }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pantry"] }) });
  const deleteMutation = useMutation({ mutationFn: (id: string) => fetchJson(ApiPaths.pantryItem(id), { method: "DELETE" }), onSuccess: () => { setSelectedId(null); queryClient.invalidateQueries({ queryKey: ["pantry"] }); } });

  const items = listQuery.data ?? [];
  const selectedItem = items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const summary = summaryQuery.data;
  const queryError = listQuery.error ?? summaryQuery.error;
  const noMatches = !listQuery.isLoading && items.length === 0;

  useEffect(() => { if (!selectedId && items[0]) setSelectedId(items[0].id); }, [items, selectedId]);
  useEffect(() => { if (selectedItem && !items.some((item) => item.id === selectedId)) setSelectedId(selectedItem.id); }, [items, selectedId, selectedItem]);

  const statCards = useMemo((): Array<[string, number, Filter]> => summary ? [
    ["Tracked items", summary.trackedItems, "all" as Filter], ["Low stock", summary.lowStock, "low-stock" as Filter], ["Empty", summary.empty, "empty" as Filter], ["Expiring soon", summary.expiringSoon, "expiring-soon" as Filter], ["Expired", summary.expired, "expired" as Filter],
  ] : [], [summary]);

  if (queryError) return <div className={styles.page}><RouteErrorState onRetry={() => { void listQuery.refetch(); void summaryQuery.refetch(); }} title={isRateLimitedApiError(queryError) ? "Pantry is temporarily rate limited." : "Unable to load Pantry."} description="Check your connection and retry." /></div>;

  return <div className={styles.page}>
    <PageHeader eyebrow="Household inventory" title="Pantry" subtitle="Keep everyday ingredients and supplies ready for the meals ahead." actions={<button className={groceryStyles.btnNewList} onClick={() => setModalOpen(true)} type="button"><Plus aria-hidden="true" /> Add item</button>} />
    <div className={styles.stats} aria-label="Pantry summary">{statCards.map(([label, value, statFilter]) => <button aria-pressed={filter === statFilter} className={`${styles.statCard} ${filter === statFilter ? styles.statCardActive : ""}`} key={label} onClick={() => setFilter(statFilter as Filter)} type="button"><span>{label}</span><strong>{value}</strong></button>)}</div>
    <div className={styles.workspace}>
      <section className={`${styles.collection} ${mobileEditor ? styles.collectionHidden : ""}`} aria-label="Pantry collection">
        <div className={styles.collectionToolbar}><label className={styles.search}><MagnifyingGlass aria-hidden="true" /><span className="sr-only">Search Pantry</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search items, aliases, locations..." /></label><div className={styles.sort}><ArrowsDownUp aria-hidden="true" /><PantrySortSelect value={sort} onChange={setSort} /></div></div>
        <div className={styles.filters} aria-label="Pantry filters">{filters.map((item) => <button aria-pressed={filter === item.id} className={filter === item.id ? styles.filterActive : ""} key={item.id} onClick={() => setFilter(item.id)} type="button">{item.label}</button>)}</div>
        <div className={styles.collectionCount}>{listQuery.isLoading ? "Loading Pantry..." : listQuery.isFetching ? "Updating Pantry..." : `${items.length} ${items.length === 1 ? "item" : "items"}`}</div>
        {noMatches ? <div className={styles.empty}><Archive aria-hidden="true" size={28} /><strong>{search || filter !== "all" ? "No Pantry items match" : "Your Pantry is empty"}</strong><span>{search || filter !== "all" ? "Try another search or clear the filter." : "Add your first household item to start tracking stock."}</span>{search || filter !== "all" ? <Button onClick={() => { setSearch(""); setFilter("all"); }} variant="outline">Clear view</Button> : null}</div> : <div className={styles.rows}>{items.map((item) => <button aria-current={selectedItem?.id === item.id ? "true" : undefined} className={`${styles.row} ${selectedItem?.id === item.id ? styles.rowSelected : ""}`} key={item.id} onClick={() => { setSelectedId(item.id); setMobileEditor(true); }} type="button"><span className={styles.rowMain}><strong>{item.name}</strong><small>{getLocationLabel(item)} · {formatQuantity(item)}</small>{item.forecast.state !== "disabled" ? <small className={item.forecast.attention ? styles.forecastRowAttention : undefined}>{item.forecast.attention ? `Forecast: ${formatForecast(item)}` : item.forecast.state === "available" ? `${item.forecast.remainingDays?.toFixed(1)} days remaining` : formatForecast(item)}</small> : null}</span><span className={`${styles.status} ${styles[`status-${item.status}`]}`}><Circle aria-hidden="true" weight="fill" /> {statusLabels[item.status]}{item.forecast.attention ? " · Forecast attention" : ""}</span></button>)}</div>}
      </section>
      {selectedItem ? <section className={`${styles.editorPane} ${mobileEditor ? styles.editorVisible : ""}`}><button className={styles.mobileBack} onClick={() => setMobileEditor(false)} type="button"><ArrowLeft aria-hidden="true" /> Back to items</button><PantryEditor item={selectedItem} onStock={(type) => { if (type === "add") setAddStockItem(selectedItem); else if (type === "consume") setUseStockItem(selectedItem); else setPendingStockAction(type); }} onAddLot={() => setLotItem(selectedItem)} onRemoveLot={(lot, location) => setRemovingLot({ item: selectedItem, lot, location })} onEdit={() => { setEditingItem(selectedItem); setModalOpen(false); }} onDelete={() => setDeletingItem(selectedItem)} /></section> : null}
    </div>
    {modalOpen ? <PantryManagementModal onClose={() => setModalOpen(false)} onCreateLots={async (id, inputs) => { for (const input of inputs) await lotMutation.mutateAsync({ id, input }); }} onSave={async (input) => (await createMutation.mutateAsync(input as CreatePantryItemInput)).data} /> : null}
    {editingItem ? <PantryManagementModal item={editingItem} onClose={() => setEditingItem(null)} onAddLots={async (inputs) => { for (const input of inputs) await lotMutation.mutateAsync({ id: editingItem.id, input }); }} onUpdateLots={async (inputs) => { for (const input of inputs) await updateLotMutation.mutateAsync({ id: editingItem.id, lotId: input.id, input }); }} onSave={async (input) => { await updateMutation.mutateAsync({ id: editingItem.id, input: input as UpdatePantryItemInput }); }} /> : null}
    {lotItem ? <AddDatedLotModal item={lotItem} onClose={() => setLotItem(null)} onSave={async (input) => { await lotMutation.mutateAsync({ id: lotItem.id, input }); }} /> : null}
    {addStockItem ? <AddStockModal item={addStockItem} onClose={() => setAddStockItem(null)} onDirectStock={async (input) => { await stockMutation.mutateAsync({ id: addStockItem.id, type: "add", ...input }); }} onPackageStock={async (input) => { await packageStockMutation.mutateAsync({ id: addStockItem.id, input }); }} /> : null}
    {useStockItem ? <UseStockModal item={useStockItem} onClose={() => setUseStockItem(null)} onSave={async (input) => { await stockMutation.mutateAsync({ id: useStockItem.id, type: "consume", ...input }); }} /> : null}
    <AlertDialog open={Boolean(removingLot)} onOpenChange={(open) => { if (!open) setRemovingLot(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Remove dated lot?</AlertDialogTitle><AlertDialogDescription>{removingLot ? `Remove ${removingLot.lot.quantity} ${removingLot.lot.unit ?? "units"} from ${removingLot.location}? This records the remaining lot as discarded.` : "This action cannot be undone."}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel asChild><Button variant="outline" type="button">Cancel</Button></AlertDialogCancel><AlertDialogAction asChild><Button variant="danger" onClick={() => { if (removingLot) removeLotMutation.mutate({ id: removingLot.item.id, lotId: removingLot.lot.id }); setRemovingLot(null); }} type="button">Remove lot</Button></AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={Boolean(deletingItem)} onOpenChange={(open) => { if (!open) setDeletingItem(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Delete Pantry item?</AlertDialogTitle><AlertDialogDescription>{deletingItem ? `Are you sure you want to delete ${deletingItem.name}? This cannot be undone.` : "This action cannot be undone."}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel asChild><Button variant="outline" type="button">Cancel</Button></AlertDialogCancel><AlertDialogAction asChild><Button variant="accent" onClick={() => { if (deletingItem) deleteMutation.mutate(deletingItem.id); setDeletingItem(null); }} type="button">Delete</Button></AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={Boolean(pendingStockAction)} onOpenChange={(open) => { if (!open) setPendingStockAction(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{pendingStockAction === "mark-empty" ? "Mark item empty?" : "Use one unit?"}</AlertDialogTitle><AlertDialogDescription>{pendingStockAction === "mark-empty" ? `This will set ${selectedItem?.name ?? "this item"} to empty and record an inventory event.` : `Use one unit from ${selectedItem?.name ?? "this item"} and record an inventory event?`}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel asChild><Button variant="outline" type="button">Cancel</Button></AlertDialogCancel><AlertDialogAction asChild><Button variant={pendingStockAction === "mark-empty" ? "danger" : "accent"} onClick={() => { if (selectedItem && pendingStockAction) stockMutation.mutate({ id: selectedItem.id, type: pendingStockAction, unit: selectedItem.locations.find((location) => location.unit)?.unit ?? "count" }); setPendingStockAction(null); }} type="button">{pendingStockAction === "mark-empty" ? "Mark empty" : "Use stock"}</Button></AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}

