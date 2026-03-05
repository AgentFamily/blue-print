# Dashboard Troubleshooting Runner

## Purpose
Automates the strategic dashboard widget troubleshooting plan for `Contents/Resources/Homepage.html`.

## Commands
```bash
# Default base URL (http://127.0.0.1:8010/Homepage.html)
scripts/run_dashboard_troubleshoot.sh

# Custom base URL
scripts/run_dashboard_troubleshoot.sh --base-url "http://127.0.0.1:8000/Homepage.html"

# Optional visible browser mode
scripts/run_dashboard_troubleshoot.sh --headful
```

## Outputs
The runner writes:
- `test-results/dashboard-troubleshoot-<timestamp>.json`
- `test-results/dashboard-troubleshoot-<timestamp>.md`
- `test-results/dashboard-troubleshoot-latest.json`
- `test-results/dashboard-troubleshoot-latest.md`

## Coverage
- Baseline layout tests (Node + Python wrappers)
- Widget inventory and selector/source audit
- API contract checks (`dashboard-layout`, `fasthosts`)
- 20 dashboard scenarios (layout, settings, reorder, resize, persistence, role/user isolation, source widgets, dynamic engine tools, mobile drag behavior, runtime stability)
- Defect list with category and severity
