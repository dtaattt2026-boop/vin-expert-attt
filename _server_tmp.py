import http.server, socketserver, sys

class NoCacheSWHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        if self.path and ('sw.js' in self.path or 'manifest.json' in self.path):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8082
with socketserver.TCPServer(('0.0.0.0', port), NoCacheSWHandler) as httpd:
    print(f'Serveur sur 0.0.0.0:{port}')
    httpd.serve_forever()
