// Throwaway #30 Noise-interop spike responder — NOT production code, NOT the daemon.
//
// A single-handshake `github.com/flynn/noise` IK responder (the daemon's actual Noise library,
// v1.1.0) over a stdio line protocol, used ONLY by ../noiseSpike.interop.test.ts to prove the #29
// noise-c.wasm JS initiator interoperates with the real Go Noise stack. It is not the production
// daemon, but it is the same library and suite, so a byte-identical handshake here is real Go<->JS
// evidence.
//
// Suite: Noise_IK_25519_ChaChaPoly_BLAKE2s (matches the daemon). --hash blake2b flips only the
// hash for the negative suite-mismatch case; one binary drives every scenario. Empty prologue,
// empty associated-data, desktop = initiator / this = responder.
//
// The load-bearing interop line is the Split() asymmetry: flynn returns raw (cs1, cs2) where cs1
// carries initiator->responder and cs2 carries responder->initiator, so the RESPONDER maps
// recv=cs1, send=cs2 (the swap pyrycode internal/noise #433 does). The JS noise-c initiator does
// NO swap (it returns role-adjusted [send, recv]). Crossing these completes the handshake but
// MAC-fails the first transport frame.
//
// LOG-FREE of secrets by construction: stdout carries ONLY the tagged base64 line protocol
// (synthetic test bytes — a locally generated responder keypair, the JS device keypair, and a test
// hello fixture; no real credential exists on this path) and static ERR reasons. No key material,
// plaintext, or flynn error text is ever printed (a flynn error string can echo transcript bytes).
//
// Line protocol (parent = JS test, child = this responder):
//
//	child->parent once:    PUB <base64-std 32-byte responder static public key>
//	parent->child lines:   <base64-std raw Noise frame>       (msg 1, then transport frames)
//	child->parent lines:   FRAME <base64-std raw Noise frame> (msg 2, then AEAD echoes)
//	child->parent on fail: ERR <static-reason>                then exit non-zero
package main

import (
	"bufio"
	"crypto/rand"
	"encoding/base64"
	"flag"
	"fmt"
	"os"

	"github.com/flynn/noise"
)

func main() {
	hashName := flag.String("hash", "blake2s", "handshake hash: blake2s (daemon suite) | blake2b (negative mismatch)")
	flag.Parse()

	if err := run(*hashName); err != nil {
		// Static reason only — never key material, plaintext, or the underlying flynn error text.
		fmt.Printf("ERR %s\n", err.Error())
		os.Exit(1)
	}
}

func run(hashName string) error {
	var hash noise.HashFunc
	switch hashName {
	case "blake2s":
		hash = noise.HashBLAKE2s
	case "blake2b":
		hash = noise.HashBLAKE2b
	default:
		return reason("unknown-hash-flag")
	}

	suite := noise.NewCipherSuite(noise.DH25519, noise.CipherChaChaPoly, hash)
	staticKey, err := suite.GenerateKeypair(rand.Reader)
	if err != nil {
		return reason("keygen-failed")
	}

	out := bufio.NewWriter(os.Stdout)
	if err := writeLine(out, "PUB "+base64.StdEncoding.EncodeToString(staticKey.Public)); err != nil {
		return reason("stdout-write-failed")
	}

	hs, err := noise.NewHandshakeState(noise.Config{
		CipherSuite:   suite,
		Random:        rand.Reader,
		Pattern:       noise.HandshakeIK,
		Initiator:     false,
		StaticKeypair: staticKey,
	})
	if err != nil {
		return reason("handshake-init-failed")
	}

	in := bufio.NewScanner(os.Stdin)
	in.Buffer(make([]byte, 0, 64*1024), 1<<20) // allow up to a 1 MiB base64 line

	// --- IK message 1 (initiator -> responder), carrying the hello early-data ---
	msg1, ok := readFrame(in)
	if !ok {
		return reason("no-msg1")
	}
	hello, _, _, err := hs.ReadMessage(nil, msg1)
	if err != nil {
		// Wrong hash suite or wrong responder static: the symmetric state / es|ss DH diverges, so
		// the encrypted static (and payload) fails its Poly1305 MAC here. This is the AC2 negative.
		return reason("handshake-read-failed")
	}

	// --- IK message 2 (responder -> initiator): echo the recovered hello as hello_ack; then split.
	msg2, cs1, cs2, err := hs.WriteMessage(nil, hello)
	if err != nil {
		return reason("handshake-write-failed")
	}
	recv, send := cs1, cs2 // responder maps recv=cs1 (init->resp), send=cs2 (resp->init)

	if err := writeLine(out, "FRAME "+base64.StdEncoding.EncodeToString(msg2)); err != nil {
		return reason("stdout-write-failed")
	}

	// --- transport: decrypt each inbound frame and echo the same plaintext back (AEAD round-trip).
	for {
		ct, ok := readFrame(in)
		if !ok {
			return nil // parent closed stdin / finished — clean exit
		}
		pt, err := recv.Decrypt(nil, nil, ct) // empty associated-data
		if err != nil {
			return reason("transport-decrypt-failed")
		}
		echo, err := send.Encrypt(nil, nil, pt) // empty associated-data
		if err != nil {
			return reason("transport-encrypt-failed")
		}
		if err := writeLine(out, "FRAME "+base64.StdEncoding.EncodeToString(echo)); err != nil {
			return reason("stdout-write-failed")
		}
	}
}

// writeLine writes one protocol line and flushes so the parent sees it immediately.
func writeLine(out *bufio.Writer, line string) error {
	if _, err := out.WriteString(line + "\n"); err != nil {
		return err
	}
	return out.Flush()
}

// readFrame reads one base64-std line and decodes it to raw frame bytes. Returns ok=false on EOF
// (the normal termination when the parent closes stdin or kills the child). The only writer is the
// trusted parent test using base64-std, so a mid-stream decode error cannot occur in practice.
func readFrame(in *bufio.Scanner) ([]byte, bool) {
	if !in.Scan() {
		return nil, false
	}
	raw, err := base64.StdEncoding.DecodeString(in.Text())
	if err != nil {
		return nil, false
	}
	return raw, true
}

// reason is a static, byte-free error whose message is safe to print on stdout.
type reason string

func (r reason) Error() string { return string(r) }
