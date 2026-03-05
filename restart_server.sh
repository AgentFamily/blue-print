#!/bin/bash
# AgentC dev server restart wrapper - keeps the server running
# This script restarts the server if it crashes or stops responding

APP_DIR="/Applications/AgentC .app"
PYTHON3="/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/Resources/Python.app/Contents/MacOS/Python"
LOG_FILE="/tmp/agentc_server.log"
PID_FILE="/tmp/agentc_server.pid"
PORT=8010
HOST="127.0.0.1"
MAX_RESTARTS=5
RESTART_COUNT=0

# Function to start the server
start_server() {
    if [ -f "$PID_FILE" ]; then
        OLD_PID=$(cat "$PID_FILE")
        if ps -p "$OLD_PID" > /dev/null 2>&1; then
            echo "[$(date)] Server already running (PID: $OLD_PID)"
            return
        fi
    fi
    
    echo "[$(date)] Starting AgentC dev server on $HOST:$PORT..."
    cd "$APP_DIR"
    "$PYTHON3" Contents/Resources/dev_server.py --port "$PORT" --host "$HOST" >> "$LOG_FILE" 2>&1 &
    NEW_PID=$!
    echo "$NEW_PID" > "$PID_FILE"
    echo "[$(date)] Server started (PID: $NEW_PID)"
    sleep 2
}

# Function to check if server is healthy
check_health() {
    curl -s --connect-timeout 2 --max-time 5 "http://$HOST:$PORT/health" > /dev/null 2>&1
    return $?
}

# Function to restart server
restart_server() {
    RESTART_COUNT=$((RESTART_COUNT + 1))
    if [ $RESTART_COUNT -gt $MAX_RESTARTS ]; then
        echo "[$(date)] ERROR: Server restarted too many times ($RESTART_COUNT). Check logs at $LOG_FILE"
        echo "[$(date)] Last log lines:"
        tail -20 "$LOG_FILE"
        exit 1
    fi
    
    echo "[$(date)] Server restart attempt $RESTART_COUNT/$MAX_RESTARTS"
    if [ -f "$PID_FILE" ]; then
        OLD_PID=$(cat "$PID_FILE")
        if ps -p "$OLD_PID" > /dev/null 2>&1; then
            echo "[$(date)] Killing old process (PID: $OLD_PID)"
            kill -9 "$OLD_PID" 2>/dev/null
            sleep 1
        fi
    fi
    start_server
}

# Initial start
start_server

# Monitor loop
while true; do
    sleep 10
    if ! check_health; then
        echo "[$(date)] Server health check failed, restarting..."
        restart_server
    fi
done
