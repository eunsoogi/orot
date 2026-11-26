import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const source = fileURLToPath(new URL('../../../apps/mobile/src/', import.meta.url));

async function productionModules(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const modules = await Promise.all(
    entries.map((entry) => {
      const file = join(directory, entry.name);
      if (entry.isDirectory() && entry.name !== '__tests__') return productionModules(file);
      return entry.isFile() && /\.[cm]?tsx?$/u.test(entry.name) ? [file] : [];
    }),
  );
  return modules.flat();
}

function moduleSpecifiers(file, text) {
  const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const specifiers = [];
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier))
        specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const first = node.arguments[0];
      if (first && ts.isStringLiteralLike(first)) specifiers.push(first.text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      if (ts.isStringLiteralLike(node.argument.literal))
        specifiers.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return specifiers;
}

test('Conversation tool implementations do not import text or voice surfaces', async () => {
  const files = await productionModules(join(source, 'conversationTools'));
  assert.ok(files.some((file) => file.endsWith('/selectedRecordingTranscriptTool.ts')));
  for (const file of files) {
    for (const specifier of moduleSpecifiers(file, await readFile(file, 'utf8'))) {
      if (!specifier.startsWith('.')) continue;
      const target = relative(source, resolve(dirname(file), specifier));
      assert.doesNotMatch(
        target,
        /^(?:ragConversation|voiceConversation)(?:[/\\]|$)/u,
        `${relative(source, file)} imports a Conversation surface through ${specifier}`,
      );
    }
  }
});

/** Value-level dependencies survive type erasure. Include local literal lazy edges, not import types. */
function runtimeImports(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const imports = new Set();
  function add(value) {
    if (value && ts.isStringLiteralLike(value)) imports.add(value.text);
  }
  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (
        !clause ||
        (!clause.isTypeOnly &&
          (clause.name ||
            !clause.namedBindings ||
            !ts.isNamedImports(clause.namedBindings) ||
            !clause.namedBindings.elements.length ||
            clause.namedBindings.elements.some((item) => !item.isTypeOnly)))
      )
        add(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      const clause = node.exportClause;
      if (
        !clause ||
        !ts.isNamedExports(clause) ||
        !clause.elements.length ||
        clause.elements.some((item) => !item.isTypeOnly)
      )
        add(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node.moduleReference.expression);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return imports;
}

/** Breadth-first traversal reports the shortest actionable chain and stops on cycles. */
function findRuntimePath(entry, forbidden, read, resolveImport) {
  const queue = [[entry]];
  const visited = new Set([entry]);
  for (let index = 0; index < queue.length; index++) {
    const path = queue[index];
    const file = path.at(-1);
    if (file === forbidden) return path;
    for (const name of runtimeImports(file, read(file))) {
      const dependency = resolveImport(name, file);
      if (dependency && !visited.has(dependency)) {
        visited.add(dependency);
        queue.push([...path, dependency]);
      }
    }
  }
  return undefined;
}

test('the dependency guard follows an intermediate runtime re-export but ignores type imports', () => {
  const files = new Map([
    ['/shared.ts', "import type { Bridge } from './channel'; export { run } from './middle';"],
    ['/middle.ts', "export { type Bridge, run } from './domain';"],
    ['/domain.ts', "export const run = () => import('./channel');"],
    ['/channel.ts', 'export type Bridge = string;'],
  ]);
  const check = () =>
    findRuntimePath(
      '/shared.ts',
      '/channel.ts',
      (file) => files.get(file),
      (name, file) => join(dirname(file), name + '.ts'),
    );
  assert.deepEqual(check(), ['/shared.ts', '/middle.ts', '/domain.ts', '/channel.ts']);
  files.set(
    '/domain.ts',
    "import { type Bridge } from './channel'; export const run = () => null;",
  );
  assert.equal(check(), undefined);
});

test('the typed-read tool contribution does not depend on the Text execution facade', () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const src = join(repo, 'apps/mobile/src');
  const entry = join(src, 'conversationTools/conversationTypedReadContribution.ts');
  const facade = join(src, 'ragConversation/conversationExecutionNative.ts');
  const options = { moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true };
  const path = findRuntimePath(
    entry,
    facade,
    (file) => readFileSync(file, 'utf8'),
    (name, file) => {
      if (!name.startsWith('.')) return;
      const dependency = ts.resolveModuleName(name, file, options, ts.sys).resolvedModule
        ?.resolvedFileName;
      if (dependency?.startsWith(src + sep) && !dependency.endsWith('.d.ts')) return dependency;
    },
  );
  assert.equal(path, undefined, path?.map((file) => relative(src, file)).join(' -> '));
});
