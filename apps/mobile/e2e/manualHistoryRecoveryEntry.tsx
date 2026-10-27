import { useCallback, useRef } from 'react';
import { AppRegistry } from 'react-native';
import App from '../App';
import { name as appName } from '../app.json';
import { openLocalManualHistoryRepository } from '../src/manualHistory/localRepository';
import { ManualHistoryRepositoryOpenerContext } from '../src/routes/ManualHistoryRoute';

/** Exercises the real App route with one rejected open before Retry reaches encrypted storage. */
function ManualHistoryRecoveryEntry() {
  const openAttempts = useRef(0);
  const openRepository = useCallback(async () => {
    openAttempts.current += 1;
    if (openAttempts.current === 1) {
      throw new Error('Synthetic test-only repository-open failure.');
    }
    return openLocalManualHistoryRepository();
  }, []);

  return (
    <ManualHistoryRepositoryOpenerContext.Provider value={openRepository}>
      <App />
    </ManualHistoryRepositoryOpenerContext.Provider>
  );
}

AppRegistry.registerComponent(appName, () => ManualHistoryRecoveryEntry);
