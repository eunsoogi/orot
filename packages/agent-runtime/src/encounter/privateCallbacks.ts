import { CallbackManager, CallbackManagerForChainRun } from '@langchain/core/callbacks/manager';
import { v4 as createUuid } from '@langchain/core/utils/uuid';

/** Review candidates include health text. Raw graph lifecycle events have no external telemetry opt-in. */
export class EncounterPrivateCallbacks extends CallbackManager {
  // LangChain configure hooks can add ambient handlers even when callbacks is an empty array.
  // Keep the boundary on every copied manager and descendant run, without mutating global tracing state.
  addHandler(): void {}
  setHandlers(): void {}
  copy(): CallbackManager {
    return new EncounterPrivateCallbacks();
  }

  async handleChainStart(
    ...args: Parameters<CallbackManager['handleChainStart']>
  ): Promise<CallbackManagerForChainRun> {
    return new EncounterPrivateChainRun(args[2] ?? createUuid(), [], [], [], [], {}, {});
  }
}

class EncounterPrivateChainRun extends CallbackManagerForChainRun {
  getChild(): CallbackManager {
    return new EncounterPrivateCallbacks();
  }
}
