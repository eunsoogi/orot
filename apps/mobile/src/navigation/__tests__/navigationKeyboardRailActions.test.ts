import { navigationKeyboardRailActions } from '../navigationKeyboardRailActions';

const actions = [
  { id: 'back', label: 'Back', accessibilityLabel: 'Back' },
  {
    id: 'tab-conversation',
    label: 'Conversation',
    accessibilityLabel: 'Conversation',
    selected: true,
    rootTab: true,
  },
];

test('keeps Back directly reachable with all other destinations in a side menu', () => {
  const compact = navigationKeyboardRailActions(actions, 300, 100, 20);
  expect(compact.actions.map(action => action.id)).toEqual([
    'back',
    'navigation-overflow',
  ]);
  expect(compact.actions[1]?.rootTab).toBe(false);
  expect(compact.overflow).toEqual(['tab-conversation']);
});

test('falls back to one side-menu target without reducing its accessible hit area', () => {
  const compact = navigationKeyboardRailActions(actions, 200, 100, 20);
  expect(compact.actions.map(action => action.id)).toEqual([
    'navigation-overflow',
  ]);
  expect(compact.overflow).toEqual(['back', 'tab-conversation']);
  expect(navigationKeyboardRailActions(actions, 160, 100, 20).actions).toEqual(
    [],
  );
});
