import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('provider data prewarms only the host SDK and still executes the original native tests without a readiness substitute', () => {
  const source = readFileSync('.github/actions/ios-apple-model-host/action.yml', 'utf8');
  const start = source.indexOf('    - name: Record public Apple model host preparation');
  const end = source.indexOf(
    '    - name: Record the public on-device Apple model CLI diagnostic',
    start,
  );
  assert.ok(start >= 0);
  assert.ok(end > start);
  const step = source.slice(start, end);
  assert.match(step, /xcrun swift -swift-version 6 scripts\/ci\/prepare-apple-model-host\.swift/);
  assert.match(step, /apple-model-host\.log/);
  assert.ok(!step.includes('continue-on-error') && !step.includes('retry'));
  const preparation = readFileSync('scripts/ci/prepare-apple-model-host.swift', 'utf8');
  assert.match(preparation, /LanguageModelSession\(model: model\)\.prewarm\(\)/);
  assert.match(preparation, /"before": before/);
  assert.match(preparation, /"after": availability\(model\)/);
  assert.ok(!preparation.includes('.respond('));
  assert.match(preparation, /while availability\(model\) == "modelNotReady"/);
  assert.match(preparation, /let readinessBudgetSeconds: TimeInterval = 30/);
  // Preparation output is diagnostic; there is no generated answer or forced "available" outcome.
  assert.match(preparation, /case \.modelNotReady:\s*(?:return )?"modelNotReady"/);
  // Read-only host metadata separates this host's eligibility from its selected iOS Simulator; no setting or account change is attempted.
  assert.match(preparation, /hostString\("hw\.model"\)/);
  assert.match(preparation, /hostString\("machdep\.cpu\.brand_string"\)/);
  assert.match(preparation, /sysctlbyname\("kern\.hv_vmm_present"[^\n]*nil, 0\)/);
  assert.match(preparation, /"physicalMemoryBytes": ProcessInfo\.processInfo\.physicalMemory/);
  assert.match(preparation, /virtualizationHint\(\)\.map \{ \$0 as Any \} \?\? NSNull\(\)/);
  assert.doesNotMatch(
    preparation,
    /UserDefaults|setenv|accept-license|ComputerName|IOPlatformSerialNumber/,
  );
});
