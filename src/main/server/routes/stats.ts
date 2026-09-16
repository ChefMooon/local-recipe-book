import { Hono } from "hono";
import { mealService, pantryService } from "../services.js";
import { endOfDay, getUpcomingDateRange, startOfWeek } from "../lib/date.js";

function getCurrentWeekRange() {
  const now = new Date();
  const monday = startOfWeek(now);
  const sunday = endOfDay(new Date(monday.setDate(monday.getDate() + 6)));

  return {
    from: monday.toISOString(),
    to: sunday.toISOString(),
  };
}

export const statsRoutes = new Hono();

statsRoutes.get("/stats", async (c) => {
  const periodQuery = c.req.query("pantryPeriod");
  const pantryPeriod = periodQuery === "90" || periodQuery === "365" || periodQuery === "all" ? periodQuery : "30";
  const [
    heatmap,
    mealTypeBreakdown,
    cuisineBreakdown,
    weeklyTrend,
    dayOfWeekBreakdown,
    planningWindow,
    topMeals,
    topIngredients,
    pantrySummary,
    pantryAnalysis,
  ] = await Promise.all([
    mealService.getHeatmap(52),
    mealService.getMealTypeBreakdown(),
    mealService.getCuisineBreakdown(),
    mealService.getWeeklyTrend(12),
    mealService.getDayOfWeekBreakdown(),
    mealService.getPlanningWindowStats(30),
    mealService.getTopMeals(10),
    mealService.getTopIngredients(15),
    pantryService.summary(),
    pantryService.analysis(pantryPeriod),
  ]);

  return c.json({
    data: {
      heatmap,
      mealTypeBreakdown,
      cuisineBreakdown,
      weeklyTrend,
      dayOfWeekBreakdown,
      planningWindow,
      topMeals,
      topIngredients,
      pantry: { summary: pantrySummary, analysis: pantryAnalysis },
    },
  });
});

statsRoutes.get("/stats/meal-summary", async (c) => {
  const daysQuery = c.req.query("days");
  const { from, to } =
    daysQuery === undefined
      ? getCurrentWeekRange()
      : getUpcomingDateRange(Number(daysQuery));
  const totalSlots = await mealService.getLiveMealCountInRange(from, to);
  return c.json({ data: { from, to, totalSlots } });
});
