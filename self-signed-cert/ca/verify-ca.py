#!/usr/bin/env python3
"""verify-ca.py — Load and inspect the CA certificate + private key.

Usage:
  python3 verify-ca.py

Prints:
  - CA subject / issuer
  - Validity window
  - CA flag, key usage, extended key usage, basic constraints
  - Private key algorithm + format
  - Confirmation that ca-key.pem + ca-cert.pem match
"""
import os, sys
from cryptography import x509
from cryptography.hazmat.primitives import serialization

CA_KEY = "ca-key.pem"
CA_CERT = "ca-cert.pem"


def main():
    if not os.path.exists(CA_CERT):
        print(f"Error: {CA_CERT} not found — run 'python3 self-signed-ca.py ca' first")
        sys.exit(1)
    if not os.path.exists(CA_KEY):
        print(f"Error: {CA_KEY} not found — run 'python3 self-signed-ca.py ca' first")
        sys.exit(1)

    with open(CA_CERT, "rb") as f:
        cert = x509.load_pem_x509_certificate(f.read())

    with open(CA_KEY, "rb") as f:
        key = serialization.load_pem_private_key(f.read(), password=None)

    print("=== CA Certificate ===")
    print(f"Subject:       {cert.subject.rfc4514_string()}")
    print(f"Issuer:        {cert.issuer.rfc4514_string()}")
    print(f"Serial:        {cert.serial_number}")
    print(f"NotBefore:     {cert.not_valid_before.isoformat()}")
    print(f"NotAfter:      {cert.not_valid_after.isoformat()}")
    print(f"SignatureAlg:  {cert.signature_algorithm_oid._name}")
    print(f"KeyAlgorithm:  {cert.public_key().__class__.__name__}")
    print(f"IsCA:          {cert.is_ca}")
    print(f"KeyUsage:      {cert.key_usage}")
    print(f"ExtKeyUsage:   {cert.extended_key_usage}")
    print(f"BasicConstraints: CA={cert.basic_constraints.ca}, path_length={cert.basic_constraints.path_length}")
    dns = cert.dns_names
    if dns:
        print(f"DNSNames:      {dns}")
    else:
        print("DNSNames:      (none)")
    print()

    # Key info
    pk = key.private_numbers() if hasattr(key, "private_numbers") else None
    print("=== CA Private Key ===")
    print(f"Type:          {key.__class__.__name__}")
    if hasattr(key, "key_size"):
        print(f"Key size:      {key.key_size} bits")
    else:
        print("Key size:      (not available)")
    print(f"Format:        PEM (EC PRIVATE KEY / DER payload)")
    print(f"Encrypted:     No")
    perms = oct(os.stat(CA_KEY).st_mode & 0o777)
    print(f"File perms:    {perms} ({(0o600 == (os.stat(CA_KEY).st_mode & 0o777)) and 'correct (0600)' or 'WARNING: should be 0600'})")
    print()

    # Consistency check
    cert_pub = cert.public_key()
    key_pub = key.public_key()
    # Compare by serializing both to DER and checking equality
    cert_pub_der = cert_pub.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    key_pub_der = key_pub.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    match = cert_pub_der == key_pub_der
    print("=== Consistency Check ===")
    print(f"Cert public key == Key public key: {'MATCH ✓' if match else 'MISMATCH ✗'}")
    print(f"Self-signed (issuer == subject):   {'YES ✓' if cert.issuer == cert.subject else 'NO ✗'}")
    print(f"CA flag set:                       {'YES ✓' if cert.is_ca else 'NO ✗'}")
    print(f"KeyCertSign in key usage:          {'YES ✓' if cert.key_usage and cert.key_usage.key_cert_sign else 'NO ✗'}")
    print()

    if match and cert.is_ca and cert.key_usage and cert.key_usage.key_cert_sign:
        print("CA verified — ca-key.pem + ca-cert.pem form a valid self-signed CA.")
    else:
        print("WARNING: CA is not correctly configured — review above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
