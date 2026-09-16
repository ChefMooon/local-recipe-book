// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HomeDashboard } from "@/components/home/home-dashboard";
import styles from "@/components/home/home-dashboard.module.css";

const {
  fetchJsonMock,
  getSettingMock,
  useMealTypeProfilesMock,
  useQueryMock,
} = vi.hoisted(() => ({
  fetchJsonMock: vi.fn(),
  getSettingMock: vi.fn(),
  useMealTypeProfilesMock: vi.fn(),
  useQueryMock: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: useQueryMock,
}));

vi.mock("@/lib/platform", () => ({
  getPlatform: () => ({
    runtime: "browser",
    getSetting: getSettingMock,
  }),
}));

vi.mock("@/lib/use-meal-types", () => ({
  useMealTypeProfiles: useMealTypeProfilesMock,
}));

vi.mock("@/lib/use-server-config", () => ({
  useServerConfig: () => ({ url: "http://localhost:3001", token: "test" }),
}));

vi.mock("@/lib/config", () => ({
  isServerConfigReady: () => true,
}));

vi.mock("@/lib/api", () => ({
  fetchJson: fetchJsonMock,
  isRateLimitedApiError: () => false,
}));

function queryState(data: unknown) {
  return {
    data,
    isLoading: false,
    isError: false,
    error: undefined,
    refetch: vi.fn(),
  };
}

describe("HomeDashboard upcoming meals", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    fetchJsonMock.mockReset();
    getSettingMock.mockReset();
    useMealTypeProfilesMock.mockReset();
    getSettingMock.mockResolvedValue(null);
    useMealTypeProfilesMock.mockReturnValue({ data: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it("groups same-type meals and keeps the date hierarchy readable", async () => {
    useMealTypeProfilesMock.mockReturnValue({
      data: [
        {
          id: "custom-weekday",
          name: "Custom Weekday",
          color: "#3b5e45",
          description: null,
          isDefault: false,
          priority: 10,
          startDate: null,
          endDate: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          mealTypes: [
            {
              id: "lunch",
              profileId: "custom-weekday",
              name: "Lunch",
              slug: "lunch",
              color: "#7db18d",
              enabled: true,
              sortOrder: 10,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
            {
              id: "dinner",
              profileId: "custom-weekday",
              name: "Dinner",
              slug: "dinner",
              color: "#7db18d",
              enabled: true,
              sortOrder: 20,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
    });

    const upcomingData = {
      days: 7,
      from: "2026-08-14",
      to: "2026-08-20",
      meals: [
        {
          id: "dinner-main",
          name: "Roasted vegetables",
          date: "2026-08-14",
          mealType: "dinner",
          mealSubTypeDefinition: {
            id: "main",
            name: "Main",
            slug: "main",
            color: "#7db18d",
          },
          cuisine: "Mediterranean",
          linkedRecipe: { title: "Weeknight vegetables" },
        },
        {
          id: "dinner-side",
          name: "Herbed rice",
          date: "2026-08-14",
          mealType: "dinner",
          mealSubTypeDefinition: {
            id: "side",
            name: "Side",
            slug: "side",
            color: "#7db18d",
          },
          cuisine: null,
          linkedRecipe: null,
          passedCutoff: true,
        },
        {
          id: "lunch-main",
          name: "Tomato toast",
          date: "2026-08-14",
          mealType: "lunch",
          mealSubTypeDefinition: null,
          cuisine: null,
          linkedRecipe: null,
        },
      ],
    };

    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === "pantry") {
        return queryState({ trackedItems: 0, lowStock: 0, empty: 0, expiringSoon: 0, expired: 0 });
      }

      if (queryKey[1] === "grocery-list") {
        return queryState(null);
      }

      if (queryKey[1] === "heatmap") {
        return queryState({ weeks: [], monthStarts: {} });
      }

      return queryState(upcomingData);
    });
    getSettingMock.mockImplementation((key: string) => {
      if (key === "home_upcoming_days") {
        return Promise.resolve(14);
      }

      return Promise.resolve(key === "home_upcoming_detail" ? "detailed" : null);
    });

    render(
      <MemoryRouter>
        <HomeDashboard />
      </MemoryRouter>
    );

    const dinnerHeading = await screen.findByText("Dinner");
    const dinnerGroup = dinnerHeading.parentElement;

    expect(dinnerGroup).not.toBeNull();
    expect(
      within(dinnerGroup as HTMLElement).getByText("Roasted vegetables")
    ).toBeTruthy();
    expect(within(dinnerGroup as HTMLElement).getByText("Herbed rice")).toBeTruthy();
    expect(screen.queryByText("Cutoff passed")).toBeNull();
    expect(screen.getByText("Herbed rice").parentElement?.parentElement).toHaveClass(
      styles.upcomingMealRowPassed
    );
    expect(screen.getByText("Lunch")).toBeTruthy();
    expect(screen.getByText("Fri")).toBeTruthy();
    expect(screen.getByText("Aug 14")).toBeTruthy();
    expect(screen.getByText(/Mediterranean/)).toBeTruthy();
    expect(screen.getByText(/Weeknight vegetables/)).toBeTruthy();
    expect(
      screen.getByText(
        "You have 3 meals planned in the next 14 days. Let's get cooking."
      )
    ).toBeTruthy();

    const upcomingQuery = useQueryMock.mock.calls
      .map(([options]) => options as { queryKey: string[]; queryFn: () => Promise<unknown> })
      .find(({ queryKey }) => queryKey[1] === "upcoming" && queryKey[2] === 14);

    expect(upcomingQuery).toBeDefined();
    fetchJsonMock.mockResolvedValue({ data: upcomingData });
    await upcomingQuery?.queryFn();
    expect(fetchJsonMock).toHaveBeenCalledWith(
      "/api/meals/upcoming?days=14"
    );

    const mealTypeGroups = screen.getByText("Lunch").parentElement?.parentElement;
    expect(mealTypeGroups?.textContent?.indexOf("Lunch")).toBeLessThan(
      mealTypeGroups?.textContent?.indexOf("Dinner") ?? -1
    );
  });
});