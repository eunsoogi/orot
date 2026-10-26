import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeRuntimeTestImports } from '../runtime-test-imports.mjs';
import { withWorkspace, write } from './support/runtime-test-import-workspace.mjs';

// Ambiguous or malformed loaders stay in macOS scope instead of being assumed safe.

test('chained loader aliases preserve literal and unresolved require edges', () => {
  withWorkspace((root) => {
    const candidate = 'packages/domain/__tests__/fixture.test.ts';
    const importer = 'packages/domain/src/consumer.ts';
    write(root, candidate, 'export const value = true;');
    write(root, 'packages/domain/package.json', JSON.stringify({ name: '@orot/domain' }));
    write(
      root,
      importer,
      "const first = require; const second = first; second('../__tests__/fixture.test');",
    );

    assert.deepEqual(analyzeRuntimeTestImports([candidate], { root }).referencingImporters, [
      importer,
    ]);

    write(root, importer, 'const first = require; const second = first; second(name);');
    assert.equal(analyzeRuntimeTestImports([candidate], { root }).status, 'unknown');

    write(root, importer, "const first = require; first.resolve('../__tests__/fixture.test');");
    assert.deepEqual(analyzeRuntimeTestImports([candidate], { root }).referencingImporters, [
      importer,
    ]);

    for (const source of ["new Function('return import(name)');", 'importScripts(name);']) {
      write(root, importer, source);
      assert.equal(analyzeRuntimeTestImports([candidate], { root }).status, 'unknown');
    }
  });
});

test('indirect eval remains ambiguous for runtime source analysis', () => {
  withWorkspace((root) => {
    const candidate = 'packages/domain/__tests__/fixture.test.ts';
    write(root, candidate, 'export const value = true;');
    write(root, 'packages/domain/package.json', JSON.stringify({ name: '@orot/domain' }));
    write(
      root,
      'packages/domain/src/consumer.ts',
      'const evaluate = eval; evaluate("require(name)");',
    );

    const result = analyzeRuntimeTestImports([candidate], { root });

    assert.equal(result.status, 'unknown');
    assert.equal(result.reason, 'dynamic-code-loader');
  });
});

test('computed require access remains ambiguous for runtime source analysis', () => {
  withWorkspace((root) => {
    const candidate = 'packages/domain/__tests__/fixture.test.ts';
    write(root, candidate, 'export const value = true;');
    write(root, 'packages/domain/package.json', JSON.stringify({ name: '@orot/domain' }));
    write(
      root,
      'packages/domain/src/consumer.ts',
      "const load = globalThis['require']; load(name);",
    );

    const result = analyzeRuntimeTestImports([candidate], { root });

    assert.equal(result.status, 'unknown');
    assert.equal(result.reason, 'dynamic-module-loader');
  });
});

test('ambient TypeScript require declarations do not hide static edges or excuse dynamic calls', () => {
  withWorkspace((root) => {
    const candidate = 'apps/mobile/src/feature/__tests__/feature.test.ts';
    const importer = 'apps/mobile/src/feature/consumer.ts';
    write(root, candidate, 'export const value = true;');
    write(root, 'apps/mobile/App.tsx', "import './src/feature/consumer';\n");
    write(
      root,
      importer,
      'declare const require: (specifier: string) => unknown;\n' +
        "export const loaded = require('./__tests__/feature.test');\n",
    );

    const staticResult = analyzeRuntimeTestImports([candidate], { root });
    assert.equal(staticResult.status, 'referenced');
    assert.deepEqual(staticResult.referencingImporters, [importer]);

    write(
      root,
      importer,
      'declare const require: (specifier: string) => unknown;\n' +
        'export const loaded = require(moduleName);\n',
    );
    const dynamicResult = analyzeRuntimeTestImports([candidate], { root });
    assert.equal(dynamicResult.status, 'unknown');
    assert.equal(dynamicResult.reason, 'dynamic-module-loader');
  });
});

test('nonliteral module loading, unreadable candidates, and malformed sources fail closed', () => {
  withWorkspace((root) => {
    const candidate = 'apps/mobile/src/feature/__tests__/feature.test.ts';
    write(root, candidate, 'export const feature = true;');
    write(root, 'apps/mobile/src/feature/loader.ts', 'export const load = (name) => import(name);');
    write(root, 'apps/mobile/App.tsx', "import './src/feature/loader';\n");

    const dynamic = analyzeRuntimeTestImports([candidate], { root });
    assert.equal(dynamic.status, 'unknown');
    assert.equal(dynamic.reason, 'dynamic-module-loader');

    write(
      root,
      'apps/mobile/src/feature/loader.ts',
      'const loadModule = require; export const load = (name) => loadModule(name);',
    );
    const aliasedDynamic = analyzeRuntimeTestImports([candidate], { root });
    assert.equal(aliasedDynamic.status, 'unknown');
    assert.equal(aliasedDynamic.reason, 'dynamic-module-loader');

    write(root, 'apps/mobile/src/feature/loader.ts', '/* unclosed comment');
    const malformed = analyzeRuntimeTestImports([candidate], { root });
    assert.equal(malformed.status, 'unknown');
    assert.equal(malformed.reason, 'source-read-or-parse-failed');

    const missing = analyzeRuntimeTestImports(
      ['apps/mobile/src/feature/__tests__/missing.test.ts'],
      { root },
    );
    assert.equal(missing.status, 'unknown');
    assert.equal(missing.reason, 'candidate-missing');
  });
});

test('unrelated paths are reported as not applicable', () => {
  const result = analyzeRuntimeTestImports(['apps/mobile/src/feature/Feature.tsx']);

  assert.equal(result.status, 'not-applicable');
  assert.equal(result.reason, 'no-jest-test-only-changes');
});
