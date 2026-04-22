import { useState, useEffect, useCallback } from 'react';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { encryptionService } from './encryptionService';
import { useAuth } from '../context/AuthContext';

const STORAGE_KEY = 'download_manager_state';

export interface DownloadState {
  status: 'idle' | 'downloading' | 'downloaded' | 'error' | 'deletion_pending';
  progress: number; // 0-100
  localFilename?: string; // UUID on disk
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

  // Load state from AsyncStorage on mount
  useEffect(() => {
    loadState();
  }, []);

  // Save state to AsyncStorage whenever it changes
  useEffect(() => {
    saveState();
  }, [stateMap]);

  const loadState = async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setStateMap(new Map(Object.entries(parsed)));
      }
    } catch (error) {
      console.error('[DownloadManager] Failed to load state:', error);
    }
  };

  const saveState = async () => {
    try {
      const obj = Object.fromEntries(stateMap);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch (error) {
      console.error('[DownloadManager] Failed to save state:', error);
    }
  };

  const getKey = (itemType: string, itemId: number): string => {
    return `${itemType}:${itemId}`;
  };

  const getDownloadState = useCallback(
    (itemType: string, itemId: number): DownloadState => {
      const key = getKey(itemType, itemId);
      return stateMap.get(key) || { status: 'idle', progress: 0 };
    },
    [stateMap]
  );

  const updateState = (itemType: string, itemId: number, update: Partial<DownloadState>) => {
    const key = getKey(itemType, itemId);
    setStateMap((prev) => {
      const newMap = new Map(prev);
      const current = newMap.get(key) || { status: 'idle' as const, progress: 0 };
      newMap.set(key, { ...current, ...update });
      return newMap;
    });
  };

  const startDownload = useCallback(
    async (itemType: 'lecture' | 'material', itemId: number) => {
      if (Platform.OS === 'web') {
        throw new Error('Downloads not supported on web');
      }

      if (!user?.sessionToken) {
        throw new Error('Not authenticated');
      }

      const key = getKey(itemType, itemId);

      try {
        updateState(itemType, itemId, { status: 'downloading', progress: 0, error: undefined });

        // Step 1: Request signed token
        const tokenResponse = await fetch(
          `${process.env.EXPO_PUBLIC_API_URL}/api/download-url?itemType=${itemType}&itemId=${itemId}`,
          {
            headers: {
              Authorization: `Bearer ${user.sessionToken}`,
              'X-User-Id': String(user.id),
            },
          }
        );

        if (!tokenResponse.ok) {
          const errorData = await tokenResponse.json().catch(() => ({}));
          throw new Error(errorData.message || 'Failed to get download token');
        }

        const { token } = await tokenResponse.json();

        // Step 2: Download file via proxy with progress tracking
        const downloadUrl = `${process.env.EXPO_PUBLIC_API_URL}/api/download-proxy?token=${token}`;
        
        const downloadResumable = FileSystem.createDownloadResumable(
          downloadUrl,
          (FileSystem as any).cacheDirectory + 'temp_download',
          {},
          (downloadProgress) => {
            const progress = Math.round(
              (downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite) * 100
            );
            updateState(itemType, itemId, { progress });
          }
        );

        const downloadResult = await downloadResumable.downloadAsync();
        
        if (!downloadResult) {
          throw new Error('Download failed');
        }

        // Step 3: Read downloaded file
        const fileContent = await FileSystem.readAsStringAsync(downloadResult.uri, {
          encoding: (FileSystem as any).EncodingType.Base64,
        });

        // Step 4: Encrypt file
        const encrypted = await encryptionService.encryptBuffer(
          fileContent,
          user.sessionToken,
          user.deviceId || 'default'
        );

        // Step 5: Generate UUID filename
        const { randomUUID } = await import('expo-crypto');
        const uuid = randomUUID();
        const encryptedFilePath = `${(FileSystem as any).documentDirectory}${uuid}.enc`;

        // Step 6: Write encrypted file
        await FileSystem.writeAsStringAsync(encryptedFilePath, encrypted, {
          encoding: (FileSystem as any).EncodingType.UTF8,
        });

        // Step 7: Delete temp file
        await FileSystem.deleteAsync(downloadResult.uri, { idempotent: true });

        // Step 8: Record download on server
        await fetch(`${process.env.EXPO_PUBLIC_API_URL}/api/my-downloads`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${user.sessionToken}`,
            'X-User-Id': String(user.id),
          },
          body: JSON.stringify({
            itemType,
            itemId,
            localFilename: uuid,
          }),
        });

        // Step 9: Update state to downloaded
        updateState(itemType, itemId, {
          status: 'downloaded',
          progress: 100,
          localFilename: uuid,
          error: undefined,
        });
      } catch (error: any) {
        console.error('[DownloadManager] Download failed:', error);
        updateState(itemType, itemId, {
          status: 'error',
          error: error.message || 'Download failed',
        });
        throw error;
      }
    },
    [user]
  );

  const deleteDownload = useCallback(
    async (itemType: string, itemId: number) => {
      if (!user?.sessionToken) {
        throw new Error('Not authenticated');
      }

      const state = getDownloadState(itemType, itemId);
      
      if (!state.localFilename) {
        return;
      }

      try {
        // Delete local file
        const filePath = `${(FileSystem as any).documentDirectory}${state.localFilename}.enc`;
        await FileSystem.deleteAsync(filePath, { idempotent: true });

        // Delete server record
        await fetch(
          `${process.env.EXPO_PUBLIC_API_URL}/api/my-downloads/${itemType}/${itemId}`,
          {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${user.sessionToken}`,
              'X-User-Id': String(user.id),
            },
          }
        );

        // Remove from state
        setStateMap((prev) => {
          const newMap = new Map(prev);
          newMap.delete(getKey(itemType, itemId));
          return newMap;
        });
      } catch (error: any) {
        console.error('[DownloadManager] Delete failed:', error);
        
        // Mark as deletion_pending for retry
        updateState(itemType, itemId, {
          status: 'deletion_pending',
          error: error.message || 'Failed to delete',
        });
        
        throw error;
      }
    },
    [user, getDownloadState]
  );

  const getLocalUri = useCallback(
    async (itemType: string, itemId: number): Promise<string | null> => {
      if (!user?.sessionToken) {
        return null;
      }

      const state = getDownloadState(itemType, itemId);
      
      if (!state.localFilename) {
        return null;
      }

      try {
        const encryptedPath = `${(FileSystem as any).documentDirectory}${state.localFilename}.enc`;
        
        // Check if file exists
        const fileInfo = await FileSystem.getInfoAsync(encryptedPath);
        if (!fileInfo.exists) {
          return null;
        }

        // Read encrypted file
        const encrypted = await FileSystem.readAsStringAsync(encryptedPath, {
          encoding: (FileSystem as any).EncodingType.UTF8,
        });

        // Decrypt to temp file in cache directory
        const tempPath = `${(FileSystem as any).cacheDirectory}decrypted_${state.localFilename}`;
        
        await encryptionService.decryptToUri(
          encrypted,
          tempPath,
          user.sessionToken,
          user.deviceId || 'default'
        );

        return tempPath;
      } catch (error) {
        console.error('[DownloadManager] Failed to get local URI:', error);
        return null;
      }
    },
    [user, getDownloadState]
  );

  const getTotalStorageBytes = useCallback(async (): Promise<number> => {
    try {
      const dirInfo = await FileSystem.readDirectoryAsync((FileSystem as any).documentDirectory || '');
      const encFiles = dirInfo.filter((name) => name.endsWith('.enc'));
      
      let totalBytes = 0;
      for (const file of encFiles) {
        const fileInfo = await FileSystem.getInfoAsync(
          `${(FileSystem as any).documentDirectory}${file}`
        );
        if (fileInfo.exists && 'size' in fileInfo) {
          totalBytes += fileInfo.size;
        }
      }
      
      return totalBytes;
    } catch (error) {
      console.error('[DownloadManager] Failed to calculate storage:', error);
      return 0;
    }
  }, []);

  const runForegroundAccessCheck = useCallback(async () => {
    if (!user?.sessionToken) {
      return;
    }

    try {
      // Fetch current downloads from server
      const response = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/api/my-downloads`, {
        headers: {
          Authorization: `Bearer ${user.sessionToken}`,
          'X-User-Id': String(user.id),
        },
      });

      if (!response.ok) {
        return;
      }

      const data = await response.json();
      const serverItems = new Set<string>();

      // Build set of valid items from server
      [...(data.lectures || []), ...(data.materials || [])].forEach((item: any) => {
        serverItems.add(getKey(item.type, item.id));
      });

      // Check local state against server
      const localKeys = Array.from(stateMap.keys());
      
      for (const key of localKeys) {
        if (!serverItems.has(key)) {
          // Item not in server response - delete it
          const [itemType, itemIdStr] = key.split(':');
          const itemId = parseInt(itemIdStr);
          
          try {
            await deleteDownload(itemType, itemId);
          } catch (error) {
            console.error('[DownloadManager] Auto-delete failed for', key, error);
            // Will retry on next foreground check
          }
        }
      }
    } catch (error) {
      console.error('[DownloadManager] Foreground check failed:', error);
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
