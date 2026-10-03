# Local LangGraph checkpoints

Orot's LangGraph saver implements the upstream `BaseCheckpointSaver` contract
and writes checkpoint state through the app's existing SQLCipher connection.
It adds no backend, hosted checkpoint service, dependency, or native bridge.

## App integration

Open the saver with `openLocalWorkflowCheckpointSaver()` from
`apps/mobile/src/agent/localCheckpointSaver.ts`. Build the graph config with
`createWorkflowCheckpointConfig(workflowId, appThreadId, checkpointNamespace)`.
The helper URI-encodes the workflow and app thread ids into LangGraph's
`thread_id`; `checkpoint_ns` stays a separate field for subgraphs.

Compile a graph with the saver and invoke it using that config. `deleteThread`
removes all checkpoints and pending writes for the composed workflow/thread id.

## Storage and writes

`langgraph_checkpoints` is keyed by thread, namespace, and checkpoint id.
`langgraph_checkpoint_writes` adds task id and write index to its key. Saving a
checkpoint or a batch of pending writes uses one SQL transaction. Repeating a
checkpoint id replaces its row. Ordinary writes use insert-if-absent at their
stable task/index; LangGraph's reserved error, scheduled, interrupt, and resume
slots replace their own rows when retried, even in a batch with ordinary writes.

LangGraph calls `put` and `putWrites` separately. Each call is atomic, but the
saver does not claim one transaction across both calls. Deletion removes both
tables' rows for every namespace in one transaction.

## Resume and side effects

After a completed node's checkpoint is saved, reopening the database and
resuming that thread continues from the saved state without running that node
again. The mobile Detox probe verifies this across an app process restart.

A node can run again if it fails or is interrupted after a local effect but
before LangGraph saves its completed checkpoint. Checkpointing alone cannot
make arbitrary side effects exactly once. Give local effects a stable operation
key and enforce that key with the effect's existing transaction or a unique
constraint; remote effects need their provider's idempotency support. The unit
probe verifies a retry with a unique local operation key and separately proves
that the incomplete node ran twice.

The adapter and probes use synthetic workflow data. They do not establish
provider authentication or provider-side behavior.

## Checks

Run portable checks with `pnpm --filter @orot/agent-runtime test:unit`,
`pnpm --filter @orot/storage test:unit`, and
`pnpm --filter @orot/mobile test:unit`. The dedicated simulator probe is
`pnpm --filter @orot/mobile e2e:test:ios:checkpoint` after building it with
`pnpm --filter @orot/mobile e2e:build:ios:checkpoint`.
