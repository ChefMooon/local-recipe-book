import { Link, useLocation } from "react-router";
import {
  type PointerEvent,
  type PropsWithChildren,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Gear, List, Minus, Square, SquaresFour, X } from "@phosphor-icons/react";

import { getPlatform } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { preloadMealPlanRoute } from "@/lib/meal-plan-route";

import styles from "./app-shell.module.css";

const MEAL_PLAN_POINTER_DELAY_MS = 125;

type MealPlanLinkProps = {
  className: string;
  children: ReactNode;
};

function MealPlanLink({ className, children }: MealPlanLinkProps) {
  const preloadTimer = useRef<number | undefined>(undefined);
  const touchPointerAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (preloadTimer.current !== undefined) {
        window.clearTimeout(preloadTimer.current);
      }
    };
  }, []);

  const preload = () => {
    void preloadMealPlanRoute().catch(() => undefined);
  };

  const handleFocus = () => {
    preload();
  };

  const handlePointerDown = (event: PointerEvent<HTMLAnchorElement>) => {
    if (event.pointerType === "touch") {
      touchPointerAt.current = performance.now();
    }
  };

  const handlePointerEnter = (
    event: PointerEvent<HTMLAnchorElement>
  ) => {
    if (
      event.pointerType === "touch" ||
      (touchPointerAt.current !== undefined &&
        performance.now() - touchPointerAt.current < 500)
    ) {
      return;
    }

    preloadTimer.current = window.setTimeout(preload, MEAL_PLAN_POINTER_DELAY_MS);
  };

  const handlePointerLeave = () => {
    if (preloadTimer.current !== undefined) {
      window.clearTimeout(preloadTimer.current);
      preloadTimer.current = undefined;
    }
  };

  return (
    <Link
      className={className}
      onFocus={handleFocus}
      onPointerDown={handlePointerDown}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      to="/meal-plan"
    >
      {children}
    </Link>
  );
}

const navigationItems = [
  { label: "Home", href: "/" },
  { label: "Meal Plan", href: "/meal-plan" },
  { label: "Recipes", href: "/recipes" },
  { label: "Pantry", href: "/pantry" },
  { label: "Grocery Lists", href: "/grocery-list" },
  { label: "Prep Lists", href: "/prep-lists" },
  { label: "Stats", href: "/stats" },
];

