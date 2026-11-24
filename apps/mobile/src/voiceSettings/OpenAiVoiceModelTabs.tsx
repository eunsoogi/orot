import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { t } from '../i18n';
import { AppText as Text } from '../layout/AppText';
import { sectionTabStyles as tabs } from '../layout/sectionTabPresentation';

const choices = ['speech', 'tools'] as const;
export type OpenAiVoiceModelTab = (typeof choices)[number];

/** Hide inactive panes without resetting their local drafts or touching provider state. */
export function OpenAiVoiceModelTabs({
  selected,
  disabled,
  onSelect,
  speech,
  tools,
}: {
  readonly selected: OpenAiVoiceModelTab;
  readonly disabled: boolean;
  readonly onSelect: (tab: OpenAiVoiceModelTab) => void;
  readonly speech: ReactNode;
  readonly tools: ReactNode;
}) {
  return (
    <>
      <View testID="openai-voice-model-tabs" style={tabs.tabs}>
        {choices.map(tab => (
          <Pressable
            key={tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: selected === tab, disabled }}
            disabled={disabled}
            testID={`openai-voice-model-tab-${tab}`}
            style={[tabs.tab, selected === tab && tabs.selectedTab]}
            onPress={() => onSelect(tab)}
          >
            <Text style={[tabs.label, selected === tab && tabs.selectedLabel]}>
              {t(
                tab === 'speech'
                  ? 'modelSettings.liveVoiceModelTab'
                  : 'modelSettings.liveResponsesTitle',
              )}
            </Text>
          </Pressable>
        ))}
      </View>
      {choices.map(tab => (
        <View
          key={tab}
          testID={`openai-voice-model-pane-${tab}`}
          style={selected !== tab && styles.hidden}
          accessibilityElementsHidden={selected !== tab}
          importantForAccessibility={
            selected === tab ? 'auto' : 'no-hide-descendants'
          }
          pointerEvents={selected === tab ? 'auto' : 'none'}
        >
          {tab === 'speech' ? speech : tools}
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({ hidden: { display: 'none' } });
