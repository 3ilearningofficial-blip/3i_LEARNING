import React from 'react';
import { TouchableOpacity, View, Text, ActivityIndicator, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDownloadManager } from '../lib/useDownloadManager';

interface DownloadButtonProps {
  itemType: 'lecture' | 'material';
  itemId: number;
  downloadAllowed: boolean;
  isEnrolled: boolean;
}

export function DownloadButton({
  itemType,
  itemId,
  downloadAllowed,
  isEnrolled,
}: DownloadButtonProps) {
  const { getDownloadState, startDownload } = useDownloadManager();
  const state = getDownloadState(itemType, itemId);

  // Guard: only show on native platforms
  if (Platform.OS === 'web') {
    return null;
  }

  // Guard: only show if download is allowed and user is enrolled
  if (!downloadAllowed || !isEnrolled) {
    return null;
  }

  const handlePress = async () => {
    if (state.status === 'downloading') {
      return; // Already downloading
    }

    if (state.status === 'error') {
      // Retry on error
      try {
        await startDownload(itemType, itemId);
      } catch (error) {
        console.error('Download retry failed:', error);
      }
      return;
    }

    if (state.status === 'idle') {
      try {
        await startDownload(itemType, itemId);
      } catch (error) {
        console.error('Download failed:', error);
      }
    }
  };

  // Render based on state
  if (state.status === 'downloading') {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="small" color="#007AFF" />
        <Text style={styles.progressText}>{state.progress}%</Text>
      </View>
    );
  }

  if (state.status === 'downloaded') {
    return (
      <View style={styles.container}>
        <Ionicons name="checkmark-circle" size={24} color="#34C759" />
        <Text style={styles.downloadedText}>Downloaded</Text>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <TouchableOpacity style={styles.container} onPress={handlePress}>
        <Ionicons name="alert-circle" size={24} color="#FF3B30" />
        <Text style={styles.errorText}>Retry</Text>
      </TouchableOpacity>
    );
  }

  // Idle state - show download icon
  return (
    <TouchableOpacity style={styles.container} onPress={handlePress}>
      <Ionicons name="download-outline" size={24} color="#007AFF" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 8,
  },
  progressText: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
  },
  downloadedText: {
    fontSize: 14,
    color: '#34C759',
    fontWeight: '500',
  },
  errorText: {
    fontSize: 14,
    color: '#FF3B30',
    fontWeight: '500',
  },
});
