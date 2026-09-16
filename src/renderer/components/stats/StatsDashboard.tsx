"use client";

import { ActivityHeatmap } from "./ActivityHeatmap";
import { CuisineChart } from "./CuisineChart";
import { DayOfWeekChart } from "./DayOfWeekChart";
import { MealTypeChart } from "./MealTypeChart";
import { PlanVsLogCard } from "./PlanVsLogCard";
import { StatKpiRow } from "./StatKpiRow";
import { TopIngredientsList } from "./TopIngredientsList";
import { TopMealsList } from "./TopMealsList";
import { WeeklyTrendChart } from "./WeeklyTrendChart";
import { PageHeader } from "@/components/ui/PageHeader";

type HeatmapCell = { date: string; meals: number; isFuture: boolean };

export type StatsPayload = {
  heatmap: {
    weeks: HeatmapCell[][];
    monthStarts: Record<string, number>;
    totalSlots: number;
    totalDishes: number;
    activeDays: number;
    streak: number;
  };
  mealTypeBreakdown: { mealType: string; slotCount: number }[];
  cuisineBreakdown: { cuisine: string; count: number }[];
  weeklyTrend: { weekLabel: string; meals: number }[];
  dayOfWeekBreakdown: { day: string; count: number }[];
  planningWindow: {
    totalSlots: number;
    totalDishes: number;
    activeDays: number;
    avgSlotsPerActiveDay: number;
    avgDishesPerSlot: number;
    multiCourseRate: number;
  };
  topMeals: { mealName: string; count: number }[];
  topIngredients: { ingredient: string; count: number }[];
  pantry?: {
    summary: { trackedItems: number; lowStock: number; empty: number; expiringSoon: number; expired: number };
    analysis: {
      period: "30" | "90" | "365" | "all";
      historyStart: string | null;
      historyEnd: string | null;
      dataQuality: "full" | "partial" | "insufficient";
      estimate: boolean;
      eventCount: number;
      weeklyTrend: { weekLabel: string; consumedQuantity: number }[];
      topConsumed: { itemId: string; itemName: string; quantity: number }[];
    };
  };
};

type Props = {
  stats: StatsPayload;
  pantryPeriod?: "30" | "90" | "365" | "all";
  onPantryPeriodChange?: (period: "30" | "90" | "365" | "all") => void;
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-[0.72rem] font-extrabold uppercase tracking-[0.12em] text-text-muted after:h-px after:flex-1 after:bg-[var(--chart-grid)] after:content-['']">
      {children}
    </div>
  );
}

