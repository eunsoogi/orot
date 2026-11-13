# Assistant appearance

The assistant has one local appearance for all conversations. The Korean default
display name is “비서”; a name is optional, and whitespace alone clears it.
Custom names are trimmed when saved, may contain at most 24 grapheme clusters,
and cannot contain control characters or line separators. They are displayed as
literal text and are not sent with model requests.

The choices use built-in SF Symbols and require no download or photo access.
The neutral choice must be explicitly saved; a missing or unknown ID is not a
selection. The encrypted local database stores avatar and name in a single row
and commits them in one transaction. A read failure stays distinct from a missing
row. The existing reminder inbox retains deferred navigation until setup allows
entry; other entry and native accessibility behavior require their own checks.
