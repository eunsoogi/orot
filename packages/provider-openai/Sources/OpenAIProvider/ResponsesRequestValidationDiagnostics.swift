import Foundation

/// Closed local guard categories only. No request content, lengths, IDs, schema,
/// credentials or error text can enter this opt-in log; public errors stay unchanged.
enum ResponsesRequestValidationDiagnostics {
    enum Category: String, CaseIterable {
        case decoderEnvelope = "decoder_envelope"
        case builderEnvelope = "builder_envelope"
        case publicSearchEnvelope = "public_search_envelope"
        case messageList = "message_list"
        case messageShape = "message_shape"
        case messageRole = "message_role"
        case functionCall = "function_call"
        case functionOutput = "function_output"
        case continuationItem = "continuation_item"
        case toolList = "tool_list"
        case toolDefinition = "tool_definition"
        case toolDescription = "tool_description"
        case toolChoice = "tool_choice"
        case transportScope = "transport_scope"
        case duplicateUpgradeWait = "duplicate_upgrade_wait"
        case duplicateResponseStart = "duplicate_response_start"
        case steeringState = "steering_state"
        case outgoingTextEncoding = "outgoing_text_encoding"
    }

    static func message(_ category: Category, enabled: Bool) -> String? {
        guard enabled else { return nil }
        return "OROT_PROVIDER_DIAGNOSTIC provider=openai stage=request_validation category=\(category.rawValue)"
    }

    static func failure(_ category: Category) -> ChatGPTResponsesError {
        if let message = message(category, enabled: ProcessInfo.processInfo.arguments.contains("-OROT_PROVIDER_DIAGNOSTICS")) {
            NSLog("%@", message)
        }
        return .invalidRequest
    }
}
