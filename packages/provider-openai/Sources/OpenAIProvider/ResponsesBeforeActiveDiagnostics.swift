import Foundation

/// Closed diagnostic vocabulary only, not a protocol acceptance list.
/// Responses server events plus explicitly named connection-control candidates.
enum ResponsesBeforeActiveDiagnostics {
    enum Event: String, CaseIterable {
        case error
        case responseCreated = "response.created"
        case responseCompleted = "response.completed"
        case responseFailed = "response.failed"
        case responseInProgress = "response.in_progress"
        case responseIncomplete = "response.incomplete"
        case responseQueued = "response.queued"
        case responseDone = "response.done"
        case responseKeepAlive = "response.keep_alive"
        case responseAudioDelta = "response.audio.delta"
        case responseAudioDone = "response.audio.done"
        case responseAudioTranscriptDelta = "response.audio.transcript.delta"
        case responseAudioTranscriptDone = "response.audio.transcript.done"
        case responseCodeInterpreterCallCompleted = "response.code_interpreter_call.completed"
        case responseCodeInterpreterCallInProgress = "response.code_interpreter_call.in_progress"
        case responseCodeInterpreterCallInterpreting = "response.code_interpreter_call.interpreting"
        case responseCodeInterpreterCallCodeDelta = "response.code_interpreter_call_code.delta"
        case responseCodeInterpreterCallCodeDone = "response.code_interpreter_call_code.done"
        case responseCompactionCompacting = "response.compaction.compacting"
        case responseContentPartAdded = "response.content_part.added"
        case responseContentPartDone = "response.content_part.done"
        case responseCustomToolCallInputDelta = "response.custom_tool_call_input.delta"
        case responseCustomToolCallInputDone = "response.custom_tool_call_input.done"
        case responseFileSearchCallCompleted = "response.file_search_call.completed"
        case responseFileSearchCallInProgress = "response.file_search_call.in_progress"
        case responseFileSearchCallSearching = "response.file_search_call.searching"
        case responseFunctionCallArgumentsDelta = "response.function_call_arguments.delta"
        case responseFunctionCallArgumentsDone = "response.function_call_arguments.done"
        case responseImageGenerationCallCompleted = "response.image_generation_call.completed"
        case responseImageGenerationCallGenerating = "response.image_generation_call.generating"
        case responseImageGenerationCallInProgress = "response.image_generation_call.in_progress"
        case responseImageGenerationCallPartialImage = "response.image_generation_call.partial_image"
        case responseMcpCallCompleted = "response.mcp_call.completed"
        case responseMcpCallFailed = "response.mcp_call.failed"
        case responseMcpCallInProgress = "response.mcp_call.in_progress"
        case responseMcpCallArgumentsDelta = "response.mcp_call_arguments.delta"
        case responseMcpCallArgumentsDone = "response.mcp_call_arguments.done"
        case responseMcpListToolsCompleted = "response.mcp_list_tools.completed"
        case responseMcpListToolsFailed = "response.mcp_list_tools.failed"
        case responseMcpListToolsInProgress = "response.mcp_list_tools.in_progress"
        case responseOutputItemAdded = "response.output_item.added"
        case responseOutputItemDone = "response.output_item.done"
        case responseOutputTextAnnotationAdded = "response.output_text.annotation.added"
        case responseOutputTextDelta = "response.output_text.delta"
        case responseOutputTextDone = "response.output_text.done"
        case responseReasoningSummaryPartAdded = "response.reasoning_summary_part.added"
        case responseReasoningSummaryPartDone = "response.reasoning_summary_part.done"
        case responseReasoningSummaryTextDelta = "response.reasoning_summary_text.delta"
        case responseReasoningSummaryTextDone = "response.reasoning_summary_text.done"
        case responseReasoningTextDelta = "response.reasoning_text.delta"
        case responseReasoningTextDone = "response.reasoning_text.done"
        case responseRefusalDelta = "response.refusal.delta"
        case responseRefusalDone = "response.refusal.done"
        case responseShellCallCommandAdded = "response.shell_call_command.added"
        case responseShellCallCommandDelta = "response.shell_call_command.delta"
        case responseShellCallCommandDone = "response.shell_call_command.done"
        case responseShellCallOutputContentDelta = "response.shell_call_output_content.delta"
        case responseShellCallOutputContentDone = "response.shell_call_output_content.done"
        case responseSteerAccepted = "response.steer.accepted"
        case responseSteerFailed = "response.steer.failed"
        case responseSteerPending = "response.steer.pending"
        case responseWebSearchCallCompleted = "response.web_search_call.completed"
        case responseWebSearchCallInProgress = "response.web_search_call.in_progress"
        case responseWebSearchCallSearching = "response.web_search_call.searching"
        case sessionCreated = "session.created"
        case sessionUpdated = "session.updated"
        case rateLimitsUpdated = "rate_limits.updated"
        case ping
        case pong
        case heartbeat
        case keepalive
        case keepAlive = "keep_alive"
        case connectionKeepalive = "connection.keepalive"
        case connectionEstablished = "connection.established"
        case other
    }

    static func message(type: String, enabled: Bool) -> String? {
        guard enabled else { return nil }
        let event = Event(rawValue: type) ?? .other
        return "OROT_PROVIDER_DIAGNOSTIC provider=openai stage=steering_before_active event=\(event.rawValue)"
    }
}
