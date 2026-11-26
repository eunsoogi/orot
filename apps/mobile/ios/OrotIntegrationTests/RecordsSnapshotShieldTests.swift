@testable import Orot
import UIKit
import XCTest

final class RecordsSnapshotShieldTests: XCTestCase {
    @MainActor
    func testExactWindowCoverSurvivesUntilCurrentPresentation() throws {
        let scene = try XCTUnwrap(
            UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .first { $0.activationState == .foregroundActive },
        )
        XCTAssertTrue(UIApplication.shared.isProtectedDataAvailable)
        let window = UIWindow(windowScene: scene)
        let neighbor = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 402, height: 669)
        let owner = UIView(frame: window.bounds)
        let other = UIView(frame: window.bounds)
        window.addSubview(owner)
        neighbor.addSubview(other)
        let shield = RecordsSnapshotShield()

        shield.conceal(in: window, scene: scene)
        XCTAssertTrue(window.subviews.last === owner, "An unarmed window must not be covered.")
        XCTAssertNil(shield.arm(owner: other, in: window, scene: scene))
        var changes: [String] = []
        let old = try XCTUnwrap(shield.arm(owner: owner, in: window, scene: scene, coverChanged: { changes.append("\($0):\($1)") }))
        shield.conceal(in: neighbor, scene: scene)
        XCTAssertTrue(neighbor.subviews.last === other)

        shield.conceal(in: window, scene: scene)
        let cover = try XCTUnwrap(window.subviews.last)
        XCTAssertFalse(cover === owner)
        XCTAssertEqual(cover.frame, window.bounds)
        XCTAssertTrue(cover.isOpaque && cover.isUserInteractionEnabled && cover.accessibilityViewIsModal)
        XCTAssertTrue(owner.accessibilityElementsHidden)
        XCTAssertEqual(cover.backgroundColor?.cgColor.alpha ?? 0, 1)
        let first = try XCTUnwrap(shield.coveredGeneration(for: owner))
        XCTAssertEqual(changes, ["\(first):false"])
        XCTAssertFalse(shield.acknowledgePresented(owner: owner, generation: old))
        XCTAssertFalse(shield.acknowledgePresented(owner: other, generation: first))
        let attemptedReplacement = UIView(frame: window.bounds)
        window.insertSubview(attemptedReplacement, belowSubview: cover)
        XCTAssertNil(shield.arm(owner: attemptedReplacement, in: window, scene: scene))
        attemptedReplacement.removeFromSuperview()
        XCTAssertTrue(window.subviews.last === cover)

        // Same window twice: a late acknowledgement from the preceding inactive epoch is stale.
        shield.conceal(in: window, scene: scene)
        let current = try XCTUnwrap(shield.coveredGeneration(for: owner))
        XCTAssertFalse(shield.acknowledgePresented(owner: owner, generation: first))
        XCTAssertTrue(shield.acknowledgePresented(owner: owner, generation: current))
        XCTAssertTrue(window.subviews.last === owner)
        XCTAssertFalse(owner.accessibilityElementsHidden)
        shield.sceneSuspended(in: window, scene: scene)
        let suspended = try XCTUnwrap(shield.coveredGeneration(for: owner))
        XCTAssertFalse(shield.acknowledgePresented(owner: owner, generation: suspended))
        shield.sceneResumed(in: window, scene: scene)
        XCTAssertTrue(window.subviews.last === owner)
        XCTAssertTrue(owner.subviews.last === cover)
        XCTAssertTrue(owner.accessibilityElementsHidden)
        XCTAssertTrue(shield.hasLocalCover(for: owner))
        XCTAssertTrue(changes.contains("\(suspended):true"))
        shield.protectionWillLock(in: window, scene: scene)
        XCTAssertTrue(window.subviews.last === cover)
        let locked = try XCTUnwrap(shield.coveredGeneration(for: owner))
        XCTAssertFalse(shield.acknowledgePresented(owner: owner, generation: locked))
        shield.protectionDidUnlock(in: window, scene: scene)
        XCTAssertTrue(owner.subviews.last === cover)
        XCTAssertTrue(owner.accessibilityElementsHidden)
        XCTAssertFalse(shield.acknowledgePresented(owner: owner, generation: suspended))
        XCTAssertTrue(shield.acknowledgePresented(owner: owner, generation: locked))
        shield.sceneSuspended(in: window, scene: scene)
        owner.removeFromSuperview()
        shield.ownerDetached(owner)
        XCTAssertNotNil(window.subviews.last)
        shield.sceneResumed(in: window, scene: scene)
        XCTAssertTrue(window.subviews.isEmpty)
        shield.disconnect(scene)
        shield.conceal(in: window, scene: scene)
        XCTAssertTrue(window.subviews.isEmpty)
    }
}