export function AppShell({ children }: PropsWithChildren) {
  const location = useLocation();
  const pathname = location.pathname;
  const getInitialIsNarrow = () => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.innerWidth <= 980;
  };
  const [menuOpen, setMenuOpen] = useState(false);
  const [isNarrowLayout, setIsNarrowLayout] = useState(getInitialIsNarrow);
  const [isMaximized, setIsMaximized] = useState(false);
  const platform = getPlatform();
  const isElectron = platform.runtime === "electron";
  const isMac = isElectron && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const isWindows = isElectron && navigator.platform.startsWith("Win");
  const isLinux = isElectron && navigator.platform.startsWith("Linux");

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    const syncNarrowLayout = () => {
      setIsNarrowLayout(window.innerWidth <= 980);
    };

    syncNarrowLayout();
    window.addEventListener("resize", syncNarrowLayout);

    return () => {
      window.removeEventListener("resize", syncNarrowLayout);
    };
  }, []);

  useEffect(() => {
    if (!isElectron || !platform.isWindowMaximized) {
      setIsMaximized(false);
      return;
    }

    let mounted = true;

    const syncMaximized = async () => {
      const next = await platform.isWindowMaximized?.();
      if (mounted) {
        setIsMaximized(Boolean(next));
      }
    };

    const syncMaximizedOnResize = () => {
      void syncMaximized();
    };

    void syncMaximized();
    window.addEventListener("resize", syncMaximizedOnResize);

    return () => {
      mounted = false;
      window.removeEventListener("resize", syncMaximizedOnResize);
    };
  }, [isElectron, platform]);

  const handleToggleMaximize = async () => {
    await platform.toggleMaximizeWindow?.();
    const next = await platform.isWindowMaximized?.();
    setIsMaximized(Boolean(next));
  };

  return (
    <div className={styles.shell}>
        <header className={cn(styles.header, isMac && styles.headerMac)}>
          <Link className={cn(styles.logo, styles.noDrag)} to="/">
            Local Recipe Book
          </Link>

          <nav className={cn(styles.navDesktop, styles.noDrag)}>
            {navigationItems.map((item) => {
              const className = cn(
                styles.navLink,
                pathname === item.href && styles.navLinkActive
              );

              return item.href === "/meal-plan" ? (
                <MealPlanLink className={className} key={item.href}>
                  {item.label}
                </MealPlanLink>
              ) : (
                <Link className={className} to={item.href} key={item.href}>
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className={cn(styles.navRight, styles.noDrag)}>
            <button
              aria-label="Open navigation"
              className={styles.hamburger}
              onClick={() => setMenuOpen((open) => !open)}
              type="button"
            >
              <List aria-hidden="true" size={20} weight="regular" />
            </button>

            {!isNarrowLayout ? (
              <Link
                aria-label="Settings"
                className={cn(
                  styles.settingsButton,
                  pathname === "/settings" && styles.settingsButtonActive
                )}
                to="/settings"
                title="Settings"
              >
                <Gear aria-hidden="true" size={18} weight="regular" />
              </Link>
            ) : null}

            {isElectron && !isMac ? (
              <div
                className={cn(
                  styles.windowControls,
                  isWindows && styles.windowControlsWindows,
                  isLinux && styles.windowControlsLinux
                )}
              >
                <button
                  aria-label="Minimize window"
                  className={cn(
                    styles.windowControlButton,
                    isWindows && styles.windowControlButtonWindows,
                    isLinux && styles.windowControlButtonLinux
                  )}
                  onClick={() => {
                    void platform.minimizeWindow?.();
                  }}
                  title="Minimize"
                  type="button"
                >
                  <Minus aria-hidden="true" className={styles.windowControlIcon} size={14} weight="regular" />
                </button>
                <button
                  aria-label={isMaximized ? "Restore window" : "Maximize window"}
                  className={cn(
                    styles.windowControlButton,
                    isWindows && styles.windowControlButtonWindows,
                    isLinux && styles.windowControlButtonLinux
                  )}
                  onClick={() => {
                    void handleToggleMaximize();
                  }}
                  title={isMaximized ? "Restore" : "Maximize"}
                  type="button"
                >
                  {isMaximized ? (
                    <SquaresFour aria-hidden="true" className={styles.windowControlIcon} size={14} weight="regular" />
                  ) : (
                    <Square aria-hidden="true" className={styles.windowControlIcon} size={14} weight="regular" />
                  )}
                </button>
                <button
                  aria-label="Close window"
                  className={cn(
                    styles.windowControlButton,
                    styles.windowControlClose,
                    isWindows && styles.windowControlButtonWindows,
                    isWindows && styles.windowControlCloseWindows,
                    isLinux && styles.windowControlButtonLinux,
                    isLinux && styles.windowControlCloseLinux
                  )}
                  onClick={() => {
                    void platform.closeWindow?.();
                  }}
                  title="Close"
                  type="button"
                >
                  <X aria-hidden="true" className={styles.windowControlIcon} size={14} weight="regular" />
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <div className={cn(styles.mobileMenu, menuOpen && styles.mobileMenuOpen)}>
          {navigationItems.map((item) => {
            const className = cn(
              styles.mobileNavLink,
              pathname === item.href && styles.mobileNavLinkActive
            );

            return item.href === "/meal-plan" ? (
              <MealPlanLink className={className} key={item.href}>
                {item.label}
              </MealPlanLink>
            ) : (
              <Link className={className} to={item.href} key={item.href}>
                {item.label}
              </Link>
            );
          })}
          <Link
            className={cn(
              styles.mobileNavLink,
              pathname === "/settings" && styles.mobileNavLinkActive
            )}
            to="/settings"
          >
            Settings
          </Link>
        </div>

        <div className={styles.contentScroller}>
          <main className={styles.page}>{children}</main>
        </div>
      </div>
  );
}
