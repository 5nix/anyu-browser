# E2e focus investigation

Electron starts with its normal macOS activation policy and Dock presence. The shell shows its window after the chrome loads; selecting a tab suggestion shows and focuses its window, and a second instance focuses the current window. No `app.focus()` call was found. WebContents focus calls also manage focus among the shell's views.

The checked-in e2e tests use CDP mouse and keyboard dispatch, and the test-only suggestion helper uses `webContents.sendInputEvent`. No real-pointer automation was found in the tests. Outside-press dismissal is handled by `before-mouse-event` listeners on the shell's views.
