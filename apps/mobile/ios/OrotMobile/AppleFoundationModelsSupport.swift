import Foundation
#if canImport(FoundationModels) && !(OROT_TESTS && targetEnvironment(simulator))
    import FoundationModels
#endif
import React

/// Keep bridge NSError metadata and event packets consistent across request paths.
func appleFoundationModelsPacket(_ type: String, _ code: String?, _ message: String?, _ status: String?) -> NSDictionary {
    var value: [String: Any] = ["type": type]
    if let code {
        value["code"] = code
    }
    if let message {
        value["message"] = message
    }
    if let status {
        value["status"] = status
    }
    return value as NSDictionary
}

func appleFoundationModelsFailure(_ code: String, _ message: String, _ status: String?) -> NSError {
    var info: [String: Any] = [NSLocalizedDescriptionKey: message, "code": code]
    if let status {
        info["status"] = status
    }
    return NSError(domain: "AppleFoundationModels", code: 1, userInfo: info)
}

func appleFoundationModelsNativeFailure(_ error: Error) -> NSError {
    logAppleModelFailureCategory(error)
    // Simulator tests use the mock call boundary, so classify SDK-specific refusals only in production.
    // Preserve native safety refusals separately from app input errors and missing records.
    #if canImport(FoundationModels) && !(OROT_TESTS && targetEnvironment(simulator))
        if #available(iOS 27.0, *), let modelError = error as? LanguageModelError {
            switch modelError {
            case .refusal, .guardrailViolation:
                return appleFoundationModelsFailure("SAFETY_REFUSAL", "The selected model declined this request.", nil)
            default: break
            }
        }
        if #available(iOS 26.0, *), let modelError = error as? LanguageModelSession.GenerationError {
            switch modelError {
            case .refusal, .guardrailViolation:
                return appleFoundationModelsFailure("SAFETY_REFUSAL", "The selected model declined this request.", nil)
            default: break
            }
        }
    #endif
    let value = error as NSError
    if value.domain == "AppleFoundationModels", value.userInfo["code"] != nil {
        return value
    }
    return appleFoundationModelsFailure("GENERATION_FAILED", value.localizedDescription, nil)
}

/// Streaming and one-shot calls preserve the same safety, capability and availability decisions.
func appleFoundationModelsErrorPacket(_ error: Error) -> NSDictionary {
    let failure = appleFoundationModelsNativeFailure(error)
    return appleFoundationModelsPacket("error", failure.userInfo["code"] as? String,
                                       failure.localizedDescription, failure.userInfo["status"] as? String)
}

/// Classify only known error types and bridge tags; never inspect generated content or error messages.
func appleFoundationModelsFailureCategory(_ error: Error) -> String {
    let value = error as NSError
    if value.domain == "FoundationModels.GeneratedContent.ParsingError" {
        return "decoding"
    }
    if value.domain == "FoundationModels.LanguageModelSession.Error" {
        return value.code == 0 ? "concurrent_requests" : value.code == 1 ? "transcript_mutation" : "other"
    }
    if value.domain == "AppleFoundationModels" {
        let tag = value.userInfo["diagnosticCategory"] as? String
        if let tag, ["required_tool_missing", "callback_conflict", "tool_arguments", "bridge_state"].contains(tag) {
            return tag
        }
        return "bridge_failure"
    }
    var category = "other"
    #if canImport(FoundationModels) && !(OROT_TESTS && targetEnvironment(simulator))
        if #available(iOS 26.0, *), error is LanguageModelSession.ToolCallError {
            category = "tool_callback"
        } else if #available(iOS 27.0, *), let failure = error as? LanguageModelError {
            switch failure {
            case .contextSizeExceeded: category = "context_size"
            case .refusal, .guardrailViolation: category = "safety_refusal"
            case .unsupportedGenerationGuide: category = "unsupported_guide"
            case .unsupportedLanguageOrLocale: category = "unsupported_language"
            case .unsupportedCapability: category = "unsupported_capability"
            case .unsupportedTranscriptContent: category = "unsupported_transcript"
            case .rateLimited: category = "rate_limited"
            case .timeout: category = "timeout"
            default: break
            }
        } else if #available(iOS 27.0, *), error is SystemLanguageModel.Error {
            category = "assets_unavailable"
        } else if #available(iOS 26.0, *), error is GenerationSchema.SchemaError {
            category = "schema"
        } else if #available(iOS 26.0, *), let failure = error as? LanguageModelSession.GenerationError {
            switch failure {
            case .exceededContextWindowSize: category = "context_size"
            case .refusal, .guardrailViolation: category = "safety_refusal"
            case .unsupportedGuide: category = "unsupported_guide"
            case .unsupportedLanguageOrLocale: category = "unsupported_language"
            case .decodingFailure: category = "decoding"
            case .assetsUnavailable: category = "assets_unavailable"
            case .concurrentRequests: category = "concurrent_requests"
            case .rateLimited: category = "rate_limited"
            default: break
            }
        }
    #endif
    return category
}

/// Device diagnostics contain closed categories only, never SDK messages or health content.
private func logAppleModelFailureCategory(_ error: Error) {
    guard ProcessInfo.processInfo.arguments.contains("-OROT_PROVIDER_DIAGNOSTICS") else { return }
    NSLog("OROT_PROVIDER_DIAGNOSTIC provider=apple category=%@", appleFoundationModelsFailureCategory(error))
}

func rejectApplePromise(_ reject: RCTPromiseRejectBlock, _ error: NSError) {
    reject(error.userInfo["code"] as? String ?? "APPLE_MODEL_ERROR", error.localizedDescription, error)
}
