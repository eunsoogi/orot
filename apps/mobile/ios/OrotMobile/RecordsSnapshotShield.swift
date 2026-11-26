import UIKit

/// A local presentation guard, not authority to read a record. Production
/// Records must arm this from its exact mounted native root before exposing rows.
@MainActor
final class RecordsSnapshotShield {
    private weak var owner: UIView?
    private weak var window: UIWindow?
    private weak var scene: UIWindowScene?
    private var cover: UIView?
    private var previousAccessibilityHidden: Bool?
    private var generation = 0
    private var suspended = false
    private var locked = false
    private var coverChanged: ((Int, Bool) -> Void)?

    /// Arms an exact attached owner. Replacing the owner cannot reveal an
    /// already covered surface; the new owner must acknowledge a fresh frame.
    func arm(owner: UIView, in window: UIWindow, scene: UIWindowScene, coverChanged: ((Int, Bool) -> Void)? = nil) -> Int? {
        guard window.windowScene === scene, owner.window === window,
              self.window == nil || self.window === window,
              self.scene == nil || self.scene === scene,
              cover == nil || self.owner === owner, !suspended, !locked,
              scene.activationState == .foregroundActive,
              UIApplication.shared.isProtectedDataAvailable
        else { return nil }
        if self.owner !== owner {
            restoreAccessibility()
            generation += 1
            self.owner = owner
        }
        self.window = window
        self.scene = scene
        self.coverChanged = coverChanged
        return generation
    }

    /// Called synchronously by UIKit, without dispatching to the React bridge.
    func conceal(in window: UIWindow, scene: UIWindowScene) {
        guard self.window === window, self.scene === scene,
              window.windowScene === scene,
              owner?.window === window || cover?.superview === window
        else { return }
        generation += 1
        hideAccessibility()
        let blanket = cover ?? makeCover()
        cover = blanket
        blanket.frame = window.bounds
        if blanket.superview !== window {
            window.addSubview(blanket)
        }
        window.bringSubviewToFront(blanket)
        coverChanged?(generation, false)
    }

    func sceneSuspended(in window: UIWindow, scene: UIWindowScene) {
        guard self.window === window, self.scene === scene else { return }
        suspended = true
        conceal(in: window, scene: scene)
    }

    func sceneResumed(in window: UIWindow, scene: UIWindowScene) {
        guard self.window === window, self.scene === scene else { return }
        suspended = false
        localizeOrRetire()
    }

    func protectionWillLock(in window: UIWindow, scene: UIWindowScene) {
        guard self.window === window, self.scene === scene else { return }
        locked = true
        conceal(in: window, scene: scene)
    }

    func protectionDidUnlock(in window: UIWindow, scene: UIWindowScene) {
        guard self.window === window, self.scene === scene else { return }
        locked = false
        localizeOrRetire()
    }

    /// Obtain only the epoch of the still-attached owner. UIKit activity by
    /// itself does not acknowledge that React has committed safe rows.
    func coveredGeneration(for owner: UIView) -> Int? {
        guard self.owner === owner, let window, owner.window === window,
              cover?.superview === window || cover?.superview === owner
        else { return nil }
        return generation
    }

    /// Call only from the exact native owner after a newly admitted commit.
    /// A generic JS foreground flag is never sufficient.
    func acknowledgePresented(owner: UIView, generation: Int) -> Bool {
        guard let window, let scene, self.owner === owner, owner.window === window,
              generation == self.generation, window.windowScene === scene,
              !suspended, !locked,
              scene.activationState == .foregroundActive,
              UIApplication.shared.isProtectedDataAvailable,
              cover?.superview === window || cover?.superview === owner
        else { return false }
        cover?.removeFromSuperview()
        cover = nil
        restoreAccessibility()
        return true
    }

    /// The exact window is being disconnected, so no future owner can reuse its ticket.
    func disconnect(_ scene: UIWindowScene) {
        guard self.scene === scene else { return }
        generation += 1
        cover?.removeFromSuperview()
        cover = nil
        restoreAccessibility()
        owner = nil
        window = nil
        self.scene = nil
        coverChanged = nil
        suspended = false
        locked = false
    }

    func ownerDetached(_ view: UIView) {
        guard owner === view, view.window !== window else { return }
        retireDetachedOwnerIfSafe()
    }

    private func localizeOrRetire() {
        guard let window, let scene, !suspended, !locked,
              window.windowScene === scene, scene.activationState == .foregroundActive,
              UIApplication.shared.isProtectedDataAvailable
        else { return }
        guard let owner, owner.window === window else {
            retireDetachedOwnerIfSafe()
            return
        }
        guard let cover, cover.superview === window else { return }
        cover.frame = owner.bounds
        owner.addSubview(cover)
        owner.bringSubviewToFront(cover)
        coverChanged?(generation, true)
    }

    func hasLocalCover(for owner: UIView) -> Bool {
        self.owner === owner && cover?.superview === owner
    }

    func keepLocalCoverInFront(of owner: UIView) {
        guard self.owner === owner, let cover, cover.superview === owner else { return }
        cover.frame = owner.bounds
        owner.bringSubviewToFront(cover)
    }

    private func retireDetachedOwnerIfSafe() {
        guard let window, let scene, owner?.window !== window, !suspended, !locked,
              window.windowScene === scene, scene.activationState == .foregroundActive,
              UIApplication.shared.isProtectedDataAvailable
        else { return }
        disconnect(scene)
    }

    private func hideAccessibility() {
        guard let owner, previousAccessibilityHidden == nil else { return }
        previousAccessibilityHidden = owner.accessibilityElementsHidden
        owner.accessibilityElementsHidden = true
    }

    private func restoreAccessibility() {
        if let previousAccessibilityHidden {
            owner?.accessibilityElementsHidden = previousAccessibilityHidden
        }
        previousAccessibilityHidden = nil
    }

    private func makeCover() -> UIView {
        let result = UIView()
        result.backgroundColor = .systemBackground
        result.isOpaque = true
        result.layer.zPosition = 1024
        result.isUserInteractionEnabled = true
        result.accessibilityViewIsModal = true
        result.isAccessibilityElement = false
        result.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        return result
    }
}
