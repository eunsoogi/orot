const failureMessage =
  'A storage reset timed out or overlapped a failed probe; later probes must not share the Simulator.';
// Preserve the four-minute setup allowance and leave a small margin for Jest to surface the latch.
const resetTimeoutMs = 240000;
const resetHookTimeoutMs = resetTimeoutMs + 1000;

// Jest can time out while a Detox Simulator command is still running.
function createStorageResetGuard({ timeoutMs = resetTimeoutMs } = {}) {
  let resetInFlight = false;
  let resetTimedOut = false;

  function assertResetMayContinue() {
    if (resetTimedOut) throw new Error(failureMessage);
  }

  function beginReset() {
    assertResetMayContinue();
    if (resetInFlight) {
      resetTimedOut = true;
      throw new Error(failureMessage);
    }
    resetInFlight = true;
  }

  function finishReset() {
    resetInFlight = false;
  }

  async function runReset(operation) {
    beginReset();
    let timeoutHandle;
    const timeout = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        resetTimedOut = true;
        reject(new Error(failureMessage));
      }, timeoutMs);
    });

    try {
      // Detox calls cannot be cancelled; the latch blocks every later command after the deadline.
      await Promise.race([
        Promise.resolve().then(() => operation(assertResetMayContinue)),
        timeout,
      ]);
      assertResetMayContinue();
    } catch (error) {
      resetTimedOut = true;
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
      finishReset();
    }
  }

  return Object.freeze({
    beginReset,
    assertResetMayContinue,
    finishReset,
    runReset,
    afterTest() {
      if (resetInFlight) resetTimedOut = true;
    },
  });
}

// Both combined Release phases share one latch so a late first reset cannot overlap the next phase.
const releasePhaseResetGuard = createStorageResetGuard();

async function installFreshApp(device, resetGuard) {
  return resetGuard.runReset(async assertMayContinue => {
    await device.uninstallApp();
    assertMayContinue();
    await device.clearKeychain();
    assertMayContinue();
    await device.installApp();
    assertMayContinue();
  });
}

module.exports = {
  createStorageResetGuard,
  failureMessage,
  installFreshApp,
  releasePhaseResetGuard,
  resetHookTimeoutMs,
  resetTimeoutMs,
};
