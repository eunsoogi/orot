import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
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
