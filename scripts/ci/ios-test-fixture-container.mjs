import { runIosSimulatorCommand, verifyIosTestSimulator } from './ios-test-simulator.mjs';

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

/** Restore independent-case uninstall after success or failure. Backup's caller admits only its first three cases; snapshot/model restart drivers do not use this cleanup. */
export function removeIosTestFixtureContainer(profile, owner) {
  if (
    !['fixtures', 'health-import', 'microphone', 'provider-selection', 'backup'].includes(profile)
  )
    throw new Error('Fixture cleanup requires an independent dedicated execution profile');
  function simctl(...args) {
    if (verifyIosTestSimulator(owner, profile).state !== 'Booted')
      throw new Error('Fixture cleanup requires its booted owned destination');
    // A slow successful uninstall/query is valid; the hosted job supplies the outer cancellation boundary.
    return runIosSimulatorCommand(args);
  }
  // The supported simctl also completes uninstall for an absent bundle. Every command error still propagates.
  // Verify ownership immediately before the exact deletion, then independently prove absence after it.
  simctl('uninstall', owner.udid, bundleIdentifier);
  if (hasInstalledApp((command, ...args) => simctl(command, owner.udid, ...args)))
    throw new Error('Owned fixture application remained after cleanup');
  // This receipt proves the command completed and the app is absent, not that an app existed before deletion.
  return { uninstallCompleted: true, installed: false };
}

/** Fresh-install fixtures and Core's dedicated persistence phase may replace their owned container and Keychain. Speech is excluded. */
export function resetIosTestFixtureContainer(
  profile,
  owner,
  application,
  { preserveKeychain = false, statePersistence = false } = {},
) {
  if (profile === 'core' && !statePersistence)
    throw new Error('Core fresh installation requires its explicit state persistence boundary');
  if (statePersistence && profile !== 'core')
    throw new Error('State persistence installation belongs only to Core');
  if (
    ![
      'core',
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
    // Wait for public command completion instead of imposing an unrelated per-command deadline.
    return runIosSimulatorCommand(args).trim();
  }
  if (hasInstalledApp((command, ...args) => simctl(command, owner.udid, ...args)))
    simctl('uninstall', owner.udid, bundleIdentifier);
  if (!preserveKeychain) simctl('keychain', owner.udid, 'reset');
  simctl('install', owner.udid, application);
}
