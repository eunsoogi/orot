import Foundation

/// Volatile receipts for a diagnostic process only; no source values or clocks.
final class ProcessDiagnosticWitness: @unchecked Sendable {
    enum WorkoutNative: String {
        case bridgeReceived, requestRejected, bridgeBusy, started, unavailable, empty, available, cancelled, timeout
        case nativeGateRejected, workoutObjectsRead, associatedParentsRead, quantitiesRead
    }

    private enum RecordsStage: String {
        case preAdmission = "recent_records_pre_admission"
        case admission = "recent_records_admission"
        case sourceRead = "recent_records_source_read"
        case reproof = "recent_records_reproof"
        case agentWitness = "recent_records_agent_witness"
        case agentCatalog = "recent_records_agent_catalog"
        case agentSchema = "recent_records_agent_schema"
        case agentLegacy = "recent_records_agent_legacy"
        case agentSlice = "recent_records_agent_slice"
        case agentCertify = "recent_records_agent_certify"
        case mediaWitness = "recent_records_media_witness"
        case mediaQuery = "recent_records_media_query"
        case mediaSettlement = "recent_records_media_settlement"
    }

    private enum Route: String {
        case records, overview, shared
    }

    private enum WorkoutStage: String {
        case route, protection, database, epoch, cohort, reproof, bridge
    }

    private enum Outcome: String {
        case started, completed, failed, cancelled, unavailable, skipped, missing, empty
        case staleEvidence = "stale_evidence"

        var records: Bool {
            self != .skipped && self != .missing && self != .empty
        }

        var workout: Bool {
            self != .unavailable && self != .staleEvidence
        }
    }

    static let current = make(arguments: ProcessInfo.processInfo.arguments)

    static func make(arguments: [String]) -> ProcessDiagnosticWitness? {
        arguments.contains("-OROT_PROVIDER_DIAGNOSTICS") ? ProcessDiagnosticWitness() : nil
    }

    private init() {}
    private let lock = NSLock()
    private var launch = false
    private var bridge = false
    private var receipts: [String] = []
    private enum HeartLayoutRow: String { case ordinary, workout }
    private var heartLayoutCounts: [HeartLayoutRow: Int] = [:]

    private func recordHeartFirstLayout(stage: String, outcome: String) {
        guard outcome == "laid_out", let row = HeartLayoutRow(rawValue: stage) else { return }
        lock.lock()
        let count = heartLayoutCounts[row, default: 0]
        if count < 16 {
            heartLayoutCounts[row] = count + 1
        }
        lock.unlock()
        guard count < 16 else { return }
        NSLog("OROT_PROVIDER_DIAGNOSTIC layer=js feature=overview_heart_first_layout stage=%@ outcome=laid_out", row.rawValue)
    }

    func markLaunch() {
        lock.lock()
        defer { lock.unlock() }
        launch = true
    }

    /// Recording deletion appears only on the opted-in native log, not the Settings receipt ring.
    static func recordingDeletionLine(stage: String, outcome: String) -> String? {
        let stages = Set([
            "confirmation_tap", "progress_presented", "busy_committed", "busy_settled", "operation",
            "library_queue_wait", "source_read", "stop_check", "audio_staging", "memory_open",
            "protected_database_open", "deletion_rag_prepare", "source_reference_snapshot",
            "source_reference_db_admission", "source_reference_sql", "source_reference_db_settlement",
            "source_delete_db_admission", "source_delete_reference_sql", "source_delete_fence_sql",
            "source_delete_vector_sql", "source_delete_cascade_sql", "source_delete_context_sql",
            "source_delete_db_settlement",
            "memory_batch_db_admission", "memory_batch_state_read", "memory_batch_record_writes",
            "memory_batch_fence_writes", "memory_batch_db_settlement",
            "memory_queue_wait", "memory_provenance_scan", "memory_engine_acquire", "memory_forget",
            "memory_deletion_fences", "memory_batch_commit", "derived_data_cleanup", "database_delete_commit",
            "audio_cleanup", "list_refresh", "list_summary_refresh", "list_summary_read",
        ])
        guard stages.contains(stage), ["started", "completed", "failed"].contains(outcome) else { return nil }
        return "OROT_PROVIDER_DIAGNOSTIC layer=app feature=recording_delete stage=" + stage + " outcome=" + outcome
    }

