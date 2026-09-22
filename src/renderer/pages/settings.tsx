import {
  useEffect,
  lazy,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router";

import { AppearanceSettings } from "@/components/settings/categories/AppearanceSettings";
import { DataManagementSettings } from "@/components/settings/categories/DataManagementSettings";
import { DietaryProfileSettings } from "@/components/settings/categories/DietaryProfileSettings";
import { GeneralSettings } from "@/components/settings/categories/GeneralSettings";
import { MealPlansSettings } from "@/components/settings/categories/MealPlansSettings";
import { NetworkSettings } from "@/components/settings/categories/NetworkSettings";
import { SettingsSidebar } from "@/components/settings/SettingsSidebar";
import { useToast } from "@/components/providers/toast-provider";
import { useUpdates } from "@/components/providers/update-provider";
import { PageHeader } from "@/components/ui/PageHeader";
import { getPreferences, type SettingsPreferences } from "@/lib/api";
import {
  getCachedConfig,
  isServerConfigReady,
  loadServerConfig,
  resetConfigCache,
} from "@/lib/config";
import { useServerConfig } from "@/lib/use-server-config";
import {
  getPlatform,
  type LanStatus,
  type PairingCodeResult,
} from "@/lib/platform";
import { usePreferences } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import {
  preferenceQueryKey,
  useSettingsController,
} from "@/components/settings/use-settings-controller";
import {
  DEFAULT_RECIPE_DEFAULT_SORT,
  HOME_DASHBOARD_DEFAULTS,
  clampHomeUpcomingDays,
  normalizeHomeBool,
  normalizeHomeDetail,
  normalizeMealBankPlacement,
  normalizeRecipeDefaultSort,
  type ArrayPreferenceField,
  type HomeDashboardSettings,
  type MealBankPlacement,
  type RecipeDefaultSortValue,
} from "@/components/settings/settings-types";
import {
  searchSettings,
  type SettingsSearchItem,
} from "@/components/settings/settings-search";
import type { AppSettingTheme } from "@shared/config/settings";
import styles from "@/components/settings/settings.module.css";

const platform = getPlatform();

const LanQrCodeModal = lazy(async () => {
  const module = await import("@/components/settings/LanQrCodeModal");
  return { default: module.LanQrCodeModal };
});

type TabId =
  | "general"
  | "appearance"
  | "dietary-profile"
  | "meal-plans"
  | "network"
  | "data-management";

export function getInitialSettingsTabId(value: string | null): TabId {
  if (value === "app-settings") return "general";
  return TABS.some((tab) => tab.id === value)
    ? (value as TabId)
    : "general";
}

export function getStoredSettingsTabId(
  storage: Pick<Storage, "getItem">
): TabId {
  return getInitialSettingsTabId(storage.getItem("settings-active-tab"));
}

export function isUpdateSettingsNavigationState(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    "focus" in state &&
    state.focus === "updates"
  );
}

export function getPairingCodeRemainingSeconds(
  expiresAt: string,
  now = Date.now()
): number | null {
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) return null;
  return Math.max(0, Math.ceil((expiry - now) / 1000));
}

export const TABS: Array<{ id: TabId; label: string; panelId: string }> = [
  { id: "general", label: "General", panelId: "panel-general" },
  { id: "appearance", label: "Appearance", panelId: "panel-appearance" },
  {
    id: "dietary-profile",
    label: "Dietary Profile",
    panelId: "panel-dietary-profile",
  },
  { id: "meal-plans", label: "Meal Plans", panelId: "panel-meal-plans" },
  { id: "network", label: "Network", panelId: "panel-network" },
  {
    id: "data-management",
    label: "Data Management",
    panelId: "panel-data-management",
  },
];

export function getNextSettingsTabId(index: number, key: string): TabId | null {
  let next: number | null = null;
  if (key === "ArrowRight") next = (index + 1) % TABS.length;
  else if (key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
  else if (key === "Home") next = 0;
  else if (key === "End") next = TABS.length - 1;
  return next === null ? null : TABS[next].id;
}

const SETTINGS_SEARCH_ITEMS = [
  ["household-size", "Household size", "Household and serving defaults", ["people", "servings"]],
  ["cooking-length", "Preferred cooking length", "Preferred meal preparation time", ["quick", "weeknight", "relaxed", "weekend"]],
  ["dietary-tags", "Dietary direction", "Dietary needs and restrictions", ["diet", "allergies", "vegan", "vegetarian"]],
  ["favorite-cuisines", "Favorite cuisines", "Cuisines your household enjoys", ["cuisine", "favorites"]],
  ["avoid-cuisines", "Avoid cuisines", "Cuisines your household avoids", ["cuisine", "avoid"]],
  ["avoid-ingredients", "Avoid ingredients", "Allergies or hard avoidances", ["allergy", "ingredients"]],
  ["planning-notes", "Planning notes", "Context used when generating plans", ["notes", "AI", "planning"]],
  ["nutrition-tags", "Nutrition focus", "Nutrition goals and priorities", ["nutrition", "health"]],
  ["skill-level", "Cooking skill level", "Preferred cooking experience", ["skill", "experience"]],
  ["budget-range", "Budget range", "Preferred meal budget", ["budget", "cost"]],
  ["theme", "Theme", "Light, dark, or system appearance", ["appearance", "visual"]],
  ["home-dashboard", "Home Dashboard", "Choose what appears on the home screen", ["home", "dashboard", "overview"]],
  ["meal-bank-placement", "Meal Bank placement", "Where unscheduled meals appear", ["meal bank", "sidecar", "layout"]],
  ["recipe-default-sort", "Recipe library default sort", "Default ordering for Recipes", ["recipes", "sort"]],
  ["default-recipe-view", "Default recipe view", "Default recipe detail presentation", ["recipes", "display"]],
  ["default-unit-mode", "Default unit mode", "Default recipe measurement units", ["recipes", "units", "measurement"]],
  ["desktop-behavior", "Application behavior", "How the app behaves on this device", ["desktop", "device", "lifecycle"]],
  ["updates", "Check for updates at startup", "Automatic packaged-app update checks", ["updates", "startup"], "general"],
  ["diagnostics", "Diagnostics", "Runtime details for troubleshooting", ["runtime", "status", "troubleshooting"]],
  ["connection", "Server connection", "Local or remote server configuration", ["network", "remote", "server"]],
  ["lan-access", "LAN browser access", "Trusted browser access on the local network", ["LAN", "browser", "pairing"]],
  ["data-management", "Data Management", "Versioned archive backup and restore", ["backup", "restore", "archive"]],
].map(([settingId, label, description, keywords, sectionId]) => ({
  settingId,
  categoryId:
    settingId === "connection" || settingId === "lan-access"
      ? "network"
      : settingId === "data-management"
        ? "data-management"
        : settingId === "theme" || settingId === "home-dashboard" || settingId === "meal-bank-placement" || settingId === "recipe-default-sort" || settingId === "default-recipe-view" || settingId === "default-unit-mode"
          ? "appearance"
          : settingId === "desktop-behavior" || settingId === "updates" || settingId === "diagnostics"
            ? "general"
            : settingId === "household-size" || settingId === "cooking-length" || settingId === "dietary-tags" || settingId === "favorite-cuisines" || settingId === "avoid-cuisines" || settingId === "avoid-ingredients" || settingId === "pantry-staples" || settingId === "planning-notes" || settingId === "nutrition-tags" || settingId === "skill-level" || settingId === "budget-range"
              ? "dietary-profile"
              : "meal-plans",
  label,
  description,
  keywords,
  sectionId,
  targetId: settingId,
})) as SettingsSearchItem[];

function clearBrowserTimer(timerRef: MutableRefObject<number | null>) {
  if (timerRef.current !== null) {
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }
}

function toggleValue(values: string[], value: string) {
  return values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];
}

