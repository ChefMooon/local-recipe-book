# Local Recipe Book Design System

Last updated: 2026-03-17
Owner: Product + Frontend Engineering
Source pages audited: Home, Meal Plan, Grocery Lists, Stats, Settings

## Purpose and scope

This document defines the production visual system currently implemented in the first five core pages. New pages should match these standards unless a future design version explicitly updates them.

Primary source files:

- src/renderer/globals.css
- src/renderer/components/layout/app-shell.module.css
- src/renderer/components/home/home-dashboard.module.css
- src/renderer/components/meal-plan/meal-plan.module.css
- src/renderer/components/grocery-list/grocery-list.module.css
- src/renderer/components/stats/ActivityHeatmap.module.css
- src/renderer/components/settings/settings.module.css
- src/renderer/components/ui/button.tsx
- tailwind.config.ts

## Design principles

- Warm utility: practical planning UI with culinary warmth.
- Soft structure: rounded cards, cream surfaces, low-contrast borders.
- Data-first: charts and progress indicators should be legible before decorative details.
- Consistent density: compact controls and tight spacing for high information pages.

## Color system

### Core tokens

Defined in src/renderer/globals.css.

| Token          | Hex     | Role                                                  |
| -------------- | ------- | ----------------------------------------------------- |
| --green        | #3B5E45 | Primary brand color, selected states, default buttons |
| --green-light  | #5A7D63 | Hover state for green controls                        |
| --green-pale   | #D4E4D8 | Soft highlight backgrounds                            |
| --cream        | #F5F0E8 | App base background, form surfaces                    |
| --cream-dark   | #EDE6D6 | Borders, dividers, neutral tracks                     |
| --orange       | #C5622A | Accent color, eyebrow labels, accent CTA buttons      |
| --orange-light | #E8885A | Orange hover state                                    |
| --text         | #2C2416 | Primary text                                          |
| --text-muted   | #7A6A58 | Secondary text and metadata                           |
| --white        | #FFFDF8 | Primary card surface                                  |

### Semantic aliases

Also defined in `src/renderer/globals.css` for utility frameworks and shared UI primitives.

- --background: #F5F0E8
- --foreground: #2C2416
- --card: #FFFDF8
- --primary: #3B5E45
- --secondary: #D4E4D8
- --accent: #C5622A
- --border: #EDE6D6
- --radius: 10px

### Theme option logic

The renderer theme is resolved from the persisted app preference and then applied
by setting the root dataset attribute used throughout the app. The current model is:

- `ui_theme` accepts the values `system`, `light`, or `dark` and defaults to `system`.
- `system` resolves against `window.matchMedia("(prefers-color-scheme: dark)")` and
  applies the matching root theme automatically.
- `light` and `dark` bypass the OS preference and lock the app to one palette.
- The effective theme is surfaced as `document.documentElement.dataset.theme`, which
  drives the CSS variable set in `src/renderer/globals.css`.

Custom theme profiles are a separate persisted object: `ui_custom_theme_profile`.
This is a versioned profile payload, not a new built-in theme mode. The schema
requires:

- `version: 1`
- `id`: a stable slug identifier
- `name`: user-facing profile name
- `tokens`: a semantic token set covering background, surface, muted, elevated,
  foreground, border, primary, accent, success/warning/danger states, focus,
  overlay, chart grid, chart series, and heatmap values

Custom themes should be treated as a semantic-token override layer on top of the
active base theme. They must keep the same layout contract and accessibility
checks as the built-in palettes, even when the base theme is dark or the custom
profile introduces a more saturated palette.

### Dark-mode rules

Runtime UI surfaces must use semantic variables rather than literal light-palette
colors. Use `var(--background)` for page surfaces, `var(--card)` for cards and
panels, `var(--muted)` for secondary bands and intermediate editor regions, and
`var(--text)` or `var(--text-muted)` for content and metadata. Use the semantic
accent variables for selected, warning, and destructive states so their contrast
survives both themes.

