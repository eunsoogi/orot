// Maintained native tests can span non-obvious cohorts, so explicit inventory ownership takes precedence over filename heuristics.
export const maintainedNativeTestOwners = new Map([
  ['apps/mobile/ios/orotintegrationtests/standardadapterintegrationtests.swift', ['provider']],
  ['apps/mobile/ios/orotuitests/recordingexportuitests.swift', ['recording-evidence']],
  ['apps/mobile/ios/orotuitests/transcriptevidenceuitests.swift', ['recording-evidence']],
  ['apps/mobile/ios/orotuitests/pagedhealthrecordsuitests.swift', ['navigation-routes']],
  [
    'apps/mobile/ios/orotuitests/unifiedimportuitests.swift',
    ['core-ui', 'health', 'navigation-imports'],
  ],
  ['apps/mobile/ios/orotuitests/storagemigrationuitests.swift', ['calendar-appointments']],
  ['apps/mobile/ios/orotuitests/manualhistoryuitests.swift', ['calendar-appointments']],
  [
    'apps/mobile/ios/orotintegrationtests/navigationlayoutintegrationtests.swift',
    ['core-integration'],
  ],
]);

// Shared UI and recording sources retain all of their independently scheduled test dependents.
export const sharedUiCohorts = [
  'core-ui',
  'recording-evidence',
  'navigation',
  'recordings',
  'questions',
  'calendar',
  'provider',
  'health',
  'microphone',
  'selection',
];
export const recordingCohorts = [
  'core-integration',
  'recording-evidence',
  'persistence',
  'isolation',
  'backup',
  'recordings',
  'microphone',
  'speech',
];

export const workflowProgressCohorts = ['core-integration'];
