import '../src/agent/polyfills';
import 'react-native-get-random-values';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppRegistry, StyleSheet, View } from 'react-native';
import { name as appName } from '../app.json';
import { AppButton } from '../src/layout/AppButton';
import { AppText } from '../src/layout/AppText';
import { SelectedModelControl } from '../src/layout/SelectedModelControl';
import { DiseaseHypothesesScreen } from '../src/diseaseHypotheses/DiseaseHypothesesScreen';
import { SummaryHistoryScreen } from '../src/diseaseHypotheses/SummaryHistoryScreen';
import { EvidenceSourceDetailScreen } from '../src/aiFeatures/integration/EvidenceSourceDetailScreen';
import type { EvidenceReference } from '@orot/agent-runtime';
import type {
  DiseaseHypothesisAnalysis,
  DiseaseHypothesisRunOutcome,
} from '../src/diseaseHypotheses/types';
import type { SymptomSummaryHistory } from '../src/diseaseHypotheses/savedSummaries';
import { ExternalMedicalEvidenceScreen } from '../src/externalMedicalEvidence/ExternalMedicalEvidenceScreen';
import { NavigationRouteAdapter } from '../src/navigation/NavigationRouteAdapter';
import { createNavigationController } from '../src/navigation/navigationController';
import { openSyntheticSummaryFixture } from './summaryVisualFixtures';
import {
  syntheticLiteratureService,
  syntheticPublication,
} from './literatureVisualFixtures';

type Services = Awaited<ReturnType<typeof openSyntheticSummaryFixture>>;
type Route =
  'picker' | 'summary' | 'history' | 'literature' | 'article' | 'evidence';
const leaveState = {
  readState: () => ({
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  }),
};
const styles = StyleSheet.create({ picker: { padding: 24, gap: 12 } });

/** Explicit Simulator-only entry: durable summary storage is real; all result and search content is synthetic. */
function SummaryVisualProbe() {
  const [services, setServices] = useState<Services>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    openSyntheticSummaryFixture().then(
      value => {
        if (active) setServices(value);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, []);
  if (!services)
    return (
      <AppText>
        {failed ? '합성 저장소를 열지 못했어요.' : '합성 저장소 준비 중'}
      </AppText>
    );
  return <Routes services={services} />;
}

function Routes({ services }: { services: Services }) {
  const [controller] = useState(() =>
    createNavigationController<Route>('picker'),
  );
  const [restored, setRestored] = useState<DiseaseHypothesisAnalysis>();
  const [reference, setReference] = useState<EvidenceReference>();
  const failNextList = useRef(false);
  const history = useMemo<SymptomSummaryHistory>(
    () => ({
      list: before => {
        if (failNextList.current) {
          failNextList.current = false;
          return Promise.reject(new Error('Synthetic local read failure'));
        }
        return services.history.list(before);
      },
      read: id => services.history.read(id),
    }),
    [services],
  );
  const summarize = useMemo(
    () => async (): Promise<DiseaseHypothesisRunOutcome> => {
      const value = await services.save();
      return {
        status: 'workflow',
        result: {
          status: 'result',
          value,
          citations: value.hypotheses.flatMap(item => item.supportingEvidence),
          coverage: [],
          checkpoint: {} as never,
        },
      };
    },
    [services],
  );
  return (
    <NavigationRouteAdapter
      controller={controller}
      leaveState={leaveState}
      showHome
    >
      {navigation => {
        const onBack = () => {
          void navigation.onBack();
        };
        if (navigation.route.name === 'evidence' && reference)
          return (
            <EvidenceSourceDetailScreen
              navigationRouteKey={navigation.route.key}
              reference={reference}
              readSource={services.readSource}
              onBack={onBack}
            />
          );
        if (navigation.route.name === 'picker')
          return (
            <View style={styles.picker} testID="summary-visual-picker">
              <AppButton
                title="합성 요약 화면"
                testID="summary-visual-open"
                onPress={() => {
                  setRestored(undefined);
                  navigation.push('summary');
                }}
              />
              <AppButton
                title="합성 요약 조회 오류"
                testID="summary-visual-read-failure"
                onPress={() => {
                  failNextList.current = true;
                  setRestored(undefined);
                  navigation.push('summary');
                }}
              />
              <AppButton
                title="합성 문헌 화면"
                testID="summary-visual-literature"
                onPress={() => navigation.push('literature')}
              />
            </View>
          );
        if (navigation.route.name === 'history')
          return (
            <SummaryHistoryScreen
              history={history}
              onRestore={value => {
                setRestored(value);
                onBack();
              }}
            />
          );
        if (navigation.route.name === 'literature')
          return (
            <ExternalMedicalEvidenceScreen
              navigationRouteKey={navigation.route.key}
              onBack={onBack}
              service={syntheticLiteratureService}
              providerSelection={
                <SelectedModelControl name="합성 문헌 검사" local />
              }
              onOpenArticle={() => navigation.push('article')}
            />
          );
        if (navigation.route.name === 'article')
          return (
            <View style={styles.picker} testID="synthetic-article-opened">
              <AppText>{syntheticPublication.title}</AppText>
              <AppText>
                합성 문헌 이동 확인이에요. 외부 페이지는 열지 않았어요.
              </AppText>
            </View>
          );
        return (
          <DiseaseHypothesesScreen
            navigationRouteKey={navigation.route.key}
            onBack={onBack}
            providerSelection={
              <SelectedModelControl name="합성 요약 모델" local />
            }
            summaryHistory={history}
            restoredSummary={restored}
            onOpenHistory={() => navigation.push('history')}
            onGenerate={async () => ({
              status: 'incomplete_inventory',
              reason: 'unavailable',
            })}
            onSummarize={summarize}
            onOpenSource={value => {
              setReference(value);
              navigation.push('evidence');
            }}
          />
        );
      }}
    </NavigationRouteAdapter>
  );
}

AppRegistry.registerComponent(appName, () => SummaryVisualProbe);
