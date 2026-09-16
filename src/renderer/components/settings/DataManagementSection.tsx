import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CheckCircle,
  DownloadSimple,
  ShieldCheck,
  UploadSimple,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  applyDataArchive,
  exportDataArchive,
  previewDataArchive,
  validateDataArchive,
  type DataArchiveApplyResult,
} from "@/lib/api";
import { getPlatform, type RendererPlatform } from "@/lib/platform";
import { invalidateDataManagementQueries } from "@/lib/query-invalidation";
import type {
  ArchivePreviewResult,
  ArchiveValidationResult,
  ConflictBulkDecision,
  ConflictDecision,
  ExportScope,
  ImportMode,
} from "@shared/schemas/data-management-schemas";

import styles from "./settings.module.css";

type DataManagementPlatform = Pick<
  RendererPlatform,
  "runtime" | "capabilities" | "openDataArchive" | "saveDataArchive"
>;

export type DataManagementApi = {
  exportDataArchive: typeof exportDataArchive;
  validateDataArchive: typeof validateDataArchive;
  previewDataArchive: typeof previewDataArchive;
  applyDataArchive: typeof applyDataArchive;
};

export type DataManagementSectionProps = {
  onPreferencesRestored?: () => void;
  onResetPreferences?: () => Promise<void>;
  resettingPreferences?: boolean;
  platform?: DataManagementPlatform;
  api?: DataManagementApi;
};

type OperationStatus = "idle" | "working" | "success" | "error" | "canceled";
type ImportStatus =
  | "idle"
  | "validating"
  | "previewing"
  | "ready"
  | "applying"
  | "success"
  | "invalid"
  | "error"
  | "canceled";
type ConflictChoice = ConflictDecision["decision"];

export const DATA_MANAGEMENT_SCOPE_OPTIONS: Array<{
  value: ExportScope;
  label: string;
  description: string;
  includes: string[];
}> = [
  {
    value: "meal-plan",
    label: "Meal plan",
    description: "Planning data and recipes needed by scheduled meals.",
    includes: [
      "Scheduled and unscheduled meals",
      "Meal types and profiles",
      "Referenced recipes and meal photos",
    ],
  },
  {
    value: "recipes",
    label: "Recipes",
    description: "The recipe library without meal-plan or household data.",
    includes: ["Recipes and ingredients", "Tags, links, and lineage"],
  },
  {
    value: "all",
    label: "All user data",
    description: "A complete content backup with safe preferences included.",
    includes: [
      "Meals, recipes, grocery, and prep lists",
      "Checked states and meal photos",
      "Allowlisted preferences, never secrets",
    ],
  },
];

const DEFAULT_API: DataManagementApi = {
  exportDataArchive,
  validateDataArchive,
  previewDataArchive,
  applyDataArchive,
};

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "The data management operation could not be completed.";
}

