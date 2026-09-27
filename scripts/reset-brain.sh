#!/bin/sh
# Wipe the studio brain and reload the example pack (THRONE_EXAMPLE, default parrot-works) on next start.
# Stops the server on $PORT (default 4777) by port, restarts it, and keeps workers.
PORT=${PORT:-4777}; H=${THRONE_HOME:-$HOME/.throne-room}
lsof -ti tcp:$PORT -sTCP:LISTEN | xargs kill 2>/dev/null; sleep 1.5
rm -rf "$H/gbrain"
node -e "const f='$H/state.json',fs=require('fs');try{const s=JSON.parse(fs.readFileSync(f));delete s.brainSeeded;fs.writeFileSync(f,JSON.stringify(s))}catch{}"
cd "$(dirname "$0")/.." && nohup node server.js > "$H/server.log" 2>&1 &
sleep 12; tail -3 "$H/server.log"