The active theme should always be read through the semantic token contract rather
than hard-coded background or text colors. This remains true when a custom theme
profile is active: the semantic names remain stable while the underlying values
change.

Literal warm-white backgrounds, light cream gradients, and light-mode dark text
are only appropriate when the surface is explicitly part of print/export output.
White foreground text is appropriate on intentionally saturated green or orange
controls. New CSS modules should be checked with `html[data-theme="dark"]` and
must keep labels, disabled controls, drag handles, focus rings, and intermediate
editor panels distinguishable from their surrounding surface.

Dark surfaces use three levels of elevation: `--background` for the page,
`--card` for standard panels, and `--card-elevated` for focused or interactive
content such as chat inputs and popovers. The Electron title bar has its own
`--header-*` tokens; do not reuse page-surface tokens for its navigation or
window controls. `--border` is reserved for structural boundaries and must
remain at least 3:1 against both the page and card surfaces in dark mode.

When custom themes are previewed or applied, preserve the same elevation model and
focus treatment; do not swap to ad hoc token names or hard-coded colors within
components unless the token set explicitly defines a replacement.

### Data visualization palette

Current chart and heatmap palette used by Home and Stats.

- Heatmap levels: #E4DDD0, #A8C8B0, #6FA882, #3B5E45
- Bar/area variants: #3B5E45, #4D7A5A, #6FA882, #A8C8B0, #C5DDC9, #E4DDD0

### Elevation

- --shadow: 0 2px 12px rgba(44, 36, 22, 0.1)
- --shadow-lg: 0 6px 28px rgba(44, 36, 22, 0.14)

Use --shadow for standard cards and --shadow-lg for emphasized panels, popovers, and hover elevation.

## Typography

### Font families

- Display serif: Georgia
- UI sans: system-ui

These are configured in `tailwind.config.ts` as `font-serif` and `font-sans`. CSS modules use Georgia/system fallbacks where needed.

### Type scale and usage

| Usage              | Font      | Size                        | Weight  | Notes                        |
| ------------------ | --------- | --------------------------- | ------- | ---------------------------- |
| Page title         | Georgia   | 2rem (or clamp on Settings) | 700     | Used in all audited pages    |
| Section/card title | Georgia   | 1rem to 1.35rem             | 700     | Card and module headings     |
| KPI number         | Georgia   | 2rem to 3rem+               | 700     | Stats and progress emphasis  |
| Eyebrow label      | system-ui | 0.72rem to 0.78rem          | 700-800 | Uppercase + tracked          |
| Body text          | system-ui | 0.88rem to 0.98rem          | 500-600 | Descriptions and helper copy |
| Metadata           | system-ui | 0.65rem to 0.78rem          | 600-700 | Dates, badges, legends       |

### Text styling conventions

- Eyebrows: uppercase, letter-spacing 0.12em, accent color.
- Long-form helper copy uses muted text color.
- Display titles use serif and tight line-height (about 1.05 to 1.2).

## Logo usage

Current implementation lives in `src/renderer/components/layout/app-shell.tsx`.

### Approved marks

- Full header lockup: Local Recipe Book wordmark (default)
- Text-only wordmark: use the current header treatment in constrained contexts

### Sizing and spacing

- Header height: 64px
- The current header uses a text-only Local Recipe Book wordmark.
- Maintain at least 0.5rem clear space around the wordmark.

### Incorrect usage

- Do not place the full logo on cream gradients without a dark backing.
- Do not substitute fonts for the wordmark.
- Do not rotate or recolor the wordmark text.

## Spacing and layout

### Global container

From app shell:

- Desktop page frame: max-width 1200px; padding 2rem 2rem 4rem
- Mobile frame (<=768px): padding 1.25rem 1rem 3rem

### Common spacing rhythm

- Card radius: 16px to 18px
- Control radius: 8px to 12px
- Large section gap: 1.25rem to 1.75rem
- Small row gap: 0.4rem to 0.8rem

