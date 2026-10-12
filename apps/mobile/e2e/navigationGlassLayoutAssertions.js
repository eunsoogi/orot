/**
 * Validates native root-tab proportions from UIKit hierarchy frames.
 * Child frames are parent-relative, so the helper composes offsets before checking padding.
 */

function expectRootTabContentLayout(hierarchyXml, testID) {
  const buttonPattern = new RegExp(
    `<UIButton\\b(?=[^>]*\\bid="${testID}")[^>]*>`,
    'g',
  );
  const button = [...hierarchyXml.matchAll(buttonPattern)].find(match =>
    match[0].includes('visibility="visible"'),
  );
  if (!button) throw new Error(`Visible native root tab ${testID} is missing.`);

  const close = hierarchyXml.indexOf('</UIButton>', button.index);
  if (close < 0)
    throw new Error(`Native root tab ${testID} has no closing view.`);
  const buttonMarkup = hierarchyXml.slice(
    button.index + button[0].length,
    close,
  );
  const tags = [...buttonMarkup.matchAll(/<(\/)?([A-Za-z0-9_]+)\b([^>]*)>/g)];
  const attributes = tag =>
    Object.fromEntries(
      [...tag.matchAll(/([A-Za-z][\w-]*)="([^"]*)"/g)].map(
        ([, name, value]) => [name, value],
      ),
    );
  const buttonAttributes = attributes(button[0]);
  const numberAttribute = (values, name) => Number(values[name] ?? 0);
  const frame = values =>
    Object.fromEntries(
      ['x', 'y', 'width', 'height'].map(name => [
        name,
        numberAttribute(values, name),
      ]),
    );
  const buttonFrame = frame(buttonAttributes);
  const contentViews = [];
  const ancestors = [{ name: 'UIButton', x: 0, y: 0 }];
  for (const [, closing, name, markup] of tags) {
    if (closing) {
      while (ancestors.length > 1 && ancestors.at(-1).name !== name)
        ancestors.pop();
      if (ancestors.length > 1) ancestors.pop();
      continue;
    }

    const values = attributes(markup);
    const parent = ancestors.at(-1);
    const content = {
      ...values,
      x: parent.x + numberAttribute(values, 'x'),
      y: parent.y + numberAttribute(values, 'y'),
      width: numberAttribute(values, 'width'),
      height: numberAttribute(values, 'height'),
    };
    if (values.class === 'UIImageView' || values.class === 'UILabel')
      contentViews.push(content);
    // The tag matcher excludes `>`, so the trailing slash marks a self-closing view.
    if (!markup.trimEnd().endsWith('/'))
      ancestors.push({ name, x: content.x, y: content.y });
  }

  // Hierarchy frames are parent-relative, so compose offsets before checking the button's padding.
  const findContent = className =>
    contentViews.find(
      view => view.class === className && view.id === `${testID}-${className}`,
    ) ?? contentViews.find(view => view.class === className);
  const icon = findContent('UIImageView');
  const label = findContent('UILabel');
  const iconFrame = icon && {
    x: icon.x,
    y: icon.y,
    width: icon.width,
    height: icon.height,
  };
  const labelFrame = label && {
    x: label.x,
    y: label.y,
    width: label.width,
    height: label.height,
  };
  if (!iconFrame || !labelFrame) {
    throw new Error(`Native root tab ${testID} is missing its icon or label.`);
  }

  const rightInset = (child, bounds) => bounds.width - child.x - child.width;
  const topInset = iconFrame.y;
  const iconToLabelGap = labelFrame.y - iconFrame.y - iconFrame.height;
  const bottomInset = buttonFrame.height - labelFrame.y - labelFrame.height;
  // Keep the symbol and title inside the taller root-tab target with visible spacing and breathing room.
  if (
    buttonFrame.width < 44 ||
    buttonFrame.height < 52 ||
    iconFrame.width > 23 ||
    // XCTest rounds frame extents outward; the 22pt constrained symbol can report as 23pt.
    iconFrame.height > 23 ||
    topInset < 3 ||
    rightInset(iconFrame, buttonFrame) < 3 ||
    iconToLabelGap < 2 ||
    labelFrame.x < 3 ||
    rightInset(labelFrame, buttonFrame) < 3 ||
    bottomInset < 3
  ) {
    throw new Error(
      `Native root tab ${testID} content must fit inside its padded 52pt+ target: ${JSON.stringify({ buttonFrame, iconFrame, labelFrame, topInset, iconToLabelGap, bottomInset })}`,
    );
  }

  return {
    buttonFrame,
    iconFrame,
    labelFrame,
    topInset,
    iconToLabelGap,
    bottomInset,
  };
}

/** Ensures the root bar reclaims inset space without reaching the screen edge. */
function expectRootTabScreenEdgeClearance(rootFrame, toolbarFrame) {
  const clearance =
    rootFrame.y + rootFrame.height - toolbarFrame.y - toolbarFrame.height;
  if (clearance < 22 || clearance > 26) {
    throw new Error(
      `Root tab bar screen-edge clearance must stay between 22pt and 26pt: ${clearance}.`,
    );
  }
  return clearance;
}

/** Keeps the final scroll control above the root bar's native hit area. */
function expectActionAboveRootTabSurface(actionFrame, toolbarFrame) {
  if (actionFrame.y + actionFrame.height > toolbarFrame.y) {
    throw new Error('The final route action overlaps the root tab bar.');
  }
}

/** Checks that a contextual route begins below the live inset and its own scroll viewport. */
function expectActiveRouteSafeArea(
  scrollFrame,
  titleFrame,
  rootFrame,
  topInset,
) {
  if (
    !scrollFrame ||
    !titleFrame ||
    !rootFrame ||
    !Number.isFinite(topInset) ||
    scrollFrame.y - rootFrame.y < topInset ||
    titleFrame.y < scrollFrame.y
  ) {
    throw new Error('The active route must begin below its top safe area.');
  }
}

module.exports = {
  expectActiveRouteSafeArea,
  expectActionAboveRootTabSurface,
  expectRootTabContentLayout,
  expectRootTabScreenEdgeClearance,
};
