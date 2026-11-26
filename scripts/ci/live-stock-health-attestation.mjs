import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const nativeFile = 'apps/mobile/ios/OrotMobile/LiveStockHealthAttestation.swift';
const start = '    // BEGIN GENERATED CHAT HEALTH DESCRIPTOR';
const end = '    // END GENERATED CHAT HEALTH DESCRIPTOR';
const stock = 'apps/mobile/src/aiFeatures/integration/healthContextToolDefinition.ts';
const topics = 'apps/mobile/src/healthEvidence/healthContext/types.ts';
const guide = 'packages/agent-runtime/src/multiAgent/guidedSchema.ts';

function load(rootPath, file, dependencies = {}) {
  const source = readFileSync(join(rootPath, file), 'utf8');
  const { outputText, diagnostics } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: file,
    reportDiagnostics: true,
  });
  if (diagnostics.length) throw new Error('Unable to compile stock descriptor input: ' + file);
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      if (!Object.hasOwn(dependencies, name))
        throw new Error('Unexpected descriptor dependency: ' + name);
      return dependencies[name];
    },
  });
  return exports;
}

/** Use the stock Conversation declaration and the same parameter adapter as the JS native registration. */
export function chatHealthDescriptorBytes(rootPath) {
  const definition = load(rootPath, stock, {
    '../../healthEvidence/healthContext/types': load(rootPath, topics),
  }).healthContextToolDefinition('rag');
  if (
    definition.id !== 'local-health-context' ||
    definition.sourceKind !== 'personal_record' ||
    definition.execution !== 'local_read_only'
  )
    throw new Error('The Stock Conversation health descriptor changed identity or scope.');
  const parameters = load(rootPath, guide).guidedSchema(definition.inputSchema);
  return Buffer.from(
    JSON.stringify(
      { name: definition.id, description: definition.description, parameters },
      (_key, value) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? Object.fromEntries(
              Object.keys(value)
                .sort()
                .map((key) => [key, value[key]]),
            )
          : value,
    ),
    'utf8',
  );
}

/** Regenerate only the exact Swift data constants; never rewrite the transport implementation. */
export function expectedNativeFile(rootPath) {
  const native = readFileSync(join(rootPath, nativeFile), 'utf8');
  const from = native.indexOf(start);
  const to = native.indexOf(end);
  if (
    from < 0 ||
    to < from ||
    native.indexOf(start, from + 1) >= 0 ||
    native.indexOf(end, to + 1) >= 0
  )
    throw new Error('The generated destination marker must be unique.');
  const bytes = chatHealthDescriptorBytes(rootPath);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const generated = [
    start,
    '    // Generated from the stock Conversation contract; do not edit.',
    '    private static let stockDigest = "' + digest + '"',
    '    private static let stockBytes =',
    ...bytes
      .toString('base64')
      .match(/.{1,96}/g)
      .map((row, index, rows) => '        "' + row + '"' + (index + 1 < rows.length ? ' +' : '')),
    end,
  ].join('\n');
  return {
    current: native,
    expected: native.slice(0, from) + generated + native.slice(to + end.length),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { current, expected } = expectedNativeFile(root);
  if (process.argv[2] === '--write') writeFileSync(join(root, nativeFile), expected);
  else if (process.argv[2] === '--check') {
    if (current !== expected)
      throw new Error(
        'Regenerate the Swift descriptor: node scripts/ci/live-stock-health-attestation.mjs --write',
      );
  } else throw new Error('Expected --check or --write.');
}