### Page header pattern

Shared by Meal Plan, Grocery Lists, and Settings:

- Left cluster: eyebrow, page title, short subtitle
- Right cluster: primary action and context controls
- Layout: wrap-friendly flex row with 1rem gap

### Grids in production

- Home overview: auto + 1fr
- Grocery page: 260px + 1fr
- Stats sections: 2-column at large breakpoints
- Settings card forms: 2-column collapsing to 1-column at <=768px
- Calendar week board: 128px + 7 columns with horizontal overflow support

### Breakpoints in active use

- 900px: calendar controls and board adjustments
- 768px: nav collapse and settings grid collapse
- 600px: persona grid reduction
- 480px: compact spacing refinements

## UI components

### Navigation shell

- Sticky top bar with green background and white text.
- Desktop nav uses subtle translucent active backgrounds.
- Mobile menu appears below header with orange bottom border.

### Cards

Base card pattern used across Home, Grocery, Stats, and Settings:

- Surface: var(--white)
- Border: 1px solid rgba(59, 94, 69, 0.08 to 0.12)
- Radius: 16px to 18px
- Shadow: --shadow

### Buttons

Primary variants from `src/renderer/components/ui/button.tsx`:

- default: green background, white text
- accent: orange background, white text
- outline: cream background, bordered neutral
- ghost: text-only green action

Page-specific use:

- Meal Plan primary action uses green add button.
- Grocery primary page action uses orange new-list button.
- Settings destructive actions use red-tinted outline treatment.
- Modal primary submit, create, save, import, and generate actions use the
  orange accent token (`--accent`) via `variant="accent"`.
- Destructive modal actions retain destructive-token styling, and cancel or
  other neutral actions use outline or ghost variants.

### Inputs and controls

- Inputs are cream-toned with 1 to 1.5px neutral borders.
- Focus ring: green border plus soft green outline glow.
- Segmented controls and filter tabs use rounded pill geometry.
- Toggle switches use compact 36x20 track with white thumb.

### Status and metadata elements

- Eyebrows and section labels rely on uppercase tracked system-ui.
- Progress indicators use rounded tracks and green gradients.
- Pill badges and tiny labels stay within 0.65rem to 0.75rem range.

### Data visualization

- All charts are wrapped in standard white cards.
- Grid lines use #E4DDD0 with dashed style for low visual noise.
- Tooltip surfaces use warm white with soft border and rounded 8px corners.
- Heatmap cells are square with subtle hover scale motion.

### Modal and popover surfaces

- Overlay dimming uses the semantic `--overlay` token.
- Panel surfaces use `--card`, `--foreground`, `--border`, and elevation tokens
  rather than literal light-theme colors, so they remain legible in dark and
  custom themes.
- Dialogs must expose an accessible name through a visible title or explicit
  label, and descriptions should be associated when supporting text is
  present.
- Modal focus moves into the panel when it opens, remains contained while the
  modal is active, and returns to the trigger when it closes. Escape and
  overlay dismissal are supported unless the modal is intentionally
  non-dismissible or an operation is in flight.
- Close controls are disabled while an in-flight operation prevents dismissal.
- Entry animation: subtle fade and upward motion.

## Iconography

The application uses one coherent UI icon system based on Phosphor Icons for
React. This renderer visual system does not change packaged Electron branding
assets.

### Current state

The implementation retains a small set of explicit visual exceptions:

- Utility icons: Phosphor components resolved directly or through the shared
  visual wrapper and semantic renderer registry
- Unicode and emoji glyphs: retained only where they represent user content or
  data labels rather than UI actions
- User-authored emoji: supported by custom persona editing
- Dot indicators: color dots for meal type and activity intensity

### Phosphor migration target

- Use `@phosphor-icons/react` as the renderer icon library for UI-facing
  navigation, actions, status marks, controls, and placeholders.
- Prefer semantic icon names and a consistent default weight and size. The
  shared visual wrapper defaults to regular weight, 18px, and `currentColor`;
  bold is reserved for selected, favourite, and destructive emphasis.
