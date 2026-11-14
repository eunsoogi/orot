import { createNativeNavigationBindings } from '../nativeNavigationActions';
import { createNavigationController } from '../navigationController';
import { rootTabItems } from '../rootTabs';

/** Icon variants must retain the same destination and accessible identity. */
test.each([
  ['conversation', 'bubble.left.and.bubble.right', '🗨︎', '대화 탭'],
  ['overview', 'square.grid.2x2', '▦', '한눈에 탭'],
] as const)(
  'keeps %s symbols consistent across selection states',
  (id, symbol, fallback, label) => {
    const controller = createNavigationController<'home'>('home');
    expect(rootTabItems.find(item => item.id === id)?.fallbackSymbol).toBe(
      fallback,
    );
    for (const selected of [false, true]) {
      const { actions } = createNativeNavigationBindings({
        controller,
        snapshot: controller.getSnapshot(),
        backDisabled: false,
        rootTabs: { activeTab: selected ? id : 'records', onSelect: jest.fn() },
      });
      expect(actions.find(action => action.id === `tab-${id}`)).toEqual(
        expect.objectContaining({
          systemImageName: selected ? `${symbol}.fill` : symbol,
          accessibilityLabel: label,
          selected,
          disabled: false,
          rootTab: true,
          testID: `navigation-tab-${id}`,
        }),
      );
    }
  },
);
