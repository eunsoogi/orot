# Orot Design System

This document defines the visual, interaction, and accessibility rules for new and existing screens and links them to the current implementation. See [README.md](README.md) for the product overview and [docs/development.md](docs/development.md) for development procedures.

## Basis and scope

Orot uses clear hierarchy, generous spacing, and familiar iOS controls. Branding, colors, and icon choices follow this design system. Screens show actual records, appointments, permissions, and errors. Example health information and availability states must never appear as real user data.

Repository source defines implemented color values and shared APIs. Use this document for reusable design rules. Keep release history and implementation progress out of this guide; record revision-specific verification evidence in the owning PR or issue.

## Visual principles

- Make one primary action clear on each screen. Use secondary buttons or quieter list rows for supporting actions.
- Distinguish the main heading, body, supporting information, and status. Let Korean sentences wrap naturally; do not truncate content to reproduce a sample line count.
- Establish hierarchy through background and card luminance and through primary and secondary text colors. Never communicate state through blue, red, or green alone.
- Use spacing and rounded corners to group information. Avoid meaningless decoration, stacked translucent backgrounds, and fixed elements that obscure content.
- Render empty, loading, error, selected, and disabled states from actual application state. Preserve medical provenance, warnings, save status, and permission boundaries.

## Colors

The shared palette is `appColorPalettes` and `appColors` in [`apps/mobile/src/layout/appColors.ts`](apps/mobile/src/layout/appColors.ts). Use the appropriate semantic token instead of adding arbitrary HEX values to screens.

| Role             | Light     | Dark      | Use                              |
| ---------------- | --------- | --------- | -------------------------------- |
| `primary`        | `#3182f6` | `#3182f6` | Emphasized icons and system tint |
| `primaryAction`  | `#1b64da` | `#1b64da` | Filled primary actions           |
| `onPrimary`      | `#ffffff` | `#ffffff` | Content on `primaryAction`       |
| `primaryText`    | `#1b64da` | `#9fc2ff` | Links and unfilled emphasis      |
| `primarySoft`    | `#e8f3ff` | `#18365a` | Subtle emphasis backgrounds      |
| `background`     | `#f2f4f6` | `#101318` | Screen canvas                    |
| `surface`        | `#ffffff` | `#1c222a` | Cards and input surfaces         |
| `text`           | `#191f28` | `#f2f4f6` | Primary content                  |
| `secondary`      | `#5e6875` | `#a1acb8` | Supporting text and metadata     |
| `border`         | `#e5e8eb` | `#38424e` | Dividers and outlines            |
| `warning`        | `#704800` | `#ffd89e` | Warning text                     |
| `warningSurface` | `#fff4d6` | `#3a2d18` | Warning backgrounds              |
| `danger`         | `#8a1c1c` | `#ffb4ab` | Error and risk text              |
| `dangerSurface`  | `#fde8e8` | `#48211f` | Error backgrounds                |
| `dangerAction`   | `#b3261e` | `#b3261e` | Filled destructive actions       |
| `onDanger`       | `#ffffff` | `#ffffff` | Content on `dangerAction`        |

On iOS, `primaryText`, state colors, backgrounds, surfaces, text, secondary text, and borders follow the system appearance through `DynamicColorIOS`. `primary`, `primaryAction`, `onPrimary`, `dangerAction`, and `onDanger` are fixed in both palettes. Other platforms currently use the light palette.

[`appColors.test.ts`](apps/mobile/src/layout/__tests__/appColors.test.ts) checks selected body, surface, secondary text, primary action, warning, and danger combinations for at least 4.5:1 contrast. This does not prove contrast across every screen or translucent surface, or readability on a device. Recheck affected combinations when changing colors or their backgrounds.

Next-visit questions have a separate [`NextVisitQuestionsTheme`](apps/mobile/src/nextVisitQuestions/types.ts). Its colors, spacing, radii, and type sizes are local to that feature until explicitly promoted into a shared API. [`nextVisitQuestionsRoutePresentation.ts`](apps/mobile/src/aiFeatures/integration/nextVisitQuestionsRoutePresentation.ts) builds theme colors as strings and must be checked when the palette changes.

## Typography and Dynamic Type