- Keep icon sizes stable: 16px to 18px for dense controls, 20px to 22px for
  standard controls, and 24px or larger only for empty states or prominent
  page modules.
- Use `currentColor` through the semantic theme tokens. Do not introduce
  literal light-palette colors in icon components or CSS modules.
- Preserve visible button and link labels unless an icon-only control is
  clearly established as familiar and space-constrained.
- Every icon-only control must retain an accessible name through its existing
  `aria-label` or an equivalent text label. Native `title` may supplement
  pointer discovery, but is never the only accessible name or a keyboard/touch
  dependency. Validate the computed accessible name rather than raw attributes.
- Decorative icons must use `aria-hidden="true"` and must not become a second
  accessible name for their parent control.
- Preserve focus-visible outlines, hit-area dimensions, disabled states, and
  hover/active behavior when replacing an icon implementation.

### Control tooltip and accessibility contract

- Rendered control tooltips use the shared Radix primitive and are reserved for
  icon-only or unfamiliar controls. Clearly labeled controls do not receive
  redundant tooltip text.
- Tooltip surfaces consume the semantic `--tooltip-background`,
  `--tooltip-foreground`, `--tooltip-border`, and `--tooltip-shadow` variables,
  which follow the active built-in light or dark theme tokens.
- Tooltip content is supplementary pointer and keyboard discovery. It must not
  provide the control's accessible name, become a workflow dependency, or be
  required for touch use. The control must have a stable computed accessible
  name independently of both the tooltip and native `title`.
- Tooltips trigger on pointer hover and keyboard focus, dismiss on blur and
  Escape, render in a portal, and remain usable inside dialogs and custom
  themes. A tooltip that explains an unavailable action is associated through
  `aria-describedby`; a tooltip that repeats an existing accessible name is not.
- Explanations for unavailable actions must not rely on native `disabled` plus
  `title`. Keep the trigger focusable with `aria-disabled="true"`, guard the
  action, and expose the reason programmatically.
- Compact icon controls provide at least a 32px hit area; standard icon
  buttons provide at least 40px. Invisible padding or hit-zone expansion may
  preserve an existing glyph size and layout. Hover-revealed actions must also
  appear on keyboard focus.
- Browser QA helpers enforce the minimum hit area and verify that tooltip text
  supplements, rather than names, controls. Route QA should use computed-name
  assertions for every named control it exercises.
- The first Escape dismisses an open tooltip inside a dialog; a subsequent
  Escape closes the dialog. Modal focus containment and focus restoration remain
  owned by the modal primitive.

### Deliberate exceptions

Phosphor is the standard for UI icons, not a replacement for every visual mark:

- Keep user-entered persona emoji as user content. The persona editor may
  continue to use an emoji input and placeholder.
- Keep QR-code SVG output generated by `qrcode`; it is data, not an interface
  icon.
- Keep chart series, heatmap cells, meal-type color dots, and swatches as data
  visualization primitives. They should continue to use the chart and theme
  tokens rather than arbitrary icon glyphs.
- Keep the packaged Electron/installer icon in `resources/` out of this UI
  migration unless a separate branding change is approved.
- Platform-specific window controls may use Phosphor-rendered marks, but must
  retain their platform-specific sizing, hit areas, labels, and behavior.

### Page-sweep rules

- Treat the app shell as a shared surface and validate it once before checking
  route-specific pages.
- Sweep routes in the established browser QA order: `/connect`, `/`,
  `/meal-plan`, `/recipes`, `/recipes/:recipeId`, `/grocery-list`,
  `/grocery-list/shop/:id`, `/prep-lists`, `/prep-lists/prep/:id`, `/stats`,
  and `/settings`.
- Do not place React component values in domain data modules merely to render
  filter icons. Store semantic icon keys and map them to Phosphor components at
  the renderer boundary.
