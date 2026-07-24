# Screenshot-Coordinate Discovery CLI

This workflow lets any screenshot-capable agent discover a browser demo through
the local Auto Demo CLI. Auto Demo never calls a model API. The interchange is
PNG plus JSON: the agent reads images, writes bounded coordinate actions, and
receives semantic replay and review artifacts without a provider adapter.

Run every command from the repository root. Build first with `npm run build`.

## One-time macOS capture setup

Native browser dropdowns are outside the page screenshot. On macOS, install the
locally built capture helper before starting discovery:

```bash
npm run autodemo -- setup capture-helper --json
```

The command installs `~/Applications/Auto Demo Capture.app`, signs it with an
eligible local Apple Development identity when exactly one is available, and
asks macOS for Screen Recording permission. Permission belongs only to the
signed app identity `com.autodemo.capture-helper`. Setup and discovery start the
app through Launch Services using its bundled supervisor; they never launch the
inner capture executable directly or ask Terminal, Codex, ChatGPT, or another
host process to capture the screen. If multiple identities are available, rerun
with the returned fingerprint as
`--signing-identity <fingerprint>`. Use `--ad-hoc` only as an explicit fallback;
macOS may ask for permission again after an ad-hoc rebuild. Certificates and
private keys stay in Keychain, and the signed app is never committed.

Run the setup command again after granting permission to confirm the preflight.
Discovery reports `capture_helper_not_installed`,
`capture_helper_signature_invalid`, `capture_helper_protocol_mismatch`, or
`capture_helper_permission_required` with the recovery command when setup is
incomplete. The browser is not opened first.

Each discovery session gets a fresh app instance, private request, token, and
socket. Closing the session tells the supervisor to terminate that exact app
instance and remove its private launch files. The helper's five-minute idle
timeout is only an orphan backstop and is long enough for ordinary autonomous
reasoning between native captures. If setup still returns
`capture_helper_permission_required`, enable Screen Recording for **Auto Demo
Capture** in System Settings and rerun setup; do not grant Screen Recording to a
terminal or model host as a fallback.

The helper writes `native-capture-diagnostics.jsonl` inside the private
discovery-session directory. It records bounded lifecycle, timing, requested
region, response-validation, and ScreenCaptureKit stage codes for each native
capture attempt. It does not contain screenshots, page content, tokens, socket
or bootstrap paths, signing data, or raw system error descriptions. Use this
file to distinguish display selection, screenshot capture, PNG encoding,
transport, and normalization failures before retrying a failed session.

Every discovery session also writes `discover-host-diagnostics.jsonl` in the
same private directory. It records the resolved browser profile, bounded
main-document response status and same-origin/other-origin relation beginning
before the initial navigation, the bounded attempt ordinal/profile responsible
for each response, live failed browser-launch outcomes, exact
stable coordinate-session/action failure stages, bounded action results,
returned persistence failures, finish stages, and host lifecycle closure. A
`runtime_stopped` record means the logger and owned runtime reached their close
boundary; earlier failure records remain authoritative. The file intentionally
excludes URLs, hostnames, headers, bodies, page text or titles, target labels,
coordinates, runtime input, authentication material, private paths,
screenshots, and raw exception messages. Use it when a public
`discover_host_failed` result does not identify whether failure occurred during
browser launch/navigation, page-state observation, action execution, artifact
persistence, finalization, review-artifact writing, or cleanup. The evidence
can identify the client boundary and response class; it cannot reveal an
unexposed server-side blocking reason.

## Start

Choose `safe`, `public-browse`, `disposable`, or `yolo` before browser activity,
then start one persistent headed session:

```bash
npm run autodemo -- discover start \
  --url https://example.com/ \
  --goal "Select the requested filters and open the first organic result" \
  --risk yolo \
  --grid \
  --json
```

The JSON result contains `sessionId` and `frame.screenshotPath`. Read the PNG at
`frame.screenshotPath`; do not infer controls from hidden page state. The frame
also declares its id, width, height, pointer, and fixed device scale factor.

## Act

Write one JSON action file against the current frame:

```json
{
  "frameId": "frame-1",
  "actions": [
    { "type": "click", "x": 420, "y": 245 },
    { "type": "type", "text": "demo value", "binding": "search-value" }
  ]
}
```

The complete action shapes are:

```json
{ "type": "move", "x": 420, "y": 245 }
{ "type": "click", "x": 420, "y": 245 }
{ "type": "double-click", "x": 420, "y": 245 }
{ "type": "scroll", "x": 420, "y": 245, "deltaY": 400 }
{ "type": "keypress", "keys": ["K", "ENTER"] }
{ "type": "type", "text": "Kia", "binding": "make" }
{ "type": "wait", "durationMs": 500 }
```

`keypress` always uses the plural `keys` array, even for one key. Run
`npm run autodemo -- discover act --help` for the same schema at the terminal.

Then submit it:

```bash
npm run autodemo -- discover act \
  --session <session-id> \
  --actions-file <actions.json> \
  --json
```

Stable form controls may share one action batch and one cached screenshot. A
navigation, page scroll, dropdown opening, dropdown scroll, viewport change, or
layout shift invalidates the old frame and returns a fresh frame. Stop the batch
at that boundary, read the new `frame.screenshotPath`, and use only its frame id
for the next action file. A stale frame is rejected without executing actions.

For a long custom dropdown, put the pointer inside its visible menu and send a
targeted `scroll` action. Read the resulting fresh frame before selecting an
option. For a native dropdown, click it first, read the fresh browser-window
frame, then use bounded `keypress` actions such as `ARROWDOWN`, a public-label
character, `ENTER`, or `ESCAPE`. The on-demand helper captures that native
browser-window frame under its Screen Recording permission and exits with the
discovery session. If the frame cannot be captured honestly, the session fails
closed with a bounded capture-helper capability error.

Request a fresh frame explicitly when the current view needs to be re-read:

```bash
npm run autodemo -- discover observe --session <session-id> --json
```

Inspect reconnectable session state without changing the browser:

```bash
npm run autodemo -- discover status --session <session-id> --json
```

## Finish and review

Compile coordinate evidence and replay it semantically in a fresh browser:

```bash
npm run autodemo -- discover finish --session <session-id> --json
```

Success returns `review_required`, the replay-validated plan, and its sanitized
review. Coordinates never enter replay, review, approval, recording, or project
artifacts. Present every ordered step, warning, question, assumption, and
blocker. Explicit approval is still required through the existing
`npm run autodemo -- agent approve` workflow before execution.

If finish returns `repairing`, read its bounded failure, request a fresh frame
with `discover observe`, continue only from that image, and finish again. Do not
edit the plan artifact or reuse stale coordinates.

## Abandon

Close a session that should not continue:

```bash
npm run autodemo -- discover abandon --session <session-id> --json
```

Discovery does not record final media. After explicit approval, use the existing
agent execute and handoff commands to create the recording and project. The
editor and export remain separate operator choices.
