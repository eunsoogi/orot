const failureMessage =
  'A storage reset is still running after the previous case failed; later probes must not share the Simulator.';

// Jest reports a timed-out Detox call without cancelling its Simulator command.
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

module.exports = { createStorageResetGuard, failureMessage };
