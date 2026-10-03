# LangGraph on React Native Hermes

## Decision

Keep LangGraph.js for the local agent runtime. The iOS Hermes probe executes a deterministic two-node state graph with pinned `@langchain/langgraph` 1.4.18 and `@langchain/core` 1.2.14. It performs 20 sequential `invoke` calls and consumes 20 `values` streams on one compiled graph, checking final state and exactly one ordered run of each node every time.

## Compatibility evidence

The reproducible Detox smoke test is `pnpm e2e:build:ios && pnpm e2e:test:ios`; the graph-specific app entry is separate from the existing smoke and storage probes. The simulator result is visible as `agent-graph-success` only after all 40 executions pass. Metro initially chose LangGraph's Node entry and rejected `node:async_hooks`; the graph package therefore imports LangGraph's published `@langchain/langgraph/web` entry. Hermes then reported a missing `ReadableStream` when streaming, so `web-streams-polyfill` 4.3.0 and `react-native-get-random-values` 2.0.0 load from the shared mobile bootstrap before app modules. LangSmith 0.10.7, resolved through the pinned LangChain core dependency, assumes any defined `navigator` has a string `userAgent` when detecting jsdom. React Native Hermes supplies `navigator` without that field, so the bootstrap adds a guarded `userAgent: 'React Native'` before graph imports; this avoids a Node `process` shim and keeps existing browser user-agent strings intact.

The target matrix is React Native 0.87.1, Hermes on the repository's iOS Simulator toolchain (Xcode/iOS 27.0), LangGraph.js 1.4.18, and LangChain.js core 1.2.14. This validates local graph invocation and state streaming only; it does not validate model-provider networking, checkpoint persistence, or remote streaming.
