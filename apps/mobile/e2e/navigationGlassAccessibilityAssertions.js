/* global by, element, expect */

/** Queries native accessibility traits directly because hierarchy XML can omit them on newer iOS. */
async function expectOnlyRootTabSelected(hierarchyXml, selectedTab) {
  for (const tab of ['home', 'records', 'schedule', 'ai', 'settings']) {
    const testID = `navigation-tab-${tab}`;
    const node = hierarchyXml
      .split('\n')
      .find(
        line =>
          line.includes(`id="${testID}"`) &&
          line.includes('visibility="visible"'),
      );
    if (!node) throw new Error(`Visible native tab ${testID} is missing.`);
    const selected = element(by.id(testID).and(by.traits(['selected'])));
    if (tab === selectedTab) await expect(selected).toExist();
    else await expect(selected).not.toExist();
  }
}

/** Back and Home must never acquire a current-tab accessibility trait. */
async function expectContextActionUnselected(hierarchyXml, testID) {
  const node = hierarchyXml
    .split('\n')
    .find(
      line =>
        line.includes(`id="${testID}"`) &&
        line.includes('visibility="visible"'),
    );
  if (!node) throw new Error(`Visible native action ${testID} is missing.`);
  await expect(
    element(by.id(testID).and(by.traits(['selected']))),
  ).not.toExist();
}

module.exports = { expectOnlyRootTabSelected, expectContextActionUnselected };
