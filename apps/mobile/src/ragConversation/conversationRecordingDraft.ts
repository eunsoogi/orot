/** A selected recording belongs to one local composer dispatch, never its history or retry. */
export function createConversationRecordingDraft<
  Row extends { readonly key: string },
>(publish: (value: Row | null) => void) {
  let selected: Row | null = null;
  let live: { readonly row: Row; admitted: boolean } | null = null;
  const clear = () => {
    live = null;
    if (selected) {
      selected = null;
      publish(null);
    }
  };
  return {
    get: () => selected,
    busy: () => live !== null,
    clear,
    select(row: Row) {
      if (live) return false;
      selected = row;
      publish(row);
      return true;
    },
    revoke(ids?: ReadonlySet<string>) {
      const row = live?.row ?? selected;
      if (row && (!ids || ids.has(row.key))) clear();
    },
    claim(current: () => boolean) {
      if (!selected || live || !current()) return undefined;
      const ticket = { row: selected, admitted: false };
      live = ticket;
      const isCurrent = () => live === ticket && current();
      return {
        sourceId: ticket.row.key,
        isCurrent,
        admit() {
          if (!isCurrent() || ticket.admitted) return false;
          ticket.admitted = true;
          selected = null;
          // Remove the visible chip without invalidating this accepted request.
          publish(null);
          return true;
        },
        release() {
          if (live === ticket) live = null;
        },
      };
    },
  };
}
