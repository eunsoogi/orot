import React
import UIKit

/// One native view owns the same React list hierarchy. It never adds a second scroll host.
@objc(RecordsSnapshotSurface)
final class RecordsSnapshotSurface: RCTView {
    @objc var onRecordsCoverage: RCTDirectEventBlock? {
        didSet {
            publishBound()
            publishCoveredGeneration()
        }
    }
    @objc var presentationGeneration: NSNumber? {
        didSet { setNeedsLayout() }
    }

    private weak var shield: RecordsSnapshotShield?
    private weak var attachedWindow: UIWindow?
    private var activeObserver: NSObjectProtocol?
    private var lastCoverage: String?
    private var boundGeneration: Int?

    override func didMoveToWindow() {
        super.didMoveToWindow()
        stopObserving()
        if attachedWindow !== window {
            shield?.ownerDetached(self)
            if let boundGeneration { onRecordsCoverage?(["kind": "detached", "generation": boundGeneration]) }
            shield = nil
            attachedWindow = nil
            lastCoverage = nil
            boundGeneration = nil
        }
        guard let scene = window?.windowScene else {
            isHidden = true
            return
        }
        activeObserver = NotificationCenter.default.addObserver(
            forName: UIScene.didActivateNotification,
            object: scene,
            queue: .main,
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.attachIfCurrent()
                self?.publishCoveredGeneration()
                self?.setNeedsLayout()
            }
        }
        attachIfCurrent()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        shield?.keepLocalCoverInFront(of: self)
        attachIfCurrent()
        guard !isHidden, let value = presentationGeneration,
              value.intValue > 0, Double(value.intValue) == value.doubleValue
        else { return }
        _ = shield?.acknowledgePresented(owner: self, generation: value.intValue)
    }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        if !isHidden, bounds.contains(point), shield?.hasLocalCover(for: self) == true { return self }
        return super.hitTest(point, with: event)
    }

    private func attachIfCurrent() {
        guard shield == nil else { return }
        guard let window, let scene = window.windowScene,
              let delegate = scene.delegate as? SceneDelegate,
              delegate.window === window,
              let generation = delegate.recordsSnapshotShield.arm(
                  owner: self,
                  in: window,
                  scene: scene,
                  coverChanged: { [weak self] epoch, local in self?.publish(epoch, local: local) },
              )
        else {
            isHidden = true
            return
        }
        shield = delegate.recordsSnapshotShield
        attachedWindow = window
        boundGeneration = generation
        isHidden = false
        publishBound()
        publishCoveredGeneration()
    }

    private func publishCoveredGeneration() {
        if let generation = shield?.coveredGeneration(for: self) {
            publish(generation, local: shield?.hasLocalCover(for: self) == true)
        }
    }

    private func publishBound() {
        if let boundGeneration { onRecordsCoverage?(["kind": "bound", "generation": boundGeneration]) }
    }

    private func publish(_ generation: Int, local: Bool) {
        let kind = local ? "localized" : "covered"
        let stamp = "\(kind):\(generation)"
        guard stamp != lastCoverage, let onRecordsCoverage else { return }
        lastCoverage = stamp
        if !local { presentationGeneration = nil }
        onRecordsCoverage(["kind": kind, "generation": generation])
    }

    private func stopObserving() {
        if let activeObserver { NotificationCenter.default.removeObserver(activeObserver) }
        activeObserver = nil
    }
}

@objc(RecordsSnapshotSurfaceManager)
final class RecordsSnapshotSurfaceManager: RCTViewManager {
    override static func requiresMainQueueSetup() -> Bool { true }
    override func view() -> UIView! { RecordsSnapshotSurface() }
}
