import { useLayoutEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { t } from '../i18n';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import type { ComposedControl } from './conversationA2UIComposedControlState';
import type { ConversationA2UITabSelections } from './conversationA2UITabSelectionLifetime';

const maxQueryUnits = 128;
const matches = (label: string, query: string) =>
  label.toLowerCase().includes(query.toLowerCase());

/** Read only model-authored labels. The query is per mounted panel; only
 * existing selections can be retained by the owning Tabs map. */
export function ConversationA2UIComposedChoice({
  control,
  owns,
  subscribe,
  tabSelections,
}: {
  control: Extract<ComposedControl, { kind: 'choice' }>;
  owns: () => boolean;
  subscribe?: (listener: () => void) => () => void;
  tabSelections?: ConversationA2UITabSelections;
}) {
  const [selected, setSelected] = useState<readonly string[]>(() => {
    const saved = tabSelections?.read(control);
    return Array.isArray(saved) ? saved : [];
  });
  const pendingSelection = useRef(selected);
  const [query, setQuery] = useState('');
  const queryRef = useRef(query);
  useLayoutEffect(() => {
    if (!control.filterable || !subscribe) return;
    let listening = true;
    // Ownership can disappear and return without React committing an
    // inactive snapshot. Clear entered text on the actual owner notification.
    const retireQuery = () => {
      if (!listening || owns() || !queryRef.current) return;
      queryRef.current = '';
      setQuery('');
    };
    const stop = subscribe(retireQuery);
    retireQuery();
    return () => {
      listening = false;
      stop();
    };
  }, [control.filterable, owns, subscribe]);
  const visible = control.filterable
    ? control.options.filter(option => matches(option.label, query))
    : control.options;
  const queryLabel = t('ragConversation.a2ui.filterChoices', {
    label: control.label,
  });
  return (
    <>
      {control.filterable && (
        <TextInput
          accessibilityLabel={queryLabel}
          autoComplete="off"
          autoCorrect={false}
          clearButtonMode="while-editing"
          maxLength={maxQueryUnits}
          placeholder={queryLabel}
          spellCheck={false}
          style={styles.field}
          textContentType="none"
          value={query}
          onChangeText={next => {
            if (!owns() || typeof next !== 'string') return;
            // Update synchronously so a queued press cannot select an option hidden by this query.
            queryRef.current = next.slice(0, maxQueryUnits);
            setQuery(queryRef.current);
          }}
        />
      )}
      {visible.length === 0 && (
        <AppText allowFontScaling accessibilityLiveRegion="polite">
          {t('ragConversation.a2ui.noMatchingChoice')}
        </AppText>
      )}
      <View
        accessibilityRole={control.multiple ? undefined : 'radiogroup'}
        accessibilityLabel={control.label}
      >
        {visible.map(option => {
          const chosen = selected.includes(option.value);
          return (
            <Pressable
              key={option.value}
              accessibilityLabel={option.label}
              accessibilityRole={control.multiple ? 'checkbox' : 'radio'}
              accessibilityState={{ checked: chosen }}
              style={chosen ? [styles.option, styles.chosen] : styles.option}
              onPress={() => {
                if (!owns() || !matches(option.label, queryRef.current)) return;
                const previous = pendingSelection.current;
                const next = previous.includes(option.value)
                  ? previous.filter(value => value !== option.value)
                  : control.multiple
                    ? [...previous, option.value]
                    : [option.value];
                pendingSelection.current = next;
                tabSelections?.write(control, next);
                setSelected(next);
              }}
            >
              <AppText allowFontScaling>{option.label}</AppText>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}
const styles = StyleSheet.create({
  field: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: appColors.primarySoft,
  },
  option: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  chosen: { backgroundColor: appColors.primarySoft, borderRadius: 8 },
});
