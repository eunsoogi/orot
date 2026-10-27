import { useEffect, useMemo, useRef, useState } from 'react';
import { NativeModules, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import App from '../../App';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { nativeHealthReviewService } from './testing/nativeService';
import { healthReviewStyles as styles } from './styles';

/** Synthetic model responses enter the full production App; no route result or session is replaced. */
export function NativeHealthReviewProbe() {
  const [ready, setReady] = useState(false);
  const [report, setReport] = useState('loading');
  const sequence = useRef(0);
  const fixture = useMemo(() => {
    const manager = NativeModules.SettingsManager;
    const settings =
      manager?.settings ?? manager?.getConstants?.().settings ?? {};
    return nativeHealthReviewService(
      String(settings.OROT_REVIEW_FIXTURE ?? ''),
      String(settings.OROT_REVIEW_MODE ?? 'seed'),
    );
  }, []);
  useEffect(() => {
    let active = true;
    fixture
      .seed()
      .then(() => {
        if (active) setReady(true);
      })
      .catch(() => {
        if (active) setReport('failed');
      });
    return () => {
      active = false;
    };
  }, [fixture]);
  return (
    <SafeAreaProvider>
      <View style={styles.probe}>
        <Text testID="health-review-probe-ready">
          {ready ? 'ready' : 'loading'}
        </Text>
        <Text testID="health-review-probe-report">{report}</Text>
        <AppButton
          title="검증 상태 읽기"
          testID="health-review-probe-readback"
          onPress={() => {
            fixture
              .readback(++sequence.current)
              .then(setReport)
              .catch(() => setReport('failed'));
          }}
        />
        <AppButton
          title="검증 관찰 삭제"
          testID="health-review-probe-remove-observation"
          onPress={() => {
            fixture
              .removeObservation()
              .then(() => setReport('observation-removed'))
              .catch(() => setReport('failed'));
          }}
        />
        <AppButton
          title="검증 자료 정리"
          testID="health-review-probe-cleanup"
          onPress={() => {
            fixture
              .cleanup()
              .then(() => setReport('cleaned'))
              .catch(() => setReport('failed'));
          }}
        />
        {ready ? <App healthReviewService={fixture.service} /> : null}
      </View>
    </SafeAreaProvider>
  );
}
