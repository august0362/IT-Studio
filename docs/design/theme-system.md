# IT Studio theme system

UX-05 · Updated 2026-10-16

## Design principles

A quiet command centre: near-neutral ink and paper surfaces, a single confident accent, compact typography and clearly separated work areas. Colour identifies actions and status; it does not fill the workspace. Opaque panels and restrained elevation keep long sessions and dense tables comfortable. Chat has a reading rhythm, useful Markdown hierarchy and flat code blocks. Selected navigation has a persistent line in addition to its background.

All 21 existing theme IDs are retained verbatim. This deliberately avoids a lossy migration of an owner's saved palette. Each palette now uses the same low-chroma surface architecture with separately derived light and dark accents. Defaults remain Arctic Focus (light) and Neon Gold (dark). The gallery's Focus, Calm, Warm, Creative and Dark-native filters curate the collection without hiding saved selections.

Final themes: Arctic Focus, Midnight Focus, Deep Forest, Harbor, Royal Ink, Spring Grove, Berry Dusk, Espresso, Blush Lavender, Vintage Dawn, Sherbet, Peach Cream, Candy Floss, Lemon Sky, Honey Sand, Autumn Ember, Summer Meadow, Winter Stone, Neon Gold, Neon Cyan and Neon Violet. Neon names remain for compatibility; continuous glow and glass are no longer part of the shared presentation.

Pipeline Studio and the process viewer retain their intentionally black, isolated canvas (D35/D40).

## Token reference

Components use semantic variables, mapped into Tailwind in `apps/desktop/src/index.css`. Contract colour names retain their existing shapes in `@itstudio/schemas`.

| Role          | CSS tokens                                                                                                       | Usage                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Surfaces      | `--color-bg`, `--color-surface`, `--color-surface-alt`                                                           | Workspace, panels, selected rows/code/user messages                                                                 |
| Content       | `--color-text`, `--color-text-muted`                                                                             | Primary and secondary copy; both readable on every surface                                                          |
| Actions       | `--color-primary`, `--color-primary-fg`, `--color-primary-hover`, `--color-accent`                               | Solid actions and links, companion accent                                                                           |
| Boundaries    | `--color-border`, `--color-focus-ring`                                                                           | Control edges and visible keyboard focus                                                                            |
| Status        | `--color-success`, `--color-warning`, `--color-danger`, `--color-info`                                           | Pair with existing labels/icons; never communicate by colour alone                                                  |
| Data          | `--color-chart-1` … `--color-chart-6`                                                                            | Categorical series, at least 3:1 on all surfaces                                                                    |
| Compatibility | `--color-glow`, `--color-surface-glass`, `--color-border-glow`, `--color-gradient-start`, `--color-gradient-end` | Still applied/reset on switches; shared panels remain opaque                                                        |
| Type          | `--font-ui`, `--font-code`, `--text-caption`, `--text-body`, `--text-title`, `--ui-scale`                        | Segoe UI Variable/Segoe UI/system sans; Cascadia Code/Consolas/monospace; 12/14/24 px roles at 100%                 |
| Spacing       | `--space-1`, `--space-2`, `--space-3`, `--space-4`, `--space-6`, `--space-8`                                     | 4, 8, 12, 16, 24, 32 px at 100%                                                                                     |
| Density       | `--control-height`, `--control-padding`, `--row-padding`                                                         | Comfortable 38 px minimum / 6 px control inset / 12 px rows; compact 30 px minimum / 3 px control inset / 7 px rows |
| Shape         | `--radius-control`, `--radius-panel`, `--radius-pill`                                                            | 8 px controls, 12 px panels, pill badges                                                                            |
| Elevation     | `--shadow-low`, `--shadow-panel`, `--shadow-dialog`                                                              | Small control/panel shadow, modal separation; no per-row shadow or blur                                             |
| Motion        | `--duration-fast`, `--duration-normal`, `--ease-standard`                                                        | 120/180 ms; colour changes and preview-card transform only                                                          |
| Layers        | `--z-sticky`, `--z-popover`, `--z-dialog`, `--z-toast`                                                           | 10 / 30 / 50 / 60                                                                                                   |

Fonts use the native offline stack. Segoe UI on the Windows target supports Vietnamese diacritics; system sans is the fallback on other platforms. No font package, CDN request or new dependency is needed. QA should inspect accented uppercase and lowercase copy at each scale.

Shared classes cover buttons, text controls, native checkbox/radio accents, switches, tabs/navigation, cards, tables, dialogs, alerts/toasts, chips, tooltips, code, scrollbars and empty states. Existing roles, labels and test IDs stay intact. `Button`, `Input`, `Select`, `Textarea`, `Card`, `Chip` and `KpiTile` are the React primitives; chat composer and Appearance/settings fields use them. Feature screens with native controls inherit the same token styling.

