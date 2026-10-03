import {
  InputAccessoryView,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

export interface SymptomKeyboardAction {
  label: string;
  testID: string;
  onPress: () => void;
  disabled?: boolean;
}

interface SymptomKeyboardAccessoryProps {
  nativeID: string;
  actions: SymptomKeyboardAction[];
}

export default function SymptomKeyboardAccessory({
  nativeID,
  actions,
}: SymptomKeyboardAccessoryProps) {
  return (
    <InputAccessoryView nativeID={nativeID}>
      <View style={styles.container}>
        {actions.map(action => (
          <Pressable
            accessibilityRole="button"
            disabled={action.disabled}
            key={action.testID}
            onPress={action.onPress}
            testID={action.testID}
          >
            <Text style={styles.action}>{action.label}</Text>
          </Pressable>
        ))}
      </View>
    </InputAccessoryView>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: 'white',
    borderTopColor: '#d9dee5',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  action: { color: '#1f5c85', fontSize: 16, fontWeight: '600' },
});
