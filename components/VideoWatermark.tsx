import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions } from 'react-native';
import { useAuth } from '@/context/AuthContext';

interface VideoWatermarkProps {
  isPlaying?: boolean;
}

export function VideoWatermark({ isPlaying = true }: VideoWatermarkProps) {
  const { user } = useAuth();
  const [position, setPosition] = useState({ top: 20, left: 20 });
  const [opacity] = useState(new Animated.Value(0));
  const [isVisible, setIsVisible] = useState(false);

  // Get screen dimensions for random positioning
  const screenWidth = Dimensions.get('window').width;
  const screenHeight = Dimensions.get('window').height;

  // Generate random position within safe bounds
  const getRandomPosition = () => {
    const watermarkWidth = 200;
    const watermarkHeight = 40;
    const padding = 20;

    return {
      top: Math.random() * (screenHeight - watermarkHeight - padding * 2) + padding,
      left: Math.random() * (screenWidth - watermarkWidth - padding * 2) + padding,
    };
  };

  useEffect(() => {
    if (!isPlaying || !user?.phone) {
      setIsVisible(false);
      return;
    }

    // Show watermark every 3 seconds
    const interval = setInterval(() => {
      // Generate new random position
      setPosition(getRandomPosition());
      setIsVisible(true);

      // Fade in
      Animated.timing(opacity, {
        toValue: 0.6,
        duration: 300,
        useNativeDriver: true,
      }).start();

      // Fade out after 2 seconds
      setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start(() => {
          setIsVisible(false);
        });
      }, 2000);
    }, 3000);

    return () => clearInterval(interval);
  }, [isPlaying, user?.phone]);

  if (!user?.phone || !isVisible) {
    return null;
  }

  // Format phone number for display
  const formattedPhone = user.phone.replace(/(\d{5})(\d{5})/, '$1 $2');

  return (
    <Animated.View
      style={[
        styles.watermark,
        {
          top: position.top,
          left: position.left,
          opacity: opacity,
        },
      ]}
      pointerEvents="none"
    >
      <View style={styles.watermarkContent}>
        <Text style={styles.watermarkText}>{formattedPhone}</Text>
        <Text style={styles.watermarkSubtext}>{user.name}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  watermark: {
    position: 'absolute',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    zIndex: 9999,
  },
  watermarkContent: {
    alignItems: 'center',
  },
  watermarkText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1,
  },
  watermarkSubtext: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
});
