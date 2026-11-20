import { providerCatalogContentInset } from '../layout/providerSettingsPresentation';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';

export function LiveVoiceCatalogSelect<Key extends string>({
  label,
  options,
  value,
  expanded,
  busy,
  onSelect,
  onToggle,
  testID,
}: {
  readonly label: string;
  readonly options: readonly (readonly [Key, string])[];
  readonly value?: Key;
  readonly expanded: boolean;
  readonly busy: boolean;
  readonly onToggle: () => void;
  readonly onSelect: (value: Key) => void;
  readonly testID: string;
}) {
  const selected = options.find(([id]) => id === value)?.[1] ?? '선택';
  return (
    <View style={styles.box}>
      <Pressable
        testID={testID}
        style={styles.row}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: selected }}
        accessibilityState={{ expanded, disabled: busy }}
        disabled={busy}
        onPress={onToggle}
      >
        <Text style={styles.value}>{label}</Text>
        <Text style={styles.current}>{selected}</Text>
        <AppSymbol
          name={expanded ? 'chevron.up' : 'chevron.down'}
          size={12}
          color={appColors.secondary}
        />
      </Pressable>
      {expanded ? (
        <View accessibilityRole="radiogroup">
          {options.map(([id, name]) => (
            <Pressable
              key={id}
              accessibilityRole="radio"
              accessibilityLabel={name}
              accessibilityState={{ selected: value === id, disabled: busy }}
              disabled={busy}
              style={styles.row}
              onPress={() => onSelect(id)}
            >
              <Text style={styles.value}>{name}</Text>
              {id === value ? (
                <AppSymbol name="checkmark" size={14} color={appColors.text} />
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export const liveVoiceSelectBoxInset = 6;

const styles = StyleSheet.create({
  box: { borderRadius: 12, backgroundColor: appColors.background },
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: providerCatalogContentInset - liveVoiceSelectBoxInset,
    gap: 8,
  },
  value: { flex: 1, color: appColors.text },
  current: { flexShrink: 1, color: appColors.secondary },
});
