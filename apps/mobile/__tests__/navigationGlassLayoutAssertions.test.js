const { describe, expect, it } = require('@jest/globals');
const {
  expectRootTabContentLayout,
} = require('../e2e/navigationGlassLayoutAssertions');

function rootTabHierarchy(labelY) {
  const testID = 'navigation-tab-home';
  // UIKit reports the icon and label as siblings inside the content stack.
  return `
    <UIButton class="UIButton" id="${testID}" x="0" y="0" width="62" height="48" visibility="visible">
      <UIStackView class="UIStackView" x="20" y="0" width="22" height="48">
        <UIImageView class="UIImageView" id="${testID}-UIImageView" x="0" y="4" width="22" height="22"/>
        <UILabel class="UILabel" id="${testID}-UILabel" x="5" y="${labelY}" width="12" height="14"/>
      </UIStackView>
    </UIButton>`;
}

describe('native root-tab hierarchy layout assertions', () => {
  it('rejects a one-point gap after a self-closing icon view', () => {
    expect(() =>
      expectRootTabContentLayout(rootTabHierarchy(27), 'navigation-tab-home'),
    ).toThrow('content must fit inside its padded 44pt+ target');
  });

  it('accepts a four-point sibling gap and bottom inset', () => {
    const layout = expectRootTabContentLayout(
      rootTabHierarchy(30),
      'navigation-tab-home',
    );

    expect(layout.iconToLabelGap).toBe(4);
    expect(layout.bottomInset).toBe(4);
  });
});
