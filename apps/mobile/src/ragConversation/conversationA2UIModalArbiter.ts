/** A mounted surface has only one native admission attempt or sheet. Identity
 * prevents a stale close from retiring the next sheet's admission attempt. */
export function createConversationA2UIModalArbiter() {
  let active: AbortController | undefined;
  return {
    acquire() {
      if (active) return undefined;
      const controller = new AbortController();
      active = controller;
      return controller;
    },
    owns(controller: AbortController) {
      return active === controller && !controller.signal.aborted;
    },
    release(controller: AbortController) {
      if (active === controller) active = undefined;
      controller.abort();
    },
  };
}
