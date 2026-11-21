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
        callback()
    }

    func provider(_ provider: CXProvider, didDeactivate _: AVAudioSession) {
        if provider === self.provider {
            finish(notify: true)
        }
    }

    func providerDidReset(_ provider: CXProvider) {
        if provider === self.provider {
            finish(notify: true)
        }
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        guard provider === self.provider, action.callUUID == uuid else { action.fail(); return }
        finish(notify: true); action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        guard provider === self.provider, action.callUUID == uuid, action.isMuted else { action.fail(); return }
        // Resuming requires foreground consent/selection revalidation, never an OS unmute shortcut.
        let callback = muted
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