- Replace repeated stars, arrows, close marks, edit/delete marks, and action
  glyphs consistently instead of choosing a different icon family per page.
- Recheck light, dark, and custom-theme token combinations because icon
  contrast and currentColor inheritance can change without changing layout.
- Record any icon that cannot be mapped cleanly as an explicit exception in
  the implementation plan rather than silently keeping a mixed treatment.
- Store semantic filter icon keys in domain data and resolve them through the
  typed renderer registry; do not store React components or presentation
  glyphs in domain modules.

Avoid heavy multi-color illustration icons. Phosphor should support the warm
utility direction with restrained, mostly single-color marks.

## Imagery and photography

Current product styling is icon-led, not photography-led.

- No stock photography in the audited pages.
- Background identity comes from gradient atmosphere and card layering.
- If photography is introduced in future pages, use warm natural-light food imagery with low saturation and avoid high-contrast studio looks.

## Voice and tone for UI copy

Observed voice across the audited pages:

- Practical and encouraging
- Brief and directive
- Warm but not playful in critical actions

Copy rules:

- Prefer concise imperatives for actions: Add Meal, Open List, Today.
- Keep helper text one sentence where possible.
- Error and destructive copy should remain neutral and explicit.

## Code tokens and implementation references

### CSS tokens

Use `src/renderer/globals.css` as the source of truth for CSS variables.

### Tailwind mappings

Use `tailwind.config.ts` for framework-level token parity:

- colors.green, colors.cream, colors.orange, colors.text, colors.white
- borderRadius.card, borderRadius.btn, borderRadius.chip
- boxShadow.card, boxShadow.lg

### Component tokens

Use `src/renderer/components/ui/button.tsx` variants to avoid one-off button styling in new pages unless a page-specific CTA treatment is required.

## Accessibility baseline

WCAG contrast checks for key production pairs:

| Pair               | Contrast | Result                           |
| ------------------ | -------- | -------------------------------- |
| #2C2416 on #F5F0E8 | 13.50:1  | Pass AAA                         |
| #2C2416 on #FFFDF8 | 15.07:1  | Pass AAA                         |
| #7A6A58 on #F5F0E8 | 4.59:1   | Pass AA for normal text          |
| #3B5E45 on #FFFDF8 | 7.19:1   | Pass AAA                         |
| #FFFDF8 on #C5622A | 4.01:1   | Pass AA for large text only      |
| #C5622A on #F5F0E8 | 3.59:1   | Pass AA for large text only      |
| #607568 on #0D1410 | 3.77:1   | Pass for non-text boundaries     |
| #607568 on #18241D | 3.24:1   | Pass for non-text boundaries     |
| #527F60 on #173025 | 3.07:1   | Pass for active navigation state |

Implementation rules:

- Keep body text at or above 0.875rem when using muted color.
- Avoid using orange as the only carrier for small text.
- Preserve focus-visible outlines on interactive elements.
- Ensure keyboard navigation for tabs, modals, popovers, and list actions.
- Treat 3:1 as the minimum for structural boundaries, active states, and other
  non-text UI indicators; treat 4.5:1 as the minimum for normal-size text.
- Keep contrast token assertions covered by the focused theme regression test.

## New page checklist

- Use the global page frame and warm gradient background.
- Start with eyebrow + serif title + muted subtitle.
- Build content from card surfaces using existing radii and shadows.
- Use button variants from shared UI primitives first.
- Reuse section labels and progress visual language.
- Verify color contrast for any newly introduced combinations.

## Version history

| Version | Date       | Summary                                                                                                                              |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1.2     | 2026-08-13 | Documented the Phosphor icon migration target, accessibility contract, and deliberate visual exceptions                              |
| 1.1     | 2026-08-12 | Added the dark-mode and custom-theme option logic, including `system`/`light`/`dark` resolution and the semantic token profile model |
| 1.0     | 2026-03-17 | Initial design system grounded in Home, Meal Plan, Grocery Lists, Stats, and Settings implementation                                  |
