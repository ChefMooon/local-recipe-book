import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowRight, CalendarDots, Fire, ShoppingCart } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/PageHeader";
import { RouteErrorState } from "@/components/ui/route-error-state";
import { AccessibleHeatmapCell } from "@/components/ui/accessible-heatmap-cell";
import { fetchJson, isRateLimitedApiError } from "@/lib/api";
import { useMealTypeProfiles } from "@/lib/use-meal-types";
import { isServerConfigReady } from "@/lib/config";
import { useServerConfig } from "@/lib/use-server-config";
import { getPlatform } from "@/lib/platform";
import { cn } from "@/lib/utils";
import {
  getDefaultMealTypeProfile,
  getMealTypeDefinitionsForDate,
} from "@/lib/calendar";
import { LIST_REFETCH_INTERVAL_MS } from "@/lib/query-intervals";

import styles from "./home-dashboard.module.css";

type GroceryListPayload = {
  id: string;
  name: string;
  createdAt: string;
  checkedCount: number;
  totalItems: number;
  completionPercentage: number;
};

type HeatmapPayload = {
  weeks: Array<Array<{ date: string; meals: number; isFuture: boolean }>>;
  monthStarts: Record<string, number>;
};

type UpcomingMealPayload = {
  id: string;
  name: string;
  date: string | null;
  mealType: string;
  mealSubTypeDefinition: {
    id: string;
    name: string;
    slug: string;
    color: string;
  } | null;
  cuisine: string | null;
  linkedRecipe: { title: string } | null;
  passedCutoff?: boolean;
};

type UpcomingMealsPayload = {
  days: number;
  from: string;
  to: string;
  meals: UpcomingMealPayload[];
};

type UpcomingMealTypeGroup = {
  mealType: string;
  meals: UpcomingMealPayload[];
};

type HomeUpcomingDetail = "standard" | "detailed";

type HomeDashboardSettings = {
  upcomingDays: number;
  upcomingDetail: HomeUpcomingDetail;
  upcomingCompact: boolean;
  showUpcomingMeals: boolean;
  showMealActivity: boolean;
  showGroceryList: boolean;
  showGreetingSubtitle: boolean;
};

const HOME_SETTINGS_DEFAULTS: HomeDashboardSettings = {
  upcomingDays: 7,
  upcomingDetail: "standard",
  upcomingCompact: false,
  showUpcomingMeals: true,
  showMealActivity: true,
  showGroceryList: true,
  showGreetingSubtitle: true,
};

const platform = getPlatform();

function clampUpcomingDays(input: unknown) {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    return HOME_SETTINGS_DEFAULTS.upcomingDays;
  }

  return Math.min(30, Math.max(1, Math.floor(input)));
}

function normalizeDetail(input: unknown): HomeUpcomingDetail {
  return input === "detailed" ? "detailed" : "standard";
}

function normalizeBoolean(input: unknown, fallback: boolean) {
  return typeof input === "boolean" ? input : fallback;
}

function formatMealType(mealType: string) {
  return mealType
    .replace(/_/g, " ")
    .replace(
      /\w\S*/g,
      (value) => value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
    );
}

function getHeatColor(meals: number, isFuture: boolean) {
  if (isFuture) {
    return "var(--heatmap-future)";
  }

  if (meals === 0) {
    return "var(--heatmap-empty)";
  }

  if (meals === 1) {
    return "var(--heatmap-low)";
  }

  if (meals === 2) {
    return "var(--heatmap-medium)";
  }

  return "var(--heatmap-high)";
}

function getGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) {
    return "Good morning";
  }

  if (hour < 18) {
    return "Good afternoon";
  }

  return "Good evening";
}

function parseUpcomingDate(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);

  if (match) {
    return new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      12,
      0,
      0,
      0
    );
  }

  return new Date(dateKey);
}

