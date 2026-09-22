// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthenticatedAppLayout } from "./app";

type MockServerConfig = {
  url: string;
  token: string;
  mode: "local" | "remote";
};

const platformMocks = vi.hoisted(() => ({
  runtime: "electron" as "electron" | "browser",
  browserConnection: { apiUrl: "http://127.0.0.1:3001", token: "token" } as {
    apiUrl: string;
    token: string;
  } | null,
}));

const queryProviderMocks = vi.hoisted(() => ({
  mounts: 0,
}));

const configMocks = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    listeners,
    loadImpl: vi.fn<() => Promise<MockServerConfig>>(),
    emitUpdate: () => {
      for (const listener of listeners) {
        listener();
      }
    },
  };
});

vi.mock("@/lib/api", () => ({
  listMealSubTypeDefinitions: vi.fn().mockResolvedValue([]),
  listMealTypeProfiles: vi.fn().mockResolvedValue([]),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    prefetchQuery: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/lib/connection", () => ({
  useServerConnection: () => ({ status: "connected", retry: vi.fn() }),
}));

vi.mock("@/lib/platform", () => ({
  getPlatform: () => ({ runtime: platformMocks.runtime }),
  getBrowserConnection: () => platformMocks.browserConnection,
}));

vi.mock("@/lib/config", () => ({
  ConfigNotReadyError: class ConfigNotReadyError extends Error {},
  isServerConfigReady: (config: MockServerConfig | null) => {
    if (!config) {
      return false;
    }

    return Boolean(config.url.trim() && config.token.trim());
  },
  loadServerConfig: () => configMocks.loadImpl(),
  subscribeConfigUpdates: (listener: () => void) => {
    configMocks.listeners.add(listener);
    return () => {
      configMocks.listeners.delete(listener);
    };
  },
}));

vi.mock("@/components/providers/query-provider", async () => {
  const React = await import("react");
  return {
    QueryProvider: ({ children }: { children: React.ReactNode }) => {
      const [id] = React.useState(() => {
        queryProviderMocks.mounts += 1;
        return queryProviderMocks.mounts;
      });

      return <div data-testid={`query-provider-${id}`}>{children}</div>;
    },
  };
});

vi.mock("@/components/providers/toast-provider", () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="toast-provider">{children}</div>
  ),
  useToast: () => ({
    toast: vi.fn(),
    dismissAll: vi.fn(),
    setDragging: vi.fn(),
  }),
}));

vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">
      <header data-testid="app-header">Local Recipe Book</header>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock("@/components/layout/connection-banner", () => ({
  ConnectionBanner: () => null,
}));

vi.mock("react-router", () => ({
  Outlet: () => <div data-testid="outlet" />,
  useNavigate: () => () => undefined,
}));

describe("AuthenticatedAppLayout", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");

    platformMocks.runtime = "electron";
    platformMocks.browserConnection = {
      apiUrl: "http://127.0.0.1:3001",
      token: "token",
    };

    queryProviderMocks.mounts = 0;
    configMocks.listeners.clear();
    configMocks.loadImpl.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps the header visible while config is loading", async () => {
    configMocks.loadImpl.mockImplementation(
      () => new Promise<MockServerConfig>(() => undefined)
    );

    render(<AuthenticatedAppLayout />);

    expect(screen.getByTestId("app-shell")).toBeTruthy();
    expect(screen.getByTestId("app-header")).toBeTruthy();
    expect(screen.getByText("Loading...")).toBeTruthy();
  });

  it("does not render the authenticated shell when browser connection is missing", async () => {
    platformMocks.runtime = "browser";
    platformMocks.browserConnection = null;

    configMocks.loadImpl.mockResolvedValue({
      url: "http://127.0.0.1:3001",
      token: "token",
      mode: "local",
    });

    render(<AuthenticatedAppLayout />);

    expect(screen.queryByTestId("app-shell")).toBeNull();
    expect(configMocks.loadImpl).not.toHaveBeenCalled();
  });

  it("does not remount QueryProvider for unchanged config updates", async () => {
    configMocks.loadImpl.mockResolvedValue({
      url: "http://127.0.0.1:3001",
      token: "token",
      mode: "local",
    });

    render(<AuthenticatedAppLayout />);

    await waitFor(() => {
      expect(screen.getByTestId("query-provider-1")).toBeTruthy();
    });

    expect(screen.queryByTestId("query-provider-2")).toBeNull();

    configMocks.emitUpdate();

    await waitFor(() => {
      expect(configMocks.loadImpl).toHaveBeenCalledTimes(2);
    });

    expect(screen.getByTestId("query-provider-1")).toBeTruthy();
    expect(screen.queryByTestId("query-provider-2")).toBeNull();
  });
});
