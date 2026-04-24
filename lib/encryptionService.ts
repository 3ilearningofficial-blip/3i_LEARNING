import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system';
import CryptoJS from "crypto-js";
import * as Crypto from 'expo-crypto';

const KEY_STORAGE_KEY = 'download_encryption_key';
const SALT_STORAGE_KEY = 'download_key_salt';
const BINDING_STORAGE_KEY = 'download_key_binding';
const ITERATIONS = 100000;
const KEY_SIZE = 256 / 32; // 256 bits = 8 words (32-bit words)

class EncryptionService {
  private cachedKey: string | null = null;
  private cachedBinding: string | null = null;

  private async computeBinding(sessionToken: string, deviceId: string): Promise<string> {
    return Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${sessionToken}:${deviceId}`
    );
  }

  /**
   * Get or create encryption key using PBKDF2 derivation
   * Key = PBKDF2(sessionToken + deviceId, salt, 100000 iterations, 256 bits)
   */
  async getOrCreateKey(sessionToken: string, deviceId: string): Promise<string> {
    const binding = await this.computeBinding(sessionToken, deviceId);

    // Return cached key if available
    if (this.cachedKey && this.cachedBinding === binding) {
      return this.cachedKey;
    }

    try {
      // Check if key already exists in SecureStore
      const existingKey = await SecureStore.getItemAsync(KEY_STORAGE_KEY);
      const existingBinding = await SecureStore.getItemAsync(BINDING_STORAGE_KEY);
      if (existingKey && existingBinding === binding) {
        this.cachedKey = existingKey;
        this.cachedBinding = binding;
        return existingKey;
      }

      // Key exists but binding changed => rotate key material.
      if (existingKey && existingBinding !== binding) {
        await SecureStore.deleteItemAsync(KEY_STORAGE_KEY);
        await SecureStore.deleteItemAsync(SALT_STORAGE_KEY);
        await SecureStore.deleteItemAsync(BINDING_STORAGE_KEY);
      }

      // Get or create salt
      let salt = await SecureStore.getItemAsync(SALT_STORAGE_KEY);
      if (!salt) {
        // Generate random 16-byte salt
        const saltBytes = await Crypto.getRandomBytesAsync(16);
        salt = Array.from(saltBytes)
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
        await SecureStore.setItemAsync(SALT_STORAGE_KEY, salt);
      }

      // Derive key using PBKDF2
      const password = `${sessionToken}:${deviceId}`;
      const key = CryptoJS.PBKDF2(password, salt, {
        keySize: KEY_SIZE,
        iterations: ITERATIONS,
        hasher: CryptoJS.algo.SHA256,
      });

      const keyString = key.toString();
      
      // Store derived key in SecureStore
      await SecureStore.setItemAsync(KEY_STORAGE_KEY, keyString);
      await SecureStore.setItemAsync(BINDING_STORAGE_KEY, binding);
      this.cachedKey = keyString;
      this.cachedBinding = binding;

      return keyString;
    } catch (error) {
      console.error('[EncryptionService] Failed to get/create key:', error);
      throw new Error('Failed to initialize encryption key');
    }
  }

  /**
   * Encrypt buffer data with AES-256-CBC
   * Returns hex ciphertext with prepended IV (hex)
   */
  async encryptBuffer(
    data: string,
    sessionToken: string,
    deviceId: string
  ): Promise<string> {
    try {
      const key = await this.getOrCreateKey(sessionToken, deviceId);

      // Generate random 16-byte IV
      const ivBytes = await Crypto.getRandomBytesAsync(16);
      const iv = CryptoJS.lib.WordArray.create(Array.from(ivBytes));

      // Encrypt with AES-256-CBC
      const encrypted = CryptoJS.AES.encrypt(data, CryptoJS.enc.Hex.parse(key), {
        iv: iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
      });

      // Prepend IV to ciphertext
      const ivHex = Array.from(ivBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      const ciphertext = encrypted.ciphertext.toString();
      const combined = ivHex + ciphertext;

      return combined;
    } catch (error) {
      console.error('[EncryptionService] Encryption failed:', error);
      throw new Error('Failed to encrypt data');
    }
  }

  /**
   * Decrypt ciphertext and write to destination path
   * Returns file:// URI of decrypted file
   */
  async decryptToUri(
    ciphertext: string,
    destPath: string,
    sessionToken: string,
    deviceId: string
  ): Promise<string> {
    try {
      const key = await this.getOrCreateKey(sessionToken, deviceId);

      // Split IV (first 32 hex chars = 16 bytes) and ciphertext
      const ivHex = ciphertext.substring(0, 32);
      const ciphertextHex = ciphertext.substring(32);
      if (ivHex.length !== 32 || ciphertextHex.length === 0) {
        throw new Error('Invalid encrypted payload');
      }

      // Convert IV from hex to WordArray
      const iv = CryptoJS.enc.Hex.parse(ivHex);

      // Decrypt with AES-256-CBC
      const decrypted = CryptoJS.AES.decrypt(
        { ciphertext: CryptoJS.enc.Hex.parse(ciphertextHex) } as any,
        CryptoJS.enc.Hex.parse(key),
        {
          iv: iv,
          mode: CryptoJS.mode.CBC,
          padding: CryptoJS.pad.Pkcs7,
        }
      );

      const decryptedString = decrypted.toString(CryptoJS.enc.Utf8);

      if (!decryptedString) {
        throw new Error('Decryption resulted in empty data');
      }

      // Decrypted content is a base64 file payload; write as binary.
      await FileSystem.writeAsStringAsync(destPath, decryptedString, {
        encoding: (FileSystem as any).EncodingType.Base64,
      });

      return destPath;
    } catch (error) {
      console.error('[EncryptionService] Decryption failed:', error);
      throw new Error('Failed to decrypt data - file may be corrupted');
    }
  }

  /**
   * Clear cached key (call on logout)
   */
  clearCache(): void {
    this.cachedKey = null;
    this.cachedBinding = null;
  }

  /**
   * Delete all encryption keys (call on logout or key rotation)
   */
  async deleteKeys(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(KEY_STORAGE_KEY);
      await SecureStore.deleteItemAsync(SALT_STORAGE_KEY);
      await SecureStore.deleteItemAsync(BINDING_STORAGE_KEY);
      this.cachedKey = null;
      this.cachedBinding = null;
    } catch (error) {
      console.error('[EncryptionService] Failed to delete keys:', error);
    }
  }
}

// Export singleton instance
export const encryptionService = new EncryptionService();
