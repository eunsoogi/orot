import Foundation

/// Closed structural failure codes only: no payload, identifier, URL, count or error text
/// can enter this opt-in log. Returning the original error preserves all rejection behavior.
enum ResponsesMalformedDiagnostics {
    enum Category: String, CaseIterable {
        case steeringFrameShape = "steering_frame_shape"
        case steeringCreatedIdentity = "steering_created_identity"
        case steeringSuccessorOrder = "steering_successor_order"
        case steeringPredecessorIdentity = "steering_predecessor_identity"
        case steeringNoActive = "steering_no_active"
        case steeringResponseIdentity = "steering_response_identity"
        case steeringNestedIdentity = "steering_nested_identity"
        case steeringIncompleteOrder = "steering_incomplete_order"
        case steeringAcknowledgmentIdentity = "steering_acknowledgment_identity"
        case steeringDuplicateAccepted = "steering_duplicate_accepted"
        case steeringPendingOrder = "steering_pending_order"
        case steeringFailureOrder = "steering_failure_order"
        case steeringUnknownEvent = "steering_unknown_event"
        case steeringUsageSum = "steering_usage_sum"
        case steeringNoActiveError = "steering_no_active_error"
        case steeringNoActiveFailed = "steering_no_active_failed"
        case webSocketMessageKind = "web_socket_message_kind"
        case startIdentity = "start_identity"
        case startStatus = "start_status"
        case startIdentityMismatch = "start_identity_mismatch"
        case completedOutputConsistency = "completed_output_consistency"
        case publicOutputShape = "public_output_shape"
        case publicOutputTextMismatch = "public_output_text_mismatch"
        case usageShape = "usage_shape"
        case usageCountType = "usage_count_type"
        case usageCountRange = "usage_count_range"
        case publicCallIdentityOrLimit = "public_call_identity_or_limit"
        case publicFunctionCall = "public_function_call"
        case publicCompletedCalls = "public_completed_calls"
        case publicMessageContent = "public_message_content"
        case publicTextAnnotations = "public_text_annotations"
        case publicCitationLimit = "public_citation_limit"
        case publicCitationsMissing = "public_citations_missing"
        case publicCitationShape = "public_citation_shape"
        case publicStreamByteLimit = "public_stream_byte_limit"
        case publicTextByteLimit = "public_text_byte_limit"
    }

    static func message(_ category: Category, enabled: Bool) -> String? {
        guard enabled else { return nil }
        return "OROT_PROVIDER_DIAGNOSTIC provider=openai stage=parser_validation category=\(category.rawValue)"
    }

    static func failure(_ category: Category) -> ChatGPTResponsesError {
        if let message = message(
            category,
            enabled: ProcessInfo.processInfo.arguments.contains("-OROT_PROVIDER_DIAGNOSTICS"),
        ) {
            NSLog("%@", message)
        }
        return .malformedEvent
    }
}
