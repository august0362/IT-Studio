# Dark glow themes

The dark workspace uses warm near-black surfaces, restrained gold/amber actions, thin luminous borders and soft glow. Content remains the strongest visual signal. Neon Gold is the default dark catalog theme because its warm base and amber focus cues suit long evening sessions and financial review. Saved theme choices and the Arctic Focus light default retain their existing behavior.

Neon Cyan offers cool, precise focus cues for coding and monitoring. Neon Violet offers a quieter creative mood for planning and ideation. Each theme has a complete light counterpart. The original 18 themes retain their existing color values.

## Tokens and fallbacks

All five additions are optional hex colors on `ThemeTokens`; CSS sets opacity and blur. The shared contract never accepts arbitrary CSS expressions.

| Token | Purpose | Fallback for existing themes |
| --- | --- | --- |
| `glow` | Soft focus/hover halo; never a text color | `primary` |
| `surfaceGlass` | Card and bar surface | `surface` |
| `borderGlow` | Luminous edge and selected-control cue | `border` |
| `gradientStart` | KPI background start | `bg` |
| `gradientEnd` | KPI background end | `surfaceAlt` |

The application and the generated startup script apply the same fallback mapping, so changing from a glow theme to a legacy theme clears all previous effect colors. Run `node scripts/design/derive-themes.mjs` after changing theme metadata. It updates the JSON catalog, the three deterministic four-band palette PNGs and the pre-React startup map together.

## Surfaces and elevation

Cards use a 16 px radius; buttons and inputs use 12 px. Small chips remain pills. Use the low shadow for code blocks (4 px offset, 16 px blur), panel shadow for cards (12/36 px), and dialog shadow for modal elevation (24/72 px). Shadow color comes from semantic text at low opacity; glow comes from its dedicated token at 12–18% opacity. Avoid stacking several saturated halos.

Glass is subtle: 96% of the surface color over the existing workspace background with 12 px backdrop blur where supported. Plain surfaces are the fallback. Modal cards remain opaque because their contrast must not depend on arbitrary content behind the overlay. KPI gradients use only background and alternate-surface endpoints; gradients never sit behind primary button labels.

## Component guidance

| Component | Existing presentation | Glow theme presentation |
| --- | --- | --- |
| Card | Flat surface and narrow radius | 16 px radius, thin token edge, restrained panel shadow and glass |
| Button | Small rectangular action | 40 px minimum height, 12 px radius, distinct primary/secondary/danger treatment and soft hover halo |
| Input | Plain border | 40 px minimum height, quiet background, visible outlined keyboard focus |
| Table | Dense text on surface | Stable text contrast, clear row separators, alternate header and hover surface, tabular numerals |
| Tabs | Color change alone | Selected border/inset line plus glow; preserve `aria-selected` |
| Navigation | Background highlight | Current-page line/glow plus existing text/icon and `aria-current` |
| KPI tile | Metric mixed with surrounding copy | Large 28–40 px tabular numeral, secondary label, quiet background gradient |
| Chip | Colored label | Compact outlined pill and readable status label; status is never color alone |

`Button`, `Card`, `Input`, `Chip` and `KpiTile` in `components/ui/primitives.tsx` take their visible text from callers. Formatting money remains the responsibility of the existing `Money` component. Shared dialog, retry actions, status bar, Markdown code/table presentation and theme preview use these visual rules without changing feature behavior.

## Contrast, motion and accessibility

Every theme/mode pair is checked for body text ≥7:1, secondary text and action labels ≥4.5:1, focus/accent ≥3:1, and status text ≥4.5:1. New glow borders also reach 3:1 on alternate surfaces. Glass composites and both gradient endpoints are checked, since decorative backgrounds may reduce contrast. Glow itself is decorative and does not carry meaning.

Keep keyboard focus as a 2 px outline with 3 px offset even when the glow is absent. Disabled controls retain readable labels and expose native disabled state. Hover and color transitions last 150 ms; no continuous ambient animation is added. `prefers-reduced-motion` disables motion/transition on shared controls. Forced-colors mode uses system Canvas/CanvasText colors and removes decorative shadows.

Dark primitive snapshots check stable semantic markup. Contrast, token fallback, pre-React startup default/cache behavior, theme filtering, keyboard selection and dialog focus tests guard the presentation contract. Final in-app review should check clipping at small window sizes and native backdrop rendering.
