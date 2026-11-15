import { Alert } from 'react-native';

/** A stale/cancelled dialog cannot grant authority to a later request. */
export function confirmHistorySave(
  text: string,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise(resolve => {
    let settled = false;
    const finish = (approved: boolean) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', cancel);
      resolve(approved && !signal.aborted);
    };
    const cancel = () => finish(false);
    signal.addEventListener('abort', cancel, { once: true });
    Alert.alert(
      '과거 건강 기록에 저장',
      text,
      [
        { text: '취소', style: 'cancel', onPress: cancel },
        { text: '저장', onPress: () => finish(true) },
      ],
      { cancelable: true, onDismiss: cancel },
    );
  });
}
