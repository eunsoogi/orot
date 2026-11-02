import { verifyIosSimulatorOwnerContract } from './ios-test-cohorts.mjs';

/** Bind the actual pre-boot inventory to the owned destination and current workflow attempt. */
export function verifyFocusedRuntimeEvidence(owner, records, profile, context, cohort) {
  const config = verifyIosSimulatorOwnerContract(owner, profile);
  const expectedName = cohort
    ? `OrotTests-cohort-${cohort}-${context.runId}-${context.attempt}`
    : `OrotTests-${profile}-${context.runId}-${context.attempt}`;
  if (
    owner.name !== expectedName ||
    (cohort ? owner.cohort !== cohort : owner.cohort !== undefined) ||
    !/^[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}$/.test(owner.udid ?? '')
  )
    throw new Error('Focused runtime owner does not match this workflow attempt');
  const inventory = records.filter((record) => record.event === 'pre-boot-inventory');
  if (inventory.length !== 1) throw new Error('Focused runtime inventory is missing or repeated');
  const { device, runtime } = inventory[0];
  if (
    device?.udid !== owner.udid ||
    device.deviceTypeIdentifier !== config.device ||
    device.isAvailable !== true ||
    runtime?.identifier !== config.runtime ||
    runtime.isAvailable !== true ||
    typeof runtime.buildversion !== 'string' ||
    !runtime.buildversion ||
    (config.runtimeBuild && runtime.buildversion !== config.runtimeBuild)
  )
    throw new Error('Focused runtime inventory does not match the owned destination');
  return {
    udid: owner.udid,
    runtime: runtime.identifier,
    runtimeBuild: runtime.buildversion,
    device: config.device,
  };
}
