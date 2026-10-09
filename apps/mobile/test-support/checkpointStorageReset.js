/**
 * Reset the checkpoint probe's app container before its Keychain so an old
 * SQLCipher file can never outlive the key used to open it.
 */
async function resetCheckpointContainer(device) {
  await device.uninstallApp();
  await device.clearKeychain();
  await device.installApp();
}

module.exports = { resetCheckpointContainer };
