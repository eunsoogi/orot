import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  createRecordRepository,
  type RecordRepository,
  type SqlDatabase,
} from '@orot/storage';
import { watchSavedReportNativeProtection as watchNativeProtection } from '../../generatedReports/savedReportNativeProtection';
import {
  readWorkoutHeartRate,
  type WorkoutHeartRate,
} from '../../healthkit/workoutHeartRate';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../../storage/localDataClearEvents';
import { acquireIndependentReadEpoch } from '../../storage/protectedReadEpoch';
import {
  loadOverviewWorkoutCandidates,
  sameWorkoutCandidate,
  type OverviewWorkoutCandidate,
} from './overviewWorkoutHeartRateSource';

type CandidatePage = Awaited<ReturnType<typeof loadOverviewWorkoutCandidates>>;
type State =
  | { status: 'idle' | 'loading' | 'failed' }
  | (CandidatePage & { status: 'choosing' })
  | { status: 'reading'; selection: OverviewWorkoutCandidate }
  | {
      status: 'result';
      selection: OverviewWorkoutCandidate;
      result: WorkoutHeartRate;
    };

declare const require: (
  path: '../../storage/secureDatabase',
) => Pick<
  typeof import('../../storage/secureDatabase'),
  'openLocalAgentMemoryDatabase' | 'isCurrentLocalAgentMemoryDatabase'
>;

// The existing facade exposes the same guarded owner without close/key access.
function workoutStorage() {
  return require('../../storage/secureDatabase');
}

type Protection = NonNullable<ReturnType<typeof watchNativeProtection>>;
type Session = {
  readonly abort: AbortController;
  readonly protection: Protection;
  database?: SqlDatabase;
  repository?: RecordRepository;
  pending: boolean;
  page?: CandidatePage;
};

/** Only a tap creates a lease. A native result is temporary and belongs to the
 * same selected workout, repository, protected-data lease and visible route.
 */
export function useOverviewWorkoutHeartRate(active: boolean) {
  const [state, setState] = useState<State>({ status: 'idle' });
  const owner = useRef<Session | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const current = (session: Session) =>
    activeRef.current &&
    owner.current === session &&
    !session.abort.signal.aborted;

  const clear = useCallback((status: 'idle' | 'failed' = 'idle') => {
    const former = owner.current;
    owner.current = null;
    former?.abort.abort();
    setState({ status });
  }, []);

  useLayoutEffect(() => {
    if (!active) {
      clear();
      return;
    }
    const visibility = AppState.addEventListener('change', next => {
      if (next !== 'active') clear();
    });
    const unsubClear = subscribeLocalDataClear(() => clear());
    const unsubDelete = subscribeLocalSourceDeletion(() => clear());
    return () => {
      const former = owner.current;
      owner.current = null;
      former?.abort.abort();
      visibility.remove();
      unsubClear();
      unsubDelete();
    };
  }, [active, clear]);

  async function choose() {
    if (!activeRef.current || owner.current?.pending) return;
    clear();
    const abort = new AbortController();
    const protection = watchNativeProtection(abort.signal, () => {
      if (
        !abort.signal.aborted &&
        (!owner.current || owner.current.abort === abort)
      )
        clear();
    });
    if (!protection) {
      abort.abort();
      setState({ status: 'failed' });
      return;
    }
    const session: Session = { abort, protection, pending: true };
    owner.current = session;
    setState({ status: 'loading' });
    let epoch: ReturnType<typeof acquireIndependentReadEpoch>;
    try {
      if (!(await protection.confirm()) || !current(session)) return;
      const storage = workoutStorage();
      const database = await storage.openLocalAgentMemoryDatabase();
      if (!current(session)) return;
      epoch = acquireIndependentReadEpoch(database);
      const admitted = () =>
        current(session) &&
        storage.isCurrentLocalAgentMemoryDatabase(database) &&
        epoch?.current();
      if (!admitted()) {
        clear();
        return;
      }
      const repository = createRecordRepository(database);
      const page = await loadOverviewWorkoutCandidates(repository, new Date());
      if (!(await protection.confirm()) || !admitted()) {
        if (current(session)) clear();
        return;
      }
      session.database = database;
      session.repository = repository;
      session.page = page;
      setState({ status: 'choosing', ...page });
    } catch {
      if (current(session)) clear('failed');
    } finally {
      epoch?.dispose();
      session.pending = false;
    }
  }

  async function select(selection: OverviewWorkoutCandidate) {
    const session = owner.current;
    const repository = session?.repository;
    const database = session?.database;
    if (
      !session ||
      !repository ||
      !database ||
      !current(session) ||
      session.pending ||
      !session.page?.candidates.includes(selection)
    )
      return;
    const storage = workoutStorage();
    const epoch = acquireIndependentReadEpoch(database);
    const admitted = () =>
      current(session) &&
      storage.isCurrentLocalAgentMemoryDatabase(database) &&
      epoch?.current();
    if (!admitted()) {
      epoch?.dispose();
      clear();
      return;
    }
    session.pending = true;
    setState({ status: 'reading', selection });
    const verify = async () => {
      if (!admitted() || !(await session.protection.confirm()) || !admitted())
        return false;
      const now = await repository.get(
        'health_observation',
        selection.record.id,
      );
      // The same writer epoch is checked after every await, including the final
      // foreground confirmation; a normal reimport is not a deletion event.
      return (
        admitted() &&
        sameWorkoutCandidate(selection, now) &&
        (await session.protection.confirm()) &&
        admitted()
      );
    };
    try {
      if (!(await verify()) || !admitted()) {
        if (current(session)) clear();
        return;
      }
      const result = await readWorkoutHeartRate(selection.uuid);
      if ((await verify()) && admitted()) {
        setState({ status: 'result', selection, result });
      } else if (current(session)) clear();
    } catch {
      if (current(session)) clear('failed');
    } finally {
      epoch?.dispose();
      session.pending = false;
    }
  }

  return {
    state: active ? state : ({ status: 'idle' } as const),
    choose,
    select,
  };
}
