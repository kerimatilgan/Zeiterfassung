#!/usr/bin/env python3
"""
Minimales Web-UI für WLAN-Konfiguration auf dem Raspberry Pi
Läuft auf Port 8080, erreichbar per QR-Code vom Display
"""

import subprocess
import json
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs

PORT = 8080


def scan_wifi():
    try:
        result = subprocess.run(
            ['nmcli', '-t', '-f', 'SSID,SIGNAL,SECURITY', 'dev', 'wifi', 'list', '--rescan', 'yes'],
            capture_output=True, text=True, timeout=15
        )
        networks = []
        seen = set()
        for line in result.stdout.strip().split('\n'):
            if not line.strip():
                continue
            parts = line.split(':')
            if len(parts) >= 3:
                ssid = parts[0].strip()
                if not ssid or ssid in seen:
                    continue
                seen.add(ssid)
                signal = int(parts[1]) if parts[1].isdigit() else 0
                security = parts[2].strip()
                networks.append({'ssid': ssid, 'signal': signal, 'security': security})
        networks.sort(key=lambda x: x['signal'], reverse=True)
        return networks
    except:
        return []


def get_current_wifi():
    try:
        result = subprocess.run(
            ['nmcli', '-t', '-f', 'ACTIVE,SSID', 'dev', 'wifi'],
            capture_output=True, text=True, timeout=5
        )
        for line in result.stdout.strip().split('\n'):
            if line.startswith('yes:'):
                return line.split(':')[1]
    except:
        pass
    return None


def get_ip():
    try:
        result = subprocess.run(['hostname', '-I'], capture_output=True, text=True, timeout=3)
        return result.stdout.strip().split()[0]
    except:
        return '?'


def connect_wifi(ssid, password):
    try:
        if password:
            result = subprocess.run(
                ['sudo', 'nmcli', 'dev', 'wifi', 'connect', ssid, 'password', password],
                capture_output=True, text=True, timeout=30
            )
        else:
            result = subprocess.run(
                ['sudo', 'nmcli', 'dev', 'wifi', 'connect', ssid],
                capture_output=True, text=True, timeout=30
            )
        return result.returncode == 0, result.stdout.strip() or result.stderr.strip()
    except Exception as e:
        return False, str(e)


