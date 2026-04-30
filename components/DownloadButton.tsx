import React, { useState } from 'react';
import { TouchableOpacity, View, Text, ActivityIndicator, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDownloadManager } from '../lib/useDownloadManager';
import { useAuth } from '../context/AuthContext';
import { getApiUrl } from '../lib/query-client';

interface DownloadButtonProps {
  itemType: 'lecture' | 'material';
  itemId: number;
  downloadAllowed: boolean;
  isEnrolled: boolean;
}

// Web-only download with progress
function WebDownloadButton({ itemType, itemId }: { itemType: string; itemId: number }) {
  const { user } = useAuth();
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'idle' | 'downloading' | 'done' | 'error'>('idle');
  const unwrapPayload = (payload: any) => {
    if (payload && typeof payload === 'object' && typeof payload.success === 'boolean') {
      if (payload.success === false) {
        throw new Error(payload.error || payload.message || 'Request failed');
      }
      if ('data' in payload) return payload.data;
    }
    return payload;
  };

  const handleWebDownload = async () => {
    if (status === 'downloading') return;
    setStatus('downloading');
    setProgress(0);

    try {
      const apiUrl = getApiUrl();

      // Step 1: Get single-use download token
      const tokenRes = await fetch(`${apiUrl}/download-url?itemType=${itemType}&itemId=${itemId}`, {
        headers: {
          Authorization: `Bearer ${user?.sessionToken}`,
        },
      });

      if (!tokenRes.ok) {
        throw new Error('Failed to get download token');
      }

      const tokenPayload = unwrapPayload(await tokenRes.json());
      const token = tokenPayload?.token;
      const downloadUrl = `${apiUrl}/download-proxy?token=${token}`;

      // Step 2: Download with XHR for progress tracking
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', downloadUrl);
        xhr.responseType = 'blob';

        xhr.onprogress = (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 100));
          } else {
            // Indeterminate — pulse between 20-80
            setProgress((prev) => (prev < 80 ? prev + 5 : 20));
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            // Step 3: Trigger browser download
            const blob = xhr.response as Blob;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            // Get filename from Content-Disposition or use default
            const disposition = xhr.getResponseHeader('Content-Disposition');
            const match = disposition?.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            a.download = match ? match[1].replace(/['"]/g, '') : `${itemType}-${itemId}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            setProgress(100);
            resolve();
          } else {
            reject(new Error(`Download failed: ${xhr.status}`));
          }
        };

        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send();
      });

      setStatus('done');
      // Reset after 3 seconds
      setTimeout(() => { setStatus('idle'); setProgress(0); }, 3000);
    } catch (err) {
      console.error('[WebDownload] Error:', err);
      setStatus('error');
      setTimeout(() => { setStatus('idle'); setProgress(0); }, 3000);
    }
  };

  if (status === 'downloading') {
    return (
      <View style={webStyles.container}>
        <View style={webStyles.progressBar}>
          <View style={[webStyles.progressFill, { width: `${progress}%` as any }]} />
        </View>
        <Text style={webStyles.progressText}>{progress}%</Text>
      </View>
    );
  }

  if (status === 'done') {
    return (
      <View style={webStyles.doneContainer}>
        <Ionicons name="checkmark-circle" size={18} color="#22C55E" />
        <Text style={webStyles.doneText}>Downloaded</Text>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <TouchableOpacity style={webStyles.errorContainer} onPress={handleWebDownload}>
        <Ionicons name="alert-circle" size={18} color="#EF4444" />
        <Text style={webStyles.errorText}>Retry</Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity style={webStyles.button} onPress={handleWebDownload}>
      <Ionicons name="download-outline" size={18} color="#3B82F6" />
      <Text style={webStyles.buttonText}>Download</Text>
    </TouchableOpacity>
  );
}

export function DownloadButton({
  itemType,
  itemId,
  downloadAllowed,
  isEnrolled,
}: DownloadButtonProps) {
  const { getDownloadState, startDownload } = useDownloadManager();
  const state = getDownloadState(itemType, itemId);

  // Guard: only show if download is allowed and user is enrolled
  if (!downloadAllowed || !isEnrolled) {
    return null;
  }

  // Web: use browser download with progress
  if (Platform.OS === 'web') {
    return <WebDownloadButton itemType={itemType} itemId={itemId} />;
  }

  // Native: use encrypted offline download
  const handlePress = async () => {
    if (state.status === 'downloading') return;
    try {
      await startDownload(itemType, itemId);
    } catch (error) {
      console.error('Download failed:', error);
    }
  };

  if (state.status === 'downloading') {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="small" color="#3B82F6" />
        <Text style={styles.progressText}>{state.progress}%</Text>
      </View>
    );
  }

  if (state.status === 'downloaded') {
    return (
      <View style={styles.container}>
        <Ionicons name="checkmark-circle" size={18} color="#22C55E" />
        <Text style={styles.downloadedText}>Downloaded</Text>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <TouchableOpacity style={styles.container} onPress={handlePress}>
        <Ionicons name="alert-circle" size={18} color="#EF4444" />
        <Text style={styles.errorText}>Retry</Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity style={styles.container} onPress={handlePress}>
      <Ionicons name="download-outline" size={18} color="#3B82F6" />
      <Text style={styles.buttonText}>Download</Text>
    </TouchableOpacity>
  );
}

// Native styles
const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  progressText: {
    fontSize: 12,
    color: '#3B82F6',
    fontWeight: '600',
  },
  downloadedText: {
    fontSize: 13,
    color: '#22C55E',
    fontWeight: '600',
  },
  errorText: {
    fontSize: 13,
    color: '#EF4444',
    fontWeight: '600',
  },
  buttonText: {
    fontSize: 13,
    color: '#3B82F6',
    fontWeight: '600',
  },
});

// Web styles
const webStyles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  buttonText: {
    fontSize: 13,
    color: '#3B82F6',
    fontWeight: '600',
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 120,
  },
  progressBar: {
    flex: 1,
    height: 6,
    backgroundColor: '#E5E7EB',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
    backgroundColor: '#3B82F6',
    borderRadius: 3,
  },
  progressText: {
    fontSize: 12,
    color: '#3B82F6',
    fontWeight: '600',
    minWidth: 32,
  },
  doneContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  doneText: {
    fontSize: 13,
    color: '#22C55E',
    fontWeight: '600',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  errorText: {
    fontSize: 13,
    color: '#EF4444',
    fontWeight: '600',
  },
});
