const { expect: jestExpect } = require('@jest/globals');

/** Verifies the accessibility hierarchy marks exactly one root destination selected. */
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
    const traits = node.match(/\btraits="([^"]*)"/)?.[1] ?? '';
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
  const traits = node.match(/\btraits="([^"]*)"/)?.[1] ?? '';
  const isSelected = traits
    .split(/[,|\s]+/)
    .some(trait => trait.toLowerCase() === 'selected');
  jestExpect(isSelected).toBe(false);
}

module.exports = { expectOnlyRootTabSelected, expectContextActionUnselected };