HTML_PAGE = """<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WLAN-Einstellungen</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0f172a; color: #f8fafc; padding: 16px; max-width: 480px; margin: 0 auto; }
h1 { font-size: 20px; margin-bottom: 4px; }
.sub { color: #94a3b8; font-size: 13px; margin-bottom: 16px; }
.current { background: #16a34a22; border: 1px solid #16a34a; border-radius: 8px; padding: 10px; margin-bottom: 16px; color: #22c55e; font-size: 14px; }
.net { background: #1e293b; border-radius: 8px; padding: 12px; margin-bottom: 8px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; }
.net:hover { background: #334155; }
.net-name { font-weight: 600; font-size: 15px; }
.net-info { color: #94a3b8; font-size: 12px; }
.signal { width: 30px; text-align: right; color: #94a3b8; font-size: 12px; }
.modal { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); z-index: 10; align-items: center; justify-content: center; }
.modal.show { display: flex; }
.modal-box { background: #1e293b; border-radius: 12px; padding: 20px; width: 90%; max-width: 400px; }
.modal h2 { font-size: 18px; margin-bottom: 12px; }
input[type=password], input[type=text] { width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: #f8fafc; font-size: 16px; margin-bottom: 12px; }
.btn { padding: 10px 20px; border-radius: 8px; border: none; font-size: 14px; font-weight: 600; cursor: pointer; }
.btn-primary { background: #3b82f6; color: white; }
.btn-cancel { background: #475569; color: white; margin-right: 8px; }
.btn-scan { background: #1e293b; color: #94a3b8; border: 1px solid #475569; width: 100%; margin-top: 8px; padding: 10px; }
.msg { padding: 10px; border-radius: 8px; margin-bottom: 12px; font-size: 14px; }
.msg-ok { background: #16a34a22; border: 1px solid #16a34a; color: #22c55e; }
.msg-err { background: #dc262622; border: 1px solid #dc2626; color: #ef4444; }
.loading { text-align: center; color: #94a3b8; padding: 40px; }
</style>
</head>
<body>
<h1>WLAN-Einstellungen</h1>
<p class="sub">Zeiterfassung Terminal</p>

<div id="msg"></div>
<div id="current"></div>
<div id="networks"><div class="loading">Suche Netzwerke...</div></div>
<button class="btn btn-scan" onclick="scan()">Netzwerke neu suchen</button>

<div class="modal" id="modal">
<div class="modal-box">
<h2 id="modal-title">Verbinden</h2>
<form onsubmit="return doConnect(event)">
<input type="hidden" id="connect-ssid">
<label style="color:#94a3b8;font-size:13px">Passwort</label>
<input type="password" id="connect-pass" placeholder="WLAN-Passwort" autofocus>
<div style="display:flex;justify-content:flex-end">
<button type="button" class="btn btn-cancel" onclick="closeModal()">Abbrechen</button>
<button type="submit" class="btn btn-primary">Verbinden</button>
</div>
</form>
</div>
</div>

<script>
function scan() {
  document.getElementById('networks').innerHTML = '<div class="loading">Suche...</div>';
  fetch('/api/scan').then(r=>r.json()).then(data => {
    let html = '';
    data.networks.forEach(n => {
      const bars = Math.min(4, Math.floor(n.signal/25)+1);
      const lock = n.security && n.security !== '--' ? '🔒' : '';
      html += '<div class="net" onclick="selectNet(\\''+n.ssid.replace(/'/g,"\\\\'")+'\\')">';
      html += '<div><div class="net-name">'+lock+' '+n.ssid+'</div>';
      html += '<div class="net-info">'+n.security+'</div></div>';
      html += '<div class="signal">'+n.signal+'%</div></div>';
    });
    if (!html) html = '<div class="loading">Keine Netzwerke gefunden</div>';
    document.getElementById('networks').innerHTML = html;
    if (data.current) {
      document.getElementById('current').innerHTML = '<div class="current">Verbunden: <strong>'+data.current+'</strong> ('+data.ip+')</div>';
    }
  });
}

function selectNet(ssid) {
  document.getElementById('connect-ssid').value = ssid;
  document.getElementById('modal-title').textContent = ssid;
  document.getElementById('connect-pass').value = '';
  document.getElementById('modal').classList.add('show');
  document.getElementById('connect-pass').focus();
}

function closeModal() {
  document.getElementById('modal').classList.remove('show');
}

function doConnect(e) {
  e.preventDefault();
  const ssid = document.getElementById('connect-ssid').value;
  const pass = document.getElementById('connect-pass').value;
  closeModal();
  document.getElementById('msg').innerHTML = '<div class="msg msg-ok">Verbinde mit '+ssid+'...</div>';
  fetch('/api/connect', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ssid, password: pass})
  }).then(r=>r.json()).then(data => {
    if (data.ok) {
      document.getElementById('msg').innerHTML = '<div class="msg msg-ok">Verbunden mit '+ssid+'!</div>';
    } else {
      document.getElementById('msg').innerHTML = '<div class="msg msg-err">Fehler: '+data.error+'</div>';
    }
    scan();
  });
  return false;
}

scan();
</script>
</body>
</html>"""


class WifiHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Keine Logs

    def do_GET(self):
        if self.path == '/api/scan':
            networks = scan_wifi()
            current = get_current_wifi()
            ip = get_ip()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'networks': networks, 'current': current, 'ip': ip}).encode())
        else:
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(HTML_PAGE.encode())

    def do_POST(self):
        if self.path == '/api/connect':
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length))
            ssid = body.get('ssid', '')
            password = body.get('password', '')
            ok, msg = connect_wifi(ssid, password)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'ok': ok, 'error': msg if not ok else ''}).encode())


def start_wifi_web_server():
    """Startet den WLAN-Web-Server in einem Hintergrund-Thread"""
    server = HTTPServer(('0.0.0.0', PORT), WifiHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"[WIFI-WEB] Server gestartet auf Port {PORT}")
    return server


if __name__ == '__main__':
    print(f"WLAN Web-UI auf http://0.0.0.0:{PORT}")
    server = HTTPServer(('0.0.0.0', PORT), WifiHandler)
    server.serve_forever()
