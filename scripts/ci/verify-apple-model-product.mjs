import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Check linked symbols, not source text or launch preferences: the mock endpoint must exist only in integration test products. */
export function verifyAppleModelSymbols(profile, symbols) {
  if (!['production', 'integration-test'].includes(profile))
    throw new Error('Unknown Apple model product profile');
  const mock = symbols.includes('_OBJC_CLASS_$_OrotAppleModelMock');
  const realSession = /FoundationModels\d+LanguageModelSession/.test(symbols);
  if (profile === 'production' ? mock || !realSession : !mock || realSession)
    throw new Error('Foundation Models product boundary does not match ' + profile);
  return {
    profile,
    modelExecution: profile === 'production' ? 'apple-sdk' : 'mock',
    mockEndpoint: mock,
    realSession,
  };
}

export function verifyAppleModelProduct(profile, app) {
  const executable = execFileSync(
    'plutil',
    ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', join(app, 'Info.plist')],
    { encoding: 'utf8' },
  ).trim();
  if (executable !== 'Orot') throw new Error('Expected the Orot application product');
  const paths = [join(app, executable), join(app, executable + '.debug.dylib')].filter(existsSync);
  if (!paths.length) throw new Error('Missing application code');
  const binaries = paths.map((path) => {
    if (!lstatSync(path).isFile()) throw new Error('Expected a regular application code file');
    const symbols = execFileSync('xcrun', ['nm', '-j', path], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return {
      path: resolve(path),
      sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
      symbols,
    };
  });
  const result = verifyAppleModelSymbols(
    profile,
    binaries.map((value) => value.symbols).join('\n'),
  );
  return { ...result, binaries: binaries.map(({ path, sha256 }) => ({ path, sha256 })) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [profile, app] = process.argv.slice(2);
  if (!app)
    throw new Error('Usage: verify-apple-model-product.mjs <production|integration-test> <app>');
  console.log(JSON.stringify(verifyAppleModelProduct(profile, app), null, 2));
}
