# Rules for agents working on Cave

The owner works on this Mac while agents run. These rules exist because test runs used to
take the mouse, pull windows to the front, and leave error dialogs on the desktop.

**Not disturbing the owner is the precondition for any test, not a preference.** A check
that would take the mouse, the keyboard focus or the frontmost window, or could leave a
dialog or a stray window behind, is not run at all: skip it, say so in your report, and
let the owner decide. A verified result never justifies an interruption.

## Launching the app is the exception

**The end-to-end tests are archived in `test/archive/e2e/` and are not part of any routine
run.** Even in background mode their windows flash on the owner's screen. The default
verification is `npm test` (typecheck and unit tests, no window) and `npm run build`.

When a change touches one specific behaviour that an archived test covers and that cannot
be judged from the code, run that one test in place, once:
`node --test --test-name-pattern="<title>" test/archive/e2e/<file>`. Not the whole file,
not after every merge, never for UI appearance. Do not write new e2e tests and do not move
the archive back. Say in your report what you ran and what was left unverified. The rules
below apply to any such launch.

## Running the app in tests

1. **Launch Cave only through `startWorld()` in `test/archive/e2e/harness.mjs`.** It sets
   `CAVE_E2E_BACKGROUND=1`: windows open inactive (`showInactive`) and request an off-screen
   position; macOS may clamp that position onto a display. Window activation and window
   `focus()` calls are suppressed, while WebContents focus still routes input between views.
   On macOS the app uses the `accessory` activation policy. Only use `startWorld()` for
   app launches; if a test cannot meet these constraints, do not run it.
2. **Never pass `foreground: true`** and never bring a window to the front (`osascript
   activate`, `open -a`, `win.focus()`, `app.focus()`) unless the owner has agreed in this
   conversation.
3. **All input is synthetic**: CDP `Input.dispatch*` (helpers in `test/archive/e2e/cdp.mjs`) or
   `webContents.sendInputEvent`. Never use the real pointer or keyboard: no `cliclick`,
   `osascript` / System Events clicks or keystrokes, CGEvent, or computer-use tools.
4. **Screenshots come from CDP** (`screenshot()` in `cdp.mjs`), not from `screencapture`
   of a window you raised.

## Ending a run: no dialogs, no leftovers

5. **Every test stops its world**: `t.after(() => w.stop())` right after `startWorld()`,
   so the app is terminated on pass, failure and timeout alike.
6. **An uncaught exception must never become a dialog.** In background mode the main
   process logs the error and exits with status 1 (`src/main/index.ts`); the harness prints
   the app log. Do not remove that handler, do not add `dialog.showErrorBox` or
   `dialog.showMessageBox` on test paths, and do not swallow the exit code.
7. **Before you report, prove nothing is left running** from your checkout:
   inspect `ps -axo pid,ppid,pgid,command` for this checkout’s Electron and `cave-core`
   processes, including children and process groups. Match the full checkout path, not just
   the process name; terminate only processes started by your run, including their groups.
   An orphan from an abandoned run is what puts an error dialog in front of the owner
   minutes later; this check is not optional, also when your run failed or was interrupted.
8. Never quit, kill or reinstall the owner's own `/Applications/Cave.app` unless the task
   says to install.

## Proportion

9. Run the focused e2e file for what you changed, one file at a time, not the whole suite
   and not in parallel. One purposeful check, then stop; do not rerun a passing test to
   "make sure".
10. If a test truly cannot work without a foreground window, do not run it: say so in
    your report and name the test.

## Writing tests

16. A fix does not come with a new e2e test by default. Add an e2e test only when it guards
    the operating premise (rule 12: proxy-only, fail closed, no leak) or a flow that has
    broken for a user more than once. Pure logic gets at most one small unit test. Copy,
    CSS, layout and one-off UI fixes get none: verify them once by hand through CDP and say
    what you looked at.
17. Before adding a test, look for an existing one that already launches the same world and
    add an assertion there. Every new `startWorld()` costs seconds on every later run.

## Code boundaries

11. Do not change `src/main/gate.ts`, `src/main/gatekeeper.ts`, `src/main/network.ts` or
    `src/main/proxy/*` except display text, unless your task brief says the owner has
    authorised a specific change there.
12. Whatever the brief says, the operating premise never changes: every request goes
    through the proxy, there is no direct connection under any failure, and the gate stays
    closed unless every release condition has been verified for the node in use right now.
    A change in these files may make the gate stricter or more accurate, never more
    permissive; when in doubt it stays closed. List every changed line in these files in
    your report with the reason.

## Settled, do not re-test

13. The toolbar button toggle (open on first click, close on second, repeated clicks) is
    settled. Do not write or run repeated-click, rapid-click or stress loops against any
    button or menu, and do not "re-verify" it when working on something else. The single
    open/close check in `test/archive/e2e/app.test.mjs` is the whole coverage it gets.

## Correct by construction first

14. Tests confirm a design; they do not replace one. Before fixing a UI bug, name the
    structural cause and choose the structure in which the bug cannot occur (the platform,
    the DOM or the OS guarantees it), instead of patching the symptom and adding a test
    that the patch holds. If the same area has been patched twice, stop patching and
    report the structural problem.
15. Hit area and decoration are separate things. Nothing decorative (shadow, glow, margin
    left for an animation) may ever be inside a surface that receives pointer events. For
    anchored cards: the overlay view's bounds are exactly the card's border box; the shadow
    is drawn elsewhere, in a layer that cannot receive input.
