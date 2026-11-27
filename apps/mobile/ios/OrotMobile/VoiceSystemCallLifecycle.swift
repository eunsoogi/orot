import AVFoundation
import CallKit
import Foundation

/// No contact, model, transcript or health data is published to the system call UI or Recents.
protocol VoiceSystemCallPort: AnyObject {
    func start(owner: UUID, prepare: @escaping () throws -> Void, activated: @escaping () -> Void,
               ended: @escaping () -> Void, muted: @escaping () -> Void) throws
    func end(owner: UUID)
}

/// Ownership is independent of OS callback timing and survives delayed caller cleanup.
struct VoiceSystemCallLease {
    private(set) var owner: UUID?
    mutating func acquire(_ next: UUID) -> Bool {
        guard owner == nil else { return false }
        owner = next
        return true
    }

    mutating func release(_ expected: UUID) -> Bool {
        guard owner == expected else { return false }
        owner = nil
        return true
    }
}

/// One process-wide outgoing call provider. It never reports incoming calls or handles telephone numbers.
final class VoiceSystemCallLifecycle: NSObject, VoiceSystemCallPort, CXProviderDelegate {
    static let shared = VoiceSystemCallLifecycle()
    enum Failure: Error { case busy }

    /// Fixed diagnostic vocabulary, never call/socket identifiers, routes, audio, or error text.
    enum DiagnosticStage: String {
        case pending = "callkit_activation_pending"
        case active = "callkit_audio_active"
        case timeout = "callkit_activation_timeout"
        case deactivated = "callkit_audio_deactivated"
        case reset = "callkit_reset"
        case ended = "callkit_end_action"
        case muted = "callkit_mute_action"
        case backgroundContinued = "background_owned_audio_continues"
        case backgroundAudioStartingStopped = "background_owned_audio_still_starting_stops"
        case backgroundManagedStopped = "background_foreground_only_delegation_stops"
        case backgroundUnownedStopped = "background_unowned_audio_stops"
        case protectedDataLost = "protected_data_unavailable"
        case interruptionBegan = "audio_interruption_began"
        case interruptionEnded = "audio_interruption_ended"
        case interruptionUnspecified = "audio_interruption_unspecified"
        case routeChanged = "audio_route_changed"
        case liveTransportFailed = "live_transport_failed"
        case livePartialToolResultRetired = "live_partial_tool_result_retired"
        case liveServerError = "live_server_error"
        case liveServerClosed = "live_server_closed"
        case liveSessionExpired = "live_session_expired"
        case liveCaptureFailed = "live_capture_failed"
        case liveInputOverflow = "live_input_overflow"
        case liveOutputFailed = "live_output_failed"
        case captionCloseIneligible = "caption_close_ineligible"
        case captionCloseEligible = "caption_close_eligible"
        case captionBufferPresent = "caption_buffer_present"
        case captionBufferUnavailable = "caption_buffer_unavailable"
        case captionTerminalAcknowledged = "caption_terminal_acknowledged"
        case captionTerminalUnconfirmed = "caption_terminal_unconfirmed"
        case captionTerminalForegroundLost = "caption_terminal_foreground_lost"
    }

    static func report(_ stage: DiagnosticStage) {
        guard ProcessInfo.processInfo.arguments.contains("-OROT_PROVIDER_DIAGNOSTICS") else { return }
        NSLog("OROT_VOICE_DIAGNOSTIC stage=%@", stage.rawValue)
    }

