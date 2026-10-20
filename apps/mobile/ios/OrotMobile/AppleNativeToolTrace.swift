import Foundation
#if canImport(FoundationModels) && !(OROT_TESTS && targetEnvironment(simulator))
    import FoundationModels
#endif

/// Opt-in numeric context diagnostics and Simulator-only lifecycle evidence.
/// Never log prompts, arguments, results, credentials, or source content;
/// lifecycle correlation IDs belong to the bridge, not the SDK.
enum AppleNativeToolTrace {
    #if canImport(FoundationModels) && !(OROT_TESTS && targetEnvironment(simulator))
        /// Opt-in numeric measurements distinguish input pressure from model execution.
        /// No request, evidence, schema text or native error is written to the console.
        @available(iOS 26.4, macOS 26.4, *)
        static func context(prompt: String, instructions: String, tools: [any Tool], schema: GenerationSchema?) async {
            guard ProcessInfo.processInfo.arguments.contains("-OROT_PROVIDER_DIAGNOSTICS") else { return }
            do {
                let model = SystemLanguageModel.default
                let promptTokens = try await model.tokenCount(for: Prompt(prompt))
                let instructionTokens = try await model.tokenCount(for: Instructions(instructions))
                let toolTokens = try await model.tokenCount(for: tools)
                let schemaTokens: Int = if let schema {
                    try await model.tokenCount(for: schema)
                } else {
                    0
                }
                NSLog("OROT_PROVIDER_DIAGNOSTIC provider=apple context_capacity=%d prompt_tokens=%d instruction_tokens=%d tool_tokens=%d schema_tokens=%d",
                      model.contextSize, promptTokens, instructionTokens, toolTokens, schemaTokens)
            } catch {
                NSLog("OROT_PROVIDER_DIAGNOSTIC provider=apple category=context_measurement_unavailable")
            }
        }
    #endif

    static func record(_ event: String, generation: AppleNativeToolGeneration, bytes: Int? = nil) {
        #if targetEnvironment(simulator)
            guard ProcessInfo.processInfo.arguments.contains("-OROT_NATIVE_TOOL_TRACE") else { return }
            var value: [String: Any] = [
                "event": event, "requestId": generation.requestId,
                "bridgeCallId": generation.callId, "identityOrigin": "bridge",
                "sdkCallId": "unavailable", "time": Date().timeIntervalSince1970,
            ]
            if let bytes {
                value["bytes"] = bytes
            }
            guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
                  let text = String(data: data, encoding: .utf8) else { return }
            NSLog("[OROT_NATIVE_TOOL] %@", text)
        #endif
    }
}
