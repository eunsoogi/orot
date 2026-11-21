import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mobileRoot = new URL('../../../apps/mobile/', import.meta.url);
const source = (path) => readFileSync(new URL(path, mobileRoot), 'utf8');
const reviewScroll = 'recording-review-scroll';
const libraryCases = [
  'RecordingDeletionLatencyUITests',
  'RecordingDeletionRecoveryUITests',
  'RecordingLibraryUITests',
  'RecordingPlaybackUITests',
  'RecordingBackgroundRecoveryUITests',
];

test('library fixture XCTest selectors target the production review scroller', () => {
  // Component coverage independently asserts that the rendered library is inside this owner.
  assert.ok(source('src/recording/RecordingControls.tsx').includes(`testID="${reviewScroll}"`));
  const fixture = source('ios/OrotUITests/RecordingFixtureUITestConditions.swift');
  assert.ok(fixture.includes('"-OROT_TRANSCRIPTION_PROBE_MODE", "recording-library-visual"'));
  assert.ok(
    source('e2e/transcription/RecordingLibraryVisualProbe.tsx').includes('<RecordingScreen'),
  );
  for (const name of libraryCases) {
    const testSource = source(`ios/OrotUITests/${name}.swift`);
    assert.ok(testSource.includes('RecordingFixtureUITestConditions.launch('), name);
    assert.ok(testSource.includes(`"${reviewScroll}"`), name);
    assert.ok(!testSource.includes('"recording-controls-scroll"'), name);
  }
  // The capture helper below this marker has a separate, non-library contract.
  const libraryHelpers = fixture.split('static func prepareRecordingAction')[0];
  assert.ok(libraryHelpers.includes(`"${reviewScroll}"`));
  assert.ok(!libraryHelpers.includes('"recording-controls-scroll"'));
});

test('export keeps its separate scroller rather than borrowing the review selector', () => {
  assert.ok(
    source('e2e/transcription/RecordingExportProbeHarness.tsx').includes(
      'testID="recording-controls-scroll"',
    ),
  );
  assert.ok(
    source('ios/OrotUITests/RecordingExportUITests.swift').includes(
      'scrollID: "recording-controls-scroll"',
    ),
  );
});
