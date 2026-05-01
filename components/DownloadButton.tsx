import React, { useState } from 'react';
import { TouchableOpacity, View, Text, ActivityIndicator, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDownloadManager } from '../lib/useDownloadManager';
import { useAuth } from '../context/AuthContext';
import { useWebDownloadJobs } from '../context/WebDownloadJobsContext';

interface DownloadButtonProps {
  itemType: 'lecture' | 'material';
  itemId: number;
  downloadAllowed: boolean;
  isEnrolled: boolean;
  /** Course / upload title — used as display name & web in-app library */
  title?: string;
  /** e.g. pdf, video — for friendly filename/metadata */
  fileType?: string;
}

// Web: save into IndexedDB + server my-downloads; progress from global context + HUD (survives tab switch)
function WebDownloadButton({
  itemType,
  itemId,
  title,
  fileType,
}: {
  itemType: string;
  itemId: number;
  title: string;
  fileType: string;
}) {
  const { user } = useAuth();
  const { getJob, startWebDownload } = useWebDownloadJobs();
  const [tapError, setTapError] = useState<string | null>(null);

  const job = getJob(itemType, itemId);
  const status = job?.status;
  const progress = job?.progress ?? 0;

  const handleWebDownload = async () => {
    if (status === 'downloading') return;
    setTapError(null);
    try {
      await startWebDownload({
        itemType: itemType as 'lecture' | 'material',
        itemId,
        title: title.trim() || 'Download',
        fileType,
        bearerFallback: user?.sessionToken,
      });
    } catch (err: unknown) {
      console.error('[WebDownload] Error:', err);
      setTapError(err instanceof Error ? err.message : 'Download failed');
    }
  };

  if (status === 'downloading') {
    return (
      <View style={webStyles.container}>
        <View style={webStyles.progressBar}>
          <View style={[webStyles.progressFill, { width: `${progress}%` as `${number}%` }]} />
        </View>
        <Text style={webStyles.progressText}>{progress}%</Text>
      </View>
    );
  }

  if (status === 'done') {
    return (
      <View style={webStyles.doneContainer}>
        <Ionicons name="checkmark-circle" size={18} color="#22C55E" />
        <Text style={webStyles.doneText}>Saved to My Downloads</Text>
      </View>
    );
  }

  if (status === 'error' || tapError) {
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
  title = 'Download',
  fileType = 'file',
}: DownloadButtonProps) {
  const { getDownloadState, startDownload } = useDownloadManager();
  const state = getDownloadState(itemType, itemId);

  // Guard: only show if download is allowed and user is enrolled
  if (!downloadAllowed || !isEnrolled) {
    return null;
  }

  // Web: in-app library (IndexedDB) + shared job state / HUD
  if (Platform.OS === 'web') {
    return (
      <WebDownloadButton
        itemType={itemType}
        itemId={itemId}
        title={title}
        fileType={fileType}
      />
    );
  }

  // Native: encrypted offline download
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
    maxWidth: 200,
  },
  doneText: {
    fontSize: 11,
    color: '#22C55E',
    fontWeight: '600',
    flexShrink: 1,
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
