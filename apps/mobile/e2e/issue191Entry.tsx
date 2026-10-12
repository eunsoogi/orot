import '../src/agent/polyfills';
import 'react-native-get-random-values';
import { useEffect, useState } from 'react';
import { AppRegistry, NativeModules, Text } from 'react-native';
import App from '../App';
import { name as appName } from '../app.json';
import { openLocalStorage } from '../src/storage/secureDatabase';
import { providerSelectionStore } from '../src/providers/selection/keychainSelectionStore';
import { createLocalQueryProbeFixtures } from './localRecordQueryProbeFixtures';
import {
  installIssue191Diagnostics,
  issue191Services,
  issue191VisitOperations,
} from './issue191Diagnostics';
import { NextVisitQuestionsRoute } from '../src/aiFeatures/integration/NextVisitQuestionsRoute';

installIssue191Diagnostics();

/** Seeds only the dedicated issue-191 Simulator, then mounts the shipping application. */
async function prepare() {
  const records = await openLocalStorage();
  const fixture = createLocalQueryProbeFixtures();
  const settings =
    NativeModules.SettingsManager?.settings ??
    NativeModules.SettingsManager?.getConstants?.().settings;
  const emptyStore = settings?.OROT_ISSUE191_EMPTY === 'enabled';
  if (
    !emptyStore &&
    !(await records.get('medication_definition', fixture.medication.id))
  ) {
    await records.sourceRecords.create(fixture.healthSource);
    await records.sourceRecords.create(fixture.audioSource);
    await records.put('medication_definition', {
      ...fixture.medication,
      displayText: '합성 아세트아미노펜 500mg',
    });
    await records.put('dose_event', {
      ...fixture.dose,
      observationStatus: 'taken',
    });
    await records.put('appointment', {
      ...fixture.appointment,
      calendarEventSnapshot: {
        ...fixture.appointment.calendarEventSnapshot!,
        title: '합성 내과 진료: 수면 변화와 복용 기록 상담',
      },
    });
    await records.transcripts.append([
      {
        ...fixture.transcript,
        text: '합성 기록입니다. 최근 일주일 동안 새벽에 잠에서 깨고 다시 잠들기 어렵습니다. 아세트아미노펜 500mg을 어제 저녁에 복용했습니다. 진료에서 수면 변화와 복용 기록을 상담하려고 합니다.',
      },
    ]);
    for (let index = 0; index < 110; index += 1) {
      await records.put('health_observation', {
        ...fixture.healthRows[3],
        id: `issue191-heart-${index}`,
      });
    }
  }
  await providerSelectionStore.save({
    providerId: 'apple-foundation-models',
    modelId: 'apple-foundation-models-system-default',
  });
}

/** No generated answer, evidence validator, or production service is replaced. */
function Issue191Entry() {
  const [state, setState] = useState('preparing');
  useEffect(() => {
    prepare()
      .then(() => setState('ready'))
      .catch(error => setState(String(error)));
  }, []);
  return state === 'ready' ? (
    <App
      aiFeatureServiceDependencies={issue191Services}
      renderVisitQuestions={input => (
        <NextVisitQuestionsRoute
          {...input}
          operations={issue191VisitOperations}
        />
      )}
    />
  ) : (
    <Text testID="issue191-setup">{state}</Text>
  );
}

AppRegistry.registerComponent(appName, () => Issue191Entry);
