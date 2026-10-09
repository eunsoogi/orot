async function tapLoopbackConsentContinue({ by, system }) {
  // iOS presents Cancel first and Continue second on this consent sheet; the real consent tap stays locale-independent.
  await system.element(by.system.type('button')).atIndex(1).tap();
}

module.exports = { tapLoopbackConsentContinue };
