import Foundation
#if canImport(FoundationModels)
    import FoundationModels

    /// The SDK call boundary is replaced only in Simulator test products. Bridge validation and request ownership stay shared.
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
                    }
                }
            #endif
        }

        static func generate(_ payload: NSDictionary, requestId: String) async throws -> [String: Any] {
            guard let request = payload as? [String: Any], let prompt = request["prompt"] as? String,
                  let instructions = request["instructions"] as? String
            else { throw appleFoundationModelsFailure("INVALID_REQUEST", "Prompt and instructions are required.", nil) }
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

        static func stream(_ payload: NSDictionary, snapshot: @escaping (String) -> Bool) async throws {
            guard let request = payload as? [String: Any], request["mode"] as? String == "text",
                  request["schema"] == nil, let prompt = request["prompt"] as? String,
                  let instructions = request["instructions"] as? String
            else { throw appleFoundationModelsFailure("UNSUPPORTED_CAPABILITY", "Streaming supports text requests only.", nil) }
            #if OROT_TESTS && targetEnvironment(simulator)
                try await AppleFoundationModelsMock.shared.stream(request, snapshot: snapshot)
            #else
                let session = LanguageModelSession(instructions: instructions)
                let options = GenerationOptions(temperature: request["temperature"] as? Double, maximumResponseTokens: request["maxOutputTokens"] as? Int)
                for try await value in session.streamResponse(to: prompt, options: options) {
                    if Task.isCancelled || !snapshot(String(describing: value.content)) {
                        return
                    }
                }
            #endif
        }
    }
#endif
