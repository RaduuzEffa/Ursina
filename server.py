import http.server
import socketserver
import urllib.request
import urllib.parse
import urllib.error
import ssl

PORT = 8000

# Vytvoření kontextu ignorujícího neplatné SSL certifikáty (časté na intranetu)
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

class ProxyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/proxy?url='):
            # Extrahuje cílovou URL
            target_url = urllib.parse.unquote(self.path.split('/proxy?url=')[1])
            try:
                # Odeslání dotazu s hlavičkami, aby to vypadalo jako reálný prohlížeč
                req = urllib.request.Request(target_url, headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'})
                with urllib.request.urlopen(req, context=ctx) as response:
                    content = response.read()
                    
                self.send_response(200)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-type', 'text/html; charset=utf-8')
                self.end_headers()
                self.wfile.write(content)
            except urllib.error.HTTPError as e:
                # Pokud intranet vrátí chybu (např. 404 nebo 401), pošleme ji
                self.send_response(e.code)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(str(e).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(str(e).encode('utf-8'))
        else:
            # Běžné servírování HTML, JS a CSS souborů z aktuální složky
            super().do_GET()

# Zajistíme, že port je ihned znovu použitelný
socketserver.TCPServer.allow_reuse_address = True

with socketserver.TCPServer(("", PORT), ProxyHTTPRequestHandler) as httpd:
    print(f"Proxy server běží na http://localhost:{PORT}")
    httpd.serve_forever()
