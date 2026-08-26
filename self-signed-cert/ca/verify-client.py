#!/usr/bin/env python3
"""verify-client.py - HTTPS client that verifies server cert against CA.

Usage: python3 verify-client.py
       python3 verify-client.py --insecure  (skip verification)
       python3 verify-client.py --host HOST (default localhost:8443)
"""
import ssl
import sys
import urllib.request
import urllib.error

HOST = "localhost:8443"
CA_CERT = "ca-cert.pem"
INSECURE = "--insecure" in sys.argv[1:]
if "--host" in sys.argv:
    idx = sys.argv.index("--host") + 1
    if idx < len(sys.argv):
        HOST = sys.argv[idx]
URL = f"https://{HOST}/"

def main():
    ctx = ssl.create_default_context(cafile=CA_CERT)
    ctx.check_hostname = True
    ctx.server_hostname = HOST.split(":")[0]
    try:
        req = urllib.request.Request(URL, method="GET")
        with urllib.request.urlopen(req, context=ctx, timeout=5) as resp:
            print(f"Status: {resp.status}")
            body = resp.read()
            print(f"Content-Type: {resp.headers.get('Content-Type', 'n/a')}")
            print(f"Body length: {len(body)} bytes")
            print("--- Body ---")
            print(body.decode("utf-8", errors="replace"))
    except urllib.error.URLError as e:
        print(f"FAILED: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
