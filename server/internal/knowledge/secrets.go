package knowledge

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

// ErrSecretKeyMissing means the deployment cannot store provider API keys.
// Without a master key we refuse to persist them rather than writing plaintext.
var ErrSecretKeyMissing = errors.New("QUICKWORK_SECRET_KEY is not configured")

// SecretCipher encrypts provider API keys at rest with AES-256-GCM. The master
// key is a base64-encoded 32-byte value from QUICKWORK_SECRET_KEY.
type SecretCipher struct {
	aead cipher.AEAD
}

func CipherFromEnv() (*SecretCipher, error) {
	raw := strings.TrimSpace(os.Getenv("QUICKWORK_SECRET_KEY"))
	if raw == "" {
		return nil, ErrSecretKeyMissing
	}
	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil || len(key) != 32 {
		return nil, fmt.Errorf("QUICKWORK_SECRET_KEY must be base64 for exactly 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &SecretCipher{aead: aead}, nil
}

func (c *SecretCipher) Encrypt(plain string) (string, error) {
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := c.aead.Seal(nonce, nonce, []byte(plain), nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

func (c *SecretCipher) Decrypt(encoded string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", fmt.Errorf("invalid encrypted key: %w", err)
	}
	if len(raw) < c.aead.NonceSize() {
		return "", errors.New("invalid encrypted key")
	}
	plain, err := c.aead.Open(nil, raw[:c.aead.NonceSize()], raw[c.aead.NonceSize():], nil)
	if err != nil {
		return "", errors.New("could not decrypt the provider key")
	}
	return string(plain), nil
}

// KeyHint is the only part of a key that may leave the server.
func KeyHint(apiKey string) string {
	key := strings.TrimSpace(apiKey)
	if len(key) <= 4 {
		return key
	}
	return key[len(key)-4:]
}
