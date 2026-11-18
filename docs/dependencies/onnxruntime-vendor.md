# ONNX Runtime Swift package provenance

`vendor/onnxruntime-swift-package-manager` is an unchanged copy of all 75 files
from Microsoft's [ONNX Runtime Swift package manager repository](https://github.com/microsoft/onnxruntime-swift-package-manager),
release `1.24.2`:

- Commit: `b7fb7f7dea8a2469e6335d95a61b8f36d0dc83b2`
- Git tree: `59178cede37305e8725fd09d5907d872a55004f1`
- Upstream license: [MIT](../../vendor/onnxruntime-swift-package-manager/LICENSE)

The local Xcode package reference removes this package's Git checkout from
package resolution. It does not bundle the binary download or eliminate all
network dependencies. The upstream Package.swift default binary URLs, checksums,
and environment overrides remain unchanged. Other Swift packages are unaffected.

## Integrity and updates

`scripts/ci/onnx-vendor-manifest.json` records the original commit object and
recursive Git blob inventory. `verify-onnx-vendor.mjs` reconstructs the commit,
blob and tree hashes and checks the filesystem's executable modes. It rejects
missing, changed, additional, or symlinked files, including ignored files.
This is content-addressed provenance verification, not a new GPG signature audit.

The required policy-test job runs `onnx-vendor-integrity.test.mjs`, including
mutation regressions and Xcode product-linkage checks. The quality inventory
verifies the complete package before excluding exactly these upstream paths
from local lint/format tools. The pre-existing general vendor LOC exclusion is
unchanged; it does not waive this integrity gate. Do not format or patch files
inside this directory. Documentation and verification metadata live outside it
so the upstream tree remains exact.

An intentional upgrade must review a new official revision, update the pinned
commit/tree, original-object manifest and exact inventory together, and rerun
the policy, package-resolution and native validation gates. Preserve upstream
file modes and binary test resources. Check the upstream .gitignore when importing a new revision; explicitly stage
any required ignored files and verify the complete inventory is present in the
published checkout.
