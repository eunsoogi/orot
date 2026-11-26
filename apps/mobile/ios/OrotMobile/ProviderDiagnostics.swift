import Foundation

/// Closed diagnostic tokens preserve failure boundaries without logging health or task content.
@objc(OrotProviderDiagnostics)
final class OrotProviderDiagnostics: NSObject {
    @objc static func requiresMainQueueSetup() -> Bool {
        false
    }

    /// Keep the detailed spans separate from the flag used for matched restore timings.
    @objc func constantsToExport() -> [AnyHashable: Any] {
        let arguments = ProcessInfo.processInfo.arguments
        let enabled = arguments.contains("-OROT_PROVIDER_DIAGNOSTICS")
        return [
            "enabled": enabled,
            "derivedHeartRateShapeEnabled": enabled && arguments.contains("-OROT_DERIVED_HEART_RATE_SHAPE"),
            "historyValidationCostEnabled": enabled && arguments.contains("-OROT_HISTORY_VALIDATION_COST"),
        ]
    }

    @objc func report(_ feature: String, stage: String, outcome: String) {
        guard ProcessDiagnosticWitness.current?.acceptAndContinueJS(feature: feature, stage: stage, outcome: outcome) == true, !WorkoutPeriodDiagnostics.handleJS(feature, stage: stage, outcome: outcome) else { return }
        if feature == "live_health" {
            // Never accept text, request identifiers, source identities, or provider/audio payloads.
            let stages = ["grant_lookup", "owner_reproof", "local_confirmation", "data_open", "evidence_lookup",
                          "result_projection", "result_confirmation", "source_reproof", "native_handoff", "admission_queue"]
            guard stages.contains(stage), let elapsed = Int(outcome), (0 ... 300_000).contains(elapsed),
                  String(elapsed) == outcome else { return }
            NSLog("OROT_PROVIDER_DIAGNOSTIC layer=app feature=live_health stage=%@ elapsed_ms=%d", stage, elapsed)
            return
        }
        if ["derived_mapped", "derived_committed"].contains(stage) {
            guard ProcessInfo.processInfo.arguments.contains("-OROT_DERIVED_HEART_RATE_SHAPE"),
                  ["restingHeartRate", "walkingHeartRateAverage"].contains(feature),
                  let count = Int(outcome), (0 ... 200).contains(count),
                  String(count) == outcome else { return }
            NSLog("OROT_DERIVED_HEART_RATE_SHAPE phase=%@ feature=%@ count=%d", stage, feature, count)
            return
        }
        if stage.hasPrefix("daily_report_data_") {
            // Detailed Daily Report timing accepts no dynamic stage or content.
            let stages = [
                "daily_report_data_snapshot", "daily_report_data_projection", "daily_report_data_reproof",
                "daily_report_data_post_provider", "daily_report_data_save_reproof",
                "daily_report_data_retry_snapshot", "daily_report_data_retry_projection",
            ]
            guard feature == "daily_report",
                  stages.contains(stage),
                  ["started", "completed", "failed", "cancelled"].contains(outcome) else { return }
            NSLog("OROT_PROVIDER_DIAGNOSTIC layer=app feature=%@ stage=%@ outcome=%@", feature, stage, outcome)
            return
        }
        if ["steering_submit_admitted", "steering_enqueue_resolved", "steering_row_available",
            "steering_row_layout", "steering_applied_observed", "steering_read_layout",
            "source_open_local_tap", "source_open_public_tap", "source_open_public_show", "source_open_public_proof", "source_open_public_ready",
            "source_open_local_admission", "source_open_detail_start", "source_open_detail_header", "source_open_detail_proof", "source_open_detail_ready",
            "source_open_db_admission", "source_open_db_work"].contains(stage)
        {
            // These app-owned stages take only bounded monotonic elapsed milliseconds, never identities.
            guard feature == "rag", let elapsed = Int(outcome), (0 ... 300_000).contains(elapsed),
                  String(elapsed) == outcome else { return }
            NSLog("OROT_PROVIDER_DIAGNOSTIC layer=app feature=rag stage=%@ elapsed_ms=%d", stage, elapsed)
            return
        }
        if feature == "navigation" {
            // Navigation accepts only code-owned layout/lifecycle categories, never route identities or sizes.
            let permitted: [String: Set<String>] = [
                "foreground": ["active", "inactive", "background"],
                "planned_frame": ["missing", "collapsed", "positive"],
                "native_frame": ["missing", "collapsed", "positive"],
                "root_cover": ["pending", "settled"],
            ]
            guard permitted[stage]?.contains(outcome) == true else { return }
            NSLog("OROT_PROVIDER_DIAGNOSTIC layer=app feature=navigation stage=%@ outcome=%@", stage, outcome)
            return
        }
        if stage == "conversation_request_write_wait" || stage == "conversation_lease_admission_wait" {
            // These waits are not a grant or a provider receipt; no request identity is logged.
            guard feature == "rag",
                  ["started", "completed", "failed", "cancelled"].contains(outcome) else { return }
            NSLog("OROT_PROVIDER_DIAGNOSTIC layer=app feature=rag stage=%@ outcome=%@", stage, outcome)
            return
        }
        if stage.hasPrefix("personal_search_") {
            // Self-contained opt-in await times, not CPU times or source receipts.
            let phases = ["personal_search_snapshot", "personal_search_index", "personal_search_rank_adapter"]
            guard feature == "rag", phases.contains(stage),
                  let elapsed = Int(outcome), (0 ... 300_000).contains(elapsed),
                  String(elapsed) == outcome else { return }
            NSLog("OROT_PROVIDER_DIAGNOSTIC layer=app feature=rag stage=%@ elapsed_ms=%d", stage, elapsed)
            return
        }
        if stage == "tool_result_evidence_check" {
            // This opt-in Conversation span accepts only the start and end of a wait.
            guard feature == "rag", ["started", "completed"].contains(outcome) else { return }
            NSLog("OROT_PROVIDER_DIAGNOSTIC layer=app feature=rag stage=tool_result_evidence_check outcome=%@", outcome)
            return
        }
        guard ["rag", "disease", "visit", "daily_report", "storage"].contains(feature),
              ["report_sql_first", "report_sql_repeat", "report_sql_unscoped",
               "report_cache_pending_hit", "report_cache_committed_hit", "report_cache_new_key", "report_cache_generation_miss",
               "report_query_quantity", "report_query_heart_rate", "report_query_sleep", "report_query_symptom", "report_query_other",
               "artifact_initial_validation", "artifact_source_hydration", "artifact_final_validation",
               "artifact_read_admission", "artifact_read_settlement", "artifact_read_setup", "artifact_session_lease", "artifact_root_row", "artifact_root_decode", "artifact_parent_row", "artifact_retained_source", "artifact_summary_parent",
               "artifact_source_authority", "artifact_parent_decode", "artifact_parent_fingerprint",
               "artifact_report_calendar", "artifact_report_snapshot", "artifact_report_fingerprint", "artifact_period_transaction",
               "history_timeline", "history_turns", "history_artifacts", "history_tool_read",
               "history_tool_restore", "history_tasks",
               "history_session_recheck_before_assembly", "history_session_recheck_after_assembly", "history_tool_recheck_before_assembly", "history_tool_recheck_final", "history_cold_previews", "history_recheck", "history_display_admission", "history_display_open", "history_display_timeline", "history_display_presentation", "history_display_recheck", "history_transcript_layout", "conversation_model_preflight", "conversation_history_preflight",
               "conversation_quick_press", "conversation_send_preparing",
               "conversation_receipt_attempt", "conversation_receipt_main", "conversation_receipt_accepted", "conversation_receipt_response_started",
               "conversation_final_react_commit",
               "conversation_dispatch", "conversation_run", "tool_capture_personal", "tool_capture_memory", "tool_capture_generated", "tool_capture_external",
               "tool_event_adapter", "tool_event_discard", "tool_event_capture", "tool_event_write", "tool_event_bind",
               "tool_event_bind_owner", "tool_event_bind_restore",
               "tool_event_write_setup", "tool_event_write_decode", "tool_event_write_lineage_validation",
               "tool_event_write_admission", "tool_event_write_body", "tool_event_write_settlement", "tool_search_wait",
               "opening_generate", "opening_validate", "opening_review", "opening_consent",
               "opening_delivery", "opening_preflight", "opening_display", "stop_native", "stop_js", "stop_abort", "stop_settlement", "conversation_photo_flush", "conversation_preview_flush", "conversation_activity_flush", "conversation_stop_fence", "conversation_lifetime_settle", "conversation_save", "conversation_final_history_validation", "conversation_retention_capture",
               "conversation_save_prepare", "conversation_save_admission", "conversation_save_authority", "conversation_save_lineage",
               "conversation_save_persist", "conversation_save_settlement", "conversation_save_lineage_period_majority", "conversation_save_lineage_period_seen",
               "saved_memory_modules", "saved_memory_open", "saved_memory_read", "saved_memory_wait", "encounter_review_selection", "encounter_review_native_admission", "encounter_review_extraction", "saved_memory_historical_missing", "saved_memory_historical_shape", "saved_memory_historical_authority", "saved_memory_historical_revoked", "recent_records_pre_admission", "recent_records_admission", "recent_records_source_read", "recent_records_reproof", "recent_records_agent_witness", "recent_records_agent_catalog", "recent_records_agent_schema", "recent_records_agent_legacy", "recent_records_agent_slice", "recent_records_agent_certify", "recent_records_media_witness", "recent_records_media_query", "recent_records_media_settlement",
               "saved_memory_delete_confirmation", "saved_memory_delete_queue", "saved_memory_delete_lineage", "saved_memory_delete_record", "saved_memory_delete_successor", "saved_memory_delete_sql",
               "saved_memory_delete_vectors", "saved_memory_delete_commit", "saved_memory_delete_receipt", "saved_memory_delete_native_retirement", "saved_memory_delete_native_submission", "saved_memory_delete_native_settlement", "database_transaction", "database_transaction_wait",
               "sql_schema", "sql_generation", "sql_aggregate", "sql_vector", "sql_health_records", "sql_artifact", "sql_other",
               "transaction_healthkit", "transaction_memory", "selection", "data", "workflow", "provider_error", "validation", "persistence",
               "consent_wait", "provider_wait", "evidence_check", "response_correction",
               "chatgpt_prompt_cache_unknown", "chatgpt_prompt_cache_reported_zero", "chatgpt_prompt_cache_reported_positive",
               "public_search", "history_preparation", "evidence_appointment", "evidence_period", "evidence_records",
               "evidence_memory", "evidence_presentation",
               "preflight_appointment", "preflight_selection", "preflight_saved", "preflight_opening",
               "preflight_context", "preflight_public", "preflight_artifacts"].contains(stage),
              ["report_target_cancelled",
               "report_target_stale",
               "report_target_deleted",
               "report_target_unavailable",
               "report_target_empty",
               "report_target_item_limit",
               "report_target_registry_missing",
               "report_target_source_unavailable",
               "report_target_item_payload",
               "report_target_batch_payload",
               "report_target_recheck",
               "report_target_resolver_missing",
               "clarification_no_new_evidence", "clarification_search_coverage", "clarification_result_coverage",
               "clarification_task_validation", "clarification_group_validation", "clarification_no_search",
               "clarification_research_exhausted", "clarification_other",
               "coverage_empty_items",
               "coverage_empty_scope",
               "coverage_conflict",
               "coverage_gap_other",
               "coverage_gap_topic_limit",
               "coverage_gap_payload",
               "coverage_gap_scope",
               "coverage_gap_reader_limit",
               "coverage_gap_sleep",
               "coverage_gap_memory",
               "coverage_gap_web_timeout",
               "coverage_gap_web_offline",
               "coverage_gap_web_unavailable",
               "coverage_personal_gap",
               "coverage_personal_truncated_blocking",
               "coverage_personal_truncated_allowed",
               "coverage_personal_ranked",
               "coverage_personal_paged",
               "coverage_personal_unspecified",
               "coverage_memory_gap",
               "coverage_memory_truncated_blocking",
               "coverage_memory_truncated_allowed",
               "coverage_memory_ranked",
               "coverage_memory_paged",
               "coverage_memory_unspecified",
               "coverage_artifact_gap",
               "coverage_artifact_truncated_blocking",
               "coverage_artifact_truncated_allowed",
               "coverage_artifact_ranked",
               "coverage_artifact_paged",
               "coverage_artifact_unspecified",
               "coverage_external_gap",
               "coverage_external_truncated_blocking",
               "coverage_external_truncated_allowed",
               "coverage_external_ranked",
               "coverage_external_paged",
               "coverage_external_unspecified",
               "budget_time", "budget_evidence_payload", "budget_evidence_items", "budget_model_calls",
               "budget_research_cycles", "budget_research_payload", "budget_model_payload", "budget_tool_calls",
               "budget_output_payload", "budget_search_start", "budget_partition_calls", "budget_other",
               "workflow_search_failed", "workflow_search_unavailable", "workflow_exception", "workflow_action_unknown", "workflow_unavailable_other",
               "tool_cited_changed", "tool_photo_owner", "tool_filter_rejected",
               "tool_generated_changed", "tool_generated_identity", "tool_generated_lineage",
               "tool_photo_changed", "tool_parent_changed", "tool_parent_invalid",
               "history_discovery_unavailable", "history_page_unavailable", "history_turn_unavailable",
               "history_session_changed", "history_sources_stale", "history_cancelled", "preparation_other",
               "started", "completed", "failed", "result", "invalid_output", "needs_clarification",
               "cancelled", "consent_required", "provider_unavailable", "budget_exhausted",
               "unavailable", "budget_exceeded", "stale_evidence", "other", "timeout", "offline",
               "authentication_required", "credential_unavailable", "internal_error", "invalid_provider",
               "invalid_request", "rate_limited", "safety_refusal", "unsupported_capability", "unsupported_input",
               "stale_model_boundary", "stale_preview_boundary", "stale_preview_input",
               "stale_search_boundary", "stale_search_result", "stale_combined_evidence",
               "stale_evidence_unavailable", "stale_initial_evidence", "stale_resume",
               "tool_capture_alias", "tool_capture_research_shape", "tool_capture_photo_unsupported",
               "tool_capture_filtered_unavailable", "tool_capture_other", "tool_parent_unavailable",
               "task_value_object", "task_value_fields", "task_value_completion", "task_value_kind",
               "task_answer_type", "task_answer_empty", "task_answer_length",
               "task_clinical_rejected", "task_validator_exception", "task_validator_other",
               "task_json", "task_citations", "task_schema", "task_incomplete", "task_date", "task_quantity",
               "task_required_source",
               "task_hypothesis_fields", "task_hypothesis_citations", "task_hypothesis_certainty", "task_hypothesis_section_count",
               "task_claim_field_title", "task_claim_field_summary", "task_claim_field_uncertainty", "task_claim_field_missing_data",
               "task_claim_rule_certainty_adverb", "task_claim_rule_personal_diagnosis", "task_claim_rule_diagnosed", "task_claim_rule_no_uncertainty",
               "task_claim_rule_korean_diagnosis", "task_claim_rule_korean_certainty_adverb", "task_claim_rule_korean_no_uncertainty",
               "task_question_count", "task_question_text", "task_question_rationale", "task_question_evidence",
               "task_question_shape", "task_question_form", "task_question_safety",
               "task_envelope_json", "task_envelope_object", "task_envelope_type", "task_envelope_citations",
               "task_envelope_value", "task_envelope_fields", "task_envelope_need",
               "task_required_lookup", "task_tool_protocol", "task_independent_citations",
               "task_summary_fields", "task_summary_citations", "task_summary_certainty",
               "task_summary_section_count", "task_summary_sources", "task_summary_medication", "task_summary_language",
               "task_summary_medication_completion", "task_summary_medication_unknown", "task_summary_medication_missing_data",
               "task_summary_prescription", "task_summary_sleep_count",
               "task_summary_sleep_duration",
               "task_summary_step_unit", "task_summary_statistic_roles", "task_summary_sleep_coverage",
               "task_summary_citation", "task_summary_contrary",
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
               "context_generation_started", "context_generation_completed",
               "context_scheduler_started", "context_scheduler_completed",
               "context_transaction_wait_started", "context_transaction_wait_completed",
               "context_quantities_started", "context_quantities_completed", "context_medications_started", "context_medications_completed",
               "context_sleep_started", "context_sleep_completed", "context_symptoms_started", "context_symptoms_completed",
               "task_quantity_ratio", "task_quantity_unit", "task_quantity_precision", "task_quantity_value",
               "task_coverage_gap", "task_coverage_empty", "task_coverage_conflict", "task_coverage_truncated",
               "task_coverage_memory", "task_coverage_sleep", "task_coverage_reader_limit",
               "task_coverage_payload", "task_coverage_topic_limit",
               "type_error", "reference_error", "range_error"].contains(outcome)
        else { return }
        NSLog("OROT_PROVIDER_DIAGNOSTIC layer=app feature=%@ stage=%@ outcome=%@", feature, stage, outcome)
    }
}
