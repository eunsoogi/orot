/** Confirm the deleted owned UDID is absent from every runtime without recording unrelated devices. */
export function verifyIosCleanupInventory(owner, inventory) {
  if (
    typeof owner?.udid !== 'string' ||
    !owner.udid ||
    !inventory?.devices ||
    typeof inventory.devices !== 'object' ||
    Array.isArray(inventory.devices)
  )
    throw new Error('Simulator cleanup requires an owner and device inventory');
  for (const devices of Object.values(inventory.devices)) {
    if (!Array.isArray(devices))
      throw new Error('Simulator cleanup inventory has an unknown shape');
    if (devices.some((device) => typeof device?.udid !== 'string'))
      throw new Error('Simulator cleanup inventory has an unknown device identity');
    if (devices.some((device) => device.udid.toLowerCase() === owner.udid.toLowerCase()))
      throw new Error('Owned Simulator remains in the device inventory after deletion');
  }
  return { udid: owner.udid, absent: true };
}
