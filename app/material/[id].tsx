import React, { useState } from "react";
import {
  View, Text, StyleSheet, Pressable, Platform,
  ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";

function getIconName(fileType: string): keyof typeof Ionicons.glyphMap {
  switch (fileType) {
    case "pdf": return "document-text";
    case "video": return "videocam";
    case "doc": return "document";
    default: return "link";
  }
}

function getGoogleDriveFileId(url: string): string | null {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  const idParam = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParam) return idParam[1];
  return null;
}

function isGoogleDriveUrl(url: string): boolean {
  return url.includes("drive.google.com") || url.includes("docs.google.com");
}

function buildGoogleDriveViewerHtml(fileId: string): string {
  const previewUrl = `https://drive.google.com/file/d/${fileId}/preview`;
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; background: #2a2a2a; overflow: hidden; }
iframe { width: 100%; height: 100%; border: none; }
</style>
</head><body>
<iframe src="${previewUrl}" allow="autoplay" allowfullscreen></iframe>
</body></html>`;
}

function buildPdfViewerHtml(fileUrl: string, proxyBaseUrl: string): string {
  const proxyUrl = `${proxyBaseUrl}/api/pdf-proxy?url=${encodeURIComponent(fileUrl)}`;
  const gviewUrl = `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(fileUrl)}`;
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; background: #2a2a2a; overflow: auto; font-family: -apple-system, sans-serif; -webkit-overflow-scrolling: touch; }
#viewer { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 8px 0; }
.page-canvas { display: block; max-width: 100%; height: auto; box-shadow: 0 2px 8px rgba(0,0,0,0.3); background: #fff; }
.loading { position: fixed; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 16px; color: #ccc; background: #2a2a2a; z-index: 10; }
.spinner { width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.1); border-top: 3px solid #1A56DB; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.fallback-frame { position: fixed; top: 0; left: 0; width: 100%; height: 100%; border: none; z-index: 5; }
.error { position: fixed; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 16px; color: #ccc; padding: 32px; text-align: center; background: #2a2a2a; z-index: 20; }
.error h3 { font-size: 18px; color: #fff; }
.error p { font-size: 13px; color: #999; line-height: 1.5; }
.error a { display: inline-block; color: #fff; background: #1A56DB; text-decoration: none; padding: 12px 28px; border-radius: 10px; font-size: 14px; font-weight: 600; margin-top: 4px; }
.page-info { color: #888; font-size: 12px; padding: 4px 0; }
</style>
</head><body>
<div id="loading" class="loading"><div class="spinner"></div><p>Loading PDF...</p></div>
<div id="viewer"></div>
<script>
(function() {
  var directUrl = ${JSON.stringify(fileUrl)};
  var proxyUrl = ${JSON.stringify(proxyUrl)};
  var gviewUrl = ${JSON.stringify(gviewUrl)};
  
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  function renderWithPdfJs(url) {
    return pdfjsLib.getDocument(url).promise.then(function(pdf) {
      document.getElementById('loading').style.display = 'none';
      var viewer = document.getElementById('viewer');
      viewer.innerHTML = '';
      var numPages = pdf.numPages;

      function renderPage(num) {
        pdf.getPage(num).then(function(page) {
          var containerWidth = Math.min(window.innerWidth - 16, 900);
          var viewport = page.getViewport({ scale: 1 });
          var scale = containerWidth / viewport.width;
          var scaledViewport = page.getViewport({ scale: scale * 2 });

          var canvas = document.createElement('canvas');
          canvas.className = 'page-canvas';
          canvas.width = scaledViewport.width;
          canvas.height = scaledViewport.height;
          canvas.style.width = (scaledViewport.width / 2) + 'px';
          canvas.style.height = (scaledViewport.height / 2) + 'px';
          viewer.appendChild(canvas);

          var info = document.createElement('div');
          info.className = 'page-info';
          info.textContent = 'Page ' + num + ' of ' + numPages;
          viewer.appendChild(info);

          page.render({ canvasContext: canvas.getContext('2d'), viewport: scaledViewport }).promise.then(function() {
            if (num < numPages) renderPage(num + 1);
          });
        });
      }
      renderPage(1);
    });
  }

  function showGoogleViewer() {
    document.getElementById('loading').style.display = 'none';
    var iframe = document.createElement('iframe');
    iframe.className = 'fallback-frame';
    iframe.src = gviewUrl;
    document.body.appendChild(iframe);
  }

  function showError() {
    document.getElementById('loading').style.display = 'none';
    var d = document.createElement('div');
    d.className = 'error';
    d.innerHTML = '<h3>Unable to preview</h3><p>This PDF cannot be previewed inline.</p><a href="'+directUrl+'" target="_blank">Open PDF Directly</a>';
    document.body.appendChild(d);
  }

  renderWithPdfJs(directUrl)
    .catch(function() {
      return renderWithPdfJs(proxyUrl);
    })
    .catch(function() {
      showGoogleViewer();
      setTimeout(function() {
        var frames = document.querySelectorAll('.fallback-frame');
        if (frames.length > 0) {
          try {
            var doc = frames[0].contentDocument;
            if (doc && doc.body && doc.body.innerText && doc.body.innerText.indexOf('No preview') >= 0) {
              frames[0].remove();
              showError();
            }
          } catch(e) {}
        }
      }, 10000);
    });
})();
</script>
</body></html>`;
}

