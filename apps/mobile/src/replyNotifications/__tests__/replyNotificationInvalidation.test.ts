import { NativeModules } from 'react-native';
import {
  notifyLocalDataCleared,
  notifyLocalSourceDeleted,
} from '../../storage/localDataClearEvents';

test('clears old previews on deletion before conversation storage is opened', () => {
  const oldModule = NativeModules.ReplyNotificationModule;
  const removeAll = jest.fn().mockResolvedValue(undefined);
  NativeModules.ReplyNotificationModule = { removeAll };
  try {
    notifyLocalDataCleared();
    notifyLocalSourceDeleted();
    expect(removeAll).toHaveBeenCalledTimes(2);
  } finally {
    NativeModules.ReplyNotificationModule = oldModule;
  }
});
