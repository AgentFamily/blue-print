#!/bin/bash
# Usage: print_html_to_pdf.sh /path/to/file.html /path/to/output.pdf
set -euo pipefail
infile="$1"
outfile="$2"

if [[ ! -f "$infile" ]]; then
  echo "Input file not found: $infile" >&2
  exit 2
fi

abs_in=$(cd "$(dirname "$infile")" && pwd)/$(basename "$infile")
fileurl="file://$abs_in"

osascript <<AS
tell application "Safari"
  activate
  try
    open location "$fileurl"
  on error
    make new document with properties {URL: "$fileurl"}
  end try
end tell
delay 1.2
tell application "System Events"
  tell process "Safari"
    keystroke "p" using command down
    delay 0.7
    -- Click PDF popup button in print dialog
    try
      click menu button "PDF" of window 1
      delay 0.2
      click menu item "Save as PDF…" of menu 1 of menu button "PDF" of window 1
    on error
      -- fallback: press Tab/Enter to select Save as PDF (may vary by macOS)
      keystroke tab
      delay 0.1
      keystroke return
    end try
    delay 0.6
    -- Fill filename and save location: bring front window's sheet to focus
    -- Type the full path into the Save dialog's file name field
    keystroke "G" using {command down, shift down}
    delay 0.3
    keystroke "/Users/$(whoami)/Desktop"
    delay 0.2
    keystroke return
    delay 0.3
    -- set filename
    keystroke "$(basename "$outfile")"
    delay 0.2
    keystroke return
  end tell
end tell
delay 0.8
AS

echo "Saved PDF to $outfile"
exit 0
