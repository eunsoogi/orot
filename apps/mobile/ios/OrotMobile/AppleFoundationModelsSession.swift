import Foundation
#if canImport(FoundationModels)
    import FoundationModels

    /// Simulator test products use scripted guided responses; production tool requests
    /// retain real SDK callbacks through AppleNativeToolRegistry. Mock tests do not prove that path.
    @available(iOS 26.0, *)
    enum AppleFoundationModelsSession {
        static func availability() -> [String: Any] {
            #if OROT_TESTS && targetEnvironment(simulator)
                return AppleFoundationModelsMock.shared.availability()
            #else
                switch SystemLanguageModel.default.availability {
                case .available:
                    return ["status": SystemLanguageModel.default.supportsLocale(Locale(identifier: "ko-KR")) ? "available" : "unsupportedLanguage"]
                case let .unavailable(reason):
                    switch reason {
                    case .deviceNotEligible: return ["status": "unsupportedDevice"]
                    case .appleIntelligenceNotEnabled: return ["status": "disabled"]
                    case .modelNotReady: return ["status": "modelNotReady"]
                    @unknown default:
                        // Keep future unavailable reasons truthful without guessing their cause.
                        return ["status": "unavailable"]
                    }
                }
            #endif
        }

        static func generate(_ payload: NSDictionary, requestId: String) async throws -> [String: Any] {
            guard let request = payload as? [String: Any], let prompt = request["prompt"] as? String,
                  let instructions = request["instructions"] as? String
            else { throw appleFoundationModelsFailure("INVALID_REQUEST", "Prompt and instructions are required.", nil) }
            #if !(OROT_TESTS && targetEnvironment(simulator))
                if usesNativeTools(request) {
                    return try await AppleNativeToolRegistry.shared.run(request, requestId: requestId) { generation in
                        try await AppleNativeToolSession.respond(request, generation: generation, snapshot: nil)
                    }
                }
            #endif
            let raw = request["schema"] as? [String: Any]
            if raw == nil, request["mode"] as? String != "text" {
                throw appleFoundationModelsFailure("INVALID_REQUEST", "Guided generation needs a schema.", nil)
            }
            // Construct the real SDK schema even in tests; malformed guided requests must not bypass codec validation.
            let schema = try raw.map { try GenerationSchema(root: AppleFoundationModelsCodec.schema($0), dependencies: []) }
            let text: String
            #if OROT_TESTS && targetEnvironment(simulator)
                text = try await AppleFoundationModelsMock.shared.respond(request)
            #else
                let session = LanguageModelSession(instructions: instructions)
                let options = GenerationOptions(temperature: request["temperature"] as? Double, maximumResponseTokens: request["maxOutputTokens"] as? Int)
                if let schema {
                    text = try await session.respond(to: prompt, schema: schema, options: options).content.jsonString
                } else {
                    text = try await session.respond(to: prompt, options: options).content
                }
            #endif
            if schema != nil {
                return try AppleFoundationModelsCodec.normalize(text, request, requestId: requestId)
            }
            return ["text": text, "toolCalls": [], "finishReason": "complete"]
        }

        /** Structured streams may revise partial JSON; normalize only the final snapshot before returning to callers. */
        static func stream(_ payload: NSDictionary, requestId: String,
                           snapshot: @escaping (String) -> Bool) async throws -> [String: Any]?
        {
            guard let request = payload as? [String: Any],
                  let mode = request["mode"] as? String,
                  let prompt = request["prompt"] as? String,
                  let instructions = request["instructions"] as? String
            else { throw appleFoundationModelsFailure("INVALID_REQUEST", "Prompt, mode and instructions are required.", nil) }
            #if !(OROT_TESTS && targetEnvironment(simulator))
                if usesNativeTools(request) {
                    return try await AppleNativeToolRegistry.shared.run(request, requestId: requestId) { generation in
                        try await AppleNativeToolSession.respond(request, generation: generation, snapshot: snapshot)
                    }
                }
            #endif
            let raw = request["schema"] as? [String: Any]
            if raw == nil, mode != "text" {
                throw appleFoundationModelsFailure("INVALID_REQUEST", "Guided streaming needs a schema.", nil)
            }
            let schema = try raw.map { try GenerationSchema(root: AppleFoundationModelsCodec.schema($0), dependencies: []) }
            let finalText: String?
            #if OROT_TESTS && targetEnvironment(simulator)
                finalText = try await AppleFoundationModelsMock.shared.stream(request, snapshot: snapshot)
            #else
                let session = LanguageModelSession(instructions: instructions)
                let options = GenerationOptions(temperature: request["temperature"] as? Double, maximumResponseTokens: request["maxOutputTokens"] as? Int)
                var latest: String?
                if let schema {
                    for try await value in session.streamResponse(to: prompt, schema: schema, options: options) {
                        let current = value.rawContent.jsonString
                        latest = current
                        if Task.isCancelled || !snapshot(current) {
                            return nil
                        }
                    }
                } else {
                    for try await value in session.streamResponse(to: prompt, options: options) {
                        let current = value.content
                        latest = current
                        if Task.isCancelled || !snapshot(current) {
                            return nil
                        }
                    }
                }
                finalText = latest
            #endif
            guard let finalText else {
                throw appleFoundationModelsFailure("GENERATION_FAILED", "Apple Foundation Models ended its stream without a final response.", nil)
            }
            if schema != nil {
                return try AppleFoundationModelsCodec.normalize(finalText, request, requestId: requestId)
            }
            return ["text": finalText, "toolCalls": [], "finishReason": "complete"]
        }

        private static func usesNativeTools(_ request: [String: Any]) -> Bool {
            !(request["nativeTools"] as? [Any] ?? []).isEmpty ||
                !(request["nativeToolResults"] as? [Any] ?? []).isEmpty
        }
    }
#endif