## Appearance and persistence

Theme ID, mode and locale still save through `settings.update`; sidecar settings remain authoritative for those existing fields. The pre-paint `itstudio.theme` cache retains the same identity/mode fields. New device-local preferences are additive fields in that same storage object:

| Field       | Values                                          | Default       |
| ----------- | ----------------------------------------------- | ------------- |
| `accent`    | `theme`, `ocean`, `grove`, `ember`, `alternate` | `theme`       |
| `density`   | `comfortable`, `compact`                        | `comfortable` |
| `fontScale` | `small`, `default`, `large`                     | `default`     |
| `motion`    | `full`, `reduced`, `system`                     | `system`      |

Accent choices use the current variant's validated info, success, warning or companion tokens. Labels continue using that variant's primary foreground. Hover does not lower colour contrast. Resetting accent to Theme default restores the original primary. Density changes shared controls, table rows, navigation and chat spacing; font scale changes the root rem scale to 93.75%, 100% or 112.5% without animating layout.

The cache writer merges fields so a theme/mode/locale save cannot erase appearance preferences. Zod validates local input; corrupt/missing fields use independent defaults. Blocked storage shows an inline save error for the new controls. The shared schema and sidecar are deliberately unchanged: these are presentation preferences scoped to this device.

`ThemeSync` reapplies the appearance on theme changes, system colour-scheme changes, and preference events, and cleans up its listeners. The gallery follows the OS live in System mode. Hover previews stay local to the preview panel; selecting a card saves the selection.

The generated boot script applies theme, mode, accent, density, typography and motion before React paints. Runtime and boot parity tests cover all 21 themes × 2 modes × 5 accents. No migration is necessary because every legacy ID still resolves directly; unknown IDs retain the existing default fallback.

## Accessibility and performance

The generator and automated contrast suite independently enforce body text ≥7:1, secondary/status/action text ≥4.5:1, button labels ≥4.5:1, and control borders/focus/chart marks ≥3:1. Checks cover all three surfaces and every accent override. Full-opacity colours avoid composite backgrounds weakening these guarantees.

Focus is a visible two-pixel outline with offset; selected theme cards have a separate outline and check mark. Forced-colours mode uses system colours and selected-state outlines. Existing keyboard behaviour remains.

The OS reduced-motion preference always disables nonessential animation, even when Full is selected. Reduced does the same explicitly. System follows the OS. Continuous feature animations, pseudo-elements and smooth scrolling are covered by these rules. No backdrop filters, animated shadows or per-list-row effects are introduced. Theme changes update CSS variables; existing lists retain their rendering/data behaviour.

## Adding or adjusting a theme

1. Add metadata/palette to `THEME_META` in `scripts/design/derive-themes.mjs`. Keep existing IDs stable. Existing palette image metadata remains the source reference; the generator does not write outside the task's design scope.
2. Derive near-neutral surfaces and palette accents in OKLCH. Adjust through the generator, never by hand-editing catalog colours. If derivation fails contrast, fix it before shipping.
3. Run `node scripts/design/derive-themes.mjs`. This regenerates `config/themes.json` and the startup script in `apps/desktop/index.html` together.
4. Run theme, appearance and primitive tests, updating only visual snapshots when intended. Run the project typecheck, lint and full test suite.
5. Review both variants in the gallery and the actual app. Any new accent option must be added to runtime validation, startup generation, translations and the contrast/parity tests.

This document describes the UX-05 implementation; THEMES.md and DARK-GLOW.md describe the previous visual baseline.

## QA screenshot list

Before landing, QA captures these mock-data views for **Arctic Focus, Neon Gold and Deep Forest**, each in **light and dark** (24 captures):

- Shell with sidebar, three project tabs, active navigation, status bar and a focused control.
- Chat with user/assistant messages, streaming state, code block, Markdown table/link, model/cost labels and a citation.
- Settings page with text inputs, selects, checkbox, disabled action, error feedback and a dialog.
- Appearance gallery with selected card, mini previews, mode selector, all four new controls and the live preview panel.

Additional spot checks: compact and large text at 1024×700; Vietnamese copy with `Tiếng Việt`, `Không gian của bạn`, `Mật độ`, `Chuyển động`; keyboard focus through cards; system colour-scheme changes; reduced motion; forced colours; Pipeline Studio/process viewer remaining black. Screenshots/native visual QA are a hand-back gate and are not claimed by unit tests.
