import { useState, useEffect, useCallback } from 'react';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { encryptionService } from './encryptionService';
import { useAuth } from '../context/AuthContext';
import { getApiUrl } from './query-client';

const STORAGE_KEY = 'download_manager_state';

export interface DownloadState {
  status: 'idle' | 'downloading' | 'downloaded' | 'error' | 'deletion_pending';
  progress: number;
  localFilename?: string;
  error?: string;
}

export interface UseDownloadManagerReturn {
  getDownloadState: (itemType: string, itemId: number) => DownloadState;
  startDownload: (itemType: 'lecture' | 'material', itemId: number) => Promise<void>;
  deleteDownload: (itemType: string, itemId: number) => Promise<void>;
  getLocalUri: (itemType: string, itemId: number) => Promise<string | null>;
  getTotalStorageBytes: () => Promise<number>;
  runForegroundAccessCheck: () => Promise<void>;
}

export function useDownloadManager(): UseDownloadManagerReturn {
  const { user } = useAuth();
  const [stateMap, setStateMap] = useState<Map<string, DownloadState>>(new Map());

  useEffect(() => {
    loadState();
  }, []);

  useEffect(() => {
    saveState();
  }, [stateMap]);

  const getKey = (itemType: string, itemId: number) => `${itemType}:${itemId}`;
  const getLocalEncryptedPath = (localFilename: string) =>
    `${(FileSystem as any).documentDirectory}${localFilename}.enc`;
  const unwrapPayload = (payload: any) => {
    if (payload && typeof payload === 'object' && typeof payload.success === 'boolean') {
      if (payload.success === false) {
        throw new Error(payload.error || payload.message || 'Request failed');
      }
      if ('data' in payload) return payload.data;
    }
    return payload;
  };

  const loadState = async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setStateMap(new Map(Object.entries(parsed)));
      }
    } catch (e) {
      console.error('[DownloadManager] load error:', e);
    }
  };

  const saveState = async () => {
    try {
      const obj = Object.fromEntries(stateMap);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch (e) {
      console.error('[DownloadManager] save error:', e);
    }
  };

  const getDownloadState = useCallback(
    (itemType: string, itemId: number): DownloadState => {
      return stateMap.get(getKey(itemType, itemId)) || { status: 'idle', progress: 0 };
    },
    [stateMap]
  );

  const updateState = (itemType: string, itemId: number, update: Partial<DownloadState>) => {
    const key = getKey(itemType, itemId);
    setStateMap(prev => {
      const map = new Map(prev);
      const current = map.get(key) || { status: 'idle' as const, progress: 0 };
      map.set(key, { ...current, ...update });
      return map;
    });
  };

  const removeStateEntry = useCallback((itemType: string, itemId: number) => {
    setStateMap(prev => {
      const map = new Map(prev);
      map.delete(getKey(itemType, itemId));
      return map;
    });
  }, []);

  // ================= DOWNLOAD =================

  const startDownload = useCallback(
    async (itemType: 'lecture' | 'material', itemId: number) => {
      if (Platform.OS === 'web') throw new Error('Downloads not supported on web');
      if (!user?.sessionToken) throw new Error('Not authenticated');

      try {
        updateState(itemType, itemId, { status: 'downloading', progress: 0 });

        const baseUrl = getApiUrl();

        // STEP 1: get token
        const tokenRes = await fetch(
          `${baseUrl}/download-url?itemType=${itemType}&itemId=${itemId}`,
          {
            headers: {
              Authorization: `Bearer ${user.sessionToken}`,
            },
          }
        );

        if (!tokenRes.ok) {
          throw new Error('Failed to get download token');
        }

        const tokenPayload = unwrapPayload(await tokenRes.json());
        const token = tokenPayload?.token;

        // STEP 2: download file
        if (!token || typeof token !== 'string') {
          throw new Error('Invalid download token response');
        }

        const downloadUrl = `${baseUrl}/download-proxy?token=${token}`;
        const tempPath = `${(FileSystem as any).cacheDirectory}temp_${Date.now()}`;

        let result: Awaited<ReturnType<ReturnType<typeof FileSystem.createDownloadResumable>["downloadAsync"]>> | null = null;
        try {
          const download = FileSystem.createDownloadResumable(
            downloadUrl,
            tempPath,
            {},
            (p) => {
              if (p.totalBytesExpectedToWrite > 0) {
                const progress = Math.round((p.totalBytesWritten / p.totalBytesExpectedToWrite) * 100);
                updateState(itemType, itemId, { progress });
              }
            }
          );

          result = await download.downloadAsync();
          if (!result) throw new Error('Download failed');

          // STEP 3: read file
          const fileData = await FileSystem.readAsStringAsync(result.uri, {
            encoding: (FileSystem as any).EncodingType.Base64,
          });

          // STEP 4: encrypt
          const encrypted = await encryptionService.encryptBuffer(
            fileData,
            user.sessionToken,
            user.deviceId || 'default'
          );

          // STEP 5: save encrypted
          const { randomUUID } = await import('expo-crypto');
          const uuid = randomUUID();
          const finalPath = getLocalEncryptedPath(uuid);

          await FileSystem.writeAsStringAsync(finalPath, encrypted);

          // STEP 6: notify server
          await fetch(`${baseUrl}/my-downloads`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${user.sessionToken}`,
            },
            body: JSON.stringify({ itemType, itemId, localFilename: uuid }),
          });

          updateState(itemType, itemId, {
            status: 'downloaded',
            progress: 100,
            localFilename: uuid,
          });
        } finally {
          // Best-effort cleanup of temp file regardless of success/failure.
          const cleanupPath = result?.uri || tempPath;
          await FileSystem.deleteAsync(cleanupPath, { idempotent: true }).catch(() => {});
        }

      } catch (err: any) {
        console.error(err);
        updateState(itemType, itemId, {
          status: 'error',
          error: err.message,
        });
        throw err;
      }
    },
    [user]
  );

  // ================= DELETE =================

  const deleteDownload = useCallback(
    async (itemType: string, itemId: number) => {
      if (!user?.sessionToken) throw new Error('Not authenticated');

      const state = getDownloadState(itemType, itemId);
      if (!state.localFilename) return;

      const baseUrl = getApiUrl();

      try {
        await FileSystem.deleteAsync(getLocalEncryptedPath(state.localFilename), { idempotent: true });

        await fetch(`${baseUrl}/my-downloads/${itemType}/${itemId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${user.sessionToken}`,
          },
        });

        removeStateEntry(itemType, itemId);

      } catch (err: any) {
        updateState(itemType, itemId, {
          status: 'deletion_pending',
          error: err.message,
        });
        throw err;
      }
    },
    [user, getDownloadState, removeStateEntry]
  );

  // ================= GET FILE =================

  const getLocalUri = useCallback(
    async (itemType: string, itemId: number) => {
      if (!user?.sessionToken) return null;

      const state = getDownloadState(itemType, itemId);
      if (!state.localFilename) return null;

      try {
        const encPath = getLocalEncryptedPath(state.localFilename);

        const exists = await FileSystem.getInfoAsync(encPath);
        if (!exists.exists) return null;

        const encrypted = await FileSystem.readAsStringAsync(encPath);

        const tempPath = `${(FileSystem as any).cacheDirectory}dec_${state.localFilename}`;

        await encryptionService.decryptToUri(
          encrypted,
          tempPath,
          user.sessionToken,
          user.deviceId || 'default'
        );

        return tempPath;

      } catch {
        return null;
      }
    },
    [user, getDownloadState]
  );

  // ================= STORAGE =================

  const getTotalStorageBytes = useCallback(async () => {
    try {
      const files = await FileSystem.readDirectoryAsync((FileSystem as any).documentDirectory || '');
      let total = 0;

      for (const f of files) {
        if (f.endsWith('.enc')) {
          const info = await FileSystem.getInfoAsync((FileSystem as any).documentDirectory + f);
          if (info.exists && 'size' in info) total += info.size;
        }
      }

      return total;
    } catch {
      return 0;
    }
  }, []);

  const runForegroundAccessCheck = useCallback(async () => {
    if (!user?.sessionToken) return;

    const baseUrl = getApiUrl();

    try {
      const res = await fetch(`${baseUrl}/my-downloads`, {
        headers: {
          Authorization: `Bearer ${user.sessionToken}`,
        },
      });

      if (!res.ok) return;

      const data = unwrapPayload(await res.json()) || {};
      const serverKeys = new Set<string>();

      [...(data.lectures || []), ...(data.materials || [])].forEach((i: any) => {
        serverKeys.add(getKey(i.type, i.id));
      });

      for (const key of stateMap.keys()) {
        if (!serverKeys.has(key)) {
          const [type, id] = key.split(':');
          const state = stateMap.get(key);
          if (state?.localFilename) {
            await FileSystem.deleteAsync(getLocalEncryptedPath(state.localFilename), { idempotent: true }).catch(() => {});
          }
          removeStateEntry(type, Number(id));
        }
      }

    } catch (e) {
      console.error(e);
    }
  }, [user, stateMap, removeStateEntry]);

  return {
    getDownloadState,
    startDownload,
    deleteDownload,
    getLocalUri,
    getTotalStorageBytes,
    runForegroundAccessCheck,
  };
}