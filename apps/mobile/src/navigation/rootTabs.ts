import { t } from '../i18n';

/** Shared root destinations keep the native and fallback tab bars in sync. */
export const rootTabItems = [
  {
    id: 'home',
    label: t('navigation.tabs.home'),
    accessibilityLabel: t('navigation.tabs.homeAccessibility'),
    testID: 'navigation-tab-home',
    systemImageName: 'house',
    selectedSystemImageName: 'house.fill',
    fallbackSymbol: '⌂',
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
    id: 'schedule',
    label: t('navigation.tabs.schedule'),
    accessibilityLabel: t('navigation.tabs.scheduleAccessibility'),
    testID: 'navigation-tab-schedule',
    systemImageName: 'calendar',
    selectedSystemImageName: 'calendar',
    fallbackSymbol: '▦',
  },
  {
    id: 'ai',
    label: t('navigation.tabs.ai'),
    accessibilityLabel: t('navigation.tabs.aiAccessibility'),
    testID: 'navigation-tab-ai',
    systemImageName: 'sparkle',
    selectedSystemImageName: 'sparkle',
    fallbackSymbol: '✧',
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

export type AppRootTab = (typeof rootTabItems)[number]['id'];

export interface NavigationRootTabs {
  readonly activeTab: AppRootTab;
  readonly onSelect: (tab: AppRootTab) => void | Promise<unknown>;
}
