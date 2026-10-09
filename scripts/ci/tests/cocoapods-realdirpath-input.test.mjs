import assert from 'node:assert/strict';
import test from 'node:test';
import { runCocoapodsFixture } from './fixtures/cocoapods-realdirpath.mjs';

const nulPath = '/fixture/react-native\0/ReactCommon';
const preservedException = /IDENTITY=preserved[\s\S]*BACKTRACE=preserved/;

// Keep each failing fixture tied to Ruby's original exception, not just its diagnostic text.
function failedOutput(result) {
  const output = result.stderr ?? '';
  assert.equal(result.status, 1, output);
  assert.match(output, preservedException);
  return output;
}

test('captures call-entry bytes and preserves errors before and after receiver mutation', () => {
  const result = runCocoapodsFixture();
  const output = failedOutput(result);
  const nulOffset = Buffer.byteLength('/fixture/react-native');

  assert.match(
    output,
    /OROT_COCOAPODS_NULL_BYTE_DIAGNOSTIC version=1\.17\.0[\s\S]*realdirpath_input="\/fixture\/react-native\\x00\/ReactCommon"/,
  );
  assert.match(
    output,
    new RegExp(
      `realdirpath_input_bytes=${Buffer.byteLength(nulPath)}[\\s\\S]*realdirpath_input_nul_offsets=${nulOffset}[\\s\\S]*realdirpath_input_nul_count=1`,
    ),
  );
  assert.equal(output.includes('\u0000'), false);

  const mutated = runCocoapodsFixture({ mutateReceiver: true });
  const mutatedOutput = failedOutput(mutated);
  assert.match(mutatedOutput, /realdirpath_input="\/fixture\/react-native\\x00\/ReactCommon"/);
  assert.doesNotMatch(mutatedOutput, /realdirpath_input="\/fixture\/mutated"/);
  const captureOutput = failedOutput(runCocoapodsFixture({ captureFailure: true }));
  assert.match(
    captureOutput,
    /realdirpath_input="<unavailable:IOError>"[\s\S]*realdirpath_input_bytes=unavailable/,
  );
});

test('captures NUL-free input while limiting symlink recovery to exact ArgumentError', () => {
  const basePath = '/fixture/react-native/ReactCommon';
  const result = runCocoapodsFixture({ basePath, injectRealdirpathError: true });
  const output = failedOutput(result);

  assert.match(
    output,
    new RegExp(
      `realdirpath_input="\\/fixture\\/react-native\\/ReactCommon"[\\s\\S]*realdirpath_input_bytes=${Buffer.byteLength(basePath)}`,
    ),
  );
  assert.match(output, /realdirpath_input_nul_offsets=none[\s\S]*realdirpath_input_nul_count=0/);
  assert.match(
    output,
    new RegExp('realdirpath_input_scanned_bytes=' + Buffer.byteLength(basePath)),
  );
  // A matching subclass keeps diagnostic capture without activating symlink recovery.
  const subclass = runCocoapodsFixture({ pnpmSymlinkError: true, subclassRealdirpathError: true });
  const subclassOutput = failedOutput(subclass);

  assert.match(
    subclassOutput,
    /realdirpath_input="[^"]*node_modules\/react-native\/ReactCommon"[\s\S]*realdirpath_input_bytes=\d+/,
  );
  assert.match(subclassOutput, /realdirpath_input_nul_offsets=none[\s\S]*realdirpath_input_nul_count=0/);
  assert.doesNotMatch(subclassOutput, /PNPM_SYMLINK_REALDIRPATH/);
});

test('uses the pnpm-symlink fallback only after the matching realdirpath error', () => {
  const result = runCocoapodsFixture({ success: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr ?? '', /TEST_SUCCESS_RESULT=\["source\.h"\] calls=1/);

  const fallback = runCocoapodsFixture({ pnpmSymlinkError: true, success: true });
  assert.equal(fallback.status, 0, fallback.stderr);
  assert.match(fallback.stderr ?? '', /PNPM_SYMLINK_REALDIRPATH/);
  // The exact result proves CocoaPods still relativizes against the lexical symlink base.
  assert.match(fallback.stderr ?? '', /TEST_SUCCESS_RESULT=\["source\.h"\] calls=1/);

  const nulPath = runCocoapodsFixture({ pnpmSymlinkNulPath: true });
  assert.equal(nulPath.status, 1, nulPath.stderr);
  assert.match(nulPath.stderr ?? '', /NULL_BYTE_DIAGNOSTIC.*nul_count=1/);
});
