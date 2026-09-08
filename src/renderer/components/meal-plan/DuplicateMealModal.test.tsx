// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render as testingRender,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { DuplicateMealModal } from "./DuplicateMealModal";
import { getMonday, type CalendarMeal, type EditableMeal } from "@/lib/calendar";
import type { MealTypeProfilePayload } from "@shared/types";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fetchJson } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  fetchJson: vi.fn().mockResolvedValue({ data: [] }),
}));

const fetchJsonMock = vi.mocked(fetchJson);

function render(ui: Parameters<typeof testingRender>[0]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return testingRender(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={0}>{ui}</TooltipProvider>
    </QueryClientProvider>
  );
}

const monday = new Date(2026, 4, 18);

const mealTypeProfiles: MealTypeProfilePayload[] = [
  {
    id: "profile-default",
    name: "Default",
    description: null,
    color: "#3b5e45",
    isDefault: true,
    priority: 0,
    startDate: null,
    endDate: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    mealTypes: [
      {
        id: "breakfast",
        profileId: "profile-default",
        slug: "BREAKFAST",
        name: "Breakfast",
        color: "#f97316",
        enabled: true,
        sortOrder: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "dinner",
        profileId: "profile-default",
        slug: "DINNER",
        name: "Dinner",
        color: "#22c55e",
        enabled: true,
        sortOrder: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  },
];

const meal: EditableMeal = {
  id: "meal-1",
  name: "Shakshuka",
  date: monday,
  type: "BREAKFAST",
  sortOrder: 10,
  mealTypeDefinitionId: "breakfast",
  mealTypeDefinition: mealTypeProfiles[0].mealTypes[0],
  mealSubTypeDefinitionId: null,
  mealSubTypeDefinition: null,
  notes: "With feta",
  ingredients: [],
  description: "Tomato and eggs",
  cuisine: "Middle Eastern",
  instructions: ["Cook onions", "Simmer tomatoes", "Poach eggs"],
  servings: 2,
  prepTime: 15,
  cookTime: 20,
  servingsOverride: null,
  recipeId: null,
  linkedRecipe: null,
};

const scheduledBreakfast = {
  ...meal,
  id: "meal-2",
  name: "Second breakfast",
  date: new Date(2026, 4, 19).toISOString(),
  mealType: "BREAKFAST",
} as unknown as CalendarMeal;

const rangedProfile: MealTypeProfilePayload = {
  ...mealTypeProfiles[0],
  id: "profile-ranged",
  name: "Ranged",
  isDefault: false,
  priority: 10,
  startDate: "2026-05-19T00:00:00",
  endDate: "2026-05-20T00:00:00",
  mealTypes: [
    {
      ...mealTypeProfiles[0].mealTypes[0],
      id: "brunch",
      slug: "BRUNCH",
      name: "Brunch",
    },
    {
      ...mealTypeProfiles[0].mealTypes[1],
      id: "supper",
      slug: "SUPPER",
      name: "Supper",
    },
    {
      ...mealTypeProfiles[0].mealTypes[0],
      id: "locked",
      slug: "LOCKED",
      name: "Locked",
      enabled: false,
    },
  ],
};

const unavailableProfile: MealTypeProfilePayload = {
  ...rangedProfile,
  id: "profile-unavailable",
  name: "Unavailable",
  startDate: "2026-05-21T00:00:00",
  endDate: "2026-05-21T00:00:00",
  mealTypes: [],
};

afterEach(() => {
  cleanup();
  fetchJsonMock.mockReset();
  fetchJsonMock.mockResolvedValue({ data: [] });
});

describe("DuplicateMealModal", () => {
  it("disables duplicating to the source day", () => {
    render(
      <DuplicateMealModal
        isOpen
        meal={meal}
        mealTypeProfiles={mealTypeProfiles}
        onClose={vi.fn()}
        onDuplicate={vi.fn()}
        referenceDate={monday}
      />
    );

    expect(screen.getByText("Source day")).toBeTruthy();

    const sourceButton = document.querySelector(
      "button[data-source-day='true']"
    );

    expect(sourceButton).toBeTruthy();
    expect(sourceButton).toHaveAttribute("aria-disabled", "true");
  });

  it("highlights the source meal type across the displayed week", () => {
    render(
      <DuplicateMealModal
        isOpen
        meal={meal}
        mealTypeProfiles={mealTypeProfiles}
        onClose={vi.fn()}
        onDuplicate={vi.fn()}
        referenceDate={monday}
      />
    );

    const sourceBreakfast = document.querySelector(
      "button[data-source-day='true'][data-meal-type-definition-id='breakfast']"
    );
    const sourceDinner = document.querySelector(
      "button[data-source-day='true'][data-meal-type-definition-id='dinner']"
    );
    const otherDayBreakfastButtons = document.querySelectorAll(
      "button[data-source-day='false'][data-meal-type-definition-id='breakfast']"
    );
    const otherDayDinnerButtons = document.querySelectorAll(
      "button[data-source-day='false'][data-meal-type-definition-id='dinner']"
    );

    expect(sourceBreakfast).toHaveAttribute("data-source-meal-type", "true");
    expect(sourceBreakfast?.className).toContain("duplicateDayTypeSource");
    expect(sourceDinner).toHaveAttribute("data-source-meal-type", "false");
    expect(sourceDinner?.className).not.toContain("duplicateDayTypeSource");
    expect(
      Array.from(otherDayBreakfastButtons).every(
        (button) => button.getAttribute("data-source-meal-type") === "true"
      )
    ).toBe(true);
    expect(
      Array.from(otherDayDinnerButtons).every(
        (button) => button.getAttribute("data-source-meal-type") === "false"
      )
    ).toBe(true);
  });

  it("marks the current day separately from the source day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 19, 12));

    try {
      render(
        <DuplicateMealModal
          isOpen
          meal={meal}
          mealTypeProfiles={mealTypeProfiles}
          onClose={vi.fn()}
          onDuplicate={vi.fn()}
          referenceDate={monday}
        />
      );

      expect(screen.getByText("Current day")).toBeInTheDocument();
      expect(
        document.querySelector("[data-current-day='true']")
      ).toHaveAttribute("data-source-day", "false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends selected day and default target meal type", () => {
    const onDuplicate = vi.fn();

    render(
      <DuplicateMealModal
        isOpen
        meal={meal}
        mealTypeProfiles={mealTypeProfiles}
        onClose={vi.fn()}
        onDuplicate={onDuplicate}
        referenceDate={monday}
      />
    );

    const target = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button[data-target-date]")
    ).find(
      (button) => button.dataset.sourceDay === "false" && !button.disabled
    );

    expect(target).toBeTruthy();

    fireEvent.click(target as HTMLButtonElement);

    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(onDuplicate.mock.calls[0][0]).toMatchObject({
      mealType: "BREAKFAST",
      mealTypeDefinitionId: "breakfast",
    });
  });

  it("applies each meal type definition color to its target control", () => {
    render(
      <DuplicateMealModal
        isOpen
        meal={meal}
        mealTypeProfiles={[mealTypeProfiles[0], rangedProfile]}
        onClose={vi.fn()}
        onDuplicate={vi.fn()}
        referenceDate={monday}
      />
    );

    expect(
      screen.getByRole("button", {
        name: "Tue, May 19, Duplicate as Brunch, 0 meals scheduled",
      })
    ).toHaveStyle({ "--meal-type-color": "#f97316" });
    expect(
      screen.getByRole("button", {
        name: "Wed, May 20, Duplicate as Supper, 0 meals scheduled",
      })
    ).toHaveStyle({ "--meal-type-color": "#22c55e" });
  });

  it("renders every enabled definition from a date-ranged profile", () => {
    const onDuplicate = vi.fn();

    render(
      <DuplicateMealModal
        isOpen
        meal={meal}
        mealTypeProfiles={[mealTypeProfiles[0], rangedProfile]}
        onClose={vi.fn()}
        onDuplicate={onDuplicate}
        referenceDate={monday}
      />
    );

    expect(
      screen.getByRole("button", {
        name: "Tue, May 19, Duplicate as Brunch, 0 meals scheduled",
      })
    ).toBeTruthy();
    const supperButton = screen.getByRole("button", {
        name: "Tue, May 19, Duplicate as Supper, 0 meals scheduled",
    });

    expect(supperButton).toHaveAttribute(
      "data-meal-type-definition-id",
      "supper"
    );
    fireEvent.click(supperButton);

    expect(onDuplicate).toHaveBeenCalledWith({
      date: new Date(2026, 4, 19),
      mealType: "SUPPER",
      mealTypeDefinitionId: "supper",
    });
  });

  it("omits disabled definitions and disables dates with no available definitions", () => {
    render(
      <DuplicateMealModal
        isOpen
        meal={meal}
        mealTypeProfiles={[
          mealTypeProfiles[0],
          rangedProfile,
          unavailableProfile,
        ]}
        onClose={vi.fn()}
        onDuplicate={vi.fn()}
        referenceDate={monday}
      />
    );

    expect(
      screen.queryByRole("button", {
        name: "Tue, May 19, Duplicate as Locked",
      })
    ).not.toBeInTheDocument();
    const unavailableDay = screen.getByRole("button", {
      name: "Thu, May 21, No meal types available",
    });

    expect(unavailableDay).toBeDisabled();
  });

  it("renders counts for matching date and meal type slots", async () => {
    fetchJsonMock.mockResolvedValue({ data: [scheduledBreakfast] });

    render(
      <DuplicateMealModal
        isOpen
        meal={meal}
        mealTypeProfiles={mealTypeProfiles}
        onClose={vi.fn()}
        onDuplicate={vi.fn()}
        referenceDate={monday}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Tue, May 19, Duplicate as Breakfast, 1 meal scheduled",
        })
      ).toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", {
        name: "Tue, May 19, Duplicate as Dinner, 0 meals scheduled",
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Wed, May 20, Duplicate as Breakfast, 0 meals scheduled",
      })
    ).toBeInTheDocument();
  });

  it("loads counts for the newly displayed week", async () => {
    const referenceDate = new Date();
    referenceDate.setDate(referenceDate.getDate() + 14);
    const previousWeekStart = getMonday(referenceDate);
    previousWeekStart.setDate(previousWeekStart.getDate() - 7);
    const targetDate = new Date(previousWeekStart);
    targetDate.setDate(targetDate.getDate() + 1);
    const navigationBreakfast = {
      ...scheduledBreakfast,
      date: targetDate.toISOString(),
    } as unknown as CalendarMeal;

    fetchJsonMock
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [navigationBreakfast] });

    render(
      <DuplicateMealModal
        isOpen
        meal={meal}
        mealTypeProfiles={mealTypeProfiles}
        onClose={vi.fn()}
        onDuplicate={vi.fn()}
        referenceDate={referenceDate}
      />
    );

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));

    await waitFor(() => {
      const count = document.querySelector(
        `button[data-meal-type-definition-id="breakfast"][data-target-date^="${targetDate.toISOString().slice(0, 10)}"] [data-meal-count="1"]`
      );

      expect(count).toBeInTheDocument();
    });

    expect(fetchJsonMock).toHaveBeenCalledTimes(2);
  });

  it("moves between future and current weeks without entering a past week", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 13, 12));

    render(
      <DuplicateMealModal
        isOpen
        meal={meal}
        mealTypeProfiles={mealTypeProfiles}
        onClose={vi.fn()}
        onDuplicate={vi.fn()}
        referenceDate={new Date(2026, 4, 25)}
      />
    );

    expect(
      screen.getByRole("button", { name: "Previous week" })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    expect(
      screen.getByRole("button", { name: "Previous week" })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    expect(
      screen.queryByRole("button", { name: "Previous week" })
    ).not.toBeInTheDocument();
    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>("[data-target-date]")
      ).some((element) => element.dataset.targetDate?.startsWith("2026-05-11"))
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(
      screen.getByRole("button", { name: "Previous week" })
    ).toBeInTheDocument();
    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>("[data-target-date]")
      ).some((element) => element.dataset.targetDate?.startsWith("2026-05-18"))
    ).toBe(true);
  });

  it("updates the source-day indication when the displayed week changes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 13, 12));

    render(
      <DuplicateMealModal
        isOpen
        meal={meal}
        mealTypeProfiles={mealTypeProfiles}
        onClose={vi.fn()}
        onDuplicate={vi.fn()}
        referenceDate={monday}
      />
    );

    expect(screen.getByText("Source day")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    expect(screen.queryByText("Source day")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(screen.getByText("Source day")).toBeInTheDocument();
  });

  it("disables every definition option and close control while duplicating", () => {
    render(
      <DuplicateMealModal
        isDuplicating
        isOpen
        meal={meal}
        mealTypeProfiles={[mealTypeProfiles[0], rangedProfile]}
        onClose={vi.fn()}
        onDuplicate={vi.fn()}
        referenceDate={monday}
      />
    );

    expect(
      Array.from(
        document.querySelectorAll<HTMLButtonElement>("button[data-target-date]")
      ).every((button) => button.getAttribute("aria-disabled") === "true")
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Close duplicate meal dialog" })
    ).toBeDisabled();
  });
});
