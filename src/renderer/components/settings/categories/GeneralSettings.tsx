import { useId, useState } from "react";

import { CollapsibleSection } from "../CollapsibleSection";
import styles from "../settings.module.css";
import { ToggleSwitch } from "../ToggleSwitch";
import { Button } from "@/components/ui/button";
import { ModalShell } from "@/components/ui/ModalShell";
import {
  clampUpdateProgress,
  normalizeReleaseNotes,
} from "@/components/providers/update-provider";
import type { UpdateState } from "@/lib/platform";
import type { PlatformCapabilities, RuntimeMode } from "@/lib/platform/types";
import { CategorySettingsPanel } from "./CategorySettingsPanel";

export type GeneralDiagnostics = {
  version: string;
  serverRunning: boolean;
  lanRunning: boolean | null;
};

export type GeneralSettingsProps = {
  active: boolean;
  ariaLabelledBy: string;
  capabilities: PlatformCapabilities;
  checkingForUpdates: boolean;
  closeToTray: boolean;
  description: string;
  diagnostics: GeneralDiagnostics | null;
  id: string;
  launchAtLogin: boolean;
  launchMinimized: boolean;
  lifecycleUnavailableReason: string | null;
  rememberWindowState: boolean;
  runtime: RuntimeMode;
  updateState: UpdateState;
  deferredVersion: string | null;
  changelogUrl: string;
  updatesCheckOnStartup: boolean;
  updatesSupported: boolean;
  onCheckForUpdates: () => void;
  onDownloadUpdate: () => void;
  onDeferUpdate: () => void;
  onRetryUpdate: () => void;
  onCloseToTrayChange: (checked: boolean) => void;
  onInstallUpdate: () => void;
  onLaunchAtLoginChange: (checked: boolean) => void;
  onLaunchMinimizedChange: (checked: boolean) => void;
  onRememberWindowStateChange: (checked: boolean) => void;
  onResetWindowLayout: () => void;
  onUpdatesCheckOnStartupChange: (checked: boolean) => void;
};

function ToggleRow(props: {
  checked: boolean;
  label: string;
  description: string;
  onChange: (checked: boolean) => void;
}) {
  const labelId = useId();

  return (
    <div className={styles.toggleRow}>
      <div className={styles.toggleCopy}>
        <div className={styles.toggleLabel} id={labelId}>
          {props.label}
        </div>
        <div className={styles.toggleDescription}>{props.description}</div>
      </div>
      <ToggleSwitch
        checked={props.checked}
        labelId={labelId}
        onChange={props.onChange}
      />
    </div>
  );
}

