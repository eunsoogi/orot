import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// A simulator can advertise availability while the host rejects actual generation. Neither state may substitute for a supported host.
export function verifyAppleModelHost(log) {
  const reports = log.split('\n').flatMap((line) => {
    try {
      const report = JSON.parse(line);
      return report.scope === 'host-sdk-prewarm' ? [report] : [];
    } catch {
      return [];
    }
  });
  if (reports.length !== 1)
    throw new Error('Missing or ambiguous Apple Intelligence host evidence');
  const report = reports[0];
  if (report.before !== 'available' || report.after !== 'available')
    throw new Error(
      `Apple Intelligence host is not available: before=${report.before}, after=${report.after}`,
    );
  if (
    report.koreanSupported !== true ||
    report.prewarmInvoked !== true ||
    report.generatedFixture !== false
  )
    throw new Error('Incomplete authentic Korean Apple Intelligence host preparation');
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    verifyAppleModelHost(readFileSync(process.argv[2], 'utf8'));
    console.log(
      'Supported Apple Intelligence host verified; actual native generation assertions remain required.',
    );
  } catch (error) {
    // Make unsupportedDevice visible on the job page while the nonzero exit blocks acceptance; retain the original SDK log separately.
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        '## Apple Intelligence host validation failed\n\n' + String(error) + '\n',
      );
    console.error(String(error));
    process.exitCode = 1;
  }
}
