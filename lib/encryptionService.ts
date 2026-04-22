import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system';
import CryptoJS from "crypto-js";
import * as Crypto from 'expo-crypto';

const KEY_STORAGE_KEY = 'download_encryption_key';
const SALT_STORAGE_KEY = 'download_key_salt';
const ITERATIONS = 100000;
const KEY_SIZE = 256 / 32; // 256 bits = 8 words (32-bit words)

class EncryptionService {
  private cachedKey: string | null = null;

  /**
   * Get or create encryption key using PBKDF2 derivation
   * Key = PBKDF2(sessionToken + deviceId, salt, 100000 iterations, 256 bits)
   */
  async getOrCreateKey(sessionToken: string, deviceId: string): Promise<string> {
    // Return cached key if available
    if (this.cachedKey) {
      return this.cachedKey;
    }

    try {
      // Check if key already exists in SecureStore
      const existingKey = await SecureStore.getItemAsync(KEY_STORAGE_KEY);
      if (existingKey) {
        this.cachedKey = existingKey;
        return existingKey;
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
      this.cachedKey = keyString;

      return keyString;
    } catch (error) {
      console.error('[EncryptionService] Failed to get/create key:', error);
      throw new Error('Failed to initialize encryption key');
    }
  }

  /**
   * Encrypt buffer data with AES-256-CBC
   * Returns base64-encoded ciphertext with prepended IV
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

      // Write decrypted data to destination path
      await FileSystem.writeAsStringAsync(destPath, decryptedString, {
        encoding: "utf8" as any
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
  }

  /**
   * Delete all encryption keys (call on logout or key rotation)
   */
  async deleteKeys(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(KEY_STORAGE_KEY);
      await SecureStore.deleteItemAsync(SALT_STORAGE_KEY);
      this.cachedKey = null;
    } catch (error) {
      console.error('[EncryptionService] Failed to delete keys:', error);
    }
  }
}

// Export singleton instance
export const encryptionService = new EncryptionService();
