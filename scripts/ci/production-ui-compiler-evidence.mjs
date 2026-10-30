import { createHash } from 'node:crypto';

/** Validate captured app compiler inputs without interpreting them as shell code. */
export function verifyCompilerEvidence(receipt, log, response) {
  const derived = receipt.argv[receipt.argv.indexOf('-derivedDataPath') + 1];
  if (
    receipt.responseCapturedDuringBuild !== true ||
    typeof response !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(receipt.captureStartedAt ?? '') ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(receipt.captureEndedAt ?? '') ||
    !(Date.parse(receipt.captureStartedAt) < Date.parse(receipt.captureEndedAt)) ||
    !/^\/[A-Za-z0-9_./-]+\/Orot\.SwiftFileList$/.test(receipt.swiftResponsePath ?? '') ||
    receipt.swiftResponsePath.split('/').includes('..') ||
    !receipt.swiftResponsePath.startsWith(derived + '/Build/Intermediates.noindex/') ||
    createHash('sha256').update(response).digest('hex') !== receipt.swiftResponseSha ||
    receipt.swiftResponseBeforeSha !== receipt.swiftResponseSha ||
    receipt.swiftResponseAfterSha !== receipt.swiftResponseSha
  )
    throw new Error('Missing captured Swift compiler response evidence');
  const files = response.trim().split('\n');
  if (
    !files.length ||
    files.some(
      (line) =>
        !/^\/[A-Za-z0-9_./-]+\.swift$/.test(line) ||
        line.split('/').includes('..') ||
        line.includes('OROT_TESTS'),
    ) ||
    !files.some((path) => path.endsWith('/AppDelegate.swift')) ||
    !files.some((path) => path.endsWith('/AppleFoundationModelsSession.swift'))
  )
    throw new Error('Unsupported or incomplete Swift compiler response');

  const lines = log.split('\n');
  const headers = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.startsWith('SwiftDriver') && /\bOrotMobile\b/.test(line));
  const success = lines.findIndex((line) => line.includes('** BUILD SUCCEEDED **'));
  if (success < 0 || headers.some(({ index }) => index >= success))
    throw new Error('App compiler records are not from the successful build');
  const expected = new Map([
    ['SwiftDriver OrotMobile normal arm64', 'builtin-SwiftDriver'],
    [
      'SwiftDriver\\ Compilation\\ Requirements OrotMobile normal arm64',
      'builtin-Swift-Compilation-Requirements',
    ],
    ['SwiftDriver\\ Compilation OrotMobile normal arm64', 'builtin-Swift-Compilation'],
  ]);
  const seen = new Set();
  const commands = [];
  for (const { line, index } of headers) {
    const key = [...expected.keys()].find((candidate) => line.startsWith(candidate + ' '));
    if (
      !key ||
      seen.has(key) ||
      !line.includes("(in target 'OrotMobile' from project 'OrotMobile')")
    )
      throw new Error('Unexpected app Swift compiler invocation');
    seen.add(key);
    const prefix = `    ${expected.get(key)} -- `;
    const command = lines[index + 2];
    if (!lines[index + 1]?.startsWith('    cd ') || !command?.startsWith(prefix))
      throw new Error('Incomplete app compiler record');
    const args = command.slice(prefix.length);
    const tokens = args.split(/\s+/);
    const references = tokens.filter((token) => token.includes('@'));
    if (
      args.includes('OROT_TESTS') ||
      references.length !== 1 ||
      references[0] !== '@' + receipt.swiftResponsePath ||
      tokens.filter((token) => token === '-module-name').length !== 1 ||
      tokens[tokens.indexOf('-module-name') + 1] !== 'Orot' ||
      tokens.filter((token) => token === '-target').length !== 1 ||
      !/^arm64-apple-ios[^\s]*-simulator$/.test(tokens[tokens.indexOf('-target') + 1] ?? '') ||
      tokens.some(
        (token, position) =>
          [
            '-filelist',
            '-primary-filelist',
            '-config',
            '-config-file',
            '-Xllvm',
            '-Xclang',
            '-load-plugin-library',
            '-load-plugin-executable',
            '-plugin-path',
            '-external-plugin-path',
          ].some((flag) => token === flag || token.startsWith(flag + '=')) ||
          (token.startsWith('-Xfrontend') &&
            (token !== '-Xfrontend' || tokens[position + 1] !== '-serialize-debugging-options')),
      )
    )
      throw new Error('Unsupported app Swift compiler arguments');
    commands.push(args);
  }
  if (seen.size !== expected.size || commands.some((value) => value !== commands[0]))
    throw new Error('Incomplete or conflicting app compiler invocations');
  const compilations = lines
    .slice(0, success)
    .filter(
      (line) =>
        line.startsWith('SwiftCompile ') &&
        line.includes("(in target 'OrotMobile' from project 'OrotMobile')"),
    );
  if (compilations.some((line) => !line.startsWith('SwiftCompile normal arm64 ')))
    throw new Error('Unexpected app Swift compilation variant');
  for (const file of ['AppDelegate.swift', 'AppleFoundationModelsSession.swift']) {
    if (
      !compilations.some(
        (line) => line.startsWith('SwiftCompile normal arm64 /') && line.includes('/' + file + ' '),
      )
    )
      throw new Error('Missing app Swift compilation record');
  }
  const products = derived + '/Build/Products/Release-iphonesimulator';
  const inputBundle = products + '/main.jsbundle';
  const app = products + '/Orot.app';
  const executed = lines
    .slice(0, success)
    .filter((line) => line.startsWith('+ '))
    .map((line) => line.split(/\s+/));
  const value = (tokens, flag) =>
    tokens.filter((token) => token === flag).length === 1
      ? tokens[tokens.indexOf(flag) + 1]
      : undefined;
  const bundled = executed.some(
    (tokens) =>
      tokens[1]?.endsWith('/node') &&
      tokens[2]?.endsWith('/react-native/scripts/bundle.js') &&
      tokens[3] === 'bundle' &&
      value(tokens, '--entry-file') === 'index.js' &&
      value(tokens, '--dev') === 'false' &&
      value(tokens, '--bundle-output') === inputBundle &&
      value(tokens, '--assets-dest') === app,
  );
  const output = executed.some(
    (tokens) =>
      tokens[1]?.endsWith('/hermesc') &&
      value(tokens, '-out') === app + '/main.jsbundle' &&
      tokens.includes(inputBundle),
  );
  if (!bundled || !output)
    throw new Error('Missing executed production JavaScript bundling evidence');
}
