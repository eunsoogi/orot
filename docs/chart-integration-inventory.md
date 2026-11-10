# Chart integration source inventory

This ledger covers the chart consumers after the loading-state migration.
Runtime observations and their source revision are recorded in
[iOS validation coverage](ios-validation.md).

## Revision and scope

The inventory was checked against the loading candidate and the merged
loading-state tree at `f2ec6b28170aa2f05a3166d9b8d095543c14fc2d`.
The common acceptance candidate `7713852c0a26fff283284ab9733a5c76f2282b34`
preserves the same chart, Home, health-record and dependency files.

## Production consumers

| Screen and metric                                    | Route to renderer                                                                                                                                                      | Data contract and scope                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Home: sleep, heart rate, body mass, steps            | `routes/home/HomeMetrics.tsx` selects `HomeMetricCard` or its placeholder; `HomeMetricCard.tsx` adapts `homeMetricChart.ts` into `ui/charts/ChartPlot.tsx` using bars. | Selection is two to four unique metrics, initially sleep and heart rate. `metricProjection.ts` maps sleep to daily asleep minutes, steps to daily sum, heart rate to daily mean, and body mass to latest daily observation. The separate comparison uses daily means for body mass and heart rate, daily sums for steps, and daily sleep duration; partial days are excluded. Missing days remain null rather than zero. |
| Health-record category: blood pressure               | `HealthRecordsCategoryCard.tsx` -> `HealthRecordsCategoryCharts.tsx` -> `HealthRecordsLineChart.tsx` -> `ChartPlot` using lines.                                       | One chart per stored unit group; systolic and diastolic are distinct labeled series, with solid and dashed styles. Values are saved observations, not daily aggregates.                                                                                                                                                                                                                                                  |
| Health-record category: heart rate, steps, body mass | Same health-record path as blood pressure.                                                                                                                             | Each category and unit group has its own line chart. Points retain saved values, timestamps and source labels. Invalid numeric values or dates are dropped, instants are sorted, and duplicate instants are retained. The initial category page covers a month and `hasMore` reports partial coverage.                                                                                                                   |

The health-record sleep and other categories use event summaries rather than
statistical charts. Medication summaries, recording waveform, progress and
calendar controls are outside this chart inventory. A source search is not a
proof that later changes cannot introduce another consumer.

## Facade, dependencies and search result

Production `ChartPlot.tsx` is the only app source importing
`react-native-chart-kit/v2`. Its line and bar components use
`react-native-chart-kit` 7.0.4; `react-native-svg` 15.16.1 is its declared peer
and appears as `RNSVG` in `apps/mobile/ios/Podfile.lock`. Do not remove SVG
merely because there is one chart facade. The reviewed manifest and import
search found no second named chart library or direct per-screen library import.
Searches for common SVG, canvas and chart primitives found no other production
statistical renderer, but cannot prove the absence of an unusually named or
otherwise implemented drawing engine. Reinspect all production chart-shaped
code and the final dependency graph before claiming cleanup is complete.

`ui/charts/window.ts` partitions observations into windows with a default limit
of 100 entries; it does not decimate. Very large groups at one timestamp may
span windows. `ChartPlot` provides page controls, value text and source labels;
large font scale switches from the plot to a value-list presentation. These are
source observations, not native interaction or performance results.

## Loading, deletion and lifecycle

`useHomeMetrics.ts` invalidates its snapshot after local data
clear, source deletion and app return to active; load generations reject older
completions. Recoverable refresh failure retains a snapshot as stale, while a
new selection has a separate generation guard. Midnight schedules a refresh.
The component tests `useHomeMetricsInvalidation.test.tsx`,
`useHomeMetrics.test.tsx` and `HomeMetricsChartState.test.tsx` are relevant;
their presence here does not establish a pass at the integration revision.

At the baseline, `useHealthRecordCategoryPages.ts` retains pages on recoverable
refresh failure and rejects completions from older generations, but does not
subscribe to local deletion or clear events. On candidate `5fa8944802ce84fba603cdde00c27808ae3b872f`,
the hook subscribes to both events, increments its generation, clears retained
pages and reloads. Its candidate tests include
`useHealthRecordCategoryPagesInvalidation.test.tsx`. This is an inspected code
change, not a passing result, nor proof of permission-revocation propagation.
After integration, verify actual commit-to-event wiring, deletion during a
pending load, permission/access loss, failed refresh, focus/foreground,
selection and late completion. Distinguish cleared data from valid stale data.

## Evidence mapping and outstanding acceptance

- `metricProjection.test.ts` covers examples of gap/partial handling, latest
  weight versus comparison means, and zero versus missing. `HomeMetricCard.test.tsx`
  and `HomeMetricsChartState.test.tsx` observe the adapter with a mocked chart.
- `HealthRecordsChartAdapter.test.tsx` checks blood-pressure styles, separate
  units, invalid inputs, duplicate instants, coverage and provenance through a
  mocked facade. `healthRecordsChartModel.test.ts` checks saved pressure series.
  `healthRecordsChartGeometry.test.js` exercises library scale/label helpers.
- `ui/charts/__tests__/ChartPlot.test.tsx`, `model.test.ts` and `window.test.ts`
  cover shared data and window behavior. Mocked renderers do not establish
  native drawing, gestures, VoiceOver speech, geometry, or memory usage.
- Historical [records PR](https://github.com/eunsoogi/orot/pull/717) reports
  scoped passes and direct synthetic-device observations, but its failed or
  interrupted native runs do not prove value or diastolic speech. Historical
  [Home PR](https://github.com/eunsoogi/orot/pull/719) reports focused passes;
  its landscape request did not produce a changed app window. The two Home
  `.xcresult` bundles and supporting logs formerly in the archived `/4264/orot`
  checkout are unavailable. PR summaries do not replace those originals.
- Pending on the final common revision: old-to-new assertion mapping and
  regression sensitivity; loading, refresh, deletion, permission and late-result
  checks; real native values and VoiceOver; ordinary iPhone, Duo portrait and
  measured expanded/narrow windows; XXXL chart values; representative appearance
  and Reduce Motion; and dense synthetic data responsiveness and memory with
  dataset, environment and measurement limits recorded. Preserve first failures.
- Prepared native scenarios in `e6a5c4f1f1b1250def3cf60fe30558c31a298735`
  are unregistered and unexecuted. Parent ownership is needed for shared Xcode
  and Duo inventory registration; verify selectors and fixture applicability
  after integration. Store future results outside disposable worktrees.

## Reproduce the source inventory

Run these read-only commands from the repository root, replacing `REV` with
the final common full SHA after it is published. Review matches, dependencies,
fixtures and the diff; an empty search is not a complete visual audit.

```sh
git grep -n -E 'ChartPlot|react-native-chart-kit|LineChart|BarChart' REV -- apps/mobile/src apps/mobile/package.json
git grep -n -E "from ['\"](react-native-svg|.*chart|.*Chart)|<Svg|<Path|<Polyline|<Canvas" REV -- apps/mobile/src
git grep -n -E 'react-native-chart-kit|victory-native|react-native-svg-charts|react-native-gifted-charts|@shopify/react-native-skia|react-native-svg' REV -- '*package.json' apps/mobile/ios/Podfile.lock
git diff --name-status dbc9af7af5713a4be80f5f575b4a559bb54708d4 REV -- apps/mobile/src/routes/home apps/mobile/src/healthkit apps/mobile/src/ui/charts apps/mobile/package.json apps/mobile/ios/Podfile.lock pnpm-lock.yaml
```