Use the system font. [`AppText`](apps/mobile/src/layout/AppText.tsx) currently supplies the default text color, not shared size or hierarchy tokens. Existing examples include 40pt titles on Home, Records, and Schedule; 24pt shared error-route titles; 15–16pt body text; and 17pt [`AppButton`](apps/mobile/src/layout/AppButton.tsx) labels. The next-visit theme uses a 30pt title, 16pt body, and 13pt caption.

Define the heading, body, and supporting roles before choosing sizes and line heights consistent with adjacent screens. Allow system text scaling. Avoid fixed heights and single-line limits that clip content. Inspect long Korean text, large text, and button labels in the running app. Do not disable scaling with `allowFontScaling={false}`.

Custom UIKit text must also support larger text. Scale labels with the system content-size category and allow their containers to grow without clipping or obscuring touch targets.

## Spacing, corners, icons, and touch targets

There is no app-wide shared spacing or corner-radius module yet. Existing screens repeat 8, 12, 16, 20, and 24pt gaps and 12–20pt card radii. Follow these ranges and neighboring density without presenting new values as shared tokens. The next-visit theme's `xs` 4pt, `sm` 8pt, `md` 12pt, `lg` 16pt, `xl` 20pt, `xxl` 24pt, and 12pt radius remain feature-local.

Current shared component dimensions:

- `AppButton`: minimum height 52pt, radius 16pt, horizontal padding 18pt.
- `NavigationActionButton`: minimum height 50pt, minimum width 72pt, radius 24pt.
- `NavigationGlassSurface`: default navigation surface 48pt; non-native fallback radius 28pt.
- `CheckboxIndicator`: 26pt symbol within a 44pt touch target.

Prefer the SF Symbols bridge in [`AppSymbol`](apps/mobile/src/layout/AppSymbol.tsx). Its default size is 20pt and can be set per screen. Decorative symbols are hidden from the accessibility tree, so their enclosing button or row must provide a meaningful accessible name.

Keep actual touch targets at least 44pt. The visible glyph size does not establish the touch target. Selected tabs distinguish both icon and label and expose their selected state to accessibility.

## Shared APIs and screen examples

| API                                                                         | Role and boundary                                                                                                            |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [`AppText`](apps/mobile/src/layout/AppText.tsx)                             | Applies the default text color. Screen styles own size and heading hierarchy.                                                |
| [`AppButton`](apps/mobile/src/layout/AppButton.tsx)                         | Provides primary/secondary buttons, disabled state, and accessible names. There is no shared loading or destructive variant. |
| [`AppSymbol`](apps/mobile/src/layout/AppSymbol.tsx)                         | Displays a decorative SF Symbol. The enclosing control owns its accessible name.                                             |
| [`CheckboxIndicator`](apps/mobile/src/layout/CheckboxIndicator.tsx)         | Draws a check indicator. The enclosing control owns selection and touch handling.                                            |
| [`NavigationActionBar`](apps/mobile/src/navigation/NavigationActionBar.tsx) | Connects root tabs or contextual back, home, and primary actions to navigation.                                              |
| [`SafeAreaLayout`](apps/mobile/src/layout/SafeAreaLayout.tsx)               | Handles safe areas and scrolling for standalone screens outside the shared navigation shell.                                 |

[`WelcomeRoute`](apps/mobile/src/routes/WelcomeRoute.tsx) separates actual appointment and recording states into cards, empty states, errors, and retry actions. [`RecordsRoute`](apps/mobile/src/routes/RecordsRoute.tsx) groups records and import actions. [`RouteLoadError`](apps/mobile/src/routes/RouteLoadError.tsx) presents recoverable errors with a heading, alert, and retry. Use [`AppointmentForm`](apps/mobile/src/appointments/AppointmentForm.tsx) as a reference for input labels and states. There is no shared input component yet.

## States and interaction

| State       | Presentation rule                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Loading     | Show a status or progress indicator while content is prepared. Expose asynchronous action state through `busy`.                        |
| Empty       | Distinguish it from an error. Explain the absence of data and the available next action.                                               |
| Error       | Use `danger` and announce the error. Provide a real recovery action when retry is possible.                                            |
| Disabled    | Preserve the reason and state and expose `disabled`. Opacity alone is insufficient.                                                    |
| Selected    | Combine a non-color cue such as a shape or symbol with the accessible selection state.                                                 |
| Destructive | Explain the consequence of deletion or cancellation and use native confirmation where needed. Do not use `danger` as a general accent. |

