// Maintained native tests can span non-obvious cohorts, so explicit inventory ownership takes precedence over filename heuristics.
export const maintainedNativeTestOwners = new Map([
  ['apps/mobile/ios/orotuitests/recordingexportuitests.swift', ['core-ui']],
  ['apps/mobile/ios/orotuitests/transcriptevidenceuitests.swift', ['core-ui']],
  ['apps/mobile/ios/orotuitests/pagedhealthrecordsuitests.swift', ['navigation']],
  ['apps/mobile/ios/orotuitests/unifiedimportuitests.swift', ['core-ui', 'health', 'navigation']],
  ['apps/mobile/ios/orotuitests/storagemigrationuitests.swift', ['calendar']],
  [
    'apps/mobile/ios/orotintegrationtests/navigationlayoutintegrationtests.swift',
    ['core-integration'],
  ],
]);
