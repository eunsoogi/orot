import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { medicalDocumentSecurityTests } from './medical-document-test-inventory.mjs';
import { verifyIosTestResults } from './ios-test-results.mjs';

/** Separate supported-host execution: no skips, retries, softened attributes or hosted E2E receipt. */
export function medicalDocumentSecurityArguments(xctestrun, destination, bundle) {
  if (![xctestrun, destination, bundle].every((value) => typeof value === 'string' && value.length))
    throw new Error(
      'Security validation requires xctestrun, owned destination and fresh result bundle',
    );
  return [
    'test-without-building',
    '-xctestrun',
    xctestrun,
    '-destination',
    destination,
    '-resultBundlePath',
    bundle,
    '-parallel-testing-enabled',
    'NO',
    ...medicalDocumentSecurityTests.map((identifier) => `-only-testing:${identifier}`),
  ];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [xctestrun, destination, bundle, output] = process.argv.slice(2);
  if (!output) throw new Error('Security validation requires a separate output JSON path');
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const base = {
    scope: 'medical-document-security-integration',
    sourceSha,
    // xctestrun provenance must accompany this report; HEAD alone cannot authenticate an older binary.
    binaryProvenance: 'requires-matching-build-evidence',
    physicalDeviceLockState: 'not-validated',
  };
  try {
    execFileSync('xcodebuild', medicalDocumentSecurityArguments(xctestrun, destination, bundle), {
      stdio: 'inherit',
    });
    const report = JSON.parse(
      execFileSync(
        'xcrun',
        ['xcresulttool', 'get', 'test-results', 'tests', '--path', bundle, '--compact'],
        { encoding: 'utf8' },
      ),
    );
    const observations = verifyIosTestResults(report, medicalDocumentSecurityTests);
    writeFileSync(
      output,
      JSON.stringify(
        { ...base, status: 'passed', observations, devices: report.devices },
        null,
        2,
      ) + '\n',
    );
  } catch (error) {
    // Unsupported hosts and incomplete runs remain non-success; preserve the xcresult/log for diagnosis.
    writeFileSync(
      output,
      JSON.stringify({ ...base, status: 'failed-or-unavailable', observations: null }, null, 2) +
        '\n',
    );
    throw error;
  }
}