export function HomeDashboard() {
  const config = useServerConfig();
  const apiReady = isServerConfigReady(config);
  const mealTypeProfilesQuery = useMealTypeProfiles();
  const [settings, setSettings] = useState<HomeDashboardSettings>(
    HOME_SETTINGS_DEFAULTS
  );
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);

  useEffect(() => {
    let canceled = false;

    async function loadHomeSettings() {
      try {
        const [
          upcomingDays,
          upcomingDetail,
          upcomingCompact,
          showUpcomingMeals,
          showMealActivity,
          showGroceryList,
          showGreetingSubtitle,
        ] = await Promise.all([
          platform.getSetting("home_upcoming_days"),
          platform.getSetting("home_upcoming_detail"),
          platform.getSetting("home_upcoming_compact"),
          platform.getSetting("home_show_upcoming_meals"),
          platform.getSetting("home_show_meal_activity"),
          platform.getSetting("home_show_grocery_list"),
          platform.getSetting("home_show_greeting_subtitle"),
        ]);

        if (canceled) {
          return;
        }

        setSettings({
          upcomingDays: clampUpcomingDays(upcomingDays),
          upcomingDetail: normalizeDetail(upcomingDetail),
          upcomingCompact: normalizeBoolean(
            upcomingCompact,
            HOME_SETTINGS_DEFAULTS.upcomingCompact
          ),
          showUpcomingMeals: normalizeBoolean(
            showUpcomingMeals,
            HOME_SETTINGS_DEFAULTS.showUpcomingMeals
          ),
          showMealActivity: normalizeBoolean(
            showMealActivity,
            HOME_SETTINGS_DEFAULTS.showMealActivity
          ),
          showGroceryList: normalizeBoolean(
            showGroceryList,
            HOME_SETTINGS_DEFAULTS.showGroceryList
          ),
          showGreetingSubtitle: normalizeBoolean(
            showGreetingSubtitle,
            HOME_SETTINGS_DEFAULTS.showGreetingSubtitle
          ),
        });
      } catch {
        if (!canceled) {
          setSettings(HOME_SETTINGS_DEFAULTS);
        }
      }
    }

    void loadHomeSettings();

    return () => {
      canceled = true;
    };
  }, []);

  const groceryListQuery = useQuery({
    queryKey: ["grocery-list", "current"],
    enabled: apiReady && settings.showGroceryList,
    refetchInterval: LIST_REFETCH_INTERVAL_MS,
    retry: (failureCount, error) =>
      isRateLimitedApiError(error) ? failureCount < 1 : failureCount < 2,
    queryFn: () =>
      fetchJson<{ data: GroceryListPayload | null }>(
        "/api/grocery-lists?current=1"
      ).then((response) => response.data),
  });

  const heatmapQuery = useQuery({
    queryKey: ["meals", "heatmap", 13],
    enabled: apiReady && settings.showMealActivity,
    refetchInterval: LIST_REFETCH_INTERVAL_MS,
    retry: (failureCount, error) =>
      isRateLimitedApiError(error) ? failureCount < 1 : failureCount < 2,
    queryFn: () =>
      fetchJson<{ data: HeatmapPayload }>("/api/meals/heatmap?weeks=13").then(
        (response) => response.data
      ),
  });

  const upcomingMealsQuery = useQuery({
    queryKey: ["meals", "upcoming", settings.upcomingDays],
    enabled: apiReady,
    refetchInterval: LIST_REFETCH_INTERVAL_MS,
    retry: (failureCount, error) =>
      isRateLimitedApiError(error) ? failureCount < 1 : failureCount < 2,
    queryFn: () =>
      fetchJson<{ data: UpcomingMealsPayload }>(
        `/api/meals/upcoming?days=${settings.upcomingDays}`
      ).then((response) => response.data),
  });

  const greetingDate = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      }).format(new Date()),
    []
  );

  const monthLabels = useMemo(() => {
    const entries = Object.entries(heatmapQuery.data?.monthStarts ?? {});
    return entries.reduce<Record<number, string>>(
      (accumulator, [month, index]) => {
        accumulator[index] = month;
        return accumulator;
      },
      {}
    );
  }, [heatmapQuery.data?.monthStarts]);

  const groceryList = groceryListQuery.data;
  const heatmap = heatmapQuery.data?.weeks ?? [];
  const upcomingMeals = upcomingMealsQuery.data?.meals ?? [];
  const totalMeals = upcomingMeals.length;
  const mealTypeProfiles = mealTypeProfilesQuery.data?.length
    ? mealTypeProfilesQuery.data
    : [getDefaultMealTypeProfile()];

  const groupedUpcomingMeals = useMemo(() => {
    const groupedByDate = upcomingMeals.reduce<
      Record<string, UpcomingMealTypeGroup[]>
    >(
      (accumulator, meal) => {
        const dateKey = meal.date ?? "unscheduled";
        const dateGroup = accumulator[dateKey] ?? [];
        const mealTypeGroup = dateGroup.find(
          (group) => group.mealType === meal.mealType
        );

        if (mealTypeGroup) {
          mealTypeGroup.meals.push(meal);
        } else {
          dateGroup.push({ mealType: meal.mealType, meals: [meal] });
        }

        accumulator[dateKey] = dateGroup;
        return accumulator;
      },
      {}
    );

    return Object.fromEntries(
      Object.entries(groupedByDate).map(([dateKey, groups]) => {
        if (dateKey === "unscheduled") {
          return [dateKey, groups];
        }

        const date = parseUpcomingDate(dateKey);
        const definitions = getMealTypeDefinitionsForDate(
          date,
          mealTypeProfiles
        );
        const order = new Map(
          definitions
            .slice()
            .sort((left, right) => left.sortOrder - right.sortOrder)
            .map((definition, index) => [definition.slug, index])
        );

        return [
          dateKey,
          groups
            .map((group, index) => ({
              group,
              index,
              order: order.get(group.mealType) ?? Number.MAX_SAFE_INTEGER,
            }))
            .sort(
              (left, right) => left.order - right.order || left.index - right.index
            )
            .map(({ group }) => group),
        ];
      })
    );
  }, [mealTypeProfiles, upcomingMeals]);

  const upcomingGroupKeys = useMemo(() => {
    return Object.keys(groupedUpcomingMeals).sort();
  }, [groupedUpcomingMeals]);

  const visibleOverviewCount =
    Number(settings.showMealActivity) + Number(settings.showGroceryList);
  const hasOverviewContent =
    settings.showUpcomingMeals || visibleOverviewCount > 0;
  const homeQueries = [
    groceryListQuery,
    heatmapQuery,
    upcomingMealsQuery,
  ] as const;
  const isRateLimited = homeQueries.some(
    (query) => query.isError && isRateLimitedApiError(query.error)
  );
  const hasHomeQueryError = homeQueries.some((query) => query.isError);

  function retryHomeQueries() {
    void Promise.all([
      groceryListQuery.refetch(),
      heatmapQuery.refetch(),
      upcomingMealsQuery.refetch(),
    ]);
  }

  return (
    <>
      <PageHeader
        className={cn(styles.pageGreeting, styles.fadeIn)}
        eyebrow={settings.showGreetingSubtitle ? greetingDate : undefined}
        subtitle={
          settings.showGreetingSubtitle
            ? totalMeals > 0
              ? `You have ${totalMeals} ${totalMeals === 1 ? "meal" : "meals"} planned in the next ${settings.upcomingDays} days. Let's get cooking.`
              : "Your first weekly plan is ready to take shape."
            : undefined
        }
        title={`${getGreeting()}, Chef!`}
      />

      {hasHomeQueryError ? (
        <RouteErrorState
          onRetry={retryHomeQueries}
          title={
            isRateLimited
              ? "Some dashboard data is temporarily rate limited."
              : "Some dashboard data could not be loaded."
          }
        />
      ) : null}

      {hasOverviewContent ? (
        <>
          <div className={cn(styles.sectionDivider, styles.fadeIn)}>
            Overview
          </div>
          <section className={cn(styles.overviewStack, styles.fadeIn)}>
            {settings.showUpcomingMeals ? (
              <div
                className={cn(
                  styles.card,
                  styles.upcomingCard,
                  settings.upcomingCompact && styles.upcomingCardCompact
                )}
              >
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>
                    <CalendarDots aria-hidden="true" size={20} weight="regular" />
                    <span>Upcoming Meals</span>
                  </div>
                  <Button
                    asChild
                    className={styles.cardActionButton}
                    size="sm"
                    variant="outline"
                  >
                    <Link to="/meal-plan">
                      <span>Open Planner</span>
                      <ArrowRight aria-hidden="true" size={16} weight="regular" />
                    </Link>
                  </Button>
                </div>

                {upcomingMealsQuery.isLoading ? (
                  <p className={styles.upcomingEmptyMessage}>
                    Loading upcoming meals...
                  </p>
                ) : upcomingMeals.length === 0 ? (
                  <p className={styles.upcomingEmptyMessage}>
                    No upcoming meals are planned.
                  </p>
                ) : (
                  <div className={styles.upcomingGroupedList}>
                    {upcomingGroupKeys.map((dateKey) => {
                      const date =
                        dateKey === "unscheduled"
                          ? null
                          : parseUpcomingDate(dateKey);

                      return (
                        <div className={styles.upcomingGroup} key={dateKey}>
                          <div className={styles.upcomingGroupHeader}>
                            <div className={styles.upcomingGroupWeekday}>
                              {date
                                ? date.toLocaleDateString("en-US", {
                                    weekday: "short",
                                  })
                                : "Unscheduled"}
                            </div>
                            {date ? (
                              <div className={styles.upcomingGroupDate}>
                                {date.toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                })}
                              </div>
                            ) : null}
                          </div>
                          <div className={styles.upcomingMealTypeGroups}>
                            {groupedUpcomingMeals[dateKey].map(
                              ({ mealType, meals }) => (
                                <div
                                  className={styles.upcomingMealTypeGroup}
                                  key={mealType}
                                >
                                  <div className={styles.upcomingMealTypeTitle}>
                                    {formatMealType(mealType)}
                                  </div>
                                  <div className={styles.upcomingGroupMeals}>
                                    {meals.map((meal) => (
                                      <div
                                        className={cn(
                                          styles.upcomingMealRow,
                                          meal.passedCutoff && styles.upcomingMealRowPassed
                                        )}
                                        key={meal.id}
                                      >
                                        <div>
                                          <div className={styles.upcomingMealName}>
                                            {meal.name}
                                          </div>
                                          <div className={styles.upcomingMeta}>
                                            {meal.mealSubTypeDefinition ? (
                                              <span
                                                className={styles.upcomingMealSubType}
                                                style={{ color: meal.mealSubTypeDefinition.color }}
                                              >
                                                {meal.mealSubTypeDefinition.name}
                                              </span>
                                            ) : null}
                                            {settings.upcomingDetail === "detailed" &&
                                            meal.cuisine
                                              ? ` · ${meal.cuisine}`
                                              : ""}
                                            {settings.upcomingDetail === "detailed" &&
                                            meal.linkedRecipe?.title
                                              ? ` · ${meal.linkedRecipe.title}`
                                              : ""}
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}

            {visibleOverviewCount > 0 ? (
              <div
                className={cn(
                  styles.overviewGrid,
                  visibleOverviewCount === 1 && styles.overviewGridSingle
                )}
              >
                {settings.showMealActivity ? (
                  <div className={styles.card}>
                    <div className={styles.cardHeader}>
                      <div className={styles.cardTitle}>
                        <Fire aria-hidden="true" size={20} weight="regular" />
                        <span>Meal Activity</span>
                      </div>
                      <Button
                        asChild
                        className={styles.cardActionButton}
                        size="sm"
                        variant="outline"
                      >
                        <Link to="/stats">
                          <span>View Stats</span>
                          <ArrowRight aria-hidden="true" size={16} weight="regular" />
                        </Link>
                      </Button>
                    </div>

                    <div className={styles.heatmapWrap}>
                      <div className={styles.heatmapMonthRow}>
                        <div />
                        {heatmap.map((_, weekIndex) => (
                          <div className={styles.monthCell} key={weekIndex}>
                            {monthLabels[weekIndex] ?? ""}
                          </div>
                        ))}
                      </div>

                      <div className={styles.heatmapGrid}>
                        {["M", "", "W", "", "F", "", ""].map(
                          (label, dayIndex) => (
                            <div
                              className={styles.dayLabel}
                              key={`label-${dayIndex}`}
                              style={{ gridColumn: 1, gridRow: dayIndex + 1 }}
                            >
                              {label}
                            </div>
                          )
                        )}

                        {heatmap.map((week, weekIndex) =>
                          week.map((cell, dayIndex) => {
                            return (
                              <AccessibleHeatmapCell
                                cell={cell}
                                className={styles.heatmapSquare}
                                key={`${weekIndex}-${dayIndex}`}
                                onMouseEnterTooltip={(event, tooltipText) =>
                                  setTooltip({
                                    x: event.clientX,
                                    y: event.clientY,
                                    text: tooltipText,
                                  })
                                }
                                onMouseLeaveTooltip={() => setTooltip(null)}
                                style={{
                                  gridColumn: weekIndex + 2,
                                  gridRow: dayIndex + 1,
                                  background: getHeatColor(
                                    cell.meals,
                                    cell.isFuture
                                  ),
                                }}
                              />
                            );
                          })
                        )}
                      </div>

                      <div className={styles.heatmapLegend}>
                        <span className={styles.legendLabel}>Less</span>
                        {["var(--heatmap-empty)", "var(--heatmap-low)", "var(--heatmap-medium)", "var(--heatmap-high)"].map(
                          (color) => (
                            <div
                              className={styles.legendSquare}
                              key={color}
                              style={{ background: color }}
                            />
                          )
                        )}
                        <span className={styles.legendLabel}>More</span>
                      </div>
                    </div>
                  </div>
                ) : null}

                {settings.showGroceryList ? (
                  <div className={styles.card}>
                    <div className={styles.cardHeader}>
                      <div className={styles.cardTitle}>
                        <ShoppingCart aria-hidden="true" size={20} weight="regular" />
                        <span>Grocery Lists</span>
                      </div>
                      <Button
                        asChild
                        className={styles.cardActionButton}
                        size="sm"
                        variant="outline"
                      >
                        <Link to="/grocery-list">
                          <span>Full List</span>
                          <ArrowRight aria-hidden="true" size={16} weight="regular" />
                        </Link>
                      </Button>
                    </div>

                    <div className={styles.grocerySummary}>
                      <div>
                        <div className={styles.groceryListName}>
                          {groceryList?.name ?? "Loading this week's list"}
                        </div>
                        <div className={styles.groceryMeta}>
                          {groceryList
                            ? `Created ${new Date(
                                groceryList.createdAt
                              ).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                              })} · ${groceryList.totalItems} items`
                            : "Fetching current list"}
                        </div>
                      </div>

                      <div>
                        <div className={styles.groceryStatRow}>
                          <div>
                            <span className={styles.groceryStatBig}>
                              {groceryList?.checkedCount ?? 0}
                            </span>
                            <span className={styles.groceryStatLabel}>
                              {" "}
                              collected
                            </span>
                          </div>
                          <div>
                            <span className={styles.groceryStatBig}>
                              {groceryList
                                ? groceryList.totalItems -
                                  groceryList.checkedCount
                                : 0}
                            </span>
                            <span className={styles.groceryStatLabel}>
                              {" "}
                              remaining
                            </span>
                          </div>
                        </div>
                        <div className={styles.groceryBar}>
                          <div
                            className={styles.groceryBarFill}
                            style={{
                              width: `${groceryList?.completionPercentage ?? 0}%`,
                            }}
                          />
                        </div>
                        <div className={styles.groceryPct}>
                          {groceryList?.completionPercentage ?? 0}% complete
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      {tooltip ? (
        <div
          className={styles.tooltip}
          style={{
            left: tooltip.x + 12,
            top: tooltip.y - 32,
            position: "fixed",
            pointerEvents: "none",
          }}
        >
          {tooltip.text}
        </div>
      ) : null}
    </>
  );
}
