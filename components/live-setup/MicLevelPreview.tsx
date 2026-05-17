import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";

type Props = {
  stream: MediaStream | null;
  isAudioEnabled: boolean;
};

const BAR_COUNT = 12;

export default function MicLevelPreview({ stream, isAudioEnabled }: Props) {
  const [level, setLevel] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web" || !stream || !isAudioEnabled) {
      setLevel(0);
      return;
    }

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      setLevel(0);
      return;
    }

    let cancelled = false;
    let audioContext: AudioContext | null = null;

    try {
      audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.65;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        if (cancelled) return;
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) sum += data[i];
        const avg = sum / data.length / 255;
        setLevel(avg);
        rafRef.current = requestAnimationFrame(tick);
      };

      void audioContext.resume().then(() => {
        if (!cancelled) tick();
      });
    } catch {
      setLevel(0);
    }

    return () => {
      cancelled = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      void audioContext?.close();
    };
  }, [stream, isAudioEnabled]);

  if (Platform.OS !== "web") {
    return (
      <View style={styles.placeholder}>
        <Ionicons name="mic-outline" size={20} color={Colors.light.textMuted} />
        <Text style={styles.placeholderText}>Mic check on web only</Text>
      </View>
    );
  }

  const activeBars = Math.round(level * BAR_COUNT);

  return (
    <View style={styles.wrap}>
      <View style={styles.bars}>
        {Array.from({ length: BAR_COUNT }, (_, i) => (
          <View
            key={i}
            style={[
              styles.bar,
              i < activeBars && isAudioEnabled ? styles.barActive : styles.barIdle,
            ]}
          />
        ))}
      </View>
      <Text style={styles.hint}>
        {!stream
          ? "Waiting for microphone…"
          : !isAudioEnabled
            ? "Microphone muted"
            : level < 0.02
              ? "Speak to test your mic"
              : "Microphone is working"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: 56,
    borderRadius: 8,
    backgroundColor: "#0D1B2A",
    paddingHorizontal: 10,
    paddingVertical: 8,
    justifyContent: "center",
    gap: 6,
    marginBottom: 8,
  },
  bars: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 3,
    height: 22,
  },
  bar: {
    width: 5,
    borderRadius: 2,
    minHeight: 4,
  },
  barIdle: { height: 6, backgroundColor: "rgba(255,255,255,0.15)" },
  barActive: { height: 22, backgroundColor: "#22C55E" },
  hint: { fontSize: 10, color: "rgba(255,255,255,0.55)", textAlign: "center" },
  placeholder: {
    height: 56,
    borderRadius: 8,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    marginBottom: 8,
  },
  placeholderText: { fontSize: 11, color: Colors.light.textMuted },
});
