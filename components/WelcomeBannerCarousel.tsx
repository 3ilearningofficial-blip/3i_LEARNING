import React, { useRef, useState, useCallback, useEffect } from "react";
import {
  View,
  ScrollView,
  Pressable,
  StyleSheet,
  Platform,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  WELCOME_BANNER_ASPECT,
  WELCOME_BANNER_DESKTOP_ASPECT,
  WELCOME_BANNER_MAX_HEIGHT,
  WELCOME_BANNER_WIDE_BREAKPOINT,
  WELCOME_BANNER_AUTO_ADVANCE_MS,
} from "@/constants/courseBanner";
import type { WelcomeBannerSlideUrls } from "@/lib/welcome-banners";
import Colors from "@/constants/colors";

type Props = {
  slides: WelcomeBannerSlideUrls[];
  resolveUrl?: (raw: string) => string;
  backgroundColor?: string;
};

const MANUAL_PAUSE_MS = 4000;

export function WelcomeBannerSlide({
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
            objectFit: "cover",
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
      <Image source={{ uri }} style={styles.slideImage} resizeMode="cover" />
    </View>
  );
}

function resolveSlideUri(
  slide: WelcomeBannerSlideUrls,
  isWide: boolean,
  resolveUrl?: (raw: string) => string,
): string {
  const pick = isWide
    ? slide.desktop.trim() || slide.mobile.trim()
    : slide.mobile.trim() || slide.desktop.trim();
  const raw = pick.trim();
  return resolveUrl ? resolveUrl(raw) : raw;
}

export default function WelcomeBannerCarousel({
  slides,
  resolveUrl,
  backgroundColor = "#F8FAFC",
}: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const pauseAutoUntilRef = useRef(0);
  const isDraggingRef = useRef(false);
  const activeIndexRef = useRef(0);

  const isWide = screenWidth >= WELCOME_BANNER_WIDE_BREAKPOINT;
  const frameAspect = isWide ? WELCOME_BANNER_DESKTOP_ASPECT : WELCOME_BANNER_ASPECT;
  const isPhoneWeb = Platform.OS === "web" && !isWide;

  const resolvedSlides = slides
    .map((slide) => ({
      key: `${slide.mobile}|${slide.desktop}`,
      uri: resolveSlideUri(slide, isWide, resolveUrl),
    }))
    .filter((s) => s.uri);

  const slideWidth = screenWidth;
  const naturalHeight = slideWidth / frameAspect;
  const slideHeight = isWide
    ? Math.min(naturalHeight, WELCOME_BANNER_MAX_HEIGHT)
    : naturalHeight;
  const slideCount = resolvedSlides.length;

  const wrapIndex = useCallback(
    (index: number) => {
      if (slideCount <= 0) return 0;
      return ((index % slideCount) + slideCount) % slideCount;
    },
    [slideCount],
  );

  const scrollToIndex = useCallback(
    (index: number, animated = true) => {
      if (slideCount <= 0) return;
      const next = wrapIndex(index);
      scrollRef.current?.scrollTo({ x: next * slideWidth, animated });
      activeIndexRef.current = next;
      setActiveIndex(next);
    },
    [slideCount, slideWidth, wrapIndex],
  );

  const pauseAutoAdvance = useCallback(() => {
    pauseAutoUntilRef.current = Date.now() + MANUAL_PAUSE_MS;
  }, []);

  const syncIndexFromOffset = useCallback(
    (x: number) => {
      if (slideCount <= 0) return;
      const i = wrapIndex(Math.round(x / Math.max(slideWidth, 1)));
      if (i !== activeIndexRef.current) {
        activeIndexRef.current = i;
        setActiveIndex(i);
      }
    },
    [slideCount, slideWidth, wrapIndex],
  );

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    syncIndexFromOffset(e.nativeEvent.contentOffset.x);
  };

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    isDraggingRef.current = false;
    syncIndexFromOffset(e.nativeEvent.contentOffset.x);
  };

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    if (slideCount <= 1) return;
    const timer = setInterval(() => {
      if (isDraggingRef.current) return;
      if (Date.now() < pauseAutoUntilRef.current) return;
      scrollToIndex(activeIndexRef.current + 1);
    }, WELCOME_BANNER_AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [slideCount, scrollToIndex]);

  if (resolvedSlides.length === 0) return null;

  const showControls = resolvedSlides.length > 1;
  const showArrows = showControls && !isPhoneWeb;

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
          onScroll={onScroll}
          onMomentumScrollEnd={onScrollEnd}
          onScrollBeginDrag={() => {
            isDraggingRef.current = true;
            pauseAutoAdvance();
          }}
          onScrollEndDrag={onScrollEnd}
          scrollEventThrottle={16}
        >
          {resolvedSlides.map((slide, i) => (
            <WelcomeBannerSlide
              key={`${slide.key}-${i}`}
              uri={slide.uri}
              width={slideWidth}
              height={slideHeight}
              backgroundColor={backgroundColor}
            />
          ))}
        </ScrollView>

        {showArrows ? (
          <>
            <Pressable
              style={[styles.arrowBtn, styles.arrowLeft]}
              onPress={() => {
                pauseAutoAdvance();
                scrollToIndex(activeIndex - 1);
              }}
              accessibilityLabel="Previous banner"
            >
              <Ionicons name="chevron-back" size={22} color={Colors.light.text} />
            </Pressable>
            <Pressable
              style={[styles.arrowBtn, styles.arrowRight]}
              onPress={() => {
                pauseAutoAdvance();
                scrollToIndex(activeIndex + 1);
              }}
              accessibilityLabel="Next banner"
            >
              <Ionicons name="chevron-forward" size={22} color={Colors.light.text} />
            </Pressable>
          </>
        ) : null}
      </View>

      {showControls ? (
        <View style={[styles.dotsRow, isWide && styles.dotsRowWide]}>
          {resolvedSlides.map((_, i) => (
            <Pressable
              key={`dot-${i}`}
              onPress={() => {
                pauseAutoAdvance();
                scrollToIndex(i);
              }}
              hitSlop={8}
              accessibilityLabel={`Go to banner ${i + 1}`}
            >
              <View style={[styles.dot, i === activeIndex ? styles.dotActive : null]} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%" },
  carouselFrame: { position: "relative", overflow: "hidden" },
  slide: { overflow: "hidden" },
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
