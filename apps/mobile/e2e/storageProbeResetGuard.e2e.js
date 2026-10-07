const failureMessage =
  'A storage reset is still running after the previous case failed; later probes must not share the Simulator.';

// Jest can time out while a Detox Simulator command is still running.
function createStorageResetGuard() {
  let resetInFlight = false;
  let resetTimedOut = false;

  function assertResetMayContinue() {
    if (resetTimedOut) throw new Error(failureMessage);
  }

  return Object.freeze({
    beginReset() {
      assertResetMayContinue();
      if (resetInFlight) throw new Error(failureMessage);
      resetInFlight = true;
    },
    assertResetMayContinue,
    finishReset() {
      resetInFlight = false;
    },
    afterTest() {
      if (resetInFlight) resetTimedOut = true;
    },
  });
}

async function installFreshApp(device, resetGuard) {
  resetGuard.beginReset();
  try {
    await device.uninstallApp();
    resetGuard.assertResetMayContinue();
    await device.clearKeychain();
    resetGuard.assertResetMayContinue();
    await device.installApp();
    resetGuard.assertResetMayContinue();
  } finally {
    resetGuard.finishReset();
  }
}

module.exports = { createStorageResetGuard, failureMessage, installFreshApp };
