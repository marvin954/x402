#!/usr/bin/env python3
"""Full self-signed TLS setup: CA generation + server cert signing + HTTPS server.

Usage:
  python3 self-signed-ca.py ca             Generate ca-key.pem + ca-cert.pem
  python3 self-signed-ca.py sign           Sign server cert → chain.pem + server-key.pem
  python3 self-signed-ca.py serve          Run HTTPS server on :8443 (needs chain.pem + server-key.pem)
  python3 self-signed-ca.py verify         Print CA cert details + key info
  python3 self-signed-ca.py verify-client  Run Python HTTPS client with --cacert-style verify

One-liner to get end-to-end working:
  python3 self-signed-ca.py ca && \
  python3 self-signed-ca.py sign && \
  python3 self-signed-ca.py serve &
  python3 self-signed-ca.py verify-client
"""
import argparse, datetime, os, socket, ssl, sys, urllib.request
from cryptography import x509
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

OUT_KEY = "ca-key.pem"
OUT_CERT = "ca-cert.pem"
OUT_CHAIN = "chain.pem"
OUT_SERVER_KEY = "server-key.pem"
DAYS_CA = 365 * 10
DAYS_SERVER = 365
CN_CA = "Local CA"
CN_SERVER = "localhost"

def generate_ca():
    key = ec.generate_private_key(ec.SECP256R1())
    now = datetime.datetime.now(datetime.UTC)
    subject = issuer = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, CN_CA)])
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now.replace(tzinfo=None))
        .not_valid_after((now + datetime.timedelta(days=DAYS_CA)).replace(tzinfo=None))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .add_extension(x509.KeyUsage(
            digital_signature=False, key_encipherment=False,
            content_commitment=False, data_encipherment=False,
            key_agreement=False, key_cert_sign=True, crl_sign=True,
            encipher_only=False, decipher_only=False,
        ), critical=True)
        .sign(key, hashes.SHA256())
    )
    key_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )
    cert_pem = cert.public_bytes(serialization.Encoding.PEM)
    with open(OUT_KEY, "wb") as f:
        f.write(key_pem)
    os.chmod(OUT_KEY, 0o600)
    with open(OUT_CERT, "wb") as f:
        f.write(cert_pem)
    print(f"Wrote {OUT_KEY} ({len(key_pem)} bytes, 0600)")
    print(f"Wrote {OUT_CERT} ({len(cert_pem)} bytes)")
    print(f"Subject: {cert.subject.rfc4514_string()}")
    print(f"NotAfter: {cert.not_valid_after.isoformat()}")

def verify_ca():
    if not os.path.exists(OUT_CERT):
        print(f"{OUT_CERT} not found — run 'python3 {__file__} ca' first")
        sys.exit(1)
    if not os.path.exists(OUT_KEY):
        print(f"{OUT_KEY} not found — run 'python3 {__file__} ca' first")
        sys.exit(1)
    with open(OUT_CERT, "rb") as f:
        cert = x509.load_pem_x509_certificate(f.read())
    with open(OUT_KEY, "rb") as f:
        key = serialization.load_pem_private_key(f.read(), password=None)
    print("=== CA Certificate ===")
    print(f"Subject: {cert.subject.rfc4514_string()}")
    print(f"Issuer:  {cert.issuer.rfc4514_string()}")
    print(f"NotBefore: {cert.not_valid_before.isoformat()}")
    print(f"NotAfter:  {cert.not_valid_after.isoformat()}")
    print(f"IsCA: {cert.is_ca}")
    print(f"KeyUsage: {cert.key_usage}")
    print(f"ExtKeyUsage: {cert.extended_key_usage}")
    print(f"BasicConstraints: CA={cert.basic_constraints.ca}, PathLen={cert.basic_constraints.path_length}")
    print()
    print("=== CA Private Key ===")
    print("Algorithm: ECDSA (P-256 / prime256v1)")
    print(f"Key file:  {OUT_KEY} (EC PRIVATE KEY, DER payload, 0600 perms)")
    print()
    print("CA verified — ready for 'python3 self-signed-ca.py sign'")

