# Codex Modification Protocol

This protocol is operational. It exists to reduce surprise before mutating the Blue-Print runtime.

## Required preflight

Before any implementation pass:

1. Capture `git status --short`.
2. Capture `git diff --binary`.
3. Write a timestamped planned-file manifest under `tmp/blueprint-snapshots/<UTC timestamp>/`.
4. State the intent of the change set before editing files.

## Confirmation gate

Pause and request confirmation if the implementation expands beyond the approved architecture in one of these areas:

- Telemetry storage adapter shape
- Widget-run contract changes
- Shared layout schema changes

## Defaults

- Canonical dashboard runtime: `Contents/Resources/Homepage.html`
- Legacy dashboard-widget harnesses are reference-only until explicitly revived
- Local snapshots are operational artifacts and may live under `tmp/`