    static func interruptionStage(_ note: Notification) -> DiagnosticStage {
        let type = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt)
            .flatMap(AVAudioSession.InterruptionType.init(rawValue:))
        switch type {
        case .began: return .interruptionBegan
        case .ended: return .interruptionEnded
        default: return .interruptionUnspecified
        }
    }

    static func backgroundStage(systemCallActive: Bool, managed: Bool, audioStarting: Bool = false) -> DiagnosticStage {
        guard systemCallActive else { return .backgroundUnownedStopped }
        guard !managed else { return .backgroundManagedStopped }
        // The system activates before the graph becomes ready. That interval still stops on background.
        return audioStarting ? .backgroundAudioStartingStopped : .backgroundContinued
    }

    private var provider: CXProvider
    private let controller = CXCallController()
    private var uuid: UUID?
    private var lease = VoiceSystemCallLease()
    private var prepare: (() throws -> Void)?
    private var activated: (() -> Void)?
    private var ended: (() -> Void)?
    private var muted: (() -> Void)?
    private var timeout: Timer?

    private static func makeProvider() -> CXProvider {
        let configuration = CXProviderConfiguration()
        configuration.supportsVideo = false
        configuration.maximumCallGroups = 1
        configuration.maximumCallsPerCallGroup = 1
        configuration.supportedHandleTypes = [.generic]
        configuration.includesCallsInRecents = false
        return CXProvider(configuration: configuration)
    }

    override init() {
        provider = Self.makeProvider()
        super.init()
        provider.setDelegate(self, queue: .main)
    }

    func start(owner: UUID, prepare: @escaping () throws -> Void, activated: @escaping () -> Void,
               ended: @escaping () -> Void, muted: @escaping () -> Void) throws
    {
        dispatchPrecondition(condition: .onQueue(.main))
        guard uuid == nil, lease.acquire(owner) else { throw Failure.busy }
        // A finished provider is invalidated. Its queued callbacks cannot target the next call.
        provider = Self.makeProvider()
        provider.setDelegate(self, queue: .main)
        let id = UUID()
        uuid = id; self.prepare = prepare; self.activated = activated
        self.ended = ended; self.muted = muted
        Self.report(.pending)
        let action = CXStartCallAction(call: id, handle: CXHandle(type: .generic, value: "Orot"))
        action.isVideo = false
        controller.request(CXTransaction(action: action)) { [weak self] error in
            DispatchQueue.main.async {
                guard let self, self.uuid == id, let error else { return }
                Self.reportRequestTransactionFailure(error)
                self.finish(notify: true)
            }
        }
        // A transaction acknowledgment is not activation. Never keep a silent pending call indefinitely.
        timeout = Timer.scheduledTimer(withTimeInterval: 15, repeats: false) { [weak self] _ in
            guard let self, uuid == id else { return }
            Self.report(.timeout)
            finish(notify: true)
        }
    }

    /// A device diagnostic may expose a recognized CallKit status, never the NSError itself.
    static func requestTransactionDiagnosticCode(_ error: Error) -> Int? {
        let value = error as NSError
        guard value.domain == CXErrorDomainRequestTransaction else { return nil }
        let recognized = [
            CXErrorCodeRequestTransactionError.unknown,
            CXErrorCodeRequestTransactionError.unentitled,
            CXErrorCodeRequestTransactionError.unknownCallProvider,
            CXErrorCodeRequestTransactionError.emptyTransaction,
            CXErrorCodeRequestTransactionError.unknownCallUUID,
            CXErrorCodeRequestTransactionError.callUUIDAlreadyExists,
            CXErrorCodeRequestTransactionError.invalidAction,
            CXErrorCodeRequestTransactionError.maximumCallGroupsReached,
        ]
        return recognized.contains(where: { $0.rawValue == value.code }) ? value.code : nil
    }

    private static func reportRequestTransactionFailure(_ error: Error) {
        guard ProcessInfo.processInfo.arguments.contains("-OROT_PROVIDER_DIAGNOSTICS") else { return }
        if let code = requestTransactionDiagnosticCode(error) {
            NSLog("OROT_VOICE_DIAGNOSTIC stage=callkit_request outcome=rejected code=%ld", code)
        } else {
            NSLog("OROT_VOICE_DIAGNOSTIC stage=callkit_request outcome=rejected")
        }
    }

    func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
        guard provider === self.provider, action.callUUID == uuid, let prepare else { action.fail(); return }
        do {
            try prepare()
            action.fulfill()
            provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: Date())
        } catch { action.fail(); finish(notify: true) }
    }

    func provider(_ provider: CXProvider, didActivate _: AVAudioSession) {
        guard provider === self.provider, let id = uuid, let callback = activated else { return }
        activated = nil; timeout?.invalidate(); timeout = nil
        provider.reportOutgoingCall(with: id, connectedAt: Date())
        Self.report(.active)
        callback()
    }

    func provider(_ provider: CXProvider, didDeactivate _: AVAudioSession) {
        if provider === self.provider {
            if uuid != nil {
                Self.report(.deactivated)
            }
            finish(notify: true)
        }
    }

    func providerDidReset(_ provider: CXProvider) {
        if provider === self.provider {
            if uuid != nil {
                Self.report(.reset)
            }
            finish(notify: true)
        }
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        guard provider === self.provider, action.callUUID == uuid else { action.fail(); return }
        Self.report(.ended)
        finish(notify: true); action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        guard provider === self.provider, action.callUUID == uuid, action.isMuted else { action.fail(); return }
        // Resuming requires foreground consent/selection revalidation, never an OS unmute shortcut.
        let callback = muted
        Self.report(.muted)
        finish(notify: false); callback?(); action.fulfill()
    }

    func provider(_ provider: CXProvider, timedOutPerforming action: CXAction) {
        guard provider === self.provider else { return }
        action.fail(); finish(notify: true)
    }

    func end(owner: UUID) {
        guard lease.owner == owner else { return }
        finish(notify: false)
    }

    private func finish(notify: Bool) {
        guard let id = uuid else { return }
        let callback = ended
        if let owner = lease.owner {
            _ = lease.release(owner)
        }
        uuid = nil; prepare = nil; activated = nil; ended = nil; muted = nil
        timeout?.invalidate(); timeout = nil
        provider.reportCall(with: id, endedAt: Date(), reason: .remoteEnded)
        provider.invalidate()
        if notify {
            callback?()
        }
    }
}
