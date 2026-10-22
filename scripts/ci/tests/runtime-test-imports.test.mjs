import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeRuntimeTestImports, isJestTestOnlyPath } from '../runtime-test-imports.mjs';
import { withWorkspace, write } from './support/runtime-test-import-workspace.mjs';

// These cases keep Jest-only paths in macOS scope whenever app or E2E code imports them.

test('only maintained Jest-style source test paths qualify for macOS exclusion', () => {
  assert.equal(isJestTestOnlyPath('apps/mobile/src/recording/__tests__/panel.test.tsx'), true);
  assert.equal(isJestTestOnlyPath('packages/storage/__tests__/querySupport.ts'), true);
  assert.equal(isJestTestOnlyPath('apps/mobile/src/recording/panel.tsx'), false);
  assert.equal(isJestTestOnlyPath('apps/mobile/e2e/panel.test.ts'), false);
  assert.equal(isJestTestOnlyPath('apps/mobile/ios/OrotUITests/PanelTests.swift'), false);
});

test('relative imports from application and E2E sources keep a candidate in macOS scope', () => {
  withWorkspace((root) => {
    const candidate = 'apps/mobile/src/recording/__tests__/panel.test.tsx';
    write(root, candidate, 'export const sample = true;');
    write(
      root,
      'apps/mobile/src/recording/Panel.tsx',
      "import { sample } from './__tests__/panel.test';\nexport { sample };\n",
    );
    write(
      root,
      'apps/mobile/e2e/recordingProbe.ts',
      "import { sample } from '../src/recording/__tests__/panel.test';\nvoid sample;\n",
    );

    const result = analyzeRuntimeTestImports([candidate], { root });

    assert.equal(result.status, 'referenced');
    assert.equal(result.reason, 'runtime-import-reference');
    assert.deepEqual(result.referencingImporters, [
      'apps/mobile/e2e/recordingProbe.ts',
      'apps/mobile/src/recording/Panel.tsx',
    ]);
  });
});

test('workspace package exports to a Jest helper remain in macOS scope', () => {
  withWorkspace((root) => {
    const candidate = 'packages/domain/__tests__/fixture.test.ts';
    write(root, candidate, 'export const value = true;');
    write(
      root,
      'packages/domain/package.json',
      JSON.stringify({
        name: '@orot/domain',
        exports: { './test-fixture': './__tests__/fixture.test.ts' },
      }),
    );
    write(root, 'apps/mobile/src/Consumer.ts', "import '@orot/domain/test-fixture';\n");

    const result = analyzeRuntimeTestImports([candidate], { root });

    assert.equal(result.status, 'referenced');
    assert.deepEqual(result.referencingImporters, ['apps/mobile/src/Consumer.ts']);
  });
});

test('checked-in TypeScript path aliases to Jest helpers are resolved', () => {
  withWorkspace((root) => {
    const candidate = 'packages/domain/__tests__/fixture.test.ts';
    write(root, candidate, 'export const value = true;');
    write(root, 'packages/domain/package.json', JSON.stringify({ name: '@orot/domain' }));
    write(
      root,
      'packages/domain/tsconfig.json',
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@domain-fixtures/*': ['__tests__/*'] },
        },
      }),
    );
    write(root, 'packages/domain/src/Consumer.ts', "import '@domain-fixtures/fixture.test';\n");

    const result = analyzeRuntimeTestImports([candidate], { root });

    assert.equal(result.status, 'referenced');
    assert.deepEqual(result.referencingImporters, ['packages/domain/src/Consumer.ts']);
  });
});

test('platform variants are resolved at the imported file suffix', () => {
  withWorkspace((root) => {
    const candidate = 'apps/mobile/src/feature.js/__tests__/panel.test.ios.js';
    write(root, candidate, 'export const value = true;');
    write(
      root,
      'apps/mobile/e2e/recordingProbe.ts',
      "import { value } from '../src/feature.js/__tests__/panel.test.js';\nvoid value;\n",
    );

    const result = analyzeRuntimeTestImports([candidate], { root });

    assert.equal(result.status, 'referenced');
    assert.deepEqual(result.referencingImporters, ['apps/mobile/e2e/recordingProbe.ts']);
  });
});

test('imports in Jest tests do not make another Jest test a runtime dependency', () => {
  withWorkspace((root) => {
    const candidate = 'packages/storage/__tests__/querySupport.ts';
    write(root, candidate, 'export const open = () => true;');
    write(root, 'packages/storage/package.json', JSON.stringify({ name: '@orot/storage' }));
    write(
      root,
      'apps/mobile/src/storage/__tests__/storage.test.ts',
      "import { open } from '../../../../../packages/storage/__tests__/querySupport';\nvoid open;\n",
    );

    const result = analyzeRuntimeTestImports([candidate], { root });

    assert.equal(result.status, 'unreferenced');
    assert.deepEqual(result.referencingImporters, []);
  });
});

test('literal require and re-export references are discovered', () => {
  withWorkspace((root) => {
    const candidate = 'packages/domain/__tests__/fixture.test.ts';
    write(root, candidate, 'export const value = true;');
    write(root, 'packages/domain/package.json', JSON.stringify({ name: '@orot/domain' }));
    write(
      root,
      'packages/domain/src/consumer.ts',
      "const fixture = require('../__tests__/fixture.test');\nexport { fixture } from '../__tests__/fixture.test';\n",
    );

    const result = analyzeRuntimeTestImports([candidate], { root });

    assert.equal(result.status, 'referenced');
    assert.deepEqual(result.referencingImporters, ['packages/domain/src/consumer.ts']);
  });
});
