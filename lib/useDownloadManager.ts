import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { encryptionService } from './encryptionService';
import { useAuth } from '../context/AuthContext';
import { getApiUrl, prepareAuthorizedFetchHeaders } from './query-client';

const STORAGE_KEY_PREFIX = 'download_manager_state';

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

const DownloadManagerContext = createContext<UseDownloadManagerReturn | null>(null);

function useDownloadManagerImpl(): UseDownloadManagerReturn {
  const { user } = useAuth();
  const [stateMap, setStateMap] = useState<Map<string, DownloadState>>(new Map());
  const storageKey = `${STORAGE_KEY_PREFIX}:${user?.id ?? "guest"}`;
  const inFlightRef = useRef<Set<string>>(new Set());
  const deleteInFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setStateMap(new Map());
    loadState();
  }, [storageKey]);

  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      saveState();
    }, 450);
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
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
      const stored = await AsyncStorage.getItem(storageKey);
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
      await AsyncStorage.setItem(storageKey, JSON.stringify(obj));
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
      const key = getKey(itemType, itemId);
      if (inFlightRef.current.has(key)) return;

      const { bearer, headers: authHeaders } = await prepareAuthorizedFetchHeaders(user?.sessionToken);
      if (!bearer) throw new Error('Not authenticated');
      inFlightRef.current.add(key);

      try {
        updateState(itemType, itemId, { status: 'downloading', progress: 0 });

        const baseUrl = getApiUrl();

        // STEP 1: get token — must send X-App-Device-Id when account has app_bound_device_id
        const tokenRes = await fetch(
          `${baseUrl}/download-url?itemType=${itemType}&itemId=${itemId}`,
          {
            headers: authHeaders,
            credentials: 'include',
          }
        );

        if (!tokenRes.ok) {
          let detail = `Failed to get download token (${tokenRes.status})`;
          try {
            const body = await tokenRes.clone().json();
            const msg = typeof body?.message === 'string' ? body.message : typeof body?.error === 'string' ? body.error : '';
            if (msg) detail = msg;
          } catch {
            /* ignore */
          }
          throw new Error(detail);
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
            bearer,
            user?.deviceId || 'default'
          );

          // STEP 5: save encrypted
          const { randomUUID } = await import('expo-crypto');
          const uuid = randomUUID();
          const finalPath = getLocalEncryptedPath(uuid);

          await FileSystem.writeAsStringAsync(finalPath, encrypted);

          // STEP 6: notify server
          const { headers: postHdr } = await prepareAuthorizedFetchHeaders(user?.sessionToken);
          let trackRes = await fetch(`${baseUrl}/my-downloads`, {
            method: 'POST',
            headers: {
              ...postHdr,
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ itemType, itemId, localFilename: uuid }),
          });
          if (!trackRes.ok) {
            // Retry once with fresh auth headers before marking local state as fully downloaded.
            const { headers: retryHdr } = await prepareAuthorizedFetchHeaders(user?.sessionToken);
            trackRes = await fetch(`${baseUrl}/my-downloads`, {
              method: 'POST',
              headers: {
                ...retryHdr,
                'Content-Type': 'application/json',
              },
              credentials: 'include',
              body: JSON.stringify({ itemType, itemId, localFilename: uuid }),
            });
          }
          if (!trackRes.ok) {
            throw new Error(`Failed to sync download entry (${trackRes.status})`);
          }

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
      } finally {
        inFlightRef.current.delete(key);
      }
    },
    [user]
  );

  // ================= DELETE =================

  const deleteDownload = useCallback(
    async (itemType: string, itemId: number) => {
      const key = getKey(itemType, itemId);
      if (deleteInFlightRef.current.has(key)) return;
      const { bearer } = await prepareAuthorizedFetchHeaders(user?.sessionToken);
      if (!bearer) throw new Error('Not authenticated');

      const state = getDownloadState(itemType, itemId);
      if (!state.localFilename) return;

      const baseUrl = getApiUrl();

      deleteInFlightRef.current.add(key);
      try {
        const { headers: delHdr } = await prepareAuthorizedFetchHeaders(user?.sessionToken);
        let delRes = await fetch(`${baseUrl}/my-downloads/${itemType}/${itemId}`, {
          method: 'DELETE',
          headers: delHdr,
          credentials: 'include',
        });
        if (!delRes.ok) {
          const { headers: retryHdr } = await prepareAuthorizedFetchHeaders(user?.sessionToken);
          delRes = await fetch(`${baseUrl}/my-downloads/${itemType}/${itemId}`, {
            method: 'DELETE',
            headers: retryHdr,
            credentials: 'include',
          });
        }
        if (!delRes.ok) {
          throw new Error(`Failed to sync delete (${delRes.status})`);
        }

        await FileSystem.deleteAsync(getLocalEncryptedPath(state.localFilename), { idempotent: true });

        removeStateEntry(itemType, itemId);

      } catch (err: any) {
        updateState(itemType, itemId, {
          status: 'deletion_pending',
          error: err.message,
        });
        throw err;
      }
      finally {
        deleteInFlightRef.current.delete(key);
      }
    },
    [user, getDownloadState, removeStateEntry]
  );

  // ================= GET FILE =================

  const getLocalUri = useCallback(
    async (itemType: string, itemId: number) => {
      const { bearer } = await prepareAuthorizedFetchHeaders(user?.sessionToken);
      if (!bearer) return null;

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
          bearer,
          user?.deviceId || 'default'
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
    const { bearer, headers } = await prepareAuthorizedFetchHeaders(user?.sessionToken);
    if (!bearer) return;

    const baseUrl = getApiUrl();

    try {
      const res = await fetch(`${baseUrl}/my-downloads`, {
        headers,
        credentials: 'include',
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

export function DownloadManagerProvider({ children }: { children: React.ReactNode }) {
  const value = useDownloadManagerImpl();
  return React.createElement(DownloadManagerContext.Provider, { value }, children);
}

export function useDownloadManager(): UseDownloadManagerReturn {
  const ctx = useContext(DownloadManagerContext);
  if (!ctx) {
    throw new Error('useDownloadManager must be used within DownloadManagerProvider');
  }
  return ctx;
}