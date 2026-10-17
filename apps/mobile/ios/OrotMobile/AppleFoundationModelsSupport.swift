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

func rejectApplePromise(_ reject: RCTPromiseRejectBlock, _ error: NSError) {
    reject(error.userInfo["code"] as? String ?? "APPLE_MODEL_ERROR", error.localizedDescription, error)
}
