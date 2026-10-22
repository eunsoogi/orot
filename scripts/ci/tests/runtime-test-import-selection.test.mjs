import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { selectChecksForPaths } from '../changed-paths-select.mjs';

function withRuntimeImportRoot(run) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'orot-selection-imports-'));
  try {
    for (const directory of ['apps/mobile/src', 'apps/mobile/e2e', 'packages'])
      mkdirSync(path.join(root, directory), { recursive: true });
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function write(root, relativePath, source) {
  const fullPath = path.join(root, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, source);
}

test('unreferenced Jest-only source changes retain quality, type and unit checks without macOS', () => {
  withRuntimeImportRoot((root) => {
    const testPath = 'apps/mobile/src/recording/__tests__/Panel.test.tsx';
    write(root, testPath, 'export const fixture = true;');

    const selection = selectChecksForPaths([testPath], null, { runtimeRoot: root });

    assert.equal(selection.runtime_test_import_analysis.status, 'unreferenced');
    assert.equal(selection.quality_inventory, true);
    assert.equal(selection.source_loc, true);
    assert.equal(selection.typecheck, true);
    assert.equal(selection.unit_tests, true);
    assert.equal(selection.ios_build, false);
    assert.equal(selection.ios_tests, false);
  });
});

test('runtime or E2E references keep a test-only change in macOS scope', () => {
  withRuntimeImportRoot((root) => {
    const testPath = 'apps/mobile/src/recording/__tests__/Panel.test.tsx';
    write(root, testPath, 'export const fixture = true;');
    write(
      root,
      'apps/mobile/e2e/recordingProbe.ts',
      "import '../src/recording/__tests__/Panel.test';\n",
    );

    const selection = selectChecksForPaths([testPath], null, { runtimeRoot: root });

    assert.equal(selection.runtime_test_import_analysis.status, 'referenced');
    assert.equal(selection.ios_build, true);
    assert.equal(selection.ios_tests, true);
  });
});

test('runtime dependencies that pass through a Jest helper keep the candidate in macOS scope', () => {
  withRuntimeImportRoot((root) => {
    const testPath = 'apps/mobile/src/__tests__/data.ts';
    write(root, testPath, 'export const fixture = true;');
    write(root, 'apps/mobile/App.tsx', "import './src/Consumer';\n");
    write(root, 'apps/mobile/src/Consumer.ts', "import './__tests__/bridge';\n");
    write(root, 'apps/mobile/src/__tests__/bridge.ts', "import './data';\n");

    const selection = selectChecksForPaths([testPath], null, { runtimeRoot: root });

    assert.equal(selection.runtime_test_import_analysis.status, 'referenced');
    assert.equal(selection.ios_build, true);
    assert.equal(selection.ios_tests, true);
  });
});

test('a real transcription RNTL-only change avoids macOS when runtime does not import it', () => {
  const testPath = 'apps/mobile/src/transcription/__tests__/TranscriptEvidencePanel.test.tsx';

  const selection = selectChecksForPaths([testPath]);

  assert.equal(selection.runtime_test_import_analysis.status, 'unreferenced');
  assert.equal(selection.typecheck, true);
  assert.equal(selection.unit_tests, true);
  assert.equal(selection.ios_build, false);
  assert.equal(selection.ios_tests, false);
});

test('ambiguous import analysis and mixed application changes retain macOS checks', () => {
  withRuntimeImportRoot((root) => {
    const testPath = 'apps/mobile/src/recording/__tests__/Panel.test.tsx';
    write(root, testPath, 'export const fixture = true;');
    write(
      root,
      'apps/mobile/src/recording/loader.ts',
      'export const load = (name) => import(name);',
    );
    write(root, 'apps/mobile/App.tsx', "import './src/recording/loader';\n");

    const ambiguous = selectChecksForPaths([testPath], null, { runtimeRoot: root });
    const mixed = selectChecksForPaths(
      [testPath, 'apps/mobile/src/recording/recordingController.ts'],
      null,
      { runtimeRoot: root },
    );

    assert.equal(ambiguous.runtime_test_import_analysis.status, 'unknown');
    assert.equal(ambiguous.ios_build, true);
    assert.equal(ambiguous.ios_tests, true);
    assert.equal(mixed.ios_build, true);
    assert.equal(mixed.ios_tests, true);
  });
});
