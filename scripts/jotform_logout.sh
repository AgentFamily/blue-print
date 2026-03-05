#!/bin/bash
# Open the JotForm in Safari, take a screenshot of the front window,
# convert to PDF and save in ~/Documents/JotForm-Fills with a timestamp.
#
# Note: This uses GUI scripting and `screencapture`/`sips`. You must grant
# Accessibility permission to Terminal (or whichever launcher runs this).

set -euo pipefail

URL="https://www.jotform.com/assign/260546958718068/260547869195069"
OUTDIR="$HOME/Documents/JotForm-Fills"
VALUES_FILE="$(dirname "$0")/jotform_values.json"
mkdir -p "$OUTDIR"

ts=$(date +%Y%m%d-%H%M%S)
pngfile="$OUTDIR/jotform-${ts}.png"
pdffile="$OUTDIR/jotform-${ts}.pdf"

# Open Safari and navigate to the form
osascript <<EOF
tell application "Safari"
    activate
    try
        open location "$URL"
    on error
        make new document with properties {URL:"$URL"}
    end try
end tell
delay 2.5
tell application "Safari" to activate
delay 0.5
EOF

# If a values file exists, inject JS into the page to fill fields
if [[ -f "$VALUES_FILE" ]]; then
    # Read the JSON file and build a JS snippet to set fields
    js="(function(){try{var map=JSON.parse('%s');for(var k in map){if(!map.hasOwnProperty(k))continue;var v=map[k];var el=document.querySelector('[name="'+k+'"]')||document.getElementById(k);if(!el){var lbl=document.evaluate('//label[contains(.,"'+k+'")]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue; if(lbl){var fid=lbl.getAttribute('for'); if(fid) el=document.getElementById(fid);} } if(el){ if(el.tagName==='INPUT' || el.tagName==='TEXTAREA'){ el.value = v; el.dispatchEvent(new Event('input',{bubbles:true})); } else if(el.tagName==='SELECT'){ el.value = v; el.dispatchEvent(new Event('change',{bubbles:true})); } } } return true;}catch(e){return String(e);} })();"
    json_escaped=$(python3 -c "import json,sys; print(json.dumps(json.load(open(\"$VALUES_FILE\"))))" 2>/dev/null || echo 'null')
    if [[ "$json_escaped" != "null" ]]; then
        # Inject via AppleScript: execute JavaScript in the front Safari tab
        osascript <<AS
        tell application "Safari"
            tell front document
                do JavaScript ("$(printf "$js" "$json_escaped" | sed -e 's/"/\\"/g')")
            end tell
        end tell
AS
        # give page a moment to process
        sleep 0.6
    fi
fi

# Try to capture the frontmost Safari window by window id; if that fails,
# capture the main screen area instead.
winid=$(osascript -e 'tell application "Safari" to id of front window' 2>/dev/null || echo "")
if [[ -n "$winid" ]]; then
    screencapture -l "$winid" -x "$pngfile" 2>/dev/null || screencapture -x -T 2 "$pngfile"
else
    screencapture -x -T 2 "$pngfile"
fi

# Convert to PDF using sips
if [[ -f "$pngfile" ]]; then
    sips -s format pdf "$pngfile" --out "$pdffile" >/dev/null 2>&1 || cp "$pngfile" "$pdffile"
    rm -f "$pngfile"
    echo "Saved filled-form snapshot to: $pdffile"
else
    echo "Failed to capture form page" >&2
    exit 2
fi

exit 0