function getDomainLabel(domain: string) {
  return domain
    .replace(/-/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getConflictSummary(summary: Record<string, unknown>) {
  const value = summary.title ?? summary.name ?? summary.identity;
  return typeof value === "string" && value.trim() ? value : "Record details";
}

function ScopeSummary({ scope }: { scope: ExportScope }) {
  const option = DATA_MANAGEMENT_SCOPE_OPTIONS.find(
    (entry) => entry.value === scope
  );

  if (!option) return null;

  return (
    <div className={styles.dataManagementScopeSummary}>
      <span className={styles.dataManagementSummaryLabel}>Includes</span>
      <ul>
        {option.includes.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function SummaryCounts({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).filter(([, count]) => count > 0);

  if (entries.length === 0) {
    return <span className={styles.dataManagementMuted}>None</span>;
  }

  return (
    <ul className={styles.dataManagementCountList}>
      {entries.map(([domain, count]) => (
        <li key={domain}>
          <strong>{count}</strong> {getDomainLabel(domain)}
        </li>
      ))}
    </ul>
  );
}

function ConflictReview({
  conflicts,
  decisions,
  onDecision,
  onBulkDecision,
}: {
  conflicts: ArchivePreviewResult["conflicts"];
  decisions: Record<string, ConflictChoice>;
  onDecision: (conflictId: string, decision: ConflictChoice) => void;
  onBulkDecision: (decision: ConflictBulkDecision) => void;
}) {
  return (
    <section
      className={styles.dataManagementSubsection}
      aria-labelledby="data-management-conflicts"
    >
      <div className={styles.dataManagementSectionHeading}>
        <div>
          <h3 id="data-management-conflicts">Review merge conflicts</h3>
          <p className={styles.fieldHint}>
            Choose an action for every conflict before any records are changed.
          </p>
        </div>
        <span className={styles.dataManagementConflictCount}>
          {conflicts.filter((conflict) => !decisions[conflict.id]).length}{" "}
          unresolved
        </span>
      </div>

      <div
        className={styles.dataManagementBulkActions}
        aria-label="Bulk conflict actions"
      >
        <Button
          onClick={() => onBulkDecision("keep-local")}
          type="button"
          variant="outline"
        >
          Keep all local
        </Button>
        <Button
          onClick={() => onBulkDecision("import")}
          type="button"
          variant="outline"
        >
          Import all
        </Button>
        <Button
          onClick={() => onBulkDecision("skip")}
          type="button"
          variant="outline"
        >
          Skip all
        </Button>
      </div>

      <div className={styles.dataManagementConflictList}>
        {conflicts.map((conflict) => (
          <div className={styles.dataManagementConflict} key={conflict.id}>
            <div className={styles.dataManagementConflictCopy}>
              <strong>{conflict.identity}</strong>
              <span>
                {getDomainLabel(conflict.domain)}: local "
                {getConflictSummary(conflict.localSummary)}"; incoming "
                {getConflictSummary(conflict.importedSummary)}"
              </span>
            </div>
            <label className={styles.dataManagementDecisionLabel}>
              <span className={styles.srOnly}>
                Decision for {conflict.identity}
              </span>
              <select
                aria-label={`Decision for ${conflict.identity}`}
                className={styles.select}
                onChange={(event) =>
                  onDecision(conflict.id, event.target.value as ConflictChoice)
                }
                value={decisions[conflict.id] ?? ""}
              >
                <option disabled value="">
                  Choose an action
                </option>
                <option value="keep-local">Keep local</option>
                <option value="import">Import incoming</option>
                <option value="replace">Replace local</option>
                <option value="skip">Skip record</option>
              </select>
            </label>
          </div>
        ))}
      </div>
    </section>
  );
}

function ImportSummary({
  result,
  backupPath,
}: {
  result: DataArchiveApplyResult;
  backupPath: string | null;
}) {
  const { summary } = result;

  return (
    <div
      className={styles.dataManagementSuccess}
      role="status"
      aria-live="polite"
    >
      <div className={styles.dataManagementStatusHeading}>
        <CheckCircle aria-hidden="true" size={22} weight="fill" />
        <strong>
          {summary.mode === "replace" ? "Restore complete" : "Import complete"}
        </strong>
      </div>
      <div className={styles.dataManagementResultGrid}>
        <span>
          Imported <strong>{summary.imported}</strong>
        </span>
        <span>
          Skipped <strong>{summary.skipped}</strong>
        </span>
        <span>
          Replaced <strong>{summary.replaced}</strong>
        </span>
        <span>
          Conflicts <strong>{summary.conflicts}</strong>
        </span>
        <span>
          Photos imported <strong>{summary.assets.imported}</strong>
        </span>
      </div>
      {summary.preferencesRestored ? (
        <p>
          Safe preferences were restored and local Settings drafts were
          refreshed.
        </p>
      ) : null}
      {backupPath ? (
        <p className={styles.dataManagementBackupNote}>
          Recovery backup created at <strong>{backupPath}</strong>.
        </p>
      ) : null}
    </div>
  );
}

function PreferenceResetSection({
  onResetPreferences,
  resettingPreferences,
}: {
  onResetPreferences: () => Promise<void>;
  resettingPreferences: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "working" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const handleReset = async () => {
    if (status === "working" || resettingPreferences) return;
    setStatus("working");
    setError(null);
    try {
      await onResetPreferences();
      setStatus("success");
    } catch (resetError) {
      setStatus("error");
      setError(getErrorMessage(resetError));
    }
  };

  return (
    <section className={styles.card} aria-labelledby="data-management-reset">
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle} id="data-management-reset">
          Reset preferences
        </h2>
        <p className={styles.cardDescription}>
          Restore household and planning preferences to their defaults.
          Recipes, meals, meal plans, archives, and device settings stay
          unchanged.
        </p>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            disabled={resettingPreferences || status === "working"}
            type="button"
            variant="danger"
          >
            {resettingPreferences || status === "working"
              ? "Resetting preferences..."
              : "Reset preferences"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset preferences?</AlertDialogTitle>
            <AlertDialogDescription>
              This restores editable household and planning preferences to
              their defaults. Your recipes, meals, meal plans, archives, and
              device settings will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                disabled={resettingPreferences || status === "working"}
                onClick={() => void handleReset()}
                type="button"
                variant="danger"
              >
                Confirm reset
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {status === "success" ? (
        <p className={styles.dataManagementSuccess} role="status">
          Preferences reset to their defaults.
        </p>
      ) : null}
      {status === "error" ? (
        <p className={styles.dataManagementError} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export function DataManagementSection({
  onPreferencesRestored,
  onResetPreferences,
  resettingPreferences = false,
  platform: platformOverride,
  api = DEFAULT_API,
}: DataManagementSectionProps) {
  const platform = platformOverride ?? getPlatform();
  const queryClient = useQueryClient();
  const operationRef = useRef(0);
  const [scope, setScope] = useState<ExportScope>("all");
  const [history, setHistory] = useState<"state" | "full">("state");
  const [exportStatus, setExportStatus] = useState<OperationStatus>("idle");
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportFileName, setExportFileName] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<ImportStatus>("idle");
  const [importError, setImportError] = useState<string | null>(null);
  const [archiveBytes, setArchiveBytes] = useState<Uint8Array | null>(null);
  const [archiveFileName, setArchiveFileName] = useState<string | null>(null);
  const [validation, setValidation] = useState<ArchiveValidationResult | null>(
    null
  );
  const [preview, setPreview] = useState<ArchivePreviewResult | null>(null);
  const [mode, setMode] = useState<ImportMode>("merge");
  const [restorePreferences, setRestorePreferences] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, ConflictChoice>>(
    {}
  );
  const [bulkDecision, setBulkDecision] = useState<
    ConflictBulkDecision | undefined
  >();
  const [applyResult, setApplyResult] = useState<DataArchiveApplyResult | null>(
    null
  );
  const [replaceDialogOpen, setReplaceDialogOpen] = useState(false);

  const nextOperation = () => {
    operationRef.current += 1;
    return operationRef.current;
  };

  const isCurrentOperation = (operation: number) =>
    operationRef.current === operation;

  const resetImportState = () => {
    setImportError(null);
    setArchiveBytes(null);
    setArchiveFileName(null);
    setValidation(null);
    setPreview(null);
    setDecisions({});
    setBulkDecision(undefined);
    setApplyResult(null);
    setRestorePreferences(false);
  };

  const handleExport = async () => {
    if (!platform.capabilities.dataManagement) return;

    const operation = nextOperation();
    setExportStatus("working");
    setExportError(null);
    setExportFileName(null);

    try {
      const download = await api.exportDataArchive(scope, history);
      if (!isCurrentOperation(operation)) return;

      const saveResult = await platform.saveDataArchive({
        data: new Uint8Array(await download.blob.arrayBuffer()),
        suggestedFileName: download.fileName,
      });
      if (!isCurrentOperation(operation)) return;

      if (saveResult.status === "canceled") {
        setExportStatus("canceled");
        return;
      }

      if (saveResult.status === "error") {
        throw new Error(saveResult.message);
      }

      setExportFileName(download.fileName);
      setExportStatus("success");
    } catch (error) {
      if (!isCurrentOperation(operation)) return;
      setExportError(getErrorMessage(error));
      setExportStatus("error");
    }
  };

  const handleChooseArchive = async () => {
    if (!platform.capabilities.dataManagement) return;

    const operation = nextOperation();
    resetImportState();
    setImportStatus("validating");

    try {
      const openResult = await platform.openDataArchive();
      if (!isCurrentOperation(operation)) return;

      if (openResult.status === "canceled") {
        setImportStatus("canceled");
        return;
      }

      if (openResult.status === "error") {
        throw new Error(openResult.message);
      }

      setArchiveBytes(openResult.data);
      setArchiveFileName(openResult.filePath);
      const validationResult = await api.validateDataArchive(openResult.data);
      if (!isCurrentOperation(operation)) return;
      setValidation(validationResult);

      if (!validationResult.valid) {
        setImportError(
          "This archive did not pass validation. No data was changed."
        );
        setImportStatus("invalid");
        return;
      }

      setImportStatus("previewing");
      const previewResult = await api.previewDataArchive(openResult.data);
      if (!isCurrentOperation(operation)) return;
      setPreview(previewResult);
      setImportStatus("ready");
    } catch (error) {
      if (!isCurrentOperation(operation)) return;
      setImportError(getErrorMessage(error));
      setImportStatus("error");
    }
  };

  const cancelOperation = () => {
    const wasExporting = exportStatus === "working";
    const wasImporting =
      importStatus === "validating" || importStatus === "previewing";
    if (!wasExporting && !wasImporting) return;

    nextOperation();
    if (wasExporting) setExportStatus("canceled");
    if (wasImporting) setImportStatus("canceled");
  };

  const setConflictDecision = (
    conflictId: string,
    decision: ConflictChoice
  ) => {
    setDecisions((current) => ({ ...current, [conflictId]: decision }));
    setBulkDecision(undefined);
  };

  const setBulkConflictDecision = (decision: ConflictBulkDecision) => {
    setBulkDecision(decision);
    setDecisions(
      Object.fromEntries(
        (preview?.conflicts ?? []).map((conflict) => [conflict.id, decision])
      ) as Record<string, ConflictChoice>
    );
  };

  const runApply = async () => {
    if (!archiveBytes || !preview) return;

    const operation = nextOperation();
    setImportStatus("applying");
    setImportError(null);

    try {
      const result = await api.applyDataArchive(archiveBytes, {
        mode,
        idMap: preview.idMap,
        restorePreferences: mode === "replace" && restorePreferences,
        decisions: Object.entries(decisions).map(([conflictId, decision]) => ({
          conflictId,
          decision,
        })),
        bulkDecision,
      });
      if (!isCurrentOperation(operation)) return;

      await invalidateDataManagementQueries(queryClient);
      setApplyResult(result);
      setImportStatus("success");
      if (result.summary.preferencesRestored) {
        onPreferencesRestored?.();
      }
    } catch (error) {
      if (!isCurrentOperation(operation)) return;
      setImportError(getErrorMessage(error));
      setImportStatus("error");
    }
  };

  const handleApply = () => {
    if (mode === "replace") {
      setReplaceDialogOpen(true);
      return;
    }
    void runApply();
  };

  const replaceAllowed = validation?.manifest?.scope === "all";
  const unresolvedConflicts =
    preview?.conflicts.filter((conflict) => !decisions[conflict.id]).length ??
    0;
  const canApply =
    importStatus === "ready" &&
    Boolean(archiveBytes && preview) &&
    (mode === "replace" || unresolvedConflicts === 0);

  if (!platform.capabilities.dataManagement) {
    return (
      <div className={styles.dataManagementStack}>
        <div className={styles.dataManagementUnsupported} role="status">
          <Archive aria-hidden="true" size={24} weight="duotone" />
          <div>
            <h2>Data backup and restore requires the desktop app</h2>
            <p>
              Browser and LAN sessions cannot open or save local archive files.
              Use the Electron desktop app for full backup, validation, and
              restore.
            </p>
          </div>
        </div>
        {onResetPreferences ? (
          <PreferenceResetSection
            onResetPreferences={onResetPreferences}
            resettingPreferences={resettingPreferences}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className={styles.dataManagementStack}>
      <div className={styles.dataManagementIntro}>
        <div className={styles.dataManagementIntroIcon} aria-hidden="true">
          <Archive size={24} weight="duotone" />
        </div>
        <div>
          <h2>Backup and restore</h2>
          <p>
            Create a versioned archive for this household or restore one from a
            previous Local Recipe Book installation. Credentials, API tokens,
            and device secrets are never included.
          </p>
        </div>
      </div>

      <section className={styles.card} aria-labelledby="data-management-export">
        <div className={styles.cardHeader}>
          <div className={styles.cardTitleRow}>
            <h2 className={styles.cardTitle} id="data-management-export">
              Export an archive
            </h2>
            <span className={styles.dataManagementBadge}>Desktop only</span>
          </div>
          <p className={styles.cardDescription}>
            Choose the smallest scope that contains what you need. Meal-plan
            archives include recipes referenced by their meals.
          </p>
        </div>

        <fieldset className={styles.dataManagementScopeGrid}>
          <legend className={styles.fieldLabel}>Export scope</legend>
          {DATA_MANAGEMENT_SCOPE_OPTIONS.map((option) => (
            <label
              className={styles.dataManagementScopeCard}
              data-selected={scope === option.value}
              key={option.value}
            >
              <input
                checked={scope === option.value}
                name="data-management-scope"
                onChange={() => setScope(option.value)}
                type="radio"
                value={option.value}
              />
              <span>
                <strong>{option.label}</strong>
                <span>{option.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <ScopeSummary scope={scope} />

        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel} htmlFor="data-management-history">
            Pantry archive history
          </label>
          <select
            className={styles.select}
            id="data-management-history"
            onChange={(event) => setHistory(event.target.value as "state" | "full")}
            value={history}
          >
            <option value="state">Current Pantry state only</option>
            <option value="full">Current state and full inventory history</option>
          </select>
        </div>

        <div className={styles.dataManagementActions}>
          <Button
            disabled={exportStatus === "working"}
            onClick={() => void handleExport()}
            type="button"
          >
            <DownloadSimple aria-hidden="true" size={18} />
            {exportStatus === "working"
              ? "Creating archive..."
              : "Export data archive"}
          </Button>
          {exportStatus === "working" ? (
            <Button onClick={cancelOperation} type="button" variant="outline">
              Cancel export
            </Button>
          ) : null}
        </div>

        {exportStatus === "success" ? (
          <div
            className={styles.dataManagementSuccess}
            role="status"
            aria-live="polite"
          >
            <CheckCircle aria-hidden="true" size={20} weight="fill" />
            Archive saved as <strong>{exportFileName}</strong>.
          </div>
        ) : null}
        {exportStatus === "canceled" ? (
          <div
            className={styles.dataManagementNotice}
            role="status"
            aria-live="polite"
          >
            Export canceled before the archive was saved.
          </div>
        ) : null}
        {exportStatus === "error" ? (
          <div className={styles.dataManagementError} role="alert">
            <XCircle aria-hidden="true" size={20} weight="fill" />
            {exportError}
          </div>
        ) : null}
      </section>

      <section className={styles.card} aria-labelledby="data-management-import">
        <div className={styles.cardHeader}>
          <div className={styles.cardTitleRow}>
            <h2 className={styles.cardTitle} id="data-management-import">
              Import and restore
            </h2>
            <ShieldCheck
              aria-hidden="true"
              className={styles.dataManagementSafeIcon}
              size={20}
            />
          </div>
          <p className={styles.cardDescription}>
            The archive is validated before mutation. Merge is the safe default;
            replace requires an all-data archive, a recovery backup, and
            explicit confirmation.
          </p>
        </div>

        <div className={styles.dataManagementActions}>
          <Button
            disabled={
              importStatus === "validating" ||
              importStatus === "previewing" ||
              importStatus === "applying"
            }
            onClick={() => void handleChooseArchive()}
            type="button"
            variant="outline"
          >
            <UploadSimple aria-hidden="true" size={18} />
            Choose backup archive
          </Button>
          {importStatus === "validating" || importStatus === "previewing" ? (
            <Button onClick={cancelOperation} type="button" variant="outline">
              Cancel import
            </Button>
          ) : null}
          {archiveFileName ? (
            <span className={styles.dataManagementFileName}>
              {archiveFileName}
            </span>
          ) : null}
        </div>

        {importStatus === "validating" ? (
          <div
            className={styles.dataManagementNotice}
            role="status"
            aria-live="polite"
          >
            Validating archive before reading its contents...
          </div>
        ) : null}
        {importStatus === "previewing" ? (
          <div
            className={styles.dataManagementNotice}
            role="status"
            aria-live="polite"
          >
            Building a non-mutating conflict preview...
          </div>
        ) : null}
        {importStatus === "canceled" ? (
          <div
            className={styles.dataManagementNotice}
            role="status"
            aria-live="polite"
          >
            Import canceled. No changes were applied.
          </div>
        ) : null}
        {importStatus === "error" ? (
          <div className={styles.dataManagementError} role="alert">
            <XCircle aria-hidden="true" size={20} weight="fill" />
            {importError}
          </div>
        ) : null}

        {validation ? (
          <div
            className={
              validation.valid
                ? styles.dataManagementValidationSuccess
                : styles.dataManagementValidationError
            }
            role={validation.valid ? "status" : "alert"}
          >
            {validation.valid ? (
              <CheckCircle aria-hidden="true" size={20} weight="fill" />
            ) : (
              <WarningCircle aria-hidden="true" size={20} weight="fill" />
            )}
            <div>
              <strong>
                {validation.valid
                  ? "Archive validated"
                  : "Archive validation failed"}
              </strong>
              {validation.valid ? (
                <p>
                  {validation.counts.entries} entries,{" "}
                  {validation.counts.assets} photo assets, and{" "}
                  {validation.counts.uncompressedBytes.toLocaleString()} bytes
                  unpacked.
                </p>
              ) : (
                <ul>
                  {validation.errors.map((error, index) => (
                    <li key={`${error.code}-${index}`}>
                      {error.message}
                      {error.entryPath ? ` (${error.entryPath})` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}

        {preview ? (
          <>
            <div className={styles.dataManagementPreviewGrid}>
              <div>
                <span className={styles.dataManagementSummaryLabel}>
                  Incoming records
                </span>
                <SummaryCounts counts={preview.summary.imported} />
              </div>
              <div>
                <span className={styles.dataManagementSummaryLabel}>
                  Matching local records
                </span>
                <SummaryCounts counts={preview.summary.local} />
              </div>
            </div>

            <fieldset className={styles.dataManagementModeGrid}>
              <legend className={styles.fieldLabel}>Restore mode</legend>
              <label className={styles.dataManagementModeOption}>
                <input
                  checked={mode === "merge"}
                  name="data-management-mode"
                  onChange={() => setMode("merge")}
                  type="radio"
                  value="merge"
                />
                <span>
                  <strong>Merge into current data</strong>
                  <span>
                    Review conflicts and choose what happens per record.
                  </span>
                </span>
              </label>
              <label
                className={styles.dataManagementModeOption}
                data-disabled={!replaceAllowed}
              >
                <input
                  checked={mode === "replace"}
                  disabled={!replaceAllowed}
                  name="data-management-mode"
                  onChange={() => {
                    setMode("replace");
                    setRestorePreferences(false);
                  }}
                  type="radio"
                  value="replace"
                />
                <span>
                  <strong>Replace current content</strong>
                  <span>
                    {replaceAllowed
                      ? "Requires explicit confirmation and creates a recovery backup."
                      : "Available only for an all-data archive."}
                  </span>
                </span>
              </label>
            </fieldset>

            {mode === "replace" ? (
              <label className={styles.dataManagementPreferenceToggle}>
                <input
                  checked={restorePreferences}
                  onChange={(event) =>
                    setRestorePreferences(event.target.checked)
                  }
                  type="checkbox"
                />
                <span>
                  <strong>Restore safe preferences</strong>
                  <span>
                    Off by default. Only the allowlisted household and planning
                    preferences are restored; credentials and device settings
                    stay local.
                  </span>
                </span>
              </label>
            ) : null}

            {mode === "merge" && preview.conflicts.length > 0 ? (
              <ConflictReview
                conflicts={preview.conflicts}
                decisions={decisions}
                onBulkDecision={setBulkConflictDecision}
                onDecision={setConflictDecision}
              />
            ) : null}

            {mode === "merge" && preview.conflicts.length === 0 ? (
              <div className={styles.dataManagementNotice} role="status">
                No conflicts detected. The archive is ready to merge.
              </div>
            ) : null}

            {mode === "replace" ? (
              <div className={styles.dataManagementWarning}>
                <WarningCircle aria-hidden="true" size={20} weight="fill" />
                Replace removes current content after validation. A recoverable
                backup is created first, and preferences remain local unless you
                opt in.
              </div>
            ) : null}

            <div className={styles.dataManagementActions}>
              <Button disabled={!canApply} onClick={handleApply} type="button">
                {mode === "replace" ? "Replace current data" : "Apply merge"}
              </Button>
              {!canApply && mode === "merge" && unresolvedConflicts > 0 ? (
                <span className={styles.fieldHint}>
                  Resolve all {unresolvedConflicts} conflicts to continue.
                </span>
              ) : null}
            </div>
          </>
        ) : null}

        {importStatus === "applying" ? (
          <div
            className={styles.dataManagementNotice}
            role="status"
            aria-live="polite"
          >
            Applying validated changes...
          </div>
        ) : null}
        {importStatus === "success" && applyResult ? (
          <ImportSummary
            result={applyResult}
            backupPath={applyResult.backupPath ?? null}
          />
        ) : null}
      </section>

        {onResetPreferences ? (
          <PreferenceResetSection
            onResetPreferences={onResetPreferences}
            resettingPreferences={resettingPreferences}
          />
        ) : null}

      <AlertDialog open={replaceDialogOpen} onOpenChange={setReplaceDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace current data?</AlertDialogTitle>
            <AlertDialogDescription>
              This replaces the current content with the validated all-data
              archive. Local Recipe Book will create a recovery backup first.
              This action cannot be undone from the current screen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button type="button" variant="outline">
                Keep current data
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                onClick={() => void runApply()}
                type="button"
                variant="accent"
              >
                Confirm replacement
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
