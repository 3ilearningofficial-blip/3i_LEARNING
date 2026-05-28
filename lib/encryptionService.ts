/**
 * EncryptionService — AES-256-CBC offline file encryption.
 *
 * All crypto operations use the native Web Crypto API (crypto.subtle), available
 * in React Native Hermes 0.73+ and all modern browsers. This replaces the
 * pure-JS CryptoJS implementation which blocked the JS thread for ~1.7 s on
 * 50 MB files. The wire format (v1 / v2) and key storage scheme are unchanged
 * so all existing encrypted downloads remain decryptable.
 *
 * Key derivation (ODSR-01 hardening):
 *   New installs:  key = PBKDF2(sessionToken:deviceId:serverNonce, salt, 100 000 iters)
 *   Legacy installs (key already in SecureStore): existing key is reused as-is.
 *
 * The serverNonce is fetched ONCE from POST /api/offline/device-secret, stored in
 * SecureStore (hardware-backed on iOS/Android), and never re-issued by the server.
 * This means even if an attacker extracts sessionToken + deviceId from AsyncStorage,
 * they cannot reconstruct the encryption key without also reading SecureStore.
 *
 * Encryption:  AES-256-CBC + PKCS#7 padding.
 * Integrity:   HMAC-SHA256 over "<ivHex>:<ciphertextHex>" (v2 only).
 *
 * Ciphertext formats:
 *   v1 (legacy):  <ivHex32><ciphertextHex>
 *   v2 (current): v2:<ivHex>:<ciphertextHex>:<macHex>
 */

import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';

const KEY_STORAGE_KEY     = 'download_encryption_key';
const SALT_STORAGE_KEY    = 'download_key_salt';
const BINDING_STORAGE_KEY = 'download_key_binding';
/** ODSR-01: server-issued nonce stored in SecureStore after first key creation. */
const SERVER_NONCE_KEY    = 'download_key_server_nonce';
const ITERATIONS = 100_000;

// ─── Low-level helpers ────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Derive a 256-bit key via PBKDF2-HMAC-SHA256 using the native Web Crypto API.
 *
 * The salt is passed as the UTF-8 encoding of its hex string representation —
 * identical to how CryptoJS encoded it previously — so keys derived on new
 * devices are compatible with the same algorithm.
 */
