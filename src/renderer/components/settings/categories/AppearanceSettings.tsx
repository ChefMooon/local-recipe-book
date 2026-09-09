import { useId } from "react";

import { CollapsibleSection } from "../CollapsibleSection";
import { SegmentedControl } from "../SegmentedControl";
import styles from "../settings.module.css";
import { ToggleSwitch } from "../ToggleSwitch";
import { RECIPE_DEFAULT_SORT_OPTIONS } from "@shared/api/constants";
import type { AppSettingTheme } from "@shared/config/settings";
import type { SettingsPreferences } from "@/lib/api";
import {
  homeUpcomingDetailOptions,
  mealBankPlacementOptions,
  recipeUnitOptions,
  recipeViewOptions,
  type HomeDashboardSettings,
  type MealBankPlacement,
} from "../settings-types";
import { CategorySettingsPanel } from "./CategorySettingsPanel";

export type AppearanceSettingsProps = {
  active: boolean;
  ariaLabelledBy: string;
  description: string;
  id: string;
  preferences: SettingsPreferences;
  themePreference: AppSettingTheme;
  mealBankPlacement: MealBankPlacement;
  homeDashboard: HomeDashboardSettings;
  onThemeChange: (value: string) => void;
  onMealBankPlacementChange: (value: string) => void;
  onHomeUpcomingDays: (value: number) => void;
  onHomeDetail: (value: string) => void;
  onHomeToggle: (
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
  ) => void;
  onImmediateField: <K extends keyof SettingsPreferences>(
    field: K,
    value: SettingsPreferences[K]
  ) => void;
  recipeDefaultSort: string;
  onRecipeDefaultSortChange: (value: string) => void;
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

export function AppearanceSettings({
  active,
  ariaLabelledBy,
  description,
  homeDashboard,
  id,
  mealBankPlacement,
  onHomeDetail,
  onHomeToggle,
  onHomeUpcomingDays,
  onImmediateField,
  onMealBankPlacementChange,
  onRecipeDefaultSortChange,
  onThemeChange,
  preferences,
  recipeDefaultSort,
  themePreference,
}: AppearanceSettingsProps) {
  return (
    <CategorySettingsPanel
      active={active}
      ariaLabelledBy={ariaLabelledBy}
      description={description}
      id={id}
    >
      <CollapsibleSection id="appearance" label="Appearance">
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Theme</h2>
            <p className={styles.cardDescription}>
              Choose the color scheme used by Local Recipe Book.
            </p>
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>Theme</label>
            <select
              aria-label="Theme"
              className={styles.select}
              onChange={(event) => onThemeChange(event.target.value)}
              value={themePreference}
            >
              <option value="system">Use system preference</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
        </div>
      </CollapsibleSection>
      <CollapsibleSection id="meal-bank" label="Meal Bank">
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Meal Bank sidecar</h2>
            <p className={styles.cardDescription}>
              Choose where unscheduled meals appear on the Meal Plan page. This
              preference is saved per device, including browser and iPad
              sessions.
            </p>
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>Sidecar placement</label>
            <SegmentedControl
              onChange={onMealBankPlacementChange}
              options={mealBankPlacementOptions}
              value={mealBankPlacement}
            />
            <p className={styles.fieldHint}>
              Bottom placement is usually best on tablets and narrow screens.
            </p>
          </div>
        </div>
      </CollapsibleSection>
      <CollapsibleSection id="home-dashboard" label="Home Dashboard">
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Home overview controls</h2>
            <p className={styles.cardDescription}>
              Choose what appears on the home screen and how upcoming meals are
              detailed.
            </p>
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>
              Upcoming meal range (days)
            </label>
            <div className={styles.rangeRow}>
              <input
                aria-label="Upcoming meal range"
                className={styles.rangeInput}
                max={30}
                min={1}
                onChange={(event) =>
                  onHomeUpcomingDays(Number(event.target.value))
                }
                step={1}
                type="range"
                value={homeDashboard.upcomingDays}
              />
              <div className={styles.rangeValue}>
                {homeDashboard.upcomingDays}
              </div>
            </div>
          </div>
          <div style={{ marginTop: "1rem" }}>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Upcoming detail level</label>
              <select
                aria-label="Upcoming detail level"
                className={styles.select}
                onChange={(event) => onHomeDetail(event.target.value)}
                value={homeDashboard.upcomingDetail}
              >
                {homeUpcomingDetailOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className={styles.toggleList} style={{ marginTop: "1rem" }}>
            <ToggleRow
              checked={homeDashboard.upcomingCompact}
              description="Use tighter spacing for the upcoming-meals section."
              label="Compact upcoming meals"
              onChange={(checked) =>
                onHomeToggle(
                  "upcomingCompact",
                  checked,
                  "home_upcoming_compact"
                )
              }
            />
            <ToggleRow
              checked={homeDashboard.showUpcomingMeals}
              description="Show the upcoming-meals card on the home page."
              label="Show upcoming meals"
              onChange={(checked) =>
                onHomeToggle(
                  "showUpcomingMeals",
                  checked,
                  "home_show_upcoming_meals"
                )
              }
            />
            <ToggleRow
              checked={homeDashboard.showMealActivity}
              description="Show the meal activity heatmap card in Overview."
              label="Show meal activity"
              onChange={(checked) =>
                onHomeToggle(
                  "showMealActivity",
                  checked,
                  "home_show_meal_activity"
                )
              }
            />
            <ToggleRow
              checked={homeDashboard.showGroceryList}
              description="Show the grocery list card in Overview."
              label="Show grocery lists"
              onChange={(checked) =>
                onHomeToggle(
                  "showGroceryList",
                  checked,
                  "home_show_grocery_list"
                )
              }
            />
            <ToggleRow
              checked={homeDashboard.showGreetingSubtitle}
              description="Show the date and subtitle under the greeting title on home."
              label="Show greeting date and subtitle"
              onChange={(checked) =>
                onHomeToggle(
                  "showGreetingSubtitle",
                  checked,
                  "home_show_greeting_subtitle"
                )
              }
            />
          </div>
        </div>
      </CollapsibleSection>
      <CollapsibleSection id="app" label="Recipes">
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Recipe display defaults</h2>
          </div>
          <div className={styles.twoColumn} style={{ marginTop: "1rem" }}>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Default recipe view</label>
              <SegmentedControl
                onChange={(value) =>
                  onImmediateField("defaultRecipeView", value)
                }
                options={recipeViewOptions}
                value={preferences.defaultRecipeView}
              />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Default unit mode</label>
              <SegmentedControl
                onChange={(value) => onImmediateField("defaultUnitMode", value)}
                options={recipeUnitOptions}
                value={preferences.defaultUnitMode}
              />
            </div>
          </div>
          <div className={styles.fieldGroup} style={{ marginTop: "1rem" }}>
            <label className={styles.fieldLabel}>
              Recipe library default sort
            </label>
            <select
              aria-label="Recipe library default sort"
              className={styles.select}
              onChange={(event) =>
                onRecipeDefaultSortChange(event.target.value)
              }
              value={recipeDefaultSort}
            >
              {RECIPE_DEFAULT_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className={styles.fieldHint}>
              Applied on Recipes when there is no active session sort override.
            </p>
          </div>
        </div>
      </CollapsibleSection>
    </CategorySettingsPanel>
  );
}
