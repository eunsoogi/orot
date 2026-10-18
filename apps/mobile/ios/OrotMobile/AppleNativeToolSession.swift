import Foundation

// Exclude the SDK implementation itself from mock Simulator products, including
// Debug builds where uncalled functions can retain real model-session symbols.
#if canImport(FoundationModels) && !(OROT_TESTS && targetEnvironment(simulator))
    import FoundationModels

    /// Native tool registration is available on iOS 26. No guided-JSON tool choice is
    /// accepted here: only entry into Tool.call produces a common-runtime tool response.
    @available(iOS 26.0, macOS 26.0, *)
    enum AppleNativeToolSession {
        private struct BridgeTool: Tool {
            let name: String
            let description: String
            let parameters: GenerationSchema
            let generation: AppleNativeToolGeneration

            func call(arguments: GeneratedContent) async throws -> String {
                guard let data = arguments.jsonString.data(using: .utf8),
                      let value = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                else { throw AppleNativeToolGeneration.failure("Tool arguments must be an object.") }
                AppleNativeToolTrace.record("sdk_callback_entered", generation: generation, bytes: data.count)
                let result = try await generation.invoke(name: name, arguments: value)
                AppleNativeToolTrace.record("sdk_callback_returned", generation: generation, bytes: result.utf8.count)
                return result
            }
        }

        static func respond(_ request: [String: Any], generation: AppleNativeToolGeneration,
                            snapshot: ((String) -> Bool)?) async throws -> [String: Any]
        {
            let definitions = request["nativeTools"] as? [[String: Any]] ?? []
            let tools = try definitions.map { definition -> BridgeTool in
                guard let name = definition["name"] as? String,
                      let description = definition["description"] as? String,
                      let parameters = definition["parameters"] as? [String: Any]
                else { throw AppleNativeToolGeneration.failure("Native tool definition was invalid.") }
                return try BridgeTool(name: name, description: description,
                                      parameters: GenerationSchema(root: AppleFoundationModelsCodec.schema(parameters), dependencies: []),
                                      generation: generation)
            }
            let required = request["nativeToolChoice"] as? String == "required"
            guard !required || !tools.isEmpty,
                  let prompt = request["prompt"] as? String,
                  var instructions = request["instructions"] as? String
            else { throw AppleNativeToolGeneration.failure("Native tool request was invalid.") }
            if required {
                instructions += "\nCall exactly one provided tool before responding. After receiving its result, acknowledge completion only."
            }
            let session = LanguageModelSession(tools: tools, instructions: instructions)
            if !tools.isEmpty {
                AppleNativeToolTrace.record("sdk_tools_registered", generation: generation)
            }
            // Each common model request starts one SDK generation. The prior generation
            // drains first; this new session receives the updated evidence and citation schema.
            let raw = request["nativeResponseSchema"] as? [String: Any]
            let schema: GenerationSchema? = if required {
                try GenerationSchema(root: DynamicGenerationSchema(name: "ToolAcknowledgement", properties: [
                    DynamicGenerationSchema.Property(name: "acknowledged", schema: DynamicGenerationSchema(type: Bool.self)),
                ]), dependencies: [])
            } else {
                try raw.map { try GenerationSchema(root: AppleFoundationModelsCodec.schema($0), dependencies: []) }
            }
            let options = GenerationOptions(temperature: request["temperature"] as? Double,
                                            maximumResponseTokens: request["maxOutputTokens"] as? Int)
            var finalText: String?
            if let snapshot {
                if let schema {
                    for try await value in session.streamResponse(to: prompt, schema: schema, options: options) {
                        let text = value.rawContent.jsonString
                        finalText = text
                        if !required, generation.permitsSnapshot(), !snapshot(text) {
                            throw CancellationError()
                        }
                    }
                } else {
                    for try await value in session.streamResponse(to: prompt, options: options) {
                        finalText = value.content
                        if generation.permitsSnapshot(), !snapshot(value.content) {
                            throw CancellationError()
                        }
                    }
                }
            } else if let schema {
                finalText = try await session.respond(to: prompt, schema: schema, options: options).content.jsonString
            } else {
                finalText = try await session.respond(to: prompt, options: options).content
            }
            guard !required || generation.hasInvokedTool() else {
                throw AppleNativeToolGeneration.failure("Apple model completed without the required native tool call.")
            }
            guard let finalText else { throw AppleNativeToolGeneration.failure("Native generation ended without a response.") }
            AppleNativeToolTrace.record("sdk_generation_completed", generation: generation, bytes: finalText.utf8.count)
            if schema != nil {
                return try AppleFoundationModelsCodec.normalize(finalText, ["mode": "structured"], requestId: generation.requestId)
            }
            return ["text": finalText, "toolCalls": [], "finishReason": "complete"]
        }
    }
#endif