`AppButton` currently provides only `primary` and `secondary` variants. Screens handle loading and destructive operations through their state and native confirmation flows. Introduce a new shared variant only through a scoped change that accounts for affected consumers and contrast.

## Navigation, safe areas, and keyboards

Shared routes use [`NavigationRouteAdapter`](apps/mobile/src/navigation/NavigationRouteAdapter.tsx), [`NavigationViewport`](apps/mobile/src/navigation/NavigationViewport.tsx), [`NavigationRouteScrollView`](apps/mobile/src/navigation/NavigationRouteScrollView.tsx), and [`NavigationActionBar`](apps/mobile/src/navigation/NavigationActionBar.tsx). Do not shrink the screen to make room for a fixed bar. `NavigationViewport` measures the actual bar height, and scrolling content reserves that bottom inset so the final content remains visible. Do not add an inset twice when the parent already owns the safe area.

Standalone screens use [`SafeAreaLayout`](apps/mobile/src/layout/SafeAreaLayout.tsx). Preserve `automaticallyAdjustKeyboardInsets` and `keyboardShouldPersistTaps="handled"` on applicable scrolling screens, and verify `KeyboardAvoidingView` behavior for forms. The keyboard must not obscure the primary action or prevent scrolling.

iOS navigation uses native UIKit controls in [`NavigationGlassView.swift`](apps/mobile/ios/Navigation/NavigationGlassView.swift). Root tabs share one continuous system Glass surface, with one selection indicator that moves between tabs. Back and Home on inner screens each retain their own regular Liquid Glass surface without selected-tab emphasis. Primary task actions use prominent Glass. Do not stack extra translucent backgrounds over system material. The React Native fallback surface is a `View` and must not be described as native Liquid Glass.

The five root tabs and their accessible names are defined in [`rootTabs.ts`](apps/mobile/src/navigation/rootTabs.ts). Native tab composition lives in [`NavigationGlassComponents.swift`](apps/mobile/ios/Navigation/NavigationGlassComponents.swift) and [`NavigationGlassView.swift`](apps/mobile/ios/Navigation/NavigationGlassView.swift); the JavaScript fallback is [`RootTabActions.tsx`](apps/mobile/src/navigation/RootTabActions.tsx); height constants are in [`navigationLayout.ts`](apps/mobile/src/navigation/navigationLayout.ts). Root tabs and contextual actions have distinct sizing and selection behavior. Use the following root-tab dimensions and platform treatments:

| Property              | Native iOS                                                                                                                                                             | JavaScript fallback                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Root-tab surface      | 60pt surface with 52pt root controls                                                                                                                                                               | Minimum item height 52pt plus 4pt vertical surface padding on each side; may grow with large text |
| Icon and label        | SF Symbol 22pt medium, `UILabel` 12pt medium, gap 4pt                                                                                                                  | Icon 22pt/line 24pt, label 12pt/line 16pt, gap 2pt                                                |
| Selected state        | Capsule around icon and label; `secondarySystemFill` with appearance-aware foreground, brighter in dark high contrast                                                  | Radius 26pt capsule with `primaryAction` background and `onPrimary` foreground                    |
| Touch target          | Button height 52pt, minimum width 44pt                                                                                                                                 | Minimum item height 52pt and width 44pt                                                           |
| Material and emphasis | Root tabs share `UIGlassEffect` on iOS 26+ and system material on earlier iOS; primary task actions use `.prominentGlass()` or `.filled()`. Back and Home each use regular `.glass()` on iOS 26+ | React Native `View`; no native Liquid Glass material                                              |

The default detail surface is `NAVIGATION_SURFACE_HEIGHT` 48pt; the root-tab surface is 60pt. Do not interchange them. When the keyboard is hidden and the bar handles its own safe area, move the root-tab surface 10pt into the bottom inset to reduce excess screen-edge space. Keep the full available inset while the keyboard is visible. Native selected tabs use system fill colors while JavaScript uses the app's primary action color. Preserve the same recognizable selection hierarchy on both platforms.

Root-tab selection and contextual back/home/primary actions have different roles. Preserve routes, unsaved-input confirmation, and recording transition restrictions when changing their presentation.

## Screen composition patterns

Use these compositions for the corresponding flows. Preserve heading hierarchy, spacing, grouping, icon proportions, and action placement when adapting a screen to its content.

