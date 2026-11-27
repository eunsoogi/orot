import DateTimePicker from '@react-native-community/datetimepicker';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { t } from '../i18n';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';

type Props = Readonly<{
  label: string;
  min?: number;
  max?: number;
  current: () => boolean;
}>;

/** Only the current mounted surface can confirm its own native selection. */
export function ConversationA2UITemporaryDateTime({
  label,
  min,
  max,
  current,
}: Props) {
  const [value, setValue] = useState<string>();
  const [picker, setPicker] = useState<number>();
  const [preview, setPreview] = useState<number>();
  const generation = useRef(0);
  const shown = value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : t('ragConversation.a2ui.chooseDateTime');
  const currentPicker = () =>
    current() && picker !== undefined && generation.current === picker;
  const close = () => {
    generation.current += 1;
    setPicker(undefined);
    setPreview(undefined);
  };
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label + ', ' + shown}
        accessibilityState={{ expanded: picker !== undefined }}
        style={styles.opener}
        onPress={() => {
          if (!current()) return;
          if (picker !== undefined) close();
          else {
            const base = value
              ? Date.parse(value)
              : Math.floor(Date.now() / 60_000) * 60_000;
            setPreview(
              Math.min(max ?? Infinity, Math.max(min ?? -Infinity, base)),
            );
            setPicker(++generation.current);
          }
        }}
      >
        <AppText allowFontScaling>{shown}</AppText>
      </Pressable>
      {picker !== undefined && preview !== undefined ? (
        <>
          <DateTimePicker
            testID="conversation-a2ui-local-datetime-picker"
            accessibilityLabel={label}
            display="spinner"
            mode="datetime"
            minimumDate={min === undefined ? undefined : new Date(min)}
            maximumDate={max === undefined ? undefined : new Date(max)}
            value={new Date(preview)}
            onValueChange={(_, selected) => {
              if (!currentPicker() || !(selected instanceof Date)) return;
              const next = selected.getTime();
              if (
                !Number.isFinite(next) ||
                (min !== undefined && next < min) ||
                (max !== undefined && next > max)
              )
                return;
              setPreview(next);
            }}
            onDismiss={() => {
              if (currentPicker()) close();
            }}
          />
          <Pressable
            accessibilityRole="button"
            style={styles.opener}
            onPress={() => {
              if (!currentPicker()) return;
              setValue(new Date(preview).toISOString());
              close();
            }}
          >
            <AppText allowFontScaling>
              {t('ragConversation.a2ui.confirmDateTime')}
            </AppText>
          </Pressable>
        </>
      ) : null}
    </>
  );
}
const styles = StyleSheet.create({
  opener: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: appColors.primarySoft,
  },
});
