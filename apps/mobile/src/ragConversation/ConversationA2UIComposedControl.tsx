import { ConversationA2UIComposedChoice } from './ConversationA2UIComposedChoice';
import type { ConversationA2UITabSelections } from './conversationA2UITabSelectionLifetime';
import Slider from '@react-native-community/slider';
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { ConversationA2UITemporaryDate } from './ConversationA2UITemporaryDate';
import type { ComposedControl } from './conversationA2UIComposedControlState';

export const ConversationA2UIComposedOwner = createContext<
  | {
      surface: string;
      current: () => boolean;
      subscribe?: (listener: () => void) => () => void;
      revision?: number;
      tabSelections?: ConversationA2UITabSelections;
      reset?: () => void;
    }
  | undefined
>(undefined);

/** The model only supplies checked display metadata. Native interactions may
 * update this mounted leaf, never a shared store, model request, or tool. */
export function ConversationA2UIComposedControl({
  control,
}: {
  control: ComposedControl;
}) {
  const owner = useContext(ConversationA2UIComposedOwner);
  return owner?.current() ? (
    <MountedControl
      key={owner.surface + ':' + (owner.revision ?? 0)}
      control={control}
      current={owner.current}
      subscribe={owner.subscribe}
      tabSelections={
        owner.tabSelections?.resetRevision === owner.revision
          ? owner.tabSelections
          : undefined
      }
    />
  ) : null;
}

export function ConversationA2UIComposedReset({ label }: { label: string }) {
  const owner = useContext(ConversationA2UIComposedOwner);
  const mountedOwner = useRef(owner);
  useLayoutEffect(() => {
    mountedOwner.current = owner;
    return () => {
      mountedOwner.current = undefined;
    };
  }, [owner]);
  if (!owner?.current() || !owner.reset)
    return <AppText allowFontScaling>{label}</AppText>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.option, styles.chosen]}
      onPress={() => {
        // A queued native press must not reinstate a retired form mount.
        if (mountedOwner.current === owner && owner.current()) owner.reset?.();
      }}
    >
      <AppText allowFontScaling>{label}</AppText>
    </Pressable>
  );
}

function MountedControl({
  control,
  current,
  subscribe,
  tabSelections,
}: {
  control: ComposedControl;
  current: () => boolean;
  subscribe?: (listener: () => void) => () => void;
  tabSelections?: ConversationA2UITabSelections;
}) {
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const owns = () => mounted.current && current();
  const [checked, setChecked] = useState(
    () => tabSelections?.read(control) === true,
  );
  const [text, setText] = useState('');
  const [range, setRange] = useState(
    control.kind === 'slider' ? control.min : 0,
  );
  return (
    <View style={styles.control}>
      <AppText allowFontScaling>{control.label}</AppText>
      {control.kind === 'check' ? (
        <Switch
          accessibilityLabel={control.label}
          value={checked}
          onValueChange={next => {
            if (!owns() || typeof next !== 'boolean') return;
            tabSelections?.write(control, next);
            setChecked(next);
          }}
        />
      ) : control.kind === 'text' ? (
        <TextInput
          accessibilityLabel={control.label}
          autoComplete="off"
          autoCorrect={false}
          maxLength={256}
          keyboardType={
            control.numeric && Platform.OS === 'ios'
              ? 'numbers-and-punctuation'
              : undefined
          }
          multiline={control.multiline}
          submitBehavior={control.multiline ? 'newline' : undefined}
          spellCheck={false}
          textContentType="none"
          value={text}
          style={
            control.multiline ? [styles.field, styles.multiline] : styles.field
          }
          placeholder={control.placeholder}
          onChangeText={next => {
            if (
              (control.multiline || control.numeric ? owns() : current()) &&
              typeof next === 'string' &&
              (!control.numeric || /^[+−-]?[0-9]*(?:[.,][0-9]*)?$/.test(next))
            )
              setText(next.slice(0, 256));
          }}
        />
      ) : control.kind === 'date' ? (
        <ConversationA2UITemporaryDate {...control} current={current} />
      ) : control.kind === 'time' ? (
        <ConversationA2UITemporaryDate
          mode="time"
          label={control.label}
          current={current}
        />
      ) : control.kind === 'slider' ? (
        <Slider
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={control.label}
          accessibilityValue={{
            min: control.min,
            max: control.max,
            now: range,
          }}
          minimumValue={control.min}
          maximumValue={control.max}
          step={(control.max - control.min) / control.steps}
          value={range}
          style={styles.slider}
          onValueChange={next => {
            if (
              current() &&
              Number.isFinite(next) &&
              next >= control.min &&
              next <= control.max
            )
              setRange(next);
          }}
        />
      ) : (
        <ConversationA2UIComposedChoice
          control={control}
          owns={owns}
          subscribe={subscribe}
          tabSelections={tabSelections}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  control: { gap: 6 },
  field: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: appColors.primarySoft,
  },
  // Leave a visible note area without growing the bubble unbounded.
  multiline: {
    minHeight: 88,
    maxHeight: 180,
    paddingVertical: 10,
    textAlignVertical: 'top',
  },
  slider: { alignSelf: 'stretch', minHeight: 44 },
  option: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  chosen: { backgroundColor: appColors.primarySoft, borderRadius: 8 },
});
