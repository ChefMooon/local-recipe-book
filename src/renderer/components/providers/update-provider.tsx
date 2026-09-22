import { createContext, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { useNavigate } from "react-router";

import { useToast } from "./toast-provider";
import { getPlatform, type UpdateInfo, type UpdateProgress, type UpdateState } from "@/lib/platform";

const initialState: UpdateState = { status: "idle" };
const CHANGELOG_URL = "https://github.com/ChefMooon/local-recipe-book/blob/main/CHANGELOG.md";

export function normalizeReleaseNotes(value: unknown): string {
  const toPlainText = (text: string) =>
    text
      .replace(/<[^>]+>/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s*/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "• ")
      .trim();

  if (typeof value === "string" && value.trim()) return toPlainText(value);
  if (Array.isArray(value)) {
    const notes = value
      .map((entry) => {
        if (typeof entry === "string") return entry.trim();
        if (!entry || typeof entry !== "object") return "";
        const item = entry as { version?: unknown; note?: unknown };
        const note = typeof item.note === "string" ? item.note.trim() : "";
        const version = typeof item.version === "string" ? item.version.trim() : "";
        return note ? (version ? `${version}\n${toPlainText(note)}` : toPlainText(note)) : "";
      })
      .filter(Boolean);
    if (notes.length) return notes.join("\n\n");
  }
  return "Release notes are not available for this update.";
}

type UpdateContextValue = {
  supported: boolean;
  state: UpdateState;
  deferredVersion: string | null;
  changelogUrl: string;
  checkForUpdates: () => Promise<unknown>;
  retryUpdate: () => Promise<unknown>;
  downloadUpdate: () => Promise<UpdateState>;
  deferUpdate: (info?: UpdateInfo) => Promise<void>;
  clearDeferredUpdate: () => Promise<void>;
  installUpdate: () => Promise<unknown>;
};

const UpdateContext = createContext<UpdateContextValue | null>(null);

function describeVersion(info: UpdateInfo | undefined): string {
  return info?.version ? `Version ${info.version} is available.` : "A new version is available.";
}

export function clampUpdateProgress(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

export function UpdateProvider({ children }: PropsWithChildren) {
  const navigate = useNavigate();
  const platform = getPlatform();
  const { toast } = useToast();
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<UpdateState>(initialState);
  const [deferredVersion, setDeferredVersion] = useState<string | null>(null);
  const toastKeysRef = useRef(new Set<string>());
  const eventVersionRef = useRef(0);

  useEffect(() => {
    if (typeof platform.getUpdatesSupported !== "function") return;
    let mounted = true;
    let cleanup: (() => void) | undefined;

    void platform.getUpdatesSupported().then((isSupported) => {
      if (!mounted || !isSupported) return;
      setSupported(true);

      // Subscribe before replaying state so no event can be lost between the two operations.
      cleanup = platform.subscribeUpdates({
        onAvailable: (info) => {
          eventVersionRef.current += 1;
          setState({ status: "available", info });
        },
        onProgress: (progress: UpdateProgress) => {
          eventVersionRef.current += 1;
          setState((current) => ({
            status: "downloading",
            info: current.info ?? {},
            progress,
          }));
        },
        onDownloaded: (info) => {
          eventVersionRef.current += 1;
          setState({ status: "downloaded", info });
        },
        onNotAvailable: () => {
          eventVersionRef.current += 1;
          setState({ status: "not-available" });
        },
        onError: (message) => {
          eventVersionRef.current += 1;
          setState((current) => ({
            status: "error",
            info: "info" in current ? current.info : undefined,
            progress: "progress" in current ? current.progress : undefined,
            error: message,
          }));
        },
      });

      const replayVersion = eventVersionRef.current;
      void Promise.all([
        platform.getUpdateState(),
        platform.getSetting("updates_deferred_version"),
      ]).then(([next, deferred]) => {
        if (!mounted) return;
        if (eventVersionRef.current === replayVersion) {
          setState(next);
        }
        setDeferredVersion(
          typeof deferred === "string" && deferred.trim() ? deferred.trim() : null
        );
      }).catch(() => {});
    }).catch(() => {});

    return () => {
      mounted = false;
      cleanup?.();
    };
  }, [platform]);

  useEffect(() => {
    if (!supported) return;
    const version = "info" in state ? state.info?.version ?? "" : "";
    const key = `${state.status}:${version}:${"error" in state ? state.error : ""}`;
    if (toastKeysRef.current.has(key)) return;
    if (state.status === "available") {
      toastKeysRef.current.add(key);
      toast({
        title: "Update available",
        description: `${describeVersion(state.info)} Review the release notes before downloading.`,
        duration: 9000,
        action: {
          label: "Open Settings",
          onClick: () => {
            navigate("/settings", { state: { focus: "updates" } });
          },
        },
      });
    } else if (state.status === "downloaded") {
      toastKeysRef.current.add(key);
      toast({
        title: "Update ready",
        description: describeVersion(state.info),
        duration: 0,
        action: {
          label: "Install & Restart",
          onClick: async () => {
            try {
              await platform.installUpdate();
            } catch (error) {
              toast({
                title: "Update installation failed",
                description: error instanceof Error ? error.message : "Could not install the update.",
                variant: "error",
              });
            }
          },
        },
      });
    } else if (state.status === "error") {
      toastKeysRef.current.add(key);
      toast({
        title: "Update failed",
        description: state.error,
        variant: "error",
      });
    }
  }, [navigate, platform, state, supported, toast]);

  const value = useMemo<UpdateContextValue>(
    () => ({
      supported,
      state,
      deferredVersion,
      changelogUrl: CHANGELOG_URL,
      checkForUpdates: async () => {
        const result = await platform.checkForUpdates();
        setDeferredVersion(null);
        return result;
      },
      retryUpdate: async () => {
        const result = await platform.checkForUpdates();
        setDeferredVersion(null);
        return result;
      },
      downloadUpdate: async () => {
        const next = await platform.downloadUpdate();
        setState(next);
        return next;
      },
      deferUpdate: async (info) => {
        const version = info?.version ?? ("info" in state ? state.info?.version : undefined);
        if (!version) return;
        await platform.setSetting("updates_deferred_version", version);
        setDeferredVersion(version);
        setState({
          status: "deferred",
          info: info ?? ("info" in state ? state.info ?? {} : {}),
        });
      },
      clearDeferredUpdate: async () => {
        await platform.setSetting("updates_deferred_version", null);
        setDeferredVersion(null);
      },
      installUpdate: platform.installUpdate,
    }),
    [deferredVersion, platform, state, supported]
  );

  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>;
}

export function useUpdates(): UpdateContextValue {
  const context = useContext(UpdateContext);
  if (!context) throw new Error("useUpdates must be used within UpdateProvider");
  return context;
}