export function StatsDashboard({ stats, pantryPeriod = "30", onPantryPeriodChange }: Props) {
  const avgMealsPerActiveDay =
    stats.heatmap.activeDays > 0
      ? (stats.heatmap.totalSlots / stats.heatmap.activeDays).toFixed(1)
      : "—";

  const kpiCards = [
    { label: "Tracked meals", value: stats.heatmap.totalSlots },
    { label: "Active days", value: stats.heatmap.activeDays },
    {
      label: "Current streak",
      value: stats.heatmap.streak,
      sub: stats.heatmap.streak === 1 ? "day" : "days",
    },
    { label: "Avg meals / active day", value: avgMealsPerActiveDay },
    {
      label: "Avg dishes / meal",
      value: stats.planningWindow.avgDishesPerSlot.toFixed(1),
    },
    ...(stats.planningWindow.multiCourseRate > 0
      ? [
          {
            label: "Multi-course",
            value: `${Math.round(stats.planningWindow.multiCourseRate * 100)}%`,
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Stats"
        subtitle="A full year of meal tracking, patterns, and planning insights."
        title="Meal Activity"
      />

      <StatKpiRow cards={kpiCards} />

      <SectionLabel>52-Week Heatmap</SectionLabel>
      <div className="rounded-card border border-green/10 bg-white p-6 shadow-card">
        <ActivityHeatmap
          monthStarts={stats.heatmap.monthStarts}
          weeks={stats.heatmap.weeks}
        />
      </div>

      <SectionLabel>Trends</SectionLabel>
      <div className="grid gap-4 lg:grid-cols-2">
        <WeeklyTrendChart data={stats.weeklyTrend} />
        <DayOfWeekChart data={stats.dayOfWeekBreakdown} />
      </div>

      <SectionLabel>Breakdown</SectionLabel>
      <div className="grid gap-4 lg:grid-cols-2">
        <MealTypeChart data={stats.mealTypeBreakdown} />
        <CuisineChart data={stats.cuisineBreakdown} />
      </div>

      <SectionLabel>Planning</SectionLabel>
      <div className="grid gap-4 lg:grid-cols-2">
        <PlanVsLogCard
          activeDays={stats.planningWindow.activeDays}
          avgMealsPerActiveDay={stats.planningWindow.avgSlotsPerActiveDay}
          totalMeals={stats.planningWindow.totalSlots}
        />
        <TopMealsList meals={stats.topMeals} />
      </div>

      <SectionLabel>Ingredients</SectionLabel>
      <TopIngredientsList ingredients={stats.topIngredients} />

      {stats.pantry ? (
        <>
          <SectionLabel>Pantry</SectionLabel>
          <section className="rounded-card border border-green/10 bg-white p-6 shadow-card" aria-labelledby="pantry-stats-title">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="font-serif text-xl font-bold" id="pantry-stats-title">Pantry inventory</h2>
                <p className="mt-1 text-sm text-text-muted">
                  {stats.pantry.analysis.estimate ? "Estimated from the available inventory history." : "Based on the selected inventory history."}
                  {stats.pantry.analysis.historyStart ? ` History since ${new Date(stats.pantry.analysis.historyStart).toLocaleDateString("en-US", { month: "short", year: "numeric" })}.` : " No inventory history recorded yet."}
                </p>
              </div>
              <label className="text-sm font-semibold text-text-muted">Analysis period<select aria-label="Pantry analysis period" className="ml-2 rounded border border-border bg-card px-2 py-1 text-text" onChange={(event) => onPantryPeriodChange?.(event.target.value as "30" | "90" | "365" | "all")} value={pantryPeriod}><option value="30">30 days</option><option value="90">90 days</option><option value="365">365 days</option><option value="all">All available</option></select></label>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-5">
              {[["Tracked", stats.pantry.summary.trackedItems], ["Low stock", stats.pantry.summary.lowStock], ["Empty", stats.pantry.summary.empty], ["Expiring", stats.pantry.summary.expiringSoon], ["Expired", stats.pantry.summary.expired]].map(([label, value]) => <div className="rounded border border-border bg-muted p-3" key={label as string}><span className="block text-xs font-semibold uppercase text-text-muted">{label}</span><strong className="mt-1 block font-serif text-2xl">{value}</strong></div>)}
            </div>
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <div><h3 className="font-semibold">Weekly depletion</h3>{stats.pantry.analysis.weeklyTrend.length ? <ul className="mt-2 space-y-2">{stats.pantry.analysis.weeklyTrend.slice(-8).map((entry) => <li className="flex justify-between text-sm" key={entry.weekLabel}><span>{entry.weekLabel}</span><strong>{entry.consumedQuantity}</strong></li>)}</ul> : <p className="mt-2 text-sm text-text-muted">No consumption events in this period.</p>}</div>
              <div><h3 className="font-semibold">Most used items</h3>{stats.pantry.analysis.topConsumed.length ? <ol className="mt-2 space-y-2">{stats.pantry.analysis.topConsumed.map((entry) => <li className="flex justify-between text-sm" key={entry.itemId}><span>{entry.itemName}</span><strong>{entry.quantity}</strong></li>)}</ol> : <p className="mt-2 text-sm text-text-muted">No ranked consumption data yet.</p>}</div>
            </div>
            <p className="mt-4 text-xs text-text-muted" role="status">Data quality: {stats.pantry.analysis.dataQuality}. {stats.pantry.analysis.eventCount} inventory events included.</p>
          </section>
        </>
      ) : null}
    </div>
  );
}
