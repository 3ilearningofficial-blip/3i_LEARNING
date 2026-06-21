import React, { useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  Image,
  ScrollView,
  Pressable,
  StyleSheet,
  Platform,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  COURSE_BANNER_ASPECT,
  WELCOME_BANNER_MAX_HEIGHT,
  WELCOME_BANNER_WIDE_BREAKPOINT,
} from "@/constants/courseBanner";
import Colors from "@/constants/colors";

type Props = {
  urls: string[];
  resolveUrl?: (raw: string) => string;
  backgroundColor?: string;
};

function BannerSlide({
  uri,
  width,
  height,
  backgroundColor,
}: {
  uri: string;
  width: number;
  height: number;
  backgroundColor: string;
}) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return (
      <View style={[styles.slide, { width, height, backgroundColor }]}>
        {React.createElement("img", {
          src: uri,
          alt: "",
          referrerPolicy: "strict-origin-when-cross-origin",
          style: {
            width: "100%",
            height: "100%",
            display: "block",
            objectFit: "contain",
            objectPosition: "center center",
          },
          loading: "lazy",
          decoding: "async",
        })}
      </View>
    );
  }

  return (
    <View style={[styles.slide, { width, height, backgroundColor }]}>
      <Image source={{ uri }} style={styles.slideImage} resizeMode="contain" />
    </View>
  );
}

export default function WelcomeBannerCarousel({
  urls,
  resolveUrl,
  backgroundColor = "#F8FAFC",
}: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const slides = urls
    .map((raw) => (resolveUrl ? resolveUrl(raw) : raw).trim())
    .filter(Boolean);

  const slideWidth = screenWidth;
  const naturalHeight = slideWidth / COURSE_BANNER_ASPECT;
  const slideHeight =
    screenWidth >= WELCOME_BANNER_WIDE_BREAKPOINT
      ? Math.min(naturalHeight, WELCOME_BANNER_MAX_HEIGHT)
      : naturalHeight;
  const isWide = screenWidth >= WELCOME_BANNER_WIDE_BREAKPOINT;
  const lastIndex = slides.length - 1;

  const scrollToIndex = useCallback(
    (index: number) => {
      const next = Math.max(0, Math.min(lastIndex, index));
      scrollRef.current?.scrollTo({ x: next * slideWidth, animated: true });
      setActiveIndex(next);
    },
    [lastIndex, slideWidth],
  );

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const i = Math.round(x / Math.max(slideWidth, 1));
    setActiveIndex(Math.max(0, Math.min(lastIndex, i)));
  };

  if (slides.length === 0) return null;

  const showControls = slides.length > 1;

  return (
    <View style={styles.wrap}>
      <View style={[styles.carouselFrame, { width: slideWidth, height: slideHeight }]}>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={slideWidth}
          snapToAlignment="start"
          onMomentumScrollEnd={onScrollEnd}
          scrollEventThrottle={16}
        >
          {slides.map((uri, i) => (
            <BannerSlide
              key={`${uri}-${i}`}
              uri={uri}
              width={slideWidth}
              height={slideHeight}
              backgroundColor={backgroundColor}
            />
          ))}
        </ScrollView>

        {showControls ? (
          <>
            <Pressable
              style={[styles.arrowBtn, styles.arrowLeft, activeIndex <= 0 && styles.arrowDisabled]}
              onPress={() => scrollToIndex(activeIndex - 1)}
              disabled={activeIndex <= 0}
              accessibilityLabel="Previous banner"
            >
              <Ionicons name="chevron-back" size={22} color={activeIndex <= 0 ? "#CBD5E1" : Colors.light.text} />
            </Pressable>
            <Pressable
              style={[styles.arrowBtn, styles.arrowRight, activeIndex >= lastIndex && styles.arrowDisabled]}
              onPress={() => scrollToIndex(activeIndex + 1)}
              disabled={activeIndex >= lastIndex}
              accessibilityLabel="Next banner"
            >
              <Ionicons name="chevron-forward" size={22} color={activeIndex >= lastIndex ? "#CBD5E1" : Colors.light.text} />
            </Pressable>
          </>
        ) : null}
      </View>

      {showControls ? (
        <View style={[styles.dotsRow, isWide && styles.dotsRowWide]}>
          {slides.map((_, i) => (
            <View
              key={`dot-${i}`}
              style={[styles.dot, i === activeIndex ? styles.dotActive : null]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%" },
  carouselFrame: { position: "relative", overflow: "hidden" },
  slide: {
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  slideImage: { width: "100%", height: "100%" },
  arrowBtn: {
    position: "absolute",
    top: "50%",
    marginTop: -20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  arrowLeft: { left: 12 },
  arrowRight: { right: 12 },
  arrowDisabled: { opacity: 0.45 },
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
  },
  dotsRowWide: { paddingVertical: 6 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#CBD5E1",
  },
  dotActive: {
    backgroundColor: Colors.light.primary,
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
