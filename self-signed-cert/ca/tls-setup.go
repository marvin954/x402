package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net/http"
	"os"
	"time"
)

// ── Step 1: Generate self-signed CA ──────────────────────────────────────────
func generateCA(caKeyPath, caCertPath string) {
	privKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		fmt.Fprintf(os.Stderr, "CA key gen failed: %v\n", err)
		os.Exit(1)
	}

	template := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{Organization: []string{"Local CA"}},
		NotBefore:    time.Now(),
		NotAfter:     time.Now().Add(10 * 365 * 24 * time.Hour),
		KeyUsage:     x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA: true,
	}
	certBytes, err := x509.CreateCertificate(rand.Reader, &template, &template, &privKey.PublicKey, privKey)
	if err != nil {
		fmt.Fprintf(os.Stderr, "CA cert creation failed: %v\n", err)
		os.Exit(1)
	}

	pkBytes, err := x509.MarshalECPrivateKey(privKey)
	if err != nil {
		fmt.Fprintf(os.Stderr, "CA key marshal failed: %v\n", err)
		os.Exit(1)
	}

	pkBlock := pem.Block{Type: "EC PRIVATE KEY", Bytes: pkBytes}
	os.WriteFile(caKeyPath, pem.EncodeToMemory(&pkBlock), 0600)

	os.WriteFile(caCertPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certBytes}), 0644)
	fmt.Printf("Wrote CA key: %s\n", caKeyPath)
	fmt.Printf("Wrote CA cert: %s\n", caCertPath)
}

// ── Step 2: Sign server cert with CA ─────────────────────────────────────────
func signServerCert(caKeyPath, caCertPath, serverKeyPath, chainPath string) {
	caKeyPEM, err := os.ReadFile(caKeyPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to read CA key %s: %v\n", caKeyPath, err)
		os.Exit(1)
	}
	caKeyBlock, _ := pem.Decode(caKeyPEM)
	caPrivKey, err := x509.ParseECPrivateKey(caKeyBlock.Bytes)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to parse CA key: %v\n", err)
		os.Exit(1)
	}

	caCertPEM, err := os.ReadFile(caCertPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to read CA cert %s: %v\n", caCertPath, err)
		os.Exit(1)
	}
	caCertBlock, _ := pem.Decode(caCertPEM)
	caCert, err := x509.ParseCertificate(caCertBlock.Bytes)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to parse CA cert: %v\n", err)
		os.Exit(1)
	}

	serverPrivKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Server key gen failed: %v\n", err)
		os.Exit(1)
	}

	template := x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: "localhost"},
		DNSNames:     []string{"localhost"},
		NotBefore:    time.Now(),
		NotAfter:     time.Now().Add(365 * 24 * time.Hour),
		KeyUsage:    x509.KeyUsageDigitalSignature,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	serverBytes, err := x509.CreateCertificate(rand.Reader, &template, caCert, &serverPrivKey.PublicKey, caPrivKey)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Server cert signing failed: %v\n", err)
		os.Exit(1)
	}

	pkBytes, err := x509.MarshalECPrivateKey(serverPrivKey)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Server key marshal failed: %v\n", err)
		os.Exit(1)
	}

	pkBlock := pem.Block{Type: "EC PRIVATE KEY", Bytes: pkBytes}
	os.WriteFile(serverKeyPath, pem.EncodeToMemory(&pkBlock), 0600)

	chain := append(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: serverBytes}),
		pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caCertBlock.Bytes})...)
	os.WriteFile(chainPath, chain, 0644)

	fmt.Printf("Wrote server key: %s\n", serverKeyPath)
	fmt.Printf("Wrote chain:    %s (server cert + CA)\n", chainPath)
}

// ── Step 3: Start HTTPS server ────────────────────────────────────────────────
func startServer(chainPath, keyPath string) {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Server", "go-tls-self-signed/1.0")
		w.Write([]byte("Hello from self-signed TLS\n"))
	})

	server := &http.Server{Addr: ":8443", Handler: mux}
	fmt.Println("Starting HTTPS server on https://localhost:8443 ...")
	if err := server.ListenAndServeTLS(chainPath, keyPath); err != nil {
		fmt.Fprintf(os.Stderr, "Server error: %v\n", err)
		os.Exit(1)
	}
}

func usage(prog string) {
	fmt.Fprintf(os.Stderr, "Usage:\n")
	fmt.Fprintf(os.Stderr, "  %s ca                         Generate CA key + cert (ca-key.pem, ca-cert.pem)\n", prog)
	fmt.Fprintf(os.Stderr, "  %s sign                       Sign server cert using ca-key.pem + ca-cert.pem → chain.pem + server-key.pem\n", prog)
	fmt.Fprintf(os.Stderr, "  %s serve                      Start HTTPS server on :8443 (requires chain.pem + server-key.pem)\n", prog)
	os.Exit(1)
}

func main() {
	if len(os.Args) < 2 {
		usage(os.Args[0])
	}

	switch os.Args[1] {
	case "ca":
		generateCA("ca-key.pem", "ca-cert.pem")
	case "sign":
		signServerCert("ca-key.pem", "ca-cert.pem", "server-key.pem", "chain.pem")
	case "serve":
		if _, err := os.Stat("chain.pem"); err != nil {
			fmt.Fprintf(os.Stderr, "chain.pem not found — run '%s sign' first\n", os.Args[0])
			os.Exit(1)
		}
		if _, err := os.Stat("server-key.pem"); err != nil {
			fmt.Fprintf(os.Stderr, "server-key.pem not found — run '%s sign' first\n", os.Args[0])
			os.Exit(1)
		}
		startServer("chain.pem", "server-key.pem")
	default:
		usage(os.Args[0])
	}
}
