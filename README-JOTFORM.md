JotForm logout snapshot helper
--------------------------------

This repository contains a helper script to open a JotForm in Safari and
save a PDF snapshot when you log out of macOS.

Files added
- `scripts/jotform_logout.sh` — opens the form and saves a PDF to `~/Documents/JotForm-Fills`.

Register as a LogoutHook (optional, requires sudo)
1. Grant Accessibility permission to Terminal (or whichever runner) in System Preferences → Security & Privacy → Privacy → Accessibility.
2. Register the script to run on logout:

```bash
sudo defaults write com.apple.loginwindow LogoutHook "/Applications/AgentC .app/scripts/jotform_logout.sh"
```

To unregister the hook:

```bash
sudo defaults delete com.apple.loginwindow LogoutHook
```

Notes
- The macOS LogoutHook mechanism is deprecated on some recent macOS versions but still available on many systems. If it does not work on your machine, consider running the script via a LaunchAgent that triggers on session end (more complex) or run it manually before logging out.
- The script takes a screenshot of the Safari window and converts to PDF using system tools (`screencapture`, `sips`). It does not auto-fill fields (no saved answers were provided). If you want auto-fill, provide a JSON map of field labels to values and I can extend the script to inject JavaScript into the page to set values before capturing.