| Screen                  | Required composition                                                                                                                                                                                                         | Implementation boundary                                                                                                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Calendar classification | Large heading and subtitle, selected-AI card, one full-width import action, automatic classification of every upcoming event, grouped medical appointment rows with saved status and detail chevrons, secondary manual entry | [`MedicalAppointmentReviewView`](apps/mobile/src/medicalAppointments/MedicalAppointmentReviewView.tsx), [`MedicalAppointmentCandidateCard`](apps/mobile/src/medicalAppointments/MedicalAppointmentCandidateCard.tsx)           |
| Recording               | Heading and subtitle, prominent microphone, large timer, real waveform, consent row, and paired pause/save controls                                                                                                          | [`RecordingSessionPanel`](apps/mobile/src/recording/RecordingSessionPanel.tsx), [`RecordingWaveform`](apps/mobile/src/recording/RecordingWaveform.tsx), [`RecordingControls`](apps/mobile/src/recording/RecordingControls.tsx) |
| AI selection            | Heading and explanation, grouped local/ChatGPT choices, brand symbols, selected radio state, accessible pending selection, and reachable bottom confirmation                                                                 | [`ProviderSelectionScreen`](apps/mobile/src/providers/selection/ProviderSelectionScreen.tsx), [`ProviderSelectionOptionCard`](apps/mobile/src/providers/selection/ProviderSelectionOptionCard.tsx)                             |
| Record conversation     | Heading and provider card, right-aligned user bubbles, readable assistant responses, source cards, and an anchored multiline composer with a send/stop control                                                               | [`ConversationScreen`](apps/mobile/src/ragConversation/ConversationScreen.tsx), [`ConversationMessage`](apps/mobile/src/ragConversation/ConversationMessage.tsx)                                                               |

Use the shared dynamic palette, 24pt content-side spacing, and a hierarchy with approximately 30pt screen headings, 16pt body text, and 14pt supporting text. These values apply to these screen patterns rather than a global token API. Preserve their hierarchy when text scales or the keyboard opens.

Contextual navigation places Back at the left and Home at the right as separate regular Liquid Glass buttons without selected-tab emphasis. Keep 48pt-high targets, a compact 64pt Home control, and a visible gap between Home and the primary task action. Preserve the 22pt home glyph, 11pt contextual home label, and 12pt root-tab label. Persistent selection belongs only to root tabs. Animate changes in bar content and continuous root selection movement from the current presentation, so rapid navigation can interrupt smoothly. Reduce Motion settles the final state without movement. Render controls as interactive components rather than flattened images.

Runtime records, model names, availability, progress, and errors must be real. Waveform samples must come from microphone metering and represent silence and pause accurately. The calendar import action classifies all events in the displayed date range and automatically saves validated medical appointments. Inspecting an imported result only expands its explanation. External literature belongs to the conversation RAG flow, with exact-query consent, provenance, citations, and failure handling preserved.

## Accessibility and visual settings

- Give buttons, inputs, and rows accessible names, roles, and states that describe their actual behavior. Mark headings as headers and errors as alerts.
- Let enclosing controls convey the meaning of decorative symbols. Pair state colors with text, symbols, or selection shapes.
- Check that headings, buttons, inputs, and final scrolling content remain visible with large text.
- Inspect light and dark appearances and ensure text on translucent surfaces remains readable against its background.
- Preserve meaning and operability with increased contrast and Reduce Transparency. Native Glass follows system material while the JavaScript fallback uses explicit colors; verify both surfaces where applicable.
- Captures prove visible layout only. VoiceOver speech, touch targets, save/cancel behavior, and accessibility-setting responses need direct runtime checks of those behaviors.

## New-screen checklist

- Are colors expressed through semantic `appColors` tokens?
- Are heading, body, and supporting roles distinct and unclipped at large text sizes?
- Are empty, loading, error, disabled, selected, and destructive states represented?
- Do controls have accessible names, roles, and states, with touch targets of at least 44pt?
- Do safe areas, bottom navigation, and the keyboard leave final content and primary actions accessible?
- Has the running screen been inspected in light, dark, and large-text modes, and where relevant, increased contrast and Reduce Transparency?
- Are design references compared with authentic app captures, and are interaction and accessibility claims backed by checks recorded in the implementation PR or issue?
