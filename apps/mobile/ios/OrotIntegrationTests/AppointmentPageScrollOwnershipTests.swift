@testable import Orot
import UIKit
import XCTest

/// Verifies the page's actual UIKit hierarchy without depending on AX role labels.
final class AppointmentPageScrollOwnershipTests: XCTestCase {
    @MainActor
    func testWrapperOwnerAndSectionsRejectNestedOrDetachedScrolls() throws {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 951, height: 669))
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
    }
}
