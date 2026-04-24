import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Platform, ActivityIndicator, Alert, Image, Linking, Modal,
} from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch, getApiUrl, apiRequest } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { useScreenProtection } from "@/lib/useScreenProtection";
import { isAndroidWeb } from "@/lib/useAndroidWebGate";
import AndroidWebGate from "@/components/AndroidWebGate";
import { useAuth } from "@/context/AuthContext";
import { WebView } from "react-native-webview";

interface Book {
  id: number;
  title: string;
  description: string;
  author: string;
  price: string;
  original_price: string;
  cover_url: string | null;
  file_url: string | null;
  is_published: boolean;
  is_hidden?: boolean;
  isPurchased?: boolean;
}

// Builds an HTML page that renders a PDF in-app using PDF.js — no download, page-limited for preview
function buildReaderHtml(fileUrl: string, title: string, isPreview: boolean) {
  const maxPages = isPreview ? 3 : 9999;
  const escapedTitle = title.replace(/'/g, "\\'").replace(/</g, "&lt;");

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-user-select:none;user-select:none}
body{background:#2b2b2b;font-family:sans-serif;color:#fff;display:flex;flex-direction:column;height:100vh;overflow:hidden}
#toolbar{background:#1a1a2e;padding:10px 14px;display:flex;align-items:center;gap:8px;flex-shrink:0;min-height:48px}
#toolbar span{font-size:14px;font-weight:700;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#toolbar small{font-size:11px;color:rgba(255,255,255,0.5);white-space:nowrap}
#canvas-container{flex:1;overflow-y:auto;overflow-x:hidden;padding:12px;display:flex;flex-direction:column;gap:10px;-webkit-overflow-scrolling:touch}
canvas{display:block;width:100%;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.5)}
#loading{text-align:center;padding:40px;color:rgba(255,255,255,0.6);font-size:14px}
#paywall{position:fixed;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(10,22,40,0.98) 25%);padding:60px 20px 30px;text-align:center;pointer-events:auto}
#paywall h3{font-size:18px;font-weight:700;margin-bottom:6px}
#paywall p{font-size:13px;color:rgba(255,255,255,0.65);margin-bottom:18px;line-height:1.5}
#paywall button{background:#1A56DB;color:#fff;border:none;border-radius:12px;padding:14px 0;font-size:15px;font-weight:700;cursor:pointer;width:100%;max-width:320px}
#paywall button:active{opacity:0.85}
</style>
</head>
<body>
<div id="toolbar">
  <span>${escapedTitle}</span>
  <small id="page-info"></small>
</div>
<div id="canvas-container"><div id="loading">Loading book...</div></div>
${isPreview ? `<div id="paywall"><h3>Preview ends here</h3><p>Purchase this book to read all pages</p><button onclick="buyNow()">Buy Now to Continue Reading</button></div>` : ""}
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script>
function buyNow(){
  if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage('buy');
  else if(window.parent) window.parent.postMessage('buy','*');
}

// Disable context menu and long-press save
document.addEventListener('contextmenu',function(e){e.preventDefault()});

pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

var MAX_PAGES=${maxPages};
var fileUrl=${JSON.stringify(fileUrl)};

async function loadPdf(){
  try{
    var loadingTask=pdfjsLib.getDocument({url:fileUrl,disableStream:true,disableAutoFetch:true});
    var pdf=await loadingTask.promise;
    var total=pdf.numPages;
    var pages=Math.min(total,MAX_PAGES);
    document.getElementById('loading').remove();
    document.getElementById('page-info').textContent=MAX_PAGES<total?'Preview: '+pages+' of '+total+' pages':total+' pages';
    var container=document.getElementById('canvas-container');
    for(var i=1;i<=pages;i++){
      var page=await pdf.getPage(i);
      var viewport=page.getViewport({scale:window.devicePixelRatio||1.5});
      var canvas=document.createElement('canvas');
      var ctx=canvas.getContext('2d');
      canvas.height=viewport.height;
      canvas.width=viewport.width;
      canvas.style.width='100%';
      container.appendChild(canvas);
      await page.render({canvasContext:ctx,viewport:viewport}).promise;
    }
  }catch(e){
    document.getElementById('loading').textContent='Failed to load book. Please try again.';
    console.error(e);
  }
}
loadPdf();
</script>
</body>
</html>`;
}

export default function StoreScreen() {
  useScreenProtection(true);
  if (isAndroidWeb()) return <AndroidWebGate />;
  const insets = useSafeAreaInsets();
  const topPadding = Platform.OS === "web" ? 16 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 16 : insets.bottom;
  const [activeTab, setActiveTab] = useState<"store" | "mybooks">("store");
  const [payingBookId, setPayingBookId] = useState<number | null>(null);
  const [paymentWebViewHtml, setPaymentWebViewHtml] = useState<string | null>(null);
  const [pendingBookId, setPendingBookId] = useState<number | null>(null);
  // Reader state
  const [readerBook, setReaderBook] = useState<Book | null>(null);
  const [readerIsPreview, setReaderIsPreview] = useState(false);
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: books = [], isLoading } = useQuery<Book[]>({
    queryKey: ["/api/books"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL("/api/books", baseUrl).toString());
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: myBooks = [], isLoading: myBooksLoading } = useQuery<Book[]>({
    queryKey: ["/api/my-books"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL("/api/my-books", baseUrl).toString());
      if (!res.ok) return [];
      return res.json();
    },
    enabled: activeTab === "mybooks",
  });

  const startPayment = async (book: Book) => {
    setPayingBookId(book.id);
    try {
      const orderRes = await apiRequest("POST", "/api/books/create-order", { bookId: book.id });
      const orderData = await orderRes.json();

      if (Platform.OS === "web") {
        if (!document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]')) {
          const s = document.createElement("script");
          s.src = "https://checkout.razorpay.com/v1/checkout.js";
          document.head.appendChild(s);
          await new Promise((resolve) => { s.onload = resolve; });
        }
        const options = {
          key: orderData.keyId, amount: orderData.amount, currency: orderData.currency,
          name: "3i Learning", description: `Purchase: ${orderData.bookTitle}`,
          order_id: orderData.orderId,
          handler: async (response: any) => {
            try {
              await apiRequest("POST", "/api/books/verify-payment", {
                bookId: book.id,
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              });
              qc.invalidateQueries({ queryKey: ["/api/my-books"] });
              qc.invalidateQueries({ queryKey: ["/api/books"] });
              Alert.alert("Success!", `"${book.title}" purchased! Go to My Books to read it.`);
            } catch {
              Alert.alert("Error", "Payment received but activation failed. Contact support.");
            } finally {
              setPayingBookId(null);
            }
          },
          prefill: { contact: user?.phone ? `+91${user.phone}` : "" },
          theme: { color: "#1A56DB" },
          modal: {
            ondismiss: () => {
              setPayingBookId(null);
            },
          },
        };
        const rzp = new (window as any).Razorpay(options);
        rzp.open();
      } else {
        const checkoutHtml = `<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1.0">
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<style>body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#0A1628;font-family:sans-serif;color:#fff;}
.loading{text-align:center}.spinner{border:3px solid rgba(255,255,255,0.2);border-top:3px solid #1A56DB;border-radius:50%;width:40px;height:40px;animation:spin 0.8s linear infinite;margin:0 auto 16px}
@keyframes spin{to{transform:rotate(360deg)}}</style>
</head><body>
<div class="loading"><div class="spinner"></div><p>Opening payment...</p></div>
<script>
var options={key:"${orderData.keyId}",amount:${orderData.amount},currency:"${orderData.currency}",name:"3i Learning",
description:"Purchase: ${(orderData.bookTitle||book.title).replace(/"/g,'\\"')}",order_id:"${orderData.orderId}",
handler:function(r){window.ReactNativeWebView.postMessage(JSON.stringify({type:"payment_success",razorpay_order_id:r.razorpay_order_id,razorpay_payment_id:r.razorpay_payment_id,razorpay_signature:r.razorpay_signature}))},
prefill:{contact:"${user?.phone?`+91${user.phone}`:''}"},theme:{color:"#1A56DB"},
modal:{ondismiss:function(){window.ReactNativeWebView.postMessage(JSON.stringify({type:"payment_dismissed"}))}}};
setTimeout(function(){var rzp=new Razorpay(options);rzp.on("payment.failed",function(resp){window.ReactNativeWebView.postMessage(JSON.stringify({type:"payment_failed",error:resp.error.description}))});rzp.open()},0);
</script></body></html>`;
        setPendingBookId(book.id);
        setPaymentWebViewHtml(checkoutHtml);
      }
    } catch (err: any) {
      setPayingBookId(null);
      const msg = (err?.message || "").replace(/^\d+:\s*/, "").trim();
      if (msg.toLowerCase().includes("already purchased")) {
        Alert.alert("Already Purchased", "You already own this book.");
        qc.invalidateQueries({ queryKey: ["/api/my-books"] });
      } else {
        Alert.alert("Payment Error", msg || "Failed to start payment. Please try again.");
      }
    }
  };

  const handleBuy = (book: Book) => {
    if (!user) { router.push("/(auth)/login"); return; }
    if (payingBookId) return;
    apiRequest("POST", "/api/books/track-click", { bookId: book.id }).catch(() => {});
    startPayment(book);
  };

  const openReader = (book: Book, preview: boolean) => {
    if (!book.file_url) {
      Alert.alert("Not Available", "This book's file is not available yet.");
      return;
    }
    // Both web and mobile use the in-app reader for paid books
    setReaderBook(book);
    setReaderIsPreview(preview);
  };

  const handleDownload = (book: Book) => {
    // Only free books can be downloaded
    if (!book.file_url) { Alert.alert("Not Available", "No file available."); return; }
    if (Platform.OS === "web") {
      window.open(book.file_url, "_blank");
    } else {
      Linking.openURL(book.file_url).catch(() => Alert.alert("Error", "Could not open file."));
    }
  };

  const displayBooks = activeTab === "store" ? books : myBooks;
  const loading = activeTab === "store" ? isLoading : myBooksLoading;

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: topPadding + 8 }]}>
        <View style={styles.headerRow}>
          <Pressable style={styles.backBtn} onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/profile" as any);
          }}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Book Store</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={styles.tabs}>
          <Pressable style={[styles.tab, activeTab === "store" && styles.tabActive]} onPress={() => setActiveTab("store")}>
            <Ionicons name="storefront-outline" size={16} color={activeTab === "store" ? Colors.light.primary : "rgba(255,255,255,0.6)"} />
            <Text style={[styles.tabText, activeTab === "store" && styles.tabTextActive]}>All Books</Text>
          </Pressable>
          <Pressable style={[styles.tab, activeTab === "mybooks" && styles.tabActive]} onPress={() => setActiveTab("mybooks")}>
            <Ionicons name="library-outline" size={16} color={activeTab === "mybooks" ? Colors.light.primary : "rgba(255,255,255,0.6)"} />
            <Text style={[styles.tabText, activeTab === "mybooks" && styles.tabTextActive]}>My Books</Text>
          </Pressable>
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPadding + 32 }]}>
        {loading ? (
          <ActivityIndicator size="large" color={Colors.light.primary} style={{ marginTop: 40 }} />
        ) : displayBooks.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="book-outline" size={48} color={Colors.light.textMuted} />
            <Text style={styles.emptyTitle}>{activeTab === "store" ? "No books available yet" : "No purchased books"}</Text>
            <Text style={styles.emptySub}>{activeTab === "store" ? "Check back soon for new books" : "Browse the store to find books"}</Text>
          </View>
        ) : (
          displayBooks.map((book) => {
            const isPurchased = book.isPurchased || activeTab === "mybooks";
            const isFree = parseFloat(book.price) === 0;
            const hasFile = !!book.file_url;
            return (
              <View key={book.id} style={styles.bookCard}>
                {book.cover_url ? (
                  <Image source={{ uri: book.cover_url }} style={styles.bookCover} resizeMode="cover" />
                ) : (
                  <View style={styles.bookCoverPlaceholder}>
                    <Ionicons name="book" size={32} color={Colors.light.primary} />
                  </View>
                )}
                <View style={styles.bookInfo}>
                  <Text style={styles.bookTitle}>{book.title}</Text>
                  {book.author ? <Text style={styles.bookAuthor}>by {book.author}</Text> : null}
                  {book.description ? <Text style={styles.bookDesc} numberOfLines={2}>{book.description}</Text> : null}
                  <View style={styles.bookFooter}>
                    {isFree ? (
                      <Text style={styles.bookPriceFree}>Free</Text>
                    ) : (
                      <View style={styles.priceRow}>
                        <Text style={styles.bookPrice}>₹{parseFloat(book.price).toFixed(0)}</Text>
                        {parseFloat(book.original_price) > parseFloat(book.price) && (
                          <Text style={styles.bookOriginalPrice}>₹{parseFloat(book.original_price).toFixed(0)}</Text>
                        )}
                      </View>
                    )}
                    <View style={{ flexDirection: "row", gap: 6 }}>
                      {/* Preview button — unpurchased paid books with a file */}
                      {!isPurchased && !isFree && hasFile && (
                        <Pressable style={styles.previewBtn} onPress={() => openReader(book, true)}>
                          <Ionicons name="eye-outline" size={13} color={Colors.light.primary} />
                          <Text style={styles.previewBtnText}>Preview</Text>
                        </Pressable>
                      )}
                      {/* Action button */}
                      {isPurchased ? (
                        // Paid + purchased → read only inside app, no download
                        <Pressable style={styles.readBtn} onPress={() => openReader(book, false)}>
                          <Ionicons name="book-outline" size={14} color="#fff" />
                          <Text style={styles.readBtnText}>Read</Text>
                        </Pressable>
                      ) : isFree ? (
                        // Free → read inside app + download allowed
                        <View style={{ flexDirection: "row", gap: 6 }}>
                          <Pressable style={styles.readBtn} onPress={() => openReader(book, false)}>
                            <Ionicons name="book-outline" size={14} color="#fff" />
                            <Text style={styles.readBtnText}>Read</Text>
                          </Pressable>
                          {hasFile && (
                            <Pressable style={[styles.readBtn, { backgroundColor: "#22C55E" }]} onPress={() => handleDownload(book)}>
                              <Ionicons name="download-outline" size={14} color="#fff" />
                              <Text style={styles.readBtnText}>Save</Text>
                            </Pressable>
                          )}
                        </View>
                      ) : (
                        // Paid + not purchased → Buy Now
                        <Pressable style={[styles.buyBtn, payingBookId === book.id && { opacity: 0.6 }]} onPress={() => handleBuy(book)} disabled={!!payingBookId}>
                          {payingBookId === book.id
                            ? <ActivityIndicator size="small" color="#fff" />
                            : <><Ionicons name="cart-outline" size={14} color="#fff" /><Text style={styles.buyBtnText}>Buy Now</Text></>
                          }
                        </Pressable>
                      )}
                    </View>
                  </View>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* In-App Book Reader (no download for paid books) */}
      {readerBook && (
        <Modal visible animationType="slide" onRequestClose={() => setReaderBook(null)}>
          <View style={{ flex: 1, backgroundColor: "#0A1628" }}>
            <View style={{ flexDirection: "row", alignItems: "center", paddingTop: (Platform.OS === "web" ? 16 : insets.top) + 8, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: "#0A1628" }}>
              <Pressable onPress={() => setReaderBook(null)}
                style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="close" size={22} color="#fff" />
              </Pressable>
              <Text style={{ flex: 1, textAlign: "center", fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff", marginRight: 36 }} numberOfLines={1}>
                {readerIsPreview ? `Preview: ${readerBook.title}` : readerBook.title}
              </Text>
            </View>
            {Platform.OS === "web" ? (
              // Web: render PDF.js in an iframe using srcdoc
              <iframe
                srcDoc={buildReaderHtml(readerBook.file_url!, readerBook.title, readerIsPreview)}
                style={{ flex: 1, border: "none", width: "100%", height: "100%" } as any}
                sandbox="allow-scripts allow-same-origin"
                onLoad={(e: any) => {
                  // Listen for buy message from iframe
                  const handler = (event: MessageEvent) => {
                    if (event.data === "buy") {
                      setReaderBook(null);
                      window.removeEventListener("message", handler);
                      setTimeout(() => handleBuy(readerBook!), 300);
                    }
                  };
                  window.addEventListener("message", handler);
                }}
              />
            ) : (
              <WebView
                source={{ html: buildReaderHtml(readerBook.file_url!, readerBook.title, readerIsPreview) }}
                javaScriptEnabled
                domStorageEnabled
                originWhitelist={["*"]}
                mixedContentMode="compatibility"
                onShouldStartLoadWithRequest={(req) => {
                  if (req.url === "about:blank" || req.url.startsWith("data:")) return true;
                  if (req.url.startsWith("https://cdnjs.cloudflare.com")) return true;
                  if (readerBook.file_url && req.url === readerBook.file_url) return true;
                  if (req.url.startsWith("blob:") || req.url.startsWith("file:")) return false;
                  return req.navigationType === "other";
                }}
                onMessage={(event) => {
                  if (event.nativeEvent.data === "buy") {
                    setReaderBook(null);
                    setTimeout(() => handleBuy(readerBook), 300);
                  }
                }}
              />
            )}
          </View>
        </Modal>
      )}

      {/* Razorpay WebView Modal */}
      {paymentWebViewHtml && Platform.OS !== "web" && (
        <Modal visible animationType="slide" onRequestClose={() => { setPaymentWebViewHtml(null); setPendingBookId(null); setPayingBookId(null); }}>
          <View style={{ flex: 1, backgroundColor: "#0A1628" }}>
            <View style={{ flexDirection: "row", alignItems: "center", paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: "#0A1628" }}>
              <Pressable onPress={() => { setPaymentWebViewHtml(null); setPendingBookId(null); setPayingBookId(null); }}
                style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="close" size={22} color="#fff" />
              </Pressable>
              <Text style={{ flex: 1, textAlign: "center", fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff", marginRight: 36 }}>Payment</Text>
            </View>
            <WebView
              source={{ html: paymentWebViewHtml, baseUrl: "https://api.razorpay.com" }}
              javaScriptEnabled domStorageEnabled mixedContentMode="compatibility"
              setSupportMultipleWindows={false} originWhitelist={["*"]}
              onMessage={async (event) => {
                try {
                  const data = JSON.parse(event.nativeEvent.data);
                  if (data.type === "payment_success") {
                    setPaymentWebViewHtml(null);
                    const bookId = pendingBookId; setPendingBookId(null);
                    try {
                      await apiRequest("POST", "/api/books/verify-payment", {
                        bookId, razorpayOrderId: data.razorpay_order_id,
                        razorpayPaymentId: data.razorpay_payment_id, razorpaySignature: data.razorpay_signature,
                      });
                      qc.invalidateQueries({ queryKey: ["/api/my-books"] });
                      qc.invalidateQueries({ queryKey: ["/api/books"] });
                      Alert.alert("Success!", "Book purchased! Go to My Books to read it.");
                    } catch {
                      Alert.alert("Error", "Payment received but activation failed. Contact support.");
                    } finally {
                      setPayingBookId(null);
                    }
                  } else if (data.type === "payment_dismissed") {
                    setPaymentWebViewHtml(null); setPendingBookId(null);
                    setPayingBookId(null);
                  } else if (data.type === "payment_failed") {
                    setPaymentWebViewHtml(null); setPendingBookId(null);
                    setPayingBookId(null);
                    Alert.alert("Payment Failed", data.error || "Payment could not be completed.");
                  }
                } catch (_e) {}
              }}
            />
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: { paddingHorizontal: 16, paddingBottom: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  tabs: { flexDirection: "row", gap: 8 },
  tab: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.1)" },
  tabActive: { backgroundColor: "#fff" },
  tabText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.7)" },
  tabTextActive: { color: Colors.light.primary },
  content: { padding: 16, gap: 14 },
  empty: { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  emptySub: { fontSize: 13, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
  bookCard: {
    backgroundColor: "#fff", borderRadius: 16, padding: 14,
    flexDirection: "row", gap: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  bookCover: { width: 70, height: 95, borderRadius: 8 },
  bookCoverPlaceholder: { width: 70, height: 95, borderRadius: 8, backgroundColor: Colors.light.secondary, alignItems: "center", justifyContent: "center" },
  bookInfo: { flex: 1, gap: 4 },
  bookTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.light.text },
  bookAuthor: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  bookDesc: { fontSize: 12, color: Colors.light.textSecondary, fontFamily: "Inter_400Regular", lineHeight: 17 },
  bookFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  bookPrice: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.primary },
  bookOriginalPrice: { fontSize: 12, color: Colors.light.textMuted, textDecorationLine: "line-through" },
  bookPriceFree: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#22C55E" },
  previewBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderWidth: 1.5, borderColor: Colors.light.primary,
    borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10,
  },
  previewBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.primary },
  buyBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: Colors.light.accent, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12,
  },
  buyBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },
  readBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: Colors.light.primary, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12,
  },
  readBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
