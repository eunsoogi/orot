import { t } from '../i18n';

/** Shared destination symbols describe conversation and overview, not branding or a home route. */
export const rootTabItems = [
  {
    id: 'conversation',
    label: t('navigation.tabs.conversation'),
    accessibilityLabel: t('navigation.tabs.conversationAccessibility'),
    testID: 'navigation-tab-conversation',
    systemImageName: 'bubble.left.and.bubble.right',
    selectedSystemImageName: 'bubble.left.and.bubble.right.fill',
    fallbackSymbol: '🗨︎',
  },
  {
    id: 'overview',
    label: t('navigation.tabs.overview'),
    accessibilityLabel: t('navigation.tabs.overviewAccessibility'),
    testID: 'navigation-tab-overview',
    systemImageName: 'square.grid.2x2',
    selectedSystemImageName: 'square.grid.2x2.fill',
    fallbackSymbol: '▦',
  },
  {
    id: 'records',
    label: t('navigation.tabs.records'),
    accessibilityLabel: t('navigation.tabs.recordsAccessibility'),
    testID: 'navigation-tab-records',
    systemImageName: 'doc.text',
    selectedSystemImageName: 'doc.text.fill',
    fallbackSymbol: '▤',
  },
  {
    id: 'settings',
    label: t('navigation.tabs.settings'),
    accessibilityLabel: t('navigation.tabs.settingsAccessibility'),
    testID: 'navigation-tab-settings',
    systemImageName: 'gearshape',
    selectedSystemImageName: 'gearshape.fill',
    fallbackSymbol: '⚙',
  },
] as const;

// Schedule remains a compatible deep-link destination inside the Records hub.
export type AppRootTab = (typeof rootTabItems)[number]['id'] | 'schedule';

export interface NavigationRootTabs {
  readonly activeTab: AppRootTab;
  /** Distinguishes nested content while retaining its parent navigation selection. */
  readonly contentKey?: AppRootTab;
  readonly onSelect: (tab: AppRootTab) => void | Promise<unknown>;
}
