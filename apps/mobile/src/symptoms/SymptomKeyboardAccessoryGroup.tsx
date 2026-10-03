import SymptomKeyboardAccessory from './SymptomKeyboardAccessory';
import type { SymptomKeyboardAction } from './SymptomKeyboardAccessory';

export interface SymptomKeyboardField {
  nativeID: string;
  testSuffix: string;
}

interface SymptomKeyboardAccessoryGroupProps {
  fields: SymptomKeyboardField[];
  actions: SymptomKeyboardAction[];
}

export default function SymptomKeyboardAccessoryGroup({
  fields,
  actions,
}: SymptomKeyboardAccessoryGroupProps) {
  return fields.map(field => (
    <SymptomKeyboardAccessory
      actions={actions.map(action => ({
        ...action,
        testID: `${action.testID}-${field.testSuffix}`,
      }))}
      key={field.nativeID}
      nativeID={field.nativeID}
    />
  ));
}
