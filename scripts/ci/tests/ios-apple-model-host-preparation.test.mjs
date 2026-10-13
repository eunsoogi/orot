import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('provider data prewarms only the host SDK and still executes the original native tests without a readiness substitute', () => {
  const source = readFileSync('.github/workflows/ios-test-cohort-execution.yml', 'utf8');
  const start = source.indexOf('      - name: Record public Apple model host preparation');
  const end = source.indexOf(
    '      - name: Boot the explicitly owned compatible destination once',
    start,
  );
  assert.ok(
    start > source.indexOf('Verify configuration, source and product integrity before boot'),
  );
  assert.ok(end > start);
  const step = source.slice(start, end);
  assert.match(step, /if: inputs\.cohort == 'debug'/);
  assert.match(step, /xcrun swift -swift-version 6 scripts\/ci\/prepare-apple-model-host\.swift/);
  assert.match(step, /artifacts\/ios-cohort\/apple-model-host\.log/);
  assert.ok(!step.includes('continue-on-error') && !step.includes('retry'));
  assert.ok(
    source.indexOf(
      '      - name: Execute every planned first attempt without compilation or retry',
      end,
    ) > end,
  );
  const preparation = readFileSync('scripts/ci/prepare-apple-model-host.swift', 'utf8');
  assert.match(preparation, /LanguageModelSession\(model: model\)\.prewarm\(\)/);
  assert.match(preparation, /"before": before/);
  assert.match(preparation, /"after": availability\(model\)/);
  assert.ok(!preparation.includes('.respond(') && !preparation.includes('sleep('));
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