    /// Fixed terminal outcomes are process logs only; never store them in the Settings ring.
    static func recordsMediaAdmissionLine(stage: String, outcome: String) -> String? {
        let first = [
            "recovered", "owner_missing", "owner_detached", "settlement_failed", "wait_expired",
            "budget_expired", "cap_missing_witness", "cap_revision_changed", "readmission_refused", "cancelled",
        ]
        let next = ["missing_witness", "revision_changed", "cancelled"]
        guard (stage == "first_page" && first.contains(outcome)) ||
            (stage == "next_page" && next.contains(outcome)) else { return nil }
        return "OROT_PROVIDER_DIAGNOSTIC layer=app feature=records_media_admission stage=" + stage + " outcome=" + outcome
    }

    /// Accepted layout decisions stay in the opted-in process log, never the Settings ring.
    static func conversationA2UILine(stage: String, outcome: String) -> String? {
        let admissions = ["a2ui_no_frames", "a2ui_invalid_frames", "a2ui_admitted"]
        let publicPublication = ["a2ui_no_proposal", "a2ui_citation_mismatch", "a2ui_published"]
        let envelope = ["present", "absent", "decode_failed", "presence_mismatch"]
        guard (stage == "conversation_a2ui_plan_envelope" && envelope.contains(outcome)) ||
            (stage == "conversation_a2ui_final_admission" && admissions.contains(outcome)) ||
            (stage == "conversation_a2ui_public_proposal" && admissions.contains(outcome)) ||
            (stage == "conversation_a2ui_public_publication" && publicPublication.contains(outcome)) ||
            (stage == "conversation_a2ui_react_commit" && outcome == "completed") else { return nil }
        return "OROT_PROVIDER_DIAGNOSTIC layer=app feature=rag stage=" + stage + " outcome=" + outcome
    }

    /// Exact caption outcomes appear only in the opted-in process log, never the Settings ring.
    static func voiceCaptionCloseLine(stage: String, outcome: String) -> String? {
        let permitted: [String: Set<String>] = [
            "bridge_packet": ["unavailable", "authorized", "authority_lost"],
            "sidecar": ["committed", "authority_lost", "failed"],
        ]
        guard permitted[stage]?.contains(outcome) == true else { return nil }
        return "OROT_PROVIDER_DIAGNOSTIC layer=app feature=voice_caption stage=" + stage + " outcome=" + outcome
    }

    func acceptAndContinueJS(feature: String, stage: String, outcome: String) -> Bool {
        if feature == "overview_heart_first_layout" {
            recordHeartFirstLayout(stage: stage, outcome: outcome)
            return false
        }
        if feature == "voice_caption" {
            if let line = Self.voiceCaptionCloseLine(stage: stage, outcome: outcome) {
                NSLog("%@", line)
            }
            return false
        }
        if stage == "conversation_a2ui_plan_envelope" || stage == "conversation_a2ui_final_admission" ||
            stage == "conversation_a2ui_react_commit" || stage == "conversation_a2ui_public_proposal" ||
            stage == "conversation_a2ui_public_publication"
        {
            if feature == "rag", let line = Self.conversationA2UILine(stage: stage, outcome: outcome) {
                NSLog("%@", line)
            }
            return false
        }
        if feature == "records_media_admission" {
            if let line = Self.recordsMediaAdmissionLine(stage: stage, outcome: outcome) {
                NSLog("%@", line)
            }
            return false
        }
        if feature == "recording_delete" {
            if let line = Self.recordingDeletionLine(stage: stage, outcome: outcome) {
                NSLog("%@", line)
            }
            return false
        }
        acceptJS(feature: feature, stage: stage, outcome: outcome)
        return feature != "pipeline"
    }

    private func acceptJS(feature: String, stage: String, outcome: String) {
        if feature == "pipeline", stage == "rn_bridge_attached", outcome == "completed" {
            lock.lock()
            defer { lock.unlock() }
            bridge = true
            return
        }
        guard let result = Outcome(rawValue: outcome) else { return }
        if feature == "storage", let step = RecordsStage(rawValue: stage), result.records {
            append("records " + step.rawValue + " " + result.rawValue)
        } else if feature == "workout_period", result.workout {
            let fields = stage.split(separator: "_", omittingEmptySubsequences: false)
            guard fields.count == 2,
                  let route = Route(rawValue: String(fields[0])),
                  let step = WorkoutStage(rawValue: String(fields[1]))
            else { return }
            append("workout " + route.rawValue + "_" + step.rawValue + " " + result.rawValue)
        }
    }

    func recordWorkout(_ mark: WorkoutNative) {
        append("workout native " + mark.rawValue)
    }

    private func append(_ receipt: String) {
        lock.lock()
        defer { lock.unlock() }
        if receipts.count == 32 {
            receipts.removeFirst()
        }
        receipts.append(receipt)
    }

    func snapshot() -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        return ["launch": launch, "bridge": bridge, "receipts": receipts]
    }
}
