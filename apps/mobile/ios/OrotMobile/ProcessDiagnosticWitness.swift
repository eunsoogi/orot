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
            "memory_queue_wait", "memory_provenance_scan", "memory_engine_acquire", "memory_forget",
            "memory_deletion_fences", "memory_batch_commit", "derived_data_cleanup", "database_delete_commit",
            "audio_cleanup", "list_refresh", "list_summary_refresh", "list_summary_read",
        ])
        guard stages.contains(stage), ["started", "completed", "failed"].contains(outcome) else { return nil }
        return "OROT_PROVIDER_DIAGNOSTIC layer=app feature=recording_delete stage=" + stage + " outcome=" + outcome
    }

    func acceptAndContinueJS(feature: String, stage: String, outcome: String) -> Bool {
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