export function GeneralSettings({
  active,
  ariaLabelledBy,
  capabilities,
  checkingForUpdates,
  closeToTray,
  description,
  diagnostics,
  id,
  launchAtLogin,
  launchMinimized,
  lifecycleUnavailableReason,
  onCheckForUpdates,
  onCloseToTrayChange,
  onDownloadUpdate,
  onDeferUpdate,
  onInstallUpdate,
  onLaunchAtLoginChange,
  onLaunchMinimizedChange,
  onRememberWindowStateChange,
  onResetWindowLayout,
  onRetryUpdate,
  onUpdatesCheckOnStartupChange,
  rememberWindowState,
  runtime,
  updateState,
  deferredVersion,
  changelogUrl,
  updatesCheckOnStartup,
  updatesSupported,
}: GeneralSettingsProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const updateInfo = "info" in updateState ? updateState.info : undefined;
  const progress = "progress" in updateState
    ? clampUpdateProgress(updateState.progress?.percent)
    : null;
  return (
    <CategorySettingsPanel
      active={active}
      ariaLabelledBy={ariaLabelledBy}
      description={description}
      id={id}
    >
      <CollapsibleSection id="general" label="General">
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Application behavior</h2>
            <p className={styles.cardDescription}>
              Set how Local Recipe Book behaves on this device.
            </p>
          </div>
          {capabilities.lifecycle ? (
            <div className={styles.toggleList} style={{ marginTop: "1rem" }}>
              <ToggleRow
                checked={closeToTray}
                description="Hide the window and keep the app, server, and tray icon running when you close it."
                label="Close to tray"
                onChange={onCloseToTrayChange}
              />
              <ToggleRow
                checked={launchAtLogin}
                description="Start Local Recipe Book when you sign in to your computer."
                label="Launch at login"
                onChange={onLaunchAtLoginChange}
              />
              <ToggleRow
                checked={launchMinimized}
                description="Start hidden in the tray instead of opening the main window."
                label="Launch minimized"
                onChange={onLaunchMinimizedChange}
              />
              <ToggleRow
                checked={rememberWindowState}
                description="Reopen the main window at its last position, size, and maximize state."
                label="Remember window layout"
                onChange={onRememberWindowStateChange}
              />
              <div className={styles.actionsRow}>
                <Button
                  onClick={onResetWindowLayout}
                  type="button"
                  variant="outline"
                >
                  Reset window layout
                </Button>
              </div>
            </div>
          ) : (
            <p className={styles.fieldHint} style={{ marginTop: "1rem" }}>
              {lifecycleUnavailableReason
                ? ` ${lifecycleUnavailableReason}`
                : ""}
            </p>
          )}
          <div className={styles.toggleList} style={{ marginTop: "1rem" }}>
            <ToggleRow
              checked={updatesCheckOnStartup}
              description="Automatically check for app updates on launch (packaged app only)."
              label="Check for updates at startup"
              onChange={onUpdatesCheckOnStartupChange}
            />
          </div>
          {updatesSupported && (
            <div data-setting-id="updates" style={{ marginTop: "1rem" }} tabIndex={-1}>
              <p className={styles.fieldHint}>
                Update status:{" "}
                {updateState.status === "downloading"
                  ? progress === null
                    ? "Downloading…"
                    : `Downloading ${Math.round(progress)}%`
                  : updateState.status === "downloaded"
                    ? `Ready to install${updateInfo?.version ? ` (v${updateInfo.version})` : ""}`
                    : updateState.status === "available"
                      ? `Available${updateInfo?.version ? ` (v${updateInfo.version})` : ""}`
                      : updateState.status === "deferred"
                        ? `Deferred${updateInfo?.version ? ` (v${updateInfo.version})` : ""}`
                        : updateState.status === "error"
                          ? "Update check failed"
                          : updateState.status === "not-available"
                            ? "No update available"
                            : "Not checked"}
              </p>
              {updateState.status === "downloading" ? (
                <div
                  aria-label={progress === null ? "Update download in progress" : `Update download ${Math.round(progress)}%`}
                  aria-valuemax={progress === null ? undefined : 100}
                  aria-valuemin={progress === null ? undefined : 0}
                  aria-valuenow={progress === null ? undefined : progress}
                  role="progressbar"
                  style={{
                    background: "var(--cream-dark)",
                    borderRadius: "999px",
                    height: "0.45rem",
                    margin: "0.75rem 0",
                    overflow: "hidden",
                  }}
                >
                  <span
                    style={{
                      background: "var(--green)",
                      display: "block",
                      height: "100%",
                      width: progress === null ? "35%" : `${progress}%`,
                    }}
                  />
                </div>
              ) : null}
              <div className={styles.actionsRow}>
                <Button
                  disabled={checkingForUpdates}
                  onClick={onCheckForUpdates}
                  type="button"
                  variant="outline"
                >
                  {checkingForUpdates ? "Checking…" : "Check for updates"}
                </Button>
                {updateInfo && (
                  <Button
                    onClick={() => setDetailsOpen(true)}
                    type="button"
                    variant="outline"
                  >
                    View release notes
                  </Button>
                )}
                {updateState.status === "available" ? (
                  <>
                    <Button onClick={onDownloadUpdate} type="button">
                      Download update
                    </Button>
                    <Button onClick={onDeferUpdate} type="button" variant="ghost">
                      Defer
                    </Button>
                  </>
                ) : null}
                {updateState.status === "deferred" ? (
                  <Button onClick={onCheckForUpdates} type="button" variant="outline">
                    Check again
                  </Button>
                ) : null}
                {updateState.status === "error" ? (
                  <Button onClick={onRetryUpdate} type="button">
                    Retry
                  </Button>
                ) : null}
                {updateState.status === "downloaded" ? (
                  <Button onClick={onInstallUpdate} type="button">
                    Install & Restart
                  </Button>
                ) : null}
              </div>
              {deferredVersion ? (
                <p className={styles.fieldHint}>
                  Version {deferredVersion} is deferred. Use “Check for updates” to review it manually.
                </p>
              ) : null}
              <p className={styles.fieldHint}>
                Read the full history in the{" "}
                <a href={changelogUrl} rel="noopener noreferrer" target="_blank">
                  Local Recipe Book changelog
                </a>
                .
              </p>
            </div>
          )}
        </div>
      </CollapsibleSection>
      <ModalShell
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title={updateInfo?.version ? `What's new in ${updateInfo.version}` : "Update details"}
        subtitle="Review these release notes before downloading or installing the update."
        width="min(720px, calc(100vw - 2rem))"
        footerRight={
          <Button onClick={() => setDetailsOpen(false)} type="button">
            Done
          </Button>
        }
      >
        <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
          {normalizeReleaseNotes(updateInfo?.releaseNotes)}
        </div>
      </ModalShell>
      <CollapsibleSection id="diagnostics" label="Diagnostics">
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Runtime status</h2>
            <p className={styles.cardDescription}>
              Non-sensitive runtime details for troubleshooting. Credentials and
              tokens are never shown here.
            </p>
          </div>
          <div className={styles.twoColumn}>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>App version</label>
              <input
                aria-label="App version"
                className={styles.select}
                readOnly
                value={diagnostics?.version ?? "Unavailable"}
              />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Runtime mode</label>
              <input
                aria-label="Runtime mode"
                className={styles.select}
                readOnly
                value={runtime}
              />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Server status</label>
              <input
                aria-label="Server status"
                className={styles.select}
                readOnly
                value={diagnostics?.serverRunning ? "Running" : "Unavailable"}
              />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>LAN status</label>
              <input
                aria-label="LAN status"
                className={styles.select}
                readOnly
                value={
                  diagnostics?.lanRunning === null
                    ? "Unavailable in browser mode"
                    : diagnostics?.lanRunning
                      ? "Running"
                      : "Stopped"
                }
              />
            </div>
          </div>
        </div>
      </CollapsibleSection>
    </CategorySettingsPanel>
  );
}
