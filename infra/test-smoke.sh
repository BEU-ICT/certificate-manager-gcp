#!/usr/bin/env bash
# Offline test of smoke-test.sh against a local fake deployment: it must pass for a healthy fake
# and fail (non-zero) for a broken one (healthz 500, details leaking `email`).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

serve() { # serve MODE PORT ROLE(run|hosting) -> starts fake server in background, appends to PIDS
  python3 - "$1" "$2" "$3" <<'PY' &
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
mode, port, role = sys.argv[1], int(sys.argv[2]), sys.argv[3]
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, ctype="application/json"):
        self.send_response(code); self.send_header("Content-Type", ctype); self.end_headers()
        self.wfile.write(body.encode())
    def do_GET(self):
        p = self.path
        if p == "/internal/healthz" and role == "run":
            return self.send(500 if mode == "broken" else 200, json.dumps({"status": "ok"}))
        if p == "/api/v1/public/certificates/known":
            body = {"id": "known", "ownerName": "A"}
            if mode == "broken": body["email"] = "x@example.com"
            return self.send(200, json.dumps(body))
        if p.startswith("/api/v1/public/certificates/"):
            return self.send(404, json.dumps({"error": {"code": "NOT_FOUND", "message": "x"}}))
        if p == "/api/v1/admin/me":
            return self.send(401, json.dumps({"error": {"code": "UNAUTHENTICATED"}}))
        return self.send(200, '<html><div id="root"></div></html>', "text/html")  # SPA fallback
HTTPServer(("127.0.0.1", port), H).serve_forever()
PY
  PIDS+=($!)
  sleep 1
}
PIDS=()
stop() { kill "${PIDS[@]}" 2>/dev/null || true; wait 2>/dev/null || true; PIDS=(); }

trap stop EXIT
serve good 18765 hosting; serve good 18767 run
SMOKE_CERT_ID=known ./smoke-test.sh http://127.0.0.1:18765 http://127.0.0.1:18767 >/dev/null
echo "ok   smoke test passes on a healthy deployment"
stop
serve broken 18766 hosting; serve broken 18768 run
if SMOKE_CERT_ID=known ./smoke-test.sh http://127.0.0.1:18766 http://127.0.0.1:18768 >/dev/null; then
  echo "FAIL smoke test passed on a broken deployment"; exit 1
fi
echo "ok   smoke test fails on a broken deployment"