export default function SettingsPage() {
  const location = useLocation();
  const config = useServerConfig();
  const { setThemePreference } = usePreferences();
  const apiReady = isServerConfigReady(config);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const {
    supported: updatesSupported,
    state: updateState,
    checkForUpdates,
    downloadUpdate,
    deferUpdate,
    deferredVersion,
    changelogUrl,
    installUpdate,
  } = useUpdates();
  const preferencesQuery = useQuery({
    queryKey: preferenceQueryKey,
    enabled: apiReady,
    queryFn: getPreferences,
  });
  const preferences = preferencesQuery.data;
  const {
    clearSaveError,
    commitPatch,
    pendingSaves,
    reset: resetSettings,
    resetting: resettingPreferences,
    saveError,
  } = useSettingsController({ preferences });
  const householdTimerRef = useRef<number | null>(null);
  const notesTimerRef = useRef<number | null>(null);
  const [householdSizeDraft, setHouseholdSizeDraft] = useState(2);
  const [householdSizeDirty, setHouseholdSizeDirty] = useState(false);
  const [householdScheduled, setHouseholdScheduled] = useState(false);
  const [planningNotesDraft, setPlanningNotesDraft] = useState("");
  const [planningNotesDirty, setPlanningNotesDirty] = useState(false);
  const [notesScheduled, setNotesScheduled] = useState(false);
  const [connectionDraft, setConnectionDraft] = useState({
    serverUrl: "http://localhost:3001",
    token: "",
    mode: "local" as "local" | "remote",
  });
  const [machineApiKeyDraft, setMachineApiKeyDraft] = useState("");
  const [connectionSaving, setConnectionSaving] = useState(false);
  const [connectionSaved, setConnectionSaved] = useState(false);
  const [updatesCheckOnStartup, setUpdatesCheckOnStartup] = useState(true);
  const [closeToTray, setCloseToTray] = useState(true);
  const [launchMinimized, setLaunchMinimized] = useState(false);
  const [rememberWindowState, setRememberWindowState] = useState(false);
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [themePreference, setThemePreferenceDraft] =
    useState<AppSettingTheme>("system");
  const [lifecycleUnavailableReason, setLifecycleUnavailableReason] = useState<
    string | null
  >(null);
  const [diagnostics, setDiagnostics] = useState<{
    version: string;
    serverRunning: boolean;
    lanRunning: boolean | null;
  } | null>(null);
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);
  const [manualUpdateCheckPending, setManualUpdateCheckPending] =
    useState(false);
  const [lanStatus, setLanStatus] = useState<LanStatus | null>(null);
  const [lanEnabledDraft, setLanEnabledDraft] = useState(false);
  const [lanWebEnabledDraft, setLanWebEnabledDraft] = useState(false);
  const [lanAdvertisedHostDraft, setLanAdvertisedHostDraft] = useState("");
  const [lanSaving, setLanSaving] = useState(false);
  const [lanQrModalOpen, setLanQrModalOpen] = useState(false);
  const [lanPairingCode, setLanPairingCode] =
    useState<PairingCodeResult | null>(null);
  const [lanPairingLoading, setLanPairingLoading] = useState(false);
  const [lanPairingAutoRenew, setLanPairingAutoRenew] = useState(false);
  const [lanPairingRemainingSeconds, setLanPairingRemainingSeconds] = useState<
    number | null
  >(null);
  const [lanPairingError, setLanPairingError] = useState<string | null>(null);
  const [documentVisible, setDocumentVisible] = useState(
    () =>
      typeof document === "undefined" || document.visibilityState === "visible"
  );
  const lanPairingTimerRef = useRef<number | null>(null);
  const lanPairingGenerationRef = useRef(0);
  const lanPairingRequestRef = useRef(false);
  const [mealBankPlacement, setMealBankPlacement] =
    useState<MealBankPlacement>("right");
  const [recipeDefaultSort, setRecipeDefaultSort] =
    useState<RecipeDefaultSortValue>(DEFAULT_RECIPE_DEFAULT_SORT);
  const [homeDashboard, setHomeDashboard] = useState<HomeDashboardSettings>(
    HOME_DASHBOARD_DEFAULTS
  );

  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const detailPaneRef = useRef<HTMLDivElement | null>(null);
  const normalizeLanAdvertisedHostDraft = (
    advertisedHost: string,
    candidates: LanStatus["candidates"]
  ) => {
    const trimmed = advertisedHost.trim();
    const fallback = candidates[0]?.address ?? trimmed;
    if (!trimmed || trimmed === "127.0.0.1" || trimmed === "localhost")
      return fallback;
    if (
      candidates.length > 0 &&
      !candidates.some((candidate) => candidate.address === trimmed)
    )
      return fallback;
    return trimmed;
  };
  function getInitialTab(): TabId {
    try {
      return getStoredSettingsTabId(window.sessionStorage);
    } catch {
      return "general";
    }
  }

  const [activeTab, setActiveTabState] = useState<TabId>(getInitialTab);
  const handledNavigationKeyRef = useRef<string | null>(null);

  function setActiveTab(id: TabId) {
    if (id !== "network") {
      lanPairingGenerationRef.current += 1;
      if (lanPairingTimerRef.current !== null) {
        window.clearInterval(lanPairingTimerRef.current);
        lanPairingTimerRef.current = null;
      }
    }
    setActiveTabState(id);
    try {
      window.sessionStorage.setItem("settings-active-tab", id);
    } catch {
      // ignore storage failures
    }
  }

  useEffect(() => {
    detailPaneRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [activeTab]);

  useEffect(() => {
    if (
      !isUpdateSettingsNavigationState(location.state) ||
      handledNavigationKeyRef.current === location.key
    ) {
      return;
    }

    handledNavigationKeyRef.current = location.key;
    setActiveTab("general");
    window.dispatchEvent(
      new CustomEvent("settings-open-section", { detail: "general" })
    );
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-setting-id="updates"]')?.focus();
    });
  }, [location.key, location.state]);

  const [searchQuery, setSearchQuery] = useState("");
  const searchResults = searchSettings(
    SETTINGS_SEARCH_ITEMS,
    TABS,
    searchQuery
  );

  function handleSearchResultSelect(result: (typeof searchResults)[number]) {
    setActiveTab(result.categoryId);
    if (result.sectionId) {
      window.dispatchEvent(
        new CustomEvent("settings-open-section", { detail: result.sectionId })
      );
    }
    window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(
        `[data-setting-id="${result.targetId}"]`
      );
      (
        target ??
        document.getElementById(`settings-category-${result.categoryId}`)
      )?.focus();
    });
  }

  function handleTabKeyDown(
    e: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ) {
    const nextTabId = getNextSettingsTabId(index, e.key);
    if (nextTabId !== null) {
      e.preventDefault();
      const nextIndex = TABS.findIndex((tab) => tab.id === nextTabId);
      setActiveTab(nextTabId);
      tabRefs.current[nextIndex]?.focus();
    }
  }

  // Load connection config on mount
  useEffect(() => {
    const cached = getCachedConfig();
    if (cached) {
      setConnectionDraft({
        serverUrl: cached.url,
        token: cached.token,
        mode: cached.mode,
      });
      return;
    }

    loadServerConfig()
      .then((config) => {
        setConnectionDraft({
          serverUrl: config.url,
          token: config.token,
          mode: config.mode,
        });
      })
      .catch(() => {
        // defaults already set
      });
  }, []);

  useEffect(() => {
    Promise.all([
      platform.getAppVersion(),
      platform.getServerStatus(),
      platform.capabilities.lanManagement
        ? platform.getLanStatus()
        : Promise.resolve(null),
    ])
      .then(([version, serverStatus, lan]) => {
        setDiagnostics({
          version,
          serverRunning: serverStatus.running,
          lanRunning: lan?.api.running ?? null,
        });
      })
      .catch(() => setDiagnostics(null));
  }, []);

  useEffect(() => {
    Promise.all([
      platform.getSetting("app_close_to_tray"),
      platform.getSetting("app_launch_minimized"),
      platform.getSetting("app_remember_window_state"),
      platform.getSetting("ui_theme"),
      platform.getLifecycleStatus(),
    ])
      .then(
        ([
          closeToTrayValue,
          launchMinimizedValue,
          rememberWindowStateValue,
          themeValue,
          lifecycle,
        ]) => {
          if (typeof closeToTrayValue === "boolean") {
            setCloseToTray(closeToTrayValue);
          }
          if (typeof launchMinimizedValue === "boolean") {
            setLaunchMinimized(launchMinimizedValue);
          }
          if (typeof rememberWindowStateValue === "boolean") {
            setRememberWindowState(rememberWindowStateValue);
          }
          if (
            themeValue === "light" ||
            themeValue === "dark" ||
            themeValue === "system"
          ) {
            setThemePreferenceDraft(themeValue);
          }
          setLaunchAtLogin(lifecycle.launchAtLogin);
          setLifecycleUnavailableReason(
            lifecycle.supported ? null : (lifecycle.reason ?? null)
          );
        }
      )
      .catch(() => {
        setLifecycleUnavailableReason(
          "Desktop lifecycle settings are unavailable."
        );
      });
  }, []);

  useEffect(() => {
    platform
      .getSetting("machine_api_key")
      .then((value) => {
        if (typeof value === "string") {
          setMachineApiKeyDraft(value);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!platform.capabilities.lanManagement) {
      return;
    }

    platform
      .getLanStatus()
      .then((status) => {
        if (!status) return;
        const advertisedHost = normalizeLanAdvertisedHostDraft(
          status.api.advertisedHost,
          status.candidates
        );
        setLanStatus(status);
        setLanEnabledDraft(status.lanEnabled);
        setLanWebEnabledDraft(status.web.enabled);
        setLanAdvertisedHostDraft(advertisedHost);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    platform
      .getSetting("updates_check_on_startup")
      .then((value) => {
        if (typeof value === "boolean") {
          setUpdatesCheckOnStartup(value);
          return;
        }
        setUpdatesCheckOnStartup(true);
      })
      .catch(() => {
        setUpdatesCheckOnStartup(true);
      });
  }, []);

  useEffect(() => {
    Promise.all([
      platform.getSetting("meal_bank_sidecar_placement"),
      platform.getSetting("recipe_default_sort"),
      platform.getSetting("home_upcoming_days"),
      platform.getSetting("home_upcoming_detail"),
      platform.getSetting("home_upcoming_compact"),
      platform.getSetting("home_show_upcoming_meals"),
      platform.getSetting("home_show_meal_activity"),
      platform.getSetting("home_show_grocery_list"),
      platform.getSetting("home_show_greeting_subtitle"),
    ])
      .then(
        ([
          mealBankPlacementSetting,
          recipeDefaultSortSetting,
          upcomingDays,
          upcomingDetail,
          upcomingCompact,
          showUpcomingMeals,
          showMealActivity,
          showGroceryList,
          showGreetingSubtitle,
        ]) => {
          setMealBankPlacement(
            normalizeMealBankPlacement(mealBankPlacementSetting)
          );
          setRecipeDefaultSort(
            normalizeRecipeDefaultSort(recipeDefaultSortSetting)
          );
          setHomeDashboard({
            upcomingDays: clampHomeUpcomingDays(upcomingDays),
            upcomingDetail: normalizeHomeDetail(upcomingDetail),
            upcomingCompact: normalizeHomeBool(
              upcomingCompact,
              HOME_DASHBOARD_DEFAULTS.upcomingCompact
            ),
            showUpcomingMeals: normalizeHomeBool(
              showUpcomingMeals,
              HOME_DASHBOARD_DEFAULTS.showUpcomingMeals
            ),
            showMealActivity: normalizeHomeBool(
              showMealActivity,
              HOME_DASHBOARD_DEFAULTS.showMealActivity
            ),
            showGroceryList: normalizeHomeBool(
              showGroceryList,
              HOME_DASHBOARD_DEFAULTS.showGroceryList
            ),
            showGreetingSubtitle: normalizeHomeBool(
              showGreetingSubtitle,
              HOME_DASHBOARD_DEFAULTS.showGreetingSubtitle
            ),
          });
        }
      )
      .catch(() => {
        setRecipeDefaultSort(DEFAULT_RECIPE_DEFAULT_SORT);
        setHomeDashboard(HOME_DASHBOARD_DEFAULTS);
      });
  }, []);

  useEffect(() => {
    if (!manualUpdateCheckPending) return;
    if (
      updateState.status === "available" ||
      updateState.status === "downloading" ||
      updateState.status === "downloaded"
    ) {
      setManualUpdateCheckPending(false);
      setCheckingForUpdates(false);
    } else if (updateState.status === "not-available") {
      setManualUpdateCheckPending(false);
      setCheckingForUpdates(false);
      toast({ title: "You are up to date." });
    } else if (updateState.status === "error") {
      setManualUpdateCheckPending(false);
      setCheckingForUpdates(false);
      toast({
        title: "Update check failed",
        description:
          updateState.error || "Could not check for updates right now.",
        variant: "error",
      });
    }
  }, [manualUpdateCheckPending, toast, updateState]);

  useEffect(() => {
    if (!preferences) {
      return;
    }

    if (!householdSizeDirty) {
      setHouseholdSizeDraft(preferences.householdSize);
    }

    if (!planningNotesDirty) {
      setPlanningNotesDraft(preferences.planningNotes);
    }
  }, [preferences, householdSizeDirty, planningNotesDirty]);

  useEffect(() => {
    return () => {
      clearBrowserTimer(householdTimerRef);
      clearBrowserTimer(notesTimerRef);
      if (lanPairingTimerRef.current !== null) {
        window.clearInterval(lanPairingTimerRef.current);
      }
      lanPairingGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setDocumentVisible(document.visibilityState === "visible");
      if (document.visibilityState !== "visible") {
        lanPairingGenerationRef.current += 1;
        if (lanPairingTimerRef.current !== null) {
          window.clearInterval(lanPairingTimerRef.current);
          lanPairingTimerRef.current = null;
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const saveState = useMemo(() => {
    if (pendingSaves > 0 || householdScheduled || notesScheduled) {
      return { label: "Saving…", className: styles.autosaveSaving };
    }

    if (saveError) {
      return { label: "Failed to save", className: styles.autosaveError };
    }

    return { label: "All changes saved", className: styles.autosaveSaved };
  }, [householdScheduled, notesScheduled, pendingSaves, saveError]);

  const scheduleHouseholdSave = (value: number) => {
    setHouseholdSizeDraft(value);
    setHouseholdSizeDirty(true);
    setHouseholdScheduled(true);
    clearSaveError();
    clearBrowserTimer(householdTimerRef);
    householdTimerRef.current = window.setTimeout(async () => {
      setHouseholdScheduled(false);
      try {
        await commitPatch({ householdSize: value }, false);
        setHouseholdSizeDirty(false);
      } catch {
        // pill handles autosave errors
      }
    }, 600);
  };

  const scheduleNotesSave = (value: string) => {
    setPlanningNotesDraft(value);
    setPlanningNotesDirty(true);
    setNotesScheduled(true);
    clearSaveError();
    clearBrowserTimer(notesTimerRef);
    notesTimerRef.current = window.setTimeout(async () => {
      setNotesScheduled(false);
      try {
        await commitPatch({ planningNotes: value }, false);
        setPlanningNotesDirty(false);
      } catch {
        // pill handles autosave errors
      }
    }, 600);
  };

  const handleImmediateArrayToggle = async (
    field: ArrayPreferenceField,
    value: string
  ) => {
    if (!preferences) {
      return;
    }
    await commitPatch({
      [field]: toggleValue(preferences[field], value),
    } as Partial<SettingsPreferences>);
  };

  const handleCuisineToggle = async (
    group: "favoriteCuisines" | "avoidCuisines",
    value: string
  ) => {
    if (!preferences) {
      return;
    }

    const favorites = [...preferences.favoriteCuisines];
    const avoids = [...preferences.avoidCuisines];
    const target = group === "favoriteCuisines" ? favorites : avoids;
    const other = group === "favoriteCuisines" ? avoids : favorites;
    const nextTarget = target.includes(value)
      ? target.filter((entry) => entry !== value)
      : [...target, value];
    const nextOther = other.filter((entry) => entry !== value);

    await commitPatch(
      group === "favoriteCuisines"
        ? { favoriteCuisines: nextTarget, avoidCuisines: nextOther }
        : { favoriteCuisines: nextOther, avoidCuisines: nextTarget }
    );
  };

  const handleChipAdd = async (
    field: "avoidIngredients",
    values: string[]
  ) => {
    if (!preferences) {
      return;
    }

    const merged = [...preferences[field]];
    values.forEach((value) => {
      if (
        !merged.some((entry) => entry.toLowerCase() === value.toLowerCase())
      ) {
        merged.push(value);
      }
    });

    await commitPatch({ [field]: merged } as Partial<SettingsPreferences>);
  };

  const handleChipRemove = async (
    field: "avoidIngredients",
    value: string
  ) => {
    if (!preferences) {
      return;
    }

    await commitPatch({
      [field]: preferences[field].filter((entry) => entry !== value),
    } as Partial<SettingsPreferences>);
  };

  const handleChipReorder = async (
    field: "avoidIngredients",
    values: string[]
  ) => {
    await commitPatch({ [field]: values } as Partial<SettingsPreferences>);
  };

  const handleImmediateField = async <K extends keyof SettingsPreferences>(
    field: K,
    value: SettingsPreferences[K]
  ) => {
    await commitPatch({ [field]: value } as Partial<SettingsPreferences>);
  };

  const handleReset = async () => {
    try {
      clearBrowserTimer(householdTimerRef);
      clearBrowserTimer(notesTimerRef);
      setHouseholdScheduled(false);
      setNotesScheduled(false);
      setHouseholdSizeDirty(false);
      setPlanningNotesDirty(false);
      await resetSettings();
    } catch {
      toast({ title: "Could not reset preferences.", variant: "error" });
    }
  };

  const handlePreferencesRestored = () => {
    clearBrowserTimer(householdTimerRef);
    clearBrowserTimer(notesTimerRef);
    setHouseholdScheduled(false);
    setNotesScheduled(false);
    setHouseholdSizeDirty(false);
    setPlanningNotesDirty(false);
    clearSaveError();
  };

  const handleSaveConnection = async () => {
    setConnectionSaving(true);
    try {
      await platform.setSetting("remote_server_url", connectionDraft.serverUrl);
      await platform.setSetting("remote_api_key", connectionDraft.token);
      await platform.setSetting("server_mode", connectionDraft.mode);
      await platform.setSetting("machine_api_key", machineApiKeyDraft);
      resetConfigCache();
      await loadServerConfig();
      queryClient.clear();
      setConnectionSaved(true);
      window.setTimeout(() => setConnectionSaved(false), 2000);
      toast({ title: "Connection settings saved." });
    } catch {
      toast({ title: "Could not save connection settings.", variant: "error" });
    } finally {
      setConnectionSaving(false);
    }
  };

  const refreshLanStatus = async () => {
    if (!platform.capabilities.lanManagement) return;
    const status = await platform.getLanStatus();
    if (!status) return;
    const advertisedHost = normalizeLanAdvertisedHostDraft(
      status.api.advertisedHost,
      status.candidates
    );
    setLanStatus(status);
    setLanEnabledDraft(status.lanEnabled);
    setLanWebEnabledDraft(status.web.enabled);
    setLanAdvertisedHostDraft(advertisedHost);
  };

  const handleSaveLanSettings = async () => {
    setLanSaving(true);
    try {
      const nextAdvertisedHost = normalizeLanAdvertisedHostDraft(
        lanAdvertisedHostDraft,
        lanStatus?.candidates ?? []
      );
      await platform.setSetting("lan_enabled", lanEnabledDraft);
      await platform.setSetting("lan_web_enabled", lanWebEnabledDraft);
      if (nextAdvertisedHost) {
        await platform.setSetting("lan_advertised_host", nextAdvertisedHost);
      }
      await platform.restartLanServices();
      await refreshLanStatus();
      toast({ title: "LAN settings saved." });
    } catch {
      toast({ title: "Could not save LAN settings.", variant: "error" });
    } finally {
      setLanSaving(false);
    }
  };

  const handleMealBankPlacementChange = async (value: string) => {
    const nextPlacement = normalizeMealBankPlacement(value);
    setMealBankPlacement(nextPlacement);

    try {
      await platform.setSetting("meal_bank_sidecar_placement", nextPlacement);
      toast({ title: "Meal Bank placement saved." });
    } catch {
      toast({ title: "Could not save Meal Bank placement.", variant: "error" });
    }
  };

  const handleRecipeDefaultSortChange = async (value: string) => {
    const nextValue = normalizeRecipeDefaultSort(value);
    const previous = recipeDefaultSort;
    setRecipeDefaultSort(nextValue);

    try {
      await platform.setSetting("recipe_default_sort", nextValue);
      toast({ title: "Recipe sort default saved." });
    } catch {
      setRecipeDefaultSort(previous);
      toast({
        title: "Could not save recipe sort default.",
        variant: "error",
      });
    }
  };

  const handleGenerateMachineToken = async () => {
    try {
      const result = await platform.generateMachineToken();
      setMachineApiKeyDraft(result.token);
      setLanQrModalOpen(false);
      await refreshLanStatus();
      toast({ title: "Machine token generated." });
    } catch {
      toast({ title: "Could not generate token.", variant: "error" });
    }
  };

  const handleRotateMachineToken = async () => {
    const confirmed = window.confirm(
      "Rotate the browser access token? Existing browser bookmarks and saved devices will need to reconnect with the new QR code or connection link."
    );
    if (!confirmed) return;

    try {
      const result = await platform.rotateMachineToken();
      setMachineApiKeyDraft(result.token);
      await refreshLanStatus();
      setLanQrModalOpen(true);
      toast({ title: "Browser access token rotated." });
    } catch {
      toast({ title: "Could not rotate token.", variant: "error" });
    }
  };

  const handleCreateLanPairingCode = async () => {
    await issueLanPairingCode(true);
  };

  const handleCopyLanPairingCode = async () => {
    if (!lanPairingCode) return;
    try {
      await navigator.clipboard.writeText(lanPairingCode.code);
      toast({ title: "Pairing code copied." });
    } catch {
      toast({ title: "Could not copy pairing code.", variant: "error" });
    }
  };

  async function issueLanPairingCode(manual = false) {
    const eligible =
      platform.capabilities.lanManagement &&
      activeTab === "network" &&
      documentVisible &&
      lanPairingAutoRenew;
    if ((!manual && !eligible) || lanPairingRequestRef.current) return;

    const generation = ++lanPairingGenerationRef.current;
    lanPairingRequestRef.current = true;
    setLanPairingLoading(true);
    setLanPairingError(null);
    if (manual) {
      setLanPairingAutoRenew(true);
      setLanPairingCode(null);
      setLanPairingRemainingSeconds(null);
    } else {
      setLanPairingRemainingSeconds(0);
    }

    try {
      const result = await platform.createLanPairingCode();
      if (generation !== lanPairingGenerationRef.current) return;
      if (!result) {
        setLanPairingCode(null);
        setLanPairingRemainingSeconds(null);
        setLanPairingError("Generate a machine token first.");
        toast({ title: "Generate a machine token first.", variant: "error" });
        return;
      }

      const remainingSeconds = getPairingCodeRemainingSeconds(result.expiresAt);
      if (remainingSeconds === null || remainingSeconds === 0) {
        throw new Error("The pairing code had an invalid expiry.");
      }
      setLanPairingCode(result);
      setLanPairingRemainingSeconds(remainingSeconds);
    } catch (error) {
      if (generation !== lanPairingGenerationRef.current) return;
      setLanPairingCode(null);
      setLanPairingRemainingSeconds(null);
      setLanPairingError(
        error instanceof Error && error.message.includes("invalid expiry")
          ? "Could not create a pairing code with a valid expiry."
          : "Could not create pairing code."
      );
      toast({
        title: "Could not create pairing code.",
        variant: "error",
      });
    } finally {
      lanPairingRequestRef.current = false;
      setLanPairingLoading(false);
    }
  }

  useEffect(() => {
    if (lanPairingTimerRef.current !== null) {
      window.clearInterval(lanPairingTimerRef.current);
      lanPairingTimerRef.current = null;
    }

    const eligible =
      platform.capabilities.lanManagement &&
      activeTab === "network" &&
      documentVisible;
    if (!eligible || !lanPairingCode) return;

    const updateCountdown = () => {
      const remaining =
        getPairingCodeRemainingSeconds(lanPairingCode.expiresAt) ?? 0;
      setLanPairingRemainingSeconds(remaining);
      if (
        remaining === 0 &&
        lanPairingAutoRenew &&
        !lanPairingRequestRef.current
      ) {
        void issueLanPairingCode();
      }
    };

    updateCountdown();
    lanPairingTimerRef.current = window.setInterval(updateCountdown, 1000);
    return () => {
      if (lanPairingTimerRef.current !== null) {
        window.clearInterval(lanPairingTimerRef.current);
        lanPairingTimerRef.current = null;
      }
    };
  }, [
    activeTab,
    documentVisible,
    lanPairingAutoRenew,
    lanPairingCode,
    lanPairingLoading,
  ]);

  const browserConnectionUrl =
    lanStatus?.web.url && lanStatus?.api.url && machineApiKeyDraft
      ? `${lanStatus.web.url}/connect#api=${encodeURIComponent(lanStatus.api.url)}&token=${encodeURIComponent(machineApiKeyDraft)}`
      : "";

  const canShowLanQrCode = Boolean(
    lanEnabledDraft &&
    lanWebEnabledDraft &&
    lanStatus?.api.url &&
    lanStatus?.web.url &&
    machineApiKeyDraft &&
    browserConnectionUrl
  );

  const handleToggleStartupUpdateCheck = async (checked: boolean) => {
    const previous = updatesCheckOnStartup;
    setUpdatesCheckOnStartup(checked);

    try {
      await platform.setSetting("updates_check_on_startup", checked);
    } catch {
      setUpdatesCheckOnStartup(previous);
      toast({
        title: "Could not save update check preference.",
        variant: "error",
      });
    }
  };

  const handleThemeChange = async (value: string) => {
    if (value !== "light" && value !== "dark" && value !== "system") return;
    const next = value as AppSettingTheme;
    const previous = themePreference;
    setThemePreferenceDraft(next);
    try {
      await setThemePreference(next);
    } catch {
      setThemePreferenceDraft(previous);
      toast({ title: "Could not save theme preference.", variant: "error" });
    }
  };

  const handleDesktopToggle = async (
    key:
      | "app_close_to_tray"
      | "app_launch_minimized"
      | "app_remember_window_state",
    checked: boolean,
    setValue: (value: boolean) => void,
    label: string
  ) => {
    setValue(checked);
    try {
      await platform.setSetting(key, checked);
    } catch {
      setValue(!checked);
      toast({ title: `Could not save ${label}.`, variant: "error" });
    }
  };

  const handleLaunchAtLogin = async (checked: boolean) => {
    const previous = launchAtLogin;
    setLaunchAtLogin(checked);
    try {
      const status = await platform.setLaunchAtLogin(checked);
      setLaunchAtLogin(status.launchAtLogin);
      setLifecycleUnavailableReason(
        status.supported ? null : (status.reason ?? null)
      );
      if (!status.supported) {
        throw new Error(status.reason);
      }
    } catch {
      setLaunchAtLogin(previous);
      toast({
        title: "Could not save launch-at-login preference.",
        variant: "error",
      });
    }
  };

  const handleResetWindowLayout = async () => {
    try {
      await platform.resetWindowLayout?.();
      toast({ title: "Window layout reset." });
    } catch {
      toast({ title: "Could not reset window layout.", variant: "error" });
    }
  };

  const saveHomeSetting = async <K extends keyof HomeDashboardSettings>(
    key: K,
    value: HomeDashboardSettings[K],
    settingKey: string,
    normalize?: (input: HomeDashboardSettings[K]) => HomeDashboardSettings[K]
  ) => {
    const nextValue = normalize ? normalize(value) : value;
    const previous = homeDashboard[key];

    setHomeDashboard((prev) => ({
      ...prev,
      [key]: nextValue,
    }));

    try {
      await platform.setSetting(settingKey, nextValue);
    } catch {
      setHomeDashboard((prev) => ({
        ...prev,
        [key]: previous,
      }));
      toast({
        title: "Could not save Home Dashboard setting.",
        variant: "error",
      });
    }
  };

  const handleHomeUpcomingDays = async (value: number) => {
    await saveHomeSetting(
      "upcomingDays",
      value,
      "home_upcoming_days",
      (input) => clampHomeUpcomingDays(input)
    );
  };

  const handleHomeDetail = async (value: string) => {
    await saveHomeSetting(
      "upcomingDetail",
      normalizeHomeDetail(value),
      "home_upcoming_detail"
    );
  };

  const handleHomeToggle = async (
    key: keyof Pick<
      HomeDashboardSettings,
      | "upcomingCompact"
      | "showUpcomingMeals"
      | "showMealActivity"
      | "showGroceryList"
      | "showGreetingSubtitle"
    >,
    value: boolean,
    settingKey: string
  ) => {
    await saveHomeSetting(key, value, settingKey);
  };

  const handleCheckForUpdates = async () => {
    setCheckingForUpdates(true);
    setManualUpdateCheckPending(true);

    try {
      const result = await checkForUpdates();
      if (result === null) {
        setManualUpdateCheckPending(false);
        setCheckingForUpdates(false);
        toast({
          title: "Update check failed",
          description: "Could not check for updates right now.",
          variant: "error",
        });
      }
    } catch {
      setManualUpdateCheckPending(false);
      setCheckingForUpdates(false);
      toast({
        title: "Update check failed",
        description: "Could not check for updates right now.",
        variant: "error",
      });
    }
  };

  const handleRetryUpdate = async () => {
    if (updateState.status === "error" && updateState.info) {
      try {
        await downloadUpdate();
      } catch {
        toast({ title: "Could not download update.", variant: "error" });
      }
      return;
    }
    await handleCheckForUpdates();
  };

  if (!preferences) {
    return (
      <div className={styles.page}>
        <PageHeader
          eyebrow="Settings"
          subtitle="Loading your cooking profile and app defaults."
          title="Household preferences"
        />
        <div className={cn(styles.card, styles.loadingCard)}>
          {preferencesQuery.isError
            ? "Unable to load settings right now."
            : "Loading preferences…"}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        actions={
          <div className={cn(styles.autosavePill, saveState.className)}>
            {saveState.label}
          </div>
        }
        eyebrow="Settings"
        subtitle="Tune dietary direction, planning behavior, and the defaults Local Recipe Book uses across your kitchen workflow."
        title="Household preferences"
      />

      <div className={styles.settingsLayout}>
        <SettingsSidebar
          activeCategory={activeTab}
          categories={TABS}
          onCategoryChange={setActiveTab}
          onCategoryKeyDown={handleTabKeyDown}
          onSearchQueryChange={setSearchQuery}
          onSearchResultSelect={handleSearchResultSelect}
          searchQuery={searchQuery}
          searchResults={searchResults}
        />

        <div className={styles.settingsDetailPane} ref={detailPaneRef}>
          <DataManagementSettings
            id="panel-data-management"
            active={activeTab === "data-management"}
            ariaLabelledBy="settings-category-data-management"
            description="Export focused or complete user-data archives and restore them safely on the desktop app."
            onPreferencesRestored={handlePreferencesRestored}
            onResetPreferences={handleReset}
            resettingPreferences={resettingPreferences}
          />

          {/* ── Tab 2: Meal Plans ── */}
          <MealPlansSettings
            id="panel-meal-plans"
            active={activeTab === "meal-plans"}
            ariaLabelledBy="meal-plans"
            description="Manage meal-plan profiles for different routines or seasons."
          ></MealPlansSettings>

          {/* ── Tab 1: Dietary Profile ── */}
          <DietaryProfileSettings
            id="panel-dietary-profile"
            active={activeTab === "dietary-profile"}
            ariaLabelledBy="settings-category-dietary-profile"
            description="Set your household, dietary needs, cuisines, and nutrition goals."
            householdSizeDraft={householdSizeDraft}
            planningNotesDraft={planningNotesDraft}
            preferences={preferences}
            onHouseholdSizeChange={scheduleHouseholdSave}
            onPlanningNotesChange={scheduleNotesSave}
            onImmediateArrayToggle={(field, value) =>
              void handleImmediateArrayToggle(field, value)
            }
            onCuisineToggle={(group, value) =>
              void handleCuisineToggle(group, value)
            }
            onChipAdd={(field, values) => void handleChipAdd(field, values)}
            onChipRemove={(field, value) => void handleChipRemove(field, value)}
            onChipReorder={(field, values) =>
              void handleChipReorder(field, values)
            }
            onImmediateField={(field, value) =>
              void handleImmediateField(field, value)
            }
          />

          {/* ── Tab 3: Recipes ── */}
          <GeneralSettings
            id="panel-general"
            active={activeTab === "general"}
            ariaLabelledBy="settings-category-general"
            description="Configure desktop behavior, update checks, and runtime diagnostics for this device."
            capabilities={platform.capabilities}
            checkingForUpdates={checkingForUpdates}
            deferredVersion={deferredVersion}
            changelogUrl={changelogUrl}
            closeToTray={closeToTray}
            diagnostics={diagnostics}
            launchAtLogin={launchAtLogin}
            launchMinimized={launchMinimized}
            lifecycleUnavailableReason={lifecycleUnavailableReason}
            onCheckForUpdates={() => void handleCheckForUpdates()}
            onDownloadUpdate={() => {
              void downloadUpdate().catch(() =>
                toast({ title: "Could not download update.", variant: "error" })
              );
            }}
            onDeferUpdate={() => {
              void deferUpdate().then(() => {
                toast({ title: "Update deferred." });
              }).catch(() => {
                toast({ title: "Could not defer update.", variant: "error" });
              });
            }}
            onCloseToTrayChange={(checked) =>
              void handleDesktopToggle(
                "app_close_to_tray",
                checked,
                setCloseToTray,
                "close-to-tray preference"
              )
            }
            onInstallUpdate={() => {
              void installUpdate().catch(() =>
                toast({ title: "Could not install update.", variant: "error" })
              );
            }}
            onLaunchAtLoginChange={(checked) =>
              void handleLaunchAtLogin(checked)
            }
            onLaunchMinimizedChange={(checked) =>
              void handleDesktopToggle(
                "app_launch_minimized",
                checked,
                setLaunchMinimized,
                "launch-minimized preference"
              )
            }
            onRememberWindowStateChange={(checked) =>
              void handleDesktopToggle(
                "app_remember_window_state",
                checked,
                setRememberWindowState,
                "window layout preference"
              )
            }
            onResetWindowLayout={() => void handleResetWindowLayout()}
            onRetryUpdate={() => void handleRetryUpdate()}
            onUpdatesCheckOnStartupChange={(checked) =>
              void handleToggleStartupUpdateCheck(checked)
            }
            rememberWindowState={rememberWindowState}
            runtime={platform.runtime}
            updateState={updateState}
            updatesCheckOnStartup={updatesCheckOnStartup}
            updatesSupported={updatesSupported}
          />

          {/* ── Tab 4: Connection ── */}
          <NetworkSettings
            id="panel-connection"
            active={activeTab === "network"}
            ariaLabelledBy="settings-category-network"
            description="Configure the local server, remote connections, and trusted browser access."
            browserConnectionUrl={browserConnectionUrl}
            canShowLanQrCode={canShowLanQrCode}
            connectionDraft={connectionDraft}
            connectionSaved={connectionSaved}
            connectionSaving={connectionSaving}
            lanAdvertisedHostDraft={lanAdvertisedHostDraft}
            lanEnabledDraft={lanEnabledDraft}
            lanPairingAutoRenew={lanPairingAutoRenew}
            lanPairingCode={lanPairingCode}
            lanPairingError={lanPairingError}
            lanPairingLoading={lanPairingLoading}
            lanPairingRemainingSeconds={lanPairingRemainingSeconds}
            lanQrCodeModal={LanQrCodeModal}
            lanQrModalOpen={lanQrModalOpen}
            lanSaving={lanSaving}
            lanStatus={lanStatus}
            lanWebEnabledDraft={lanWebEnabledDraft}
            machineApiKeyDraft={machineApiKeyDraft}
            platformLanManagement={platform.capabilities.lanManagement}
            onAdvertisedHostChange={setLanAdvertisedHostDraft}
            onCloseLanQrModal={() => setLanQrModalOpen(false)}
            onConnectionModeChange={(checked) =>
              setConnectionDraft((prev) => ({
                ...prev,
                mode: checked ? "remote" : "local",
              }))
            }
            onCopyLanPairingCode={() => void handleCopyLanPairingCode()}
            onCreateLanPairingCode={() => void handleCreateLanPairingCode()}
            onGenerateMachineToken={() => void handleGenerateMachineToken()}
            onLanEnabledChange={setLanEnabledDraft}
            onLanWebEnabledChange={setLanWebEnabledDraft}
            onMachineApiKeyChange={setMachineApiKeyDraft}
            onOpenLanQrModal={() => {
              if (canShowLanQrCode) setLanQrModalOpen(true);
            }}
            onPairingAutoRenewToggle={() => {
              setLanPairingAutoRenew((enabled) => !enabled);
              lanPairingGenerationRef.current += 1;
            }}
            onRotateMachineToken={() => void handleRotateMachineToken()}
            onSaveConnection={() => void handleSaveConnection()}
            onSaveLanSettings={() => void handleSaveLanSettings()}
            onServerUrlChange={(serverUrl) =>
              setConnectionDraft((prev) => ({ ...prev, serverUrl }))
            }
            onTokenChange={(token) =>
              setConnectionDraft((prev) => ({ ...prev, token }))
            }
            onLanQrCopied={() => toast({ title: "Connection link copied." })}
          />

          {/* ── Recipes continuation ── */}
          <AppearanceSettings
            id="panel-appearance"
            active={activeTab === "appearance"}
            ariaLabelledBy="settings-category-appearance"
            description="Shape the visual presentation and layout of your recipe workspace."
            preferences={preferences}
            themePreference={themePreference}
            mealBankPlacement={mealBankPlacement}
            homeDashboard={homeDashboard}
            onThemeChange={(value) => void handleThemeChange(value)}
            onMealBankPlacementChange={(value) =>
              void handleMealBankPlacementChange(value)
            }
            onHomeUpcomingDays={(value) => void handleHomeUpcomingDays(value)}
            onHomeDetail={(value) => void handleHomeDetail(value)}
            onHomeToggle={(key, value, settingKey) =>
              void handleHomeToggle(key, value, settingKey)
            }
            onImmediateField={(field, value) =>
              void handleImmediateField(field, value)
            }
            recipeDefaultSort={recipeDefaultSort}
            onRecipeDefaultSortChange={(value) =>
              void handleRecipeDefaultSortChange(value)
            }
          />
        </div>
      </div>
    </div>
  );
}
