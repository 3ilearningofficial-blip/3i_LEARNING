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
              'X-User-Id': String(user.id),
            },
          }
        );

        if (!tokenRes.ok) {
          throw new Error('Failed to get download token');
        }

        const { token } = await tokenRes.json();

        // STEP 2: download file
        const downloadUrl = `${baseUrl}/download-proxy?token=${token}`;
        const tempPath = `${(FileSystem as any).cacheDirectory}temp_${Date.now()}`;

        const download = FileSystem.createDownloadResumable(
          downloadUrl,
          tempPath,
          {},
          (p) => {
            const progress = Math.round((p.totalBytesWritten / p.totalBytesExpectedToWrite) * 100);
            updateState(itemType, itemId, { progress });
          }
        );

        const result = await download.downloadAsync();
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
        const finalPath = `${(FileSystem as any).documentDirectory}${uuid}.enc`;

        await FileSystem.writeAsStringAsync(finalPath, encrypted);

        // cleanup
        await FileSystem.deleteAsync(result.uri, { idempotent: true });

        // STEP 6: notify server
        await fetch(`${baseUrl}/my-downloads`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${user.sessionToken}`,
            'X-User-Id': String(user.id),
          },
          body: JSON.stringify({ itemType, itemId, localFilename: uuid }),
        });

        updateState(itemType, itemId, {
          status: 'downloaded',
          progress: 100,
          localFilename: uuid,
        });

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
        await FileSystem.deleteAsync(
          `${(FileSystem as any).documentDirectory}${state.localFilename}.enc`,
          { idempotent: true }
        );

        await fetch(`${baseUrl}/my-downloads/${itemType}/${itemId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${user.sessionToken}`,
            'X-User-Id': String(user.id),
          },
        });

        setStateMap(prev => {
          const map = new Map(prev);
          map.delete(getKey(itemType, itemId));
          return map;
        });

      } catch (err: any) {
        updateState(itemType, itemId, {
          status: 'deletion_pending',
          error: err.message,
        });
        throw err;
      }
    },
    [user, getDownloadState]
  );

  // ================= GET FILE =================

  const getLocalUri = useCallback(
    async (itemType: string, itemId: number) => {
      if (!user?.sessionToken) return null;

      const state = getDownloadState(itemType, itemId);
      if (!state.localFilename) return null;

      try {
        const encPath = `${(FileSystem as any).documentDirectory}${state.localFilename}.enc`;

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
          'X-User-Id': String(user.id),
        },
      });

      if (!res.ok) return;

      const data = await res.json();
      const serverKeys = new Set<string>();

      [...(data.lectures || []), ...(data.materials || [])].forEach((i: any) => {
        serverKeys.add(getKey(i.type, i.id));
      });

      for (const key of stateMap.keys()) {
        if (!serverKeys.has(key)) {
          const [type, id] = key.split(':');
          await deleteDownload(type, Number(id));
        }
      }

    } catch (e) {
      console.error(e);
    }
  }, [user, stateMap, deleteDownload]);

  return {
    getDownloadState,
    startDownload,
    deleteDownload,
    getLocalUri,
    getTotalStorageBytes,
    runForegroundAccessCheck,
  };
}