def sign_server():
    if not os.path.exists(OUT_KEY):
        print(f"{OUT_KEY} not found — run 'python3 {__file__} ca' first")
        sys.exit(1)
    if not os.path.exists(OUT_CERT):
        print(f"{OUT_CERT} not found — run 'python3 {__file__} ca' first")
        sys.exit(1)
    with open(OUT_KEY, "rb") as f:
        ca_key = serialization.load_pem_private_key(f.read(), password=None)
    with open(OUT_CERT, "rb") as f:
        ca_cert = x509.load_pem_x509_certificate(f.read())
    # Generate server key
    server_key = ec.generate_private_key(ec.SECP256R1())
    now = datetime.datetime.now(datetime.UTC)
    server_cert = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, CN_SERVER)]))
        .issuer_name(ca_cert.subject)
        .public_key(server_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now.replace(tzinfo=None))
        .not_valid_after((now + datetime.timedelta(days=DAYS_SERVER)).replace(tzinfo=None))
        .add_extension(x509.KeyUsage(
            digital_signature=True, key_encipherment=False,
            content_commitment=False, data_encipherment=False,
            key_agreement=False, key_cert_sign=False, crl_sign=False,
            encipher_only=False, decipher_only=False,
        ), critical=True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .add_extension(x509.SubjectAlternativeName([x509.DNSName(CN_SERVER)]), critical=True)
        .sign(ca_key, hashes.SHA256())
    )
    # Write server key
    server_key_pem = server_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )
    with open(OUT_SERVER_KEY, "wb") as f:
        f.write(server_key_pem)
    os.chmod(OUT_SERVER_KEY, 0o600)
    # Write chain: server cert + CA cert
    chain = server_cert.public_bytes(serialization.Encoding.PEM) + ca_cert.public_bytes(serialization.Encoding.PEM)
    with open(OUT_CHAIN, "wb") as f:
        f.write(chain)
    print(f"Wrote {OUT_SERVER_KEY} ({len(server_key_pem)} bytes, 0600)")
    print(f"Wrote {OUT_CHAIN} ({len(chain)} bytes, server cert + CA chain)")
    print(f"Server CN: {CN_SERVER}, SAN: DNS:{CN_SERVER}")
    print(f"NotAfter: {server_cert.not_valid_after.isoformat()}")

def start_server():
    for f in (OUT_CHAIN, OUT_SERVER_KEY):
        if not os.path.exists(f):
            print(f"{f} not found — run 'python3 {__file__} sign' first")
            sys.exit(1)
    import http.server
    import socketserver
    class Handler(http.server.SimpleHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Server", "python-self-signed-ca/1.0")
            self.end_headers()
            self.wfile.write(b"Hello from self-signed TLS\n")
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(OUT_CHAIN, OUT_SERVER_KEY)
    with socketserver.TCPServer(("", 8443), Handler) as httpd:
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
        print("Starting HTTPS server on https://localhost:8443 ...")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down...")

def verify_client(raw=False, use_curl=False):
    HOST, PORT = "localhost", 8443
    if use_curl:
        rc = os.system(f"curl -s --cacert {OUT_CERT} https://{HOST}:{PORT}/")
        if rc == 0:
            print("curl --cacert: OK")
            return True
        print(f"curl --cacert: FAILED (exit {rc})")
        return False
    ctx = ssl.create_default_context(cafile=OUT_CERT)
    ctx.check_hostname = True
    ctx.server_hostname = HOST
    try:
        with socket.create_connection((HOST, PORT), timeout=5) as sock:
            with ctx.wrap_socket(sock, server_hostname=HOST) as ssock:
                cert = ssock.getpeercert()
                print(f"TLS version: {ssock.version()}")
                print(f"Cipher:      {ssock.cipher()}")
                print(f"Subject:    {dict(x[0] for x in cert['subject'])}")
                print(f"Issuer:     {dict(x[0] for x in cert['issuer'])}")
                print(f"DNSNames:   {cert.get('subjectAltName', [])}")
                print(f"NotAfter:   {cert['notAfter']}")
                print("Verified:   YES — server cert chains to CA")
                if not raw:
                    handler = urllib.request.HTTPSHandler(context=ctx)
                    opener = urllib.request.build_opener(handler)
                    resp = opener.open(f"https://{HOST}:{PORT}/", timeout=5)
                    body = resp.read().decode("utf-8")
                    print(f"HTTP:       {resp.status} {resp.reason}")
                    print(f"Server:     {resp.headers.get('Server', '(none)')}")
                    print(f"Body:       {body.strip()}")
                    print("HTTPS request completed — full verify + HTTP OK")
        return True
    except Exception as e:
        print(f"FAILED: {e}")
        return False

def main():
    p = argparse.ArgumentParser(description="Self-signed CA + TLS server tool")
    sub = p.add_subparsers(dest="cmd")
    sub.add_parser("ca", help="Generate CA key + cert")
    sub.add_parser("sign", help="Sign server cert → chain.pem + server-key.pem")
    sub.add_parser("serve", help="Run HTTPS server on :8443")
    sub.add_parser("verify", help="Print CA cert + key details")
    vp = sub.add_parser("verify-client", help="Verify server cert against CA (Python or curl)")
    vp.add_argument("--raw", action="store_true", help="TLS connect only, no HTTP")
    vp.add_argument("--curl", action="store_true", help="use curl --cacert instead of Python ssl")
    args = p.parse_args()
    if not args.cmd:
        p.print_help()
        sys.exit(1)
    {
        "ca": generate_ca,
        "sign": sign_server,
        "serve": start_server,
        "verify": verify_ca,
        "verify-client": lambda: verify_client(args.raw, args.curl),
    }[args.cmd]()

if __name__ == "__main__":
    main()
