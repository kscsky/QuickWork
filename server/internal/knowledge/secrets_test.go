package knowledge

import (
	"encoding/base64"
	"strings"
	"testing"
)

func testKey(t *testing.T) string {
	t.Helper()
	return base64.StdEncoding.EncodeToString([]byte(strings.Repeat("k", 32)))
}

func TestCipherFromEnvRequiresMasterKey(t *testing.T) {
	t.Setenv("QUICKWORK_SECRET_KEY", "")
	if _, err := CipherFromEnv(); err == nil {
		t.Fatal("cipher was created without a master key")
	}
}

func TestCipherRoundTripAndHint(t *testing.T) {
	t.Setenv("QUICKWORK_SECRET_KEY", testKey(t))
	cipher, err := CipherFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	encrypted, err := cipher.Encrypt("sk-test-1234")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(encrypted, "sk-test-1234") {
		t.Fatal("ciphertext contains the plaintext key")
	}
	plain, err := cipher.Decrypt(encrypted)
	if err != nil {
		t.Fatal(err)
	}
	if plain != "sk-test-1234" {
		t.Fatalf("plaintext = %q", plain)
	}
	if hint := KeyHint("sk-test-1234"); hint != "1234" {
		t.Fatalf("hint = %q, want 1234", hint)
	}
}

func TestCipherRejectsTamperedCiphertext(t *testing.T) {
	t.Setenv("QUICKWORK_SECRET_KEY", testKey(t))
	cipher, err := CipherFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	encrypted, err := cipher.Encrypt("sk-test-1234")
	if err != nil {
		t.Fatal(err)
	}
	// Flip a character in the ciphertext body, not in the base64 padding.
	body := []byte(encrypted)
	body[len(body)/2] ^= 0x01
	if _, err := cipher.Decrypt(string(body)); err == nil {
		t.Fatal("tampered ciphertext decrypted successfully")
	}
}
