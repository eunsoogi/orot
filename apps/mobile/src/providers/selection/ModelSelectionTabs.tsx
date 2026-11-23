import { CalendarModelSettingsPanel } from '../../calendarModelSettings/CalendarModelSettingsPanel';
import type { ChatGPTAccountSetup, ProviderSelectionOption } from './types';
import { t } from '../../i18n';
import { useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type HostInstance } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { sectionTabStyles as tabs } from '../../layout/sectionTabPresentation';
import { VoiceSettingsPanel } from '../../voiceSettings/VoiceSettingsPanel';
import { NavigationInlineTransition } from '../../navigation/NavigationInlineTransition';
import { providerSelectionScreenStyles } from './providerSelectionScreenPresentation';

import { AdaptiveColumnsMeasurementRoot } from '../../layout/AdaptiveColumnsMeasurementRoot';

const modelTabs = ['language', 'calendar', 'voice'] as const;
type ModelTab = (typeof modelTabs)[number];

/** Retain drafts and catalog requests across tab switches; hiding a panel never saves it. */
export function ModelSelectionTabs({
  enabled,
  languageHeader,
  children,
  locked,
  onOpenAccounts,
  calendarOptions = [],
  chatGPTSetup,
  onCalendarStateChange,
}: {
  readonly onCalendarStateChange?: (
    state: { hasPendingSelection: boolean; isSavingSelection: boolean },
    inputChanged?: boolean,
  ) => void;
  readonly calendarOptions?: readonly ProviderSelectionOption[];
  readonly chatGPTSetup?: ChatGPTAccountSetup;
  readonly enabled: boolean;
  readonly languageHeader?: ReactNode;
  readonly children: ReactNode;
  readonly locked: boolean;
  readonly onOpenAccounts?: () => void;
}) {
  const viewport = useRef<HostInstance | null>(null);
  const [active, setActive] = useState<ModelTab>('language');
  const [visitedVoice, setVisitedVoice] = useState(false);
  const [calendarLocked, setCalendarLocked] = useState(false);
  if (!enabled) return <>{children}</>;
  return (
    <>
      <View style={tabs.tabs}>
        {modelTabs.map(tab => (
          <Pressable
            key={tab}
            accessibilityRole="tab"
            accessibilityState={{
              selected: active === tab,
              disabled: locked || calendarLocked,
            }}
            disabled={locked || calendarLocked}
            testID={`model-tab-${tab}`}
            style={[tabs.tab, active === tab && tabs.selectedTab]}
            onPress={() => {
              setActive(tab);
              if (tab === 'voice') setVisitedVoice(true);
            }}
          >
            <Text style={[tabs.label, active === tab && tabs.selectedLabel]}>
              {tab === 'language'
                ? t('modelSettings.languageTab')
                : tab === 'calendar'
                  ? t('modelSettings.calendarTab')
                  : t('modelSettings.voiceTab')}
            </Text>
          </Pressable>
        ))}
      </View>
      {active === 'language' ? languageHeader : null}
      {/* Animate the incoming pane only. Keep the tabs and their keyboard/AX
          targets stationary, and do not remount the visited Voice settings. */}
      <View
        ref={viewport}
        collapsable={false}
        style={styles.viewport}
        testID="model-tab-content-viewport"
      >
        <AdaptiveColumnsMeasurementRoot.Provider value={viewport}>
          <NavigationInlineTransition
            transitionKey={active}
            depth={modelTabs.indexOf(active)}
            style={styles.body}
          >
            {active === 'language' ? children : null}
            {active === 'calendar' ? (
              <CalendarModelSettingsPanel
                options={calendarOptions}
                chatGPTSetup={chatGPTSetup}
                onBusyChange={setCalendarLocked}
                onStateChange={onCalendarStateChange}
              />
            ) : null}
            {visitedVoice ? (
              <View
                style={active !== 'voice' && styles.hidden}
                accessibilityElementsHidden={active !== 'voice'}
                importantForAccessibility={
                  active === 'voice' ? 'auto' : 'no-hide-descendants'
                }
              >
                <VoiceSettingsPanel
                  active={active === 'voice'}
                  onOpenAccounts={onOpenAccounts}
                />
              </View>
            ) : null}
          </NavigationInlineTransition>
        </AdaptiveColumnsMeasurementRoot.Provider>
      </View>
    </>
  );
}
const styles = StyleSheet.create({
  viewport: { alignSelf: 'stretch', overflow: 'hidden' },
  // The Choices and Footer were previously separate children of this ScrollView.
  body: {
    alignSelf: 'stretch',
    gap: providerSelectionScreenStyles.container.gap,
  },
  hidden: { display: 'none' },
});
