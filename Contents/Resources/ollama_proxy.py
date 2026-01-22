#!/Library/Developer/CommandLineTools/usr/bin/python3
import http.server
import urllib.request
import urllib.error
import json
import sys

UPSTREAM = 'http://127.0.0.1:11434'
ALLOW_ORIGIN = '*'

class Handler(http.server.BaseHTTPRequestHandler):
    def _set_cors(self):
        self.send_header('Access-Control-Allow-Origin', ALLOW_ORIGIN)
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Accept, X-MK-Tool-Token')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

    def _proxy_stream(self, method, target, body=None, timeout=300):
        try:
            req = urllib.request.Request(target, data=body if method != 'GET' else None, method=method)
            ct = self.headers.get('Content-Type')
            if ct:
                req.add_header('Content-Type', ct)
            accept = self.headers.get('Accept')
            if accept:
                req.add_header('Accept', accept)

            resp = urllib.request.urlopen(req, timeout=timeout)
            status = resp.status
            headers = dict(resp.headers)
            stream = resp
        except urllib.error.HTTPError as e:
            status = e.code
            headers = dict(e.headers)
            stream = e
        except Exception as e:
            self.send_response(502)
            self._set_cors()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())
            return

        self.send_response(status)
        self._set_cors()
        self.send_header('Content-Type', headers.get('Content-Type', 'application/json'))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Transfer-Encoding', 'chunked')
        self.end_headers()
        try:
            self.wfile.flush()
        except Exception:
            pass

        try:
            while True:
                chunk = stream.read(8192)
                if not chunk:
                    break
                try:
                    size = f"{len(chunk):X}\r\n".encode("ascii")
                    self.wfile.write(size)
                    self.wfile.write(chunk)
                    self.wfile.write(b"\r\n")
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    break
        finally:
            try:
                try:
                    self.wfile.write(b"0\r\n\r\n")
                    self.wfile.flush()
                except Exception:
                    pass
                stream.close()
            except Exception:
                pass

    def do_OPTIONS(self):
        self.send_response(204)
        self._set_cors()
        self.end_headers()

    def do_GET(self):
        if self.path == '/' or self.path.startswith('/?'):
            self.send_response(200)
            self._set_cors()
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.end_headers()
            self.wfile.write(b'ollama-proxy ok\n')
            return

        if self.path == '/health':
            target = UPSTREAM + '/api/version'
            try:
                req = urllib.request.Request(target, method='GET')
                with urllib.request.urlopen(req, timeout=10) as resp:
                    data = resp.read()
                    status = resp.status
            except Exception as e:
                self.send_response(502)
                self._set_cors()
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'ok': False, 'error': str(e)}).encode())
                return

            if status != 200:
                self.send_response(502)
                self._set_cors()
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'ok': False, 'upstream_status': status}).encode())
                return

            try:
                payload = json.loads(data.decode('utf-8'))
            except Exception:
                payload = {'raw': data.decode('utf-8', errors='replace')}

            self.send_response(200)
            self._set_cors()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'ok': True, 'upstream': UPSTREAM, 'version': payload.get('version')}).encode())
            return

        if self.path == '/favicon.ico':
            self.send_response(204)
            self._set_cors()
            self.end_headers()
            return

        if self.path.startswith('/api/'):
            self._proxy_stream('GET', UPSTREAM + self.path, None, timeout=300)
            return

        self.send_response(404)
        self._set_cors()
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.end_headers()
        self.wfile.write(b'not found\n')

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length) if length else b''
        self._proxy_stream('POST', UPSTREAM + self.path, body, timeout=600)

    def log_message(self, format, *args):
        sys.stderr.write("%s - - [%s] %s\n" % (self.client_address[0], self.log_date_time_string(), format%args))

if __name__ == '__main__':
    port = 3030
    http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
