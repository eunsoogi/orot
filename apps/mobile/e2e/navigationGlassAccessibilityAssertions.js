const { expect: jestExpect } = require('@jest/globals');

/** Verifies selected traits when the Simulator exposes them in its hierarchy. */
function expectOnlyRootTabSelected(hierarchyXml, selectedTab) {
  const lines = hierarchyXml.split('\n');
  for (const tab of ['home', 'records', 'schedule', 'ai', 'settings']) {
    const testID = `navigation-tab-${tab}`;
    const node = lines.find(
      line =>
        line.includes(`id="${testID}"`) &&
        line.includes('visibility="visible"'),
    );
    if (!node) throw new Error(`Visible native tab ${testID} is missing.`);
    // iOS 27 currently omits traits for these native controls from the hierarchy export.
    const traitsMatch = node.match(/\btraits="([^"]*)"/);
    if (!traitsMatch) continue;
    const traits = traitsMatch[1];
    const isSelected = traits
      .split(/[,|\s]+/)
      .some(trait => trait.toLowerCase() === 'selected');
    jestExpect(isSelected).toBe(tab === selectedTab);
  }
}

/** Keeps child-route Back and Home controls out of the root-tab selected state. */
function expectContextActionUnselected(hierarchyXml, testID) {
  const node = hierarchyXml
    .split('\n')
    .find(
      line =>
        line.includes(`id="${testID}"`) &&
        line.includes('visibility="visible"'),
    );
  if (!node) throw new Error(`Visible native action ${testID} is missing.`);
  // iOS 27 currently omits traits for these native controls from the hierarchy export.
  const traitsMatch = node.match(/\btraits="([^"]*)"/);
  if (!traitsMatch) return;
  const traits = traitsMatch[1];
  const isSelected = traits
    .split(/[,|\s]+/)
    .some(trait => trait.toLowerCase() === 'selected');
  jestExpect(isSelected).toBe(false);
}

module.exports = { expectOnlyRootTabSelected, expectContextActionUnselected };
