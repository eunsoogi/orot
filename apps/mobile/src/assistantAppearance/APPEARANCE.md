# Assistant appearance

The assistant has one local appearance for all conversations. The Korean default
display name is “비서”; a name is optional, and whitespace alone clears it.
Custom names are trimmed when saved, may contain at most 24 grapheme clusters,
and cannot contain control characters or line separators. They are displayed as
literal text and are not sent with model requests.

The choices use bundled project mockup artwork and require no download or photo access.
The neutral choice must be explicitly saved; a missing or unknown ID is not a
selection. The encrypted local database stores avatar and name in a single row
and commits them in one transaction. A read failure stays distinct from a missing
row. The existing reminder inbox retains deferred navigation until setup allows
entry; other entry and native accessibility behavior require their own checks.

## Visual asset provenance

The owner requested the approved project mockup's appearance. The original public
AI-generated proposals are bundled unchanged as raster atlases, rather than
redrawing or generating new characters. `AvatarArtwork` displays only the circular
avatar regions. Mockup text, names, status, and controls never become runtime UI.

- `assets/onboarding-reference.png`: [approved onboarding proposal](https://github.com/user-attachments/assets/05374d69-ab6d-47a6-bd80-18c32a7bf512), 890 by 1768 pixels, from #765.
- `assets/voice-reference.png`: [approved saved-identity voice proposal](https://github.com/user-attachments/assets/794a6ba3-f13b-4f83-a5f5-7df5dbcb789d), 1040 by 1512 pixels, from #741.

These are existing project design assets described as AI-generated in their
source issues, not a newly acquired third-party character pack. This record does
not assign a third-party license or claim exclusivity over AI-generated output.
The original private device screenshots are not included.

Saved IDs remain `neutral`, `sun`, `leaf`, and `star`. Neutral uses the plain blue
face, sun uses the sun, leaf uses the sprout, and star uses the voice proposal's
star. The illustrative cloud is deliberately not substituted for an existing
star selection. Existing names and IDs are never migrated or reset.

Source avatar diameters are 347, 150, 148, and 180 pixels respectively. Rendering
scales those original pixels; it does not claim additional detail or generated
high-resolution artwork. The native visual comparison must check the enlarged
preview as well as the small choices.