export default function MaterialViewerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const { isAdmin } = useAuth();

  const { data: material, isError: fetchError } = useQuery<{
    id: number; title: string; file_url: string; file_type: string;
    description: string; download_allowed: boolean; is_free: boolean;
    section_title: string | null;
  }>({
    queryKey: ["/api/study-materials", id],
    enabled: !!id,
  });

  const isPdf = material && (material.file_type === "pdf" || material.file_url?.toLowerCase().endsWith(".pdf"));
  const isGDrive = material && isGoogleDriveUrl(material.file_url || "");
  const gDriveFileId = material ? getGoogleDriveFileId(material.file_url || "") : null;
  const apiBaseUrl = getApiUrl();

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: topPadding + 8 }]}>
        <View style={styles.headerRow}>
          <Pressable
            style={styles.backBtn}
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.back();
            }}
          >
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </Pressable>
          <View style={styles.headerInfo}>
            <Text style={styles.headerTitle} numberOfLines={1}>{material?.title || "Study Material"}</Text>
            {material && (
              <View style={styles.headerMeta}>
                <Ionicons name={getIconName(material.file_type)} size={12} color="rgba(255,255,255,0.6)" />
                <Text style={styles.headerMetaText}>{material.file_type?.toUpperCase() || "FILE"}</Text>
                {material.is_free && (
                  <View style={styles.freeBadge}><Text style={styles.freeBadgeText}>FREE</Text></View>
                )}
              </View>
            )}
          </View>
          <View style={styles.headerActions}>
            {isAdmin && material?.download_allowed && (
              <Pressable
                style={styles.actionBtn}
                onPress={() => {
                  if (Platform.OS === "web") {
                    window.open(material.file_url, "_blank");
                  }
                }}
              >
                <Ionicons name="download-outline" size={20} color="#fff" />
              </Pressable>
            )}
          </View>
        </View>
      </LinearGradient>

      <View style={styles.content}>
        {fetchError ? (
          <View style={styles.centered}>
            <Ionicons name="alert-circle-outline" size={48} color={Colors.light.accent} />
            <Text style={styles.errorTitle}>Failed to load material</Text>
            <Text style={styles.errorSub}>Please check your connection and try again.</Text>
            <Pressable style={styles.retryBtn} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={16} color="#fff" />
              <Text style={styles.retryBtnText}>Go Back</Text>
            </Pressable>
          </View>
        ) : !material ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={Colors.light.primary} />
            <Text style={styles.loadingText}>Loading material...</Text>
          </View>
        ) : Platform.OS === "web" ? (
          <>
            {isGDrive && gDriveFileId ? (
              <iframe
                srcDoc={buildGoogleDriveViewerHtml(gDriveFileId)}
                style={{ width: "100%", height: "100%", border: "none" } as any}
                title={material.title}
                allow="autoplay"
                onLoad={() => setLoading(false)}
              />
            ) : isPdf ? (
              <iframe
                srcDoc={buildPdfViewerHtml(material.file_url, apiBaseUrl)}
                style={{ width: "100%", height: "100%", border: "none" } as any}
                title={material.title}
                onLoad={() => setLoading(false)}
              />
            ) : (
              <iframe
                src={material.file_url}
                style={{ width: "100%", height: "100%", border: "none" } as any}
                title={material.title}
                onLoad={() => setLoading(false)}
              />
            )}
            {loading && (
              <View style={styles.webLoadingOverlay}>
                <ActivityIndicator size="large" color={Colors.light.primary} />
              </View>
            )}
          </>
        ) : (
          <WebView
            source={
              isGDrive && gDriveFileId
                ? { html: buildGoogleDriveViewerHtml(gDriveFileId), baseUrl: "https://drive.google.com" }
                : isPdf
                  ? { html: buildPdfViewerHtml(material.file_url, apiBaseUrl), baseUrl: apiBaseUrl }
                  : { uri: material.file_url }
            }
            style={styles.webview}
            onLoadEnd={() => setLoading(false)}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            allowsInlineMediaPlayback
            mixedContentMode="always"
            allowsFullscreenVideo
            setSupportMultipleWindows={false}
            originWhitelist={["*"]}
            renderLoading={() => (
              <View style={styles.webviewLoading}>
                <ActivityIndicator size="large" color={Colors.light.primary} />
              </View>
            )}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: { paddingHorizontal: 16, paddingBottom: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  headerMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  headerMetaText: { fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.6)" },
  freeBadge: { backgroundColor: "#22C55E30", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  freeBadgeText: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#22C55E" },
  headerActions: { flexDirection: "row", gap: 8 },
  actionBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  content: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  loadingText: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.textMuted, marginTop: 12 },
  errorTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text, marginTop: 16 },
  errorSub: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, marginTop: 6, textAlign: "center" },
  retryBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.light.primary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 20 },
  retryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  webview: { flex: 1 },
  webviewLoading: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: Colors.light.background },
  webLoadingOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: Colors.light.background },
});
