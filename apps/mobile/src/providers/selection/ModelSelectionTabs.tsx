import { CalendarModelSettingsPanel } from '../../calendarModelSettings/CalendarModelSettingsPanel';
import type { ChatGPTAccountSetup, ProviderSelectionOption } from './types';
import { t } from '../../i18n';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { sectionTabStyles as tabs } from '../../layout/sectionTabPresentation';
import { VoiceSettingsPanel } from '../../voiceSettings/VoiceSettingsPanel';
import { NavigationInlineTransition } from '../../navigation/NavigationInlineTransition';
import { providerSelectionScreenStyles } from './providerSelectionScreenPresentation';

const modelTabs = ['language', 'calendar', 'voice'] as const;
type ModelTab = (typeof modelTabs)[number];

/** Retain drafts and catalog requests across tab switches; hiding a panel never saves it. */
export function ModelSelectionTabs({
  enabled,
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
  readonly children: ReactNode;
  readonly locked: boolean;
  readonly onOpenAccounts?: () => void;
}) {
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
      {/* Animate the incoming pane only. Keep the tabs and their keyboard/AX
          targets stationary, and do not remount the visited Voice settings. */}
      <View style={styles.viewport} testID="model-tab-content-viewport">
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
      </View>
    </>
  );
}
const styles = StyleSheet.create({
  viewport: { overflow: 'hidden' },
  // The Choices and Footer were previously separate children of this ScrollView.
  body: { gap: providerSelectionScreenStyles.container.gap },
  hidden: { display: 'none' },
});
