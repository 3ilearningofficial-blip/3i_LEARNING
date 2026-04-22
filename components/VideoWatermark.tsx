import React, { useEffect, useState } from 'react';
import { Text, Animated, Dimensions } from 'react-native';
import { useAuth } from '@/context/AuthContext';

interface VideoWatermarkProps {
  isPlaying?: boolean;
}

export function VideoWatermark({ isPlaying = true }: VideoWatermarkProps) {
  const { user } = useAuth();
  const [position, setPosition] = useState({ top: 20, left: 20 });
  const [opacity] = useState(new Animated.Value(0));
  const [isVisible, setIsVisible] = useState(false);

  const screenWidth = Dimensions.get('window').width;
  const screenHeight = Dimensions.get('window').height;

  const getRandomPosition = () => {
    const watermarkWidth = 130;
    const watermarkHeight = 20;
    const padding = 16;
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

    const interval = setInterval(() => {
      setPosition(getRandomPosition());
      setIsVisible(true);

      Animated.timing(opacity, {
        toValue: 0.55,
        duration: 300,
        useNativeDriver: true,
      }).start();

      setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start(() => setIsVisible(false));
      }, 2000);
    }, 3000);

    return () => clearInterval(interval);
  }, [isPlaying, user?.phone]);

  if (!user?.phone || !isVisible) return null;

  const formattedPhone = user.phone.replace(/(\d{5})(\d{5})/, '$1 $2');

  return (
    <Animated.Text
      style={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        opacity: opacity,
        color: 'rgba(255,255,255,0.85)',
        fontSize: 11,
        fontFamily: 'Inter_600SemiBold',
        letterSpacing: 1.5,
        zIndex: 9999,
        pointerEvents: 'none' as any,
      }}
    >
      {formattedPhone}
    </Animated.Text>
  );
}
