@testable import Orot
import UIKit
import XCTest

/// Verifies the page's actual UIKit hierarchy without depending on AX role labels.
final class AppointmentPageScrollOwnershipTests: XCTestCase {
    @MainActor
    func testWrapperOwnerAndSectionsRejectNestedOrDetachedScrolls() throws {
        let window = try makeFixtureWindow(frame: CGRect(x: 0, y: 0, width: 951, height: 669))
        let wrapper = UIView(frame: window.bounds)
        wrapper.accessibilityIdentifier = "appointments-scroll"
        let owner = UIScrollView(frame: wrapper.bounds)
        let primary = UIView(), secondary = UIView()
        primary.accessibilityIdentifier = "appointments-columns-primary"
        secondary.accessibilityIdentifier = "appointments-columns-secondary"
        window.addSubview(wrapper); wrapper.addSubview(owner)
        owner.addSubview(primary); owner.addSubview(secondary)
        func identity(_ object: NSObject) -> String {
            String(describing: ObjectIdentifier(object))
        }
        func snapshot() -> [String: Any] {
            AppointmentPageScrollObservation.snapshot(window: window, identity: identity)
        }
        let normal = snapshot()
        XCTAssertEqual(normal["status"] as? String, "sampled")
        let ownerID = try XCTUnwrap(normal["ownerID"] as? String)
        XCTAssertEqual(normal["ownerCount"] as? Int, 1)
        XCTAssertEqual(normal["primaryAncestors"] as? [String], [ownerID])
        XCTAssertEqual(normal["secondaryAncestors"] as? [String], [ownerID])
        XCTAssertEqual(normal["primaryNested"] as? Int, 0)
        let nested = UIScrollView()
        primary.addSubview(nested)
        XCTAssertEqual(snapshot()["primaryNested"] as? Int, 1)
        nested.removeFromSuperview()
        let other = UIScrollView()
        owner.addSubview(other); other.addSubview(secondary)
        XCTAssertEqual(snapshot()["secondaryAncestors"] as? [String], [identity(other), ownerID])
        secondary.removeFromSuperview(); window.addSubview(secondary)
        XCTAssertEqual(snapshot()["secondaryComplete"] as? Bool, false)
        wrapper.addSubview(UIScrollView())
        XCTAssertEqual(snapshot()["status"] as? String, "unavailable")

        // A native root scroll needs no wrapper; depth and traversal limits still fail closed.
        let directWindow = try makeFixtureWindow(frame: window.bounds)
        let direct = UIScrollView(frame: directWindow.bounds)
        direct.accessibilityIdentifier = "appointments-scroll"
        let directPrimary = UIView(), directSecondary = UIView()
        directPrimary.accessibilityIdentifier = "appointments-columns-primary"
        directSecondary.accessibilityIdentifier = "appointments-columns-secondary"
        directWindow.addSubview(direct); direct.addSubview(directPrimary); direct.addSubview(directSecondary)
        func directSnapshot() -> [String: Any] {
            AppointmentPageScrollObservation.snapshot(window: directWindow, identity: identity)
        }
        let directResult = directSnapshot()
        XCTAssertEqual(directResult["ownerID"] as? String, identity(direct))
        XCTAssertEqual(directResult["primaryAncestors"] as? [String], [identity(direct)])
        var parent: UIView = direct
        for _ in 0 ..< 65 {
            let child = UIView(); parent.addSubview(child); parent = child
        }
        parent.addSubview(directPrimary)
        XCTAssertEqual(directSnapshot()["primaryComplete"] as? Bool, false)
        direct.addSubview(directPrimary)
        for _ in 0 ..< 2049 {
            direct.addSubview(UIView())
        }
        XCTAssertEqual(directSnapshot()["truncated"] as? Bool, true)
    }

    /// Uses a real foreground scene for screen-coordinate geometry while keeping fixture windows hidden.
    @MainActor
    private func makeFixtureWindow(frame: CGRect) throws -> UIWindow {
        let scene = try XCTUnwrap(
            UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .first { $0.activationState == .foregroundActive },
            "The integration host must have a foreground window scene.",
        )
        let window = UIWindow(windowScene: scene)
        window.frame = frame
        window.isHidden = true
        XCTAssertTrue(window.windowScene === scene)
        return window
    }
}
