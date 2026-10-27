import ObjectiveC
import UIKit

/// Binds default activity creation intent to the controller; UIKit's style getter does not prove that intent.
@MainActor
struct ActivityPresentation {
    let controller: UIActivityViewController
    let requestedStyle: UIModalPresentationStyle

    init(items: [Any], requestedStyle: UIModalPresentationStyle = .automatic) {
        self.requestedStyle = requestedStyle
        controller = UIActivityViewController(activityItems: items, applicationActivities: nil)
        controller.modalPresentationStyle = requestedStyle
    }

    /// This is a workflow policy, never proof of a non-popover modality or successful presentation.
    func usesSystemManagedPhonePolicy(in window: UIWindow) -> Bool {
        usesSystemManagedPhonePolicy(sourceIdiom: window.traitCollection.userInterfaceIdiom, activityIdiom: controller.traitCollection.userInterfaceIdiom)
    }

    func usesSystemManagedPhonePolicy(sourceIdiom: UIUserInterfaceIdiom, activityIdiom: UIUserInterfaceIdiom) -> Bool {
        requestedStyle == .automatic && sourceIdiom == .phone && activityIdiom == .phone
    }
}

/// Owns a framework UIView source item; UIKit's activity controller rejects arbitrary protocol conformers.
@MainActor
final class PopoverSourceRegion: NSObject {
    private static var retentionKey: UInt8 = 0
    let item = UIView()

    init(view: UIView, rect: CGRect) {
        super.init()
        item.frame = rect
        item.backgroundColor = .clear
        item.isUserInteractionEnabled = false
        item.isAccessibilityElement = false
        item.accessibilityElementsHidden = true
        view.addSubview(item)
    }

    /// The popover retains the region through presentation after the initiating anchor is released.
    func retain(on popover: UIPopoverPresentationController) {
        objc_setAssociatedObject(popover, &Self.retentionKey, self, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
    }

    deinit {
        // UIKit tears down presentations on the main actor; the source must not retain an orphan region.
        MainActor.assumeIsolated { item.removeFromSuperview() }
    }
}
