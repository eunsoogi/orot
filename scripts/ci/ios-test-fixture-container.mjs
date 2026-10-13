import { execFileSync } from 'node:child_process';
import { verifyIosTestSimulator } from './ios-test-simulator.mjs';

const bundleIdentifier = 'com.orot.mobile';

/** Query only the owned bundle; enumeration of every installed app is unrelated to the reset boundary. */
function hasInstalledApp(simctl) {
  try {
    const container = simctl('get_app_container', bundleIdentifier, 'app').trim();
    if (!container) throw new Error('Owned app container query returned no path');
    return true;
  } catch (error) {
    // simctl reports an absent bundle as POSIX ENOENT. Timeouts and other service errors must still stop execution.
    if (error.status === 2 && String(error.stderr).includes('domain=NSPOSIXErrorDomain, code=2'))
      return false;
    throw error;
  }
}

/** Restore the original independent-case uninstall boundary after success or failure; snapshot and model restart phases are deliberately excluded. */
export function removeIosTestFixtureContainer(profile, owner) {
  if (!['fixtures', 'health-import', 'microphone', 'provider-selection'].includes(profile))
    throw new Error('Fixture cleanup requires an independent dedicated execution profile');
  function simctl(...args) {
    if (verifyIosTestSimulator(owner, profile).state !== 'Booted')
      throw new Error('Fixture cleanup requires its booted owned destination');
    return execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8', timeout: 30000 });
  }
  const installed = () =>
    hasInstalledApp((command, ...args) => simctl(command, owner.udid, ...args));
  const removed = installed();
  if (removed) simctl('uninstall', owner.udid, bundleIdentifier);
  if (installed()) throw new Error('Owned fixture application remained after cleanup');
  return { removed, installed: false };
}

/** Only dedicated fixture profiles may replace their app container or Keychain; shared Core and Speech destinations are excluded. */
export function resetIosTestFixtureContainer(
  profile,
  owner,
  application,
  { preserveKeychain = false } = {},
) {
  if (
    ![
      'backup',
      'fixtures',
      'health-import',
      'microphone',
      'local-model',
      'provider-selection',
    ].includes(profile)
  )
    throw new Error('Fresh fixture state requires a dedicated execution profile');
  if (preserveKeychain && profile !== 'backup')
    throw new Error('Only backup snapshot restore may retain fixture Keychain state');
  function simctl(...args) {
    if (verifyIosTestSimulator(owner, profile).state !== 'Booted')
      throw new Error('Fixture reset requires its booted owned destination');
    return execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8', timeout: 30000 }).trim();
  }
  if (hasInstalledApp((command, ...args) => simctl(command, owner.udid, ...args)))
    simctl('uninstall', owner.udid, bundleIdentifier);
  if (!preserveKeychain) simctl('keychain', owner.udid, 'reset');
  simctl('install', owner.udid, application);
}
