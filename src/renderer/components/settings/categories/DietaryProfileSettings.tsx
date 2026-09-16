import { ChipList } from "@/components/settings/ChipList";
import { CollapsibleSection } from "@/components/settings/CollapsibleSection";
import { TagCloud } from "@/components/settings/TagCloud";
import type { SettingsPreferences } from "@/lib/api";
import { CUISINE_OPTIONS } from "@shared/api/constants";

import { CategorySettingsPanel } from "./CategorySettingsPanel";
import styles from "../settings.module.css";
import {
	budgetOptions,
	cookingLengthOptions,
	dietaryOptions,
	nutritionOptions,
	skillOptions,
	type ArrayPreferenceField,
} from "../settings-types";

type DietaryProfileSettingsProps = {
	active: boolean;
	ariaLabelledBy: string;
	description: string;
	id: string;
	preferences: SettingsPreferences;
	householdSizeDraft: number;
	planningNotesDraft: string;
	onHouseholdSizeChange: (value: number) => void;
	onPlanningNotesChange: (value: string) => void;
	onImmediateArrayToggle: (field: ArrayPreferenceField, value: string) => void;
	onCuisineToggle: (group: "favoriteCuisines" | "avoidCuisines", value: string) => void;
	onChipAdd: (field: "avoidIngredients", values: string[]) => void;
	onChipRemove: (field: "avoidIngredients", value: string) => void;
	onChipReorder: (field: "avoidIngredients", values: string[]) => void;
	onImmediateField: <K extends keyof SettingsPreferences>(field: K, value: SettingsPreferences[K]) => void;
};

export function DietaryProfileSettings({
	active,
	ariaLabelledBy,
	description,
	id,
	preferences,
	householdSizeDraft,
	planningNotesDraft,
	onHouseholdSizeChange,
	onPlanningNotesChange,
	onImmediateArrayToggle,
	onCuisineToggle,
	onChipAdd,
	onChipRemove,
	onChipReorder,
	onImmediateField,
}: DietaryProfileSettingsProps) {
	return (
		<CategorySettingsPanel active={active} ariaLabelledBy={ariaLabelledBy} description={description} id={id}>
			<CollapsibleSection id="dietary-tab" label="Dietary Profile">
				<div className={styles.card}>
					<div className={styles.cardHeader}><h2 className={styles.cardTitle}>Household</h2></div>
					<div className={styles.twoColumn}>
						<div className={styles.fieldGroup}>
							<label className={styles.fieldLabel}>Household size</label>
							<div className={styles.rangeRow}>
								<input aria-label="Household size" className={styles.rangeInput} max={8} min={1} onChange={(event) => onHouseholdSizeChange(Number(event.target.value))} step={1} type="range" value={householdSizeDraft} />
								<div className={styles.rangeValue}>{householdSizeDraft}</div>
							</div>
						</div>
						<div className={styles.fieldGroup}>
							<label className={styles.fieldLabel}>Preferred cooking length</label>
							<select aria-label="Preferred cooking length" className={styles.select} onChange={(event) => onImmediateField("cookingLength", event.target.value)} value={preferences.cookingLength}>
								{cookingLengthOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
							</select>
						</div>
					</div>
				</div>
				<div className={styles.card}>
					<div className={styles.cardHeader}><h2 className={styles.cardTitle}>Dietary direction</h2></div>
					<TagCloud onToggle={(value) => onImmediateArrayToggle("dietaryTags", value)} options={dietaryOptions} selectedValues={preferences.dietaryTags} />
				</div>
				<div className={styles.card}>
					<div className={styles.cardHeader}><h2 className={styles.cardTitle}>Cuisines</h2></div>
					<div className={styles.cuisineColumns}>
						<div className={styles.cuisineColumn}><div className={styles.columnHeading}>Favorites</div><TagCloud onToggle={(value) => onCuisineToggle("favoriteCuisines", value)} options={CUISINE_OPTIONS} selectedValues={preferences.favoriteCuisines} tone="orange" /></div>
						<div className={styles.cuisineColumn}><div className={styles.columnHeading}>Avoid</div><TagCloud onToggle={(value) => onCuisineToggle("avoidCuisines", value)} options={CUISINE_OPTIONS} selectedValues={preferences.avoidCuisines} tone="red" /></div>
					</div>
				</div>
				<div className={styles.card}>
					<div className={styles.chipColumns}>
						<ChipList description="Allergies or hard avoidances. Drag to reprioritize." items={preferences.avoidIngredients} onAdd={(values) => onChipAdd("avoidIngredients", values)} onRemove={(value) => onChipRemove("avoidIngredients", value)} onReorder={(values) => onChipReorder("avoidIngredients", values)} placeholder="e.g. peanuts, shellfish" title="Avoid ingredients" />
					</div>
				</div>
				<div className={styles.card}>
					<div className={styles.cardHeader}><h2 className={styles.cardTitle}>Planning notes</h2><p className={styles.cardDescription}>Free-form context the AI uses when generating plans.</p></div>
					<textarea aria-label="Planning notes" className={styles.textarea} onChange={(event) => onPlanningNotesChange(event.target.value)} value={planningNotesDraft} />
				</div>
			</CollapsibleSection>
			<CollapsibleSection id="nutrition" label="Nutrition & Goals">
				<div className={styles.card}>
					<div className={styles.cardHeader}><h2 className={styles.cardTitle}>Nutrition focus</h2></div>
					<TagCloud onToggle={(value) => onImmediateArrayToggle("nutritionTags", value)} options={nutritionOptions} selectedValues={preferences.nutritionTags} />
				</div>
				<div className={styles.card}>
					<div className={styles.cardHeader}><h2 className={styles.cardTitle}>Skill & budget</h2></div>
					<div className={styles.twoColumn}>
						<div className={styles.fieldGroup}><label className={styles.fieldLabel}>Cooking skill level</label><select aria-label="Cooking skill level" className={styles.select} onChange={(event) => onImmediateField("skillLevel", event.target.value)} value={preferences.skillLevel}>{skillOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
						<div className={styles.fieldGroup}><label className={styles.fieldLabel}>Budget range</label><select aria-label="Budget range" className={styles.select} onChange={(event) => onImmediateField("budgetRange", event.target.value)} value={preferences.budgetRange}>{budgetOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
					</div>
				</div>
			</CollapsibleSection>
		</CategorySettingsPanel>
	);
}