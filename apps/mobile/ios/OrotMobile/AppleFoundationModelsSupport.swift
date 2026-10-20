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

/// Closed stage codes distinguish app preparation from provider failures without logging health data.
@objc(OrotProviderDiagnostics)
final class OrotProviderDiagnostics: NSObject {
    @objc static func requiresMainQueueSetup() -> Bool {
        false
    }

    @objc func report(_ feature: String, stage: String, outcome: String) {
        guard ProcessInfo.processInfo.arguments.contains("-OROT_PROVIDER_DIAGNOSTICS"),
              ["rag", "disease", "visit"].contains(feature),
              ["selection", "data", "workflow", "provider_error", "validation"].contains(stage),
              ["started", "completed", "failed", "result", "invalid_output", "needs_clarification",
               "cancelled", "consent_required", "provider_unavailable", "budget_exhausted",
               "unavailable", "budget_exceeded", "stale_evidence", "other",
               "authentication_required", "credential_unavailable", "internal_error", "invalid_provider",
               "invalid_request", "rate_limited", "safety_refusal", "unsupported_capability", "unsupported_input",
               "task_json", "task_citations", "task_schema", "task_incomplete", "task_date", "task_quantity",
               "task_required_source",
               "task_envelope_json", "task_envelope_object", "task_envelope_type", "task_envelope_citations",
               "task_envelope_value", "task_envelope_fields", "task_envelope_need",
               "task_summary_fields", "task_summary_citations", "task_summary_certainty",
               "task_summary_section_count", "task_summary_sources", "task_summary_medication", "task_summary_language",
               "task_summary_medication_completion", "task_summary_medication_unknown", "task_summary_medication_missing_data",
               "task_summary_prescription", "task_summary_sleep_count",
               "task_summary_sleep_duration",
               "task_summary_step_unit", "task_summary_citation", "task_summary_contrary",
               "task_summary_uncertainty_notes",
               "task_summary_language_summary", "task_summary_language_uncertainty", "task_summary_language_missing_data",
               "task_summary_language_blank", "task_summary_language_symbols", "task_summary_language_numeric",
               "task_summary_language_latin_token", "task_summary_language_latin_numbers", "task_summary_language_latin_phrase", "task_summary_language_other",
               "task_summary_facts", "task_summary_units",
               "task_summary_facts_medications", "task_summary_facts_pressure", "task_summary_facts_heart_rate",
               "task_summary_facts_body_mass", "task_summary_facts_activity", "task_summary_facts_other_quantity",
               "task_summary_facts_sleep", "task_summary_facts_placeholder", "task_summary_coverage",
               "task_summary_empty_section_1", "task_summary_empty_section_2", "task_summary_empty_section_3", "task_summary_empty_section_4",
               "task_summary_empty_section_5", "task_summary_empty_section_6", "task_summary_empty_section_7", "task_summary_empty_section_8",
               "overview_selected", "context_started", "context_selected",
               "context_preparation_started", "context_preparation_completed", "context_calendar_started", "context_calendar_completed",
               "context_quantities_started", "context_quantities_completed", "context_medications_started", "context_medications_completed",
               "context_sleep_started", "context_sleep_completed", "context_symptoms_started", "context_symptoms_completed",
               "task_quantity_ratio", "task_quantity_unit", "task_quantity_precision", "task_quantity_value",
               "type_error", "reference_error", "range_error"].contains(outcome)
        else { return }
        NSLog("OROT_PROVIDER_DIAGNOSTIC layer=app feature=%@ stage=%@ outcome=%@", feature, stage, outcome)
    }
}
