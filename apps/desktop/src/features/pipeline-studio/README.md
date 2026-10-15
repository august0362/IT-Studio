# Pipeline Studio

An optional full-screen viewer for the active project's latest 20 pipeline runs. It uses existing RPCs and notifications; no polling or extra model calls are made by viewing or replaying a run. Starting a request and answering clarification questions use the existing pipeline actions.

Set `PIPELINE_STUDIO_ENABLED` to `false` in `index.ts` to hide the Settings button and reject the studio hash route. The page is loaded lazily. Back (or Escape with no panel open) returns to the route used to enter; direct hash entry returns to API Keys.

To remove the add-on, delete this folder, revert the Pipeline Studio imports/button/route handling in `shell/MainNav.tsx` and `shell/AppShell.tsx`, and remove `pipelineStudio` and `nav.pipelineStudio` from `i18n/en.json` and `i18n/vi.json`. No other core file imports this folder.

Drag nodes to save their positions locally for this viewer. Storage is optional; failures leave the canvas usable. Reset layout restores the built-in positions. Fit view frames all nodes. Replay animates a finished run's inferred path without running it again. Reduced motion suppresses packets and transitions.

Persisted runs contain overall start/end times but no per-stage timestamps or queue flag. Panels identify this limitation. Queue state is inferred when a fresh specifying run is behind another unfinished run in the project. Historical terminal paths use artifacts and the failure stage, augmented by stages observed while the viewer is open. The first PM call may go Spec → Clarify → Spec; this return edge is visible while clarification is pending. A run without questions takes Request → Spec, and a first-pass approval takes Review → Write.

Suggested changelog entry: Add an optional standalone Pipeline Studio with live flow, detailed module panels, clarification answers, and saved node layouts (PSTUDIO-02).
