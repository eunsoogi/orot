# Native design QA — 2026-10-10

## Scope and visual truth

This report covers the saved-question/edit revision, floating navigation spacing,
and the unified-import screen integrated from main. It is a native iOS review.

- Question reference: `/Users/eunsoo/Git/orot/_workspace/design-reference-20261010/17-saved-questions-edit.png`.
- Import reference: `/Users/eunsoo/Git/orot/_workspace/design-reference-20261010/09-import-observations.png`.
- Question comparison: `/tmp/orot-pr167-board17-comparison.png`.
- Import comparison: `/tmp/orot-pr167-import-comparison.png`.
- Question originals: `/tmp/orot-pr167-final-questions/`, run `2026-10-10 11-16-41Z`.
- Import originals: `/tmp/orot-pr167-release-9d54/`, run `2026-10-10 11-26-52Z`.

## Viewport and comparison method

The iOS 27 simulator renders 1206 × 2622 pixels at 3× density: 402 × 874
logical points. The question board is 1704 × 923 pixels; the import board is
1705 × 923 pixels. Their approximately 386 × 843 portrait panels represent
390 × 844 design frames. CSS dimensions do not apply to this React Native app.
The composites normalize portrait widths without changing aspect ratios.
System status areas are present in the app and omitted from the reference art.

Full-view comparisons include saved light/dark, edit light/dark, and import
light/dark. Original-resolution question and import screenshots were also
inspected. `saved-questions-bottom-clear.png` provides the focused bottom-area
check: both warning meanings and the final recommendation link remain above
the floating bar after scrolling to the end.

## Findings and accepted differences

No actionable P0/P1/P2 visual finding remains in these inspected states.

- Typography: native system type preserves the title/body/metadata hierarchy,
  readable Korean wrapping, and Dynamic Type. The generated reference does not
  identify an exact font file. Native antialiasing and glyph shapes are expected
  to differ from the image. Text is not baked into screenshots or clipped to
  match a sample line count.
- Spacing: compact appointment/provider rows, numbered question cards, evidence
  rows, a single warning group, and shared bottom actions follow the reference.
  The bar is shorter and closer to the bottom following the user's subsequent
  spacing correction. Its remaining bottom clearance is the system safe area.
- Color: light surfaces use the app's white/gray hierarchy; dark surfaces use
  dark canvas/cards with readable foreground colors. Blue actions, green saved
  status, and amber warnings retain their semantic roles in both appearances.
- Assets: the app uses native SF Symbols and UIKit Liquid Glass. Reference
  illustrations of system icons are represented by their native counterparts;
  no reference panel is embedded as product UI. Icons remain sharp at 3×.
- Content: actual question count, priority selection, appointment/time-zone
  details, provider identity, processing boundary, and warnings remain driven
  by state. The synthetic question probe has three questions where the mock
  has two. Import retains six selectable HealthKit categories and the existing
  authorization/storage notices. These functional details explain the denser
  content compared with the illustrative board.
- The wrench visible in the dedicated question probe opens test diagnostics.
  It is not present in the production app route.

## Comparison history

| Earlier finding | Correction | Post-fix evidence |
| --- | --- | --- |
| Large appointment/provider blocks dominated saved questions | Compact context rows and saved count/status heading | Four question-state originals and board-17 comparison |
| Warning cards occupied separate sections | One warning container after the question list; both meanings preserved | Saved/edit originals and bottom-clear capture |
| Light-mode input could retain dark-mode foreground | Recreate the native input when foreground changes while retaining controller draft | Light/dark edit captures and appearance regression test |
| Floating controls could cover final content | Measure the actual overlay and share its content inset across route scrollers | Bottom-clear native frame assertions and shared-inset regression tests |
| Excess space below the bar | Remove additional bottom padding and reduce the shared surface height | Native Home geometry assertion: at most the 34-point home safe area |
| Main's unified-import screen needed the shared shell | Integrate provider cards, primary action, scroll inset, and navigation guards | Import light/dark captures and real Records-to-import E2E |

## Interaction evidence and limits

- Dedicated question E2E passed: generation, editing, save, cancel, reload,
  evidence/caveat retention, appearance switching, and final-content clearance.
- Import E2E passed in the full Release run: real Records navigation, disabled
  action before selection, enabled action after selection, both appearances,
  bottom clearance, and native Back. It does not import personal device data.
- Deferred candidate-save integration checks pass for both Back and Home:
  navigation is blocked during persistence and released afterward. Removing
  the guard makes both regression cases fail.
- The Release run also checks root controls with XXXL text and keyboard-safe
  primary actions. Overall Release/remote CI status is reported separately;
  this visual report is not a merge-readiness or real-provider attestation.

## Implementation checklist

- [x] Inspect same-state light and dark question screenshots.
- [x] Compare import light/dark with the source board.
- [x] Inspect final content above the floating bar.
- [x] Preserve evidence, clinical caveats, source data, and saving guards.
- [x] Keep test diagnostics outside production UI.

## Final result

passed