async function deriveKeyHex(password: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(saltHex), iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

/** Import a 32-byte hex key string as a CryptoKey for AES-CBC. */
async function importAesCbcKey(keyHex: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', hexToBytes(keyHex), { name: 'AES-CBC' }, false, usages);
}

/** Sign a message with HMAC-SHA256 using the key hex; returns a hex digest. */
async function hmacSha256Hex(keyHex: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const hmacKey = await crypto.subtle.importKey(
    'raw', hexToBytes(keyHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', hmacKey, enc.encode(message));
  return bytesToHex(new Uint8Array(sig));
}

/** Verify an HMAC-SHA256 signature. Returns true if the tag is authentic. */
async function verifyHmacSha256(keyHex: string, message: string, tagHex: string): Promise<boolean> {
  const enc = new TextEncoder();
  const hmacKey = await crypto.subtle.importKey(
    'raw', hexToBytes(keyHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
  );
  return crypto.subtle.verify('HMAC', hmacKey, hexToBytes(tagHex), enc.encode(message));
}

// ─── Server-nonce fetch (ODSR-01) ────────────────────────────────────────

/**
 * Fetch a one-time server nonce from POST /api/offline/device-secret.
 * The nonce is issued once per (user, device) and never reissued.
 * Returns the hex nonce string, or null if the request fails (fallback: no nonce).
 */
async function fetchServerNonce(
  apiBaseUrl: string,
  sessionToken: string,
  deviceId: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${apiBaseUrl}/api/offline/device-secret`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        'x-app-device-id': deviceId,
        'Content-Type': 'application/json',
      },
    });
    if (res.status === 409) {
      // Already issued — this shouldn't happen (we check SecureStore first), but
      // treat it as a signal that SecureStore data was lost.  Fail gracefully.
      console.warn('[EncryptionService] Server nonce already issued for this device; SecureStore may have been reset.');
      return null;
    }
    if (!res.ok) return null;
    const json = await res.json() as { nonce?: string };
    return typeof json.nonce === 'string' && json.nonce.length === 64 ? json.nonce : null;
  } catch {
    return null;
  }
}

// ─── Service ─────────────────────────────────────────────────────────────

class EncryptionService {
  private cachedKey: string | null = null;
  private cachedBinding: string | null = null;
  /** API base URL injected at first call from useDownloadManager. */
  private apiBaseUrl = '';

  /** Called once by useDownloadManager to provide the API base URL. */
  setApiBaseUrl(url: string): void {
    this.apiBaseUrl = url;
  }

  private async computeBinding(sessionToken: string, deviceId: string): Promise<string> {
    return Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${sessionToken}:${deviceId}`,
    );
  }

  /**
   * Get or create the AES-256 key for this (sessionToken, deviceId) pair.
   *
   * The derived key is stored in SecureStore as a 64-char hex string.
   * On subsequent calls the in-memory cache is checked first, then SecureStore —
   * so PBKDF2 only runs once per device lifetime (or on credential rotation).
   *
   * ODSR-01: For new key derivations (fresh install or credential rotation), a
   * server-issued nonce is fetched and included in the PBKDF2 password.  This
   * nonce lives only in SecureStore — the server only stores a HMAC of it and
   * cannot reconstruct the plaintext even if the DB is compromised.
   *
   * Legacy keys (already stored in SecureStore from before this change) are
   * reused as-is for backward compatibility with existing encrypted files.
   */
  async getOrCreateKey(sessionToken: string, deviceId: string): Promise<string> {
    const binding = await this.computeBinding(sessionToken, deviceId);
    if (this.cachedKey && this.cachedBinding === binding) return this.cachedKey;

    try {
      const existingKey = await SecureStore.getItemAsync(KEY_STORAGE_KEY);
      const existingBinding = await SecureStore.getItemAsync(BINDING_STORAGE_KEY);

      if (existingKey && existingBinding === binding) {
        // Key already derived (possibly by a previous version) — reuse it directly.
        // This preserves backward compat with all existing encrypted downloads.
        this.cachedKey = existingKey;
        this.cachedBinding = binding;
        return existingKey;
      }

      if (existingKey && existingBinding !== binding) {
        // Credentials changed → rotate. Old encrypted files become inaccessible (by design).
        await SecureStore.deleteItemAsync(KEY_STORAGE_KEY);
        await SecureStore.deleteItemAsync(SALT_STORAGE_KEY);
        await SecureStore.deleteItemAsync(BINDING_STORAGE_KEY);
        await SecureStore.deleteItemAsync(SERVER_NONCE_KEY);
      }

      // Generate a fresh salt for new derivations.
      let salt = await SecureStore.getItemAsync(SALT_STORAGE_KEY);
      if (!salt) {
        const saltBytes = await Crypto.getRandomBytesAsync(16);
        salt = bytesToHex(saltBytes);
        await SecureStore.setItemAsync(SALT_STORAGE_KEY, salt);
      }

      // ODSR-01: Retrieve or request the server-issued nonce.
      // If the fetch fails (offline, server error), fall back to nonce-less derivation
      // so downloads are never permanently blocked by a network issue.
      let serverNonce = await SecureStore.getItemAsync(SERVER_NONCE_KEY);
      if (!serverNonce && this.apiBaseUrl) {
        const fetched = await fetchServerNonce(this.apiBaseUrl, sessionToken, deviceId);
        if (fetched) {
          serverNonce = fetched;
          await SecureStore.setItemAsync(SERVER_NONCE_KEY, serverNonce);
        }
      }

      // Build the PBKDF2 password — include nonce if available.
      const password = serverNonce
        ? `${sessionToken}:${deviceId}:${serverNonce}`
        : `${sessionToken}:${deviceId}`;

      const keyString = await deriveKeyHex(password, salt);

      await SecureStore.setItemAsync(KEY_STORAGE_KEY, keyString);
      await SecureStore.setItemAsync(BINDING_STORAGE_KEY, binding);
      this.cachedKey = keyString;
      this.cachedBinding = binding;
      return keyString;
    } catch (err) {
      console.error('[EncryptionService] Failed to get/create key:', err);
      throw new Error('Failed to initialize encryption key');
    }
  }

  /**
   * Encrypt `data` with AES-256-CBC and an HMAC-SHA256 integrity tag.
   * Output: v2:<ivHex>:<ciphertextHex>:<macHex>
   *
   * Runs on the native crypto engine — no JS-thread stall for large payloads.
   */
  async encryptBuffer(data: string, sessionToken: string, deviceId: string): Promise<string> {
    try {
      const key = await this.getOrCreateKey(sessionToken, deviceId);

      const ivBytes = await Crypto.getRandomBytesAsync(16);
      const ivHex = bytesToHex(ivBytes);

      const aesKey = await importAesCbcKey(key, ['encrypt']);
      const enc = new TextEncoder();
      const ciphertextBuf = await crypto.subtle.encrypt(
        { name: 'AES-CBC', iv: ivBytes },
        aesKey,
        enc.encode(data),
      );
      const ciphertextHex = bytesToHex(new Uint8Array(ciphertextBuf));
      const mac = await hmacSha256Hex(key, `${ivHex}:${ciphertextHex}`);

      return `v2:${ivHex}:${ciphertextHex}:${mac}`;
    } catch (err) {
      console.error('[EncryptionService] Encryption failed:', err);
      throw new Error('Failed to encrypt data');
    }
  }

  /**
   * Decrypt a v1 or v2 ciphertext and write the result to `destPath`.
   * Returns the file:// URI of the decrypted file.
   *
   * v1: no HMAC check — just AES-CBC decode.
   * v2: HMAC-SHA256 verified before decryption.
   *
   * Both formats are decryptable with the same Web Crypto AES-CBC key,
   * including files originally encrypted by the old CryptoJS implementation.
   */
  async decryptToUri(
    ciphertext: string,
    destPath: string,
    sessionToken: string,
    deviceId: string,
  ): Promise<string> {
    try {
      const key = await this.getOrCreateKey(sessionToken, deviceId);

      let ivHex: string;
      let ciphertextHex: string;
      let macHex: string | null = null;

      if (ciphertext.startsWith('v2:')) {
        const parts = ciphertext.split(':');
        if (parts.length !== 4) throw new Error('Invalid encrypted payload');
        ivHex = parts[1];
        ciphertextHex = parts[2];
        macHex = parts[3];
      } else {
        // Legacy v1: first 32 hex chars = 16-byte IV, remainder = ciphertext.
        ivHex = ciphertext.substring(0, 32);
        ciphertextHex = ciphertext.substring(32);
      }

      if (ivHex.length !== 32 || ciphertextHex.length === 0) {
        throw new Error('Invalid encrypted payload');
      }

      if (macHex) {
        const valid = await verifyHmacSha256(key, `${ivHex}:${ciphertextHex}`, macHex);
        if (!valid) throw new Error('Encrypted payload integrity check failed');
      }

      const aesKey = await importAesCbcKey(key, ['decrypt']);
      const plainBuf = await crypto.subtle.decrypt(
        { name: 'AES-CBC', iv: hexToBytes(ivHex) },
        aesKey,
        hexToBytes(ciphertextHex),
      );

      // Plaintext is a base64-encoded file payload — write as binary.
      const decryptedString = new TextDecoder().decode(plainBuf);
      if (!decryptedString) throw new Error('Decryption resulted in empty data');

      await FileSystem.writeAsStringAsync(destPath, decryptedString, {
        encoding: (FileSystem as any).EncodingType.Base64,
      });

      return destPath;
    } catch (err) {
      console.error('[EncryptionService] Decryption failed:', err);
      throw new Error('Failed to decrypt data - file may be corrupted');
    }
  }

  /** Clear the in-memory key cache (call on logout). */
  clearCache(): void {
    this.cachedKey = null;
    this.cachedBinding = null;
  }

  /** Delete all persisted key material from SecureStore (call on logout or key rotation). */
  async deleteKeys(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(KEY_STORAGE_KEY);
      await SecureStore.deleteItemAsync(SALT_STORAGE_KEY);
      await SecureStore.deleteItemAsync(BINDING_STORAGE_KEY);
      await SecureStore.deleteItemAsync(SERVER_NONCE_KEY);
      this.cachedKey = null;
      this.cachedBinding = null;
    } catch (err) {
      console.error('[EncryptionService] Failed to delete keys:', err);
    }
  }
}

export const encryptionService = new EncryptionService();
