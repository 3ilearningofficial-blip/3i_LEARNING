import type { Express, Request, Response } from "express";
import { isIP } from "node:net";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterPdfRoutesDeps = {
  app: Express;
  db: DbClient;
  getAuthUser: (req: Request) => Promise<{ id: number } | null>;
};

const MAX_PDF_PROXY_BYTES = 30 * 1024 * 1024;
const MAX_PDF_PROXY_REDIRECTS = 2;
const PDF_PROXY_ALLOWED_HOSTS = new Set([
  "drive.google.com",
  "docs.google.com",
  "lh3.googleusercontent.com",
]);

function isPrivateOrLocalHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".local")) return true;
  const ipVersion = isIP(lower);
  if (!ipVersion) return false;
  if (ipVersion === 4) {
    const [a, b] = lower.split(".").map(Number);
    if (a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  // Treat IPv6 loopback/link-local/ULA as private.
  return lower === "::1" || lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd");
}

export function registerPdfRoutes({ app, db, getAuthUser }: RegisterPdfRoutesDeps): void {
  app.get("/api/pdf-viewer", async (req: Request, res: Response) => {
    const { token, key } = req.query;
    if (!token || !key || typeof token !== "string" || typeof key !== "string") {
      return res.status(400).send("Missing token or key");
    }
    const tokenResult = await db.query(
      "SELECT user_id FROM media_tokens WHERE token = $1 AND expires_at > $2 AND file_key = $3",
      [token, Date.now(), key]
    ).catch(() => ({ rows: [] }));
    if (!tokenResult.rows.length) {
      return res.status(401).send("Token expired or invalid");
    }
    const origin = `${req.headers["x-forwarded-proto"] || req.protocol}://${req.headers["x-forwarded-host"] || req.headers.host}`;
    const pdfUrl = `${origin}/api/media/${key}?token=${token}`;
    const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
<meta name="robots" content="noindex,nofollow">
<title>PDF Viewer</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;background:#2a2a2a;overflow:auto;font-family:-apple-system,sans-serif;-webkit-overflow-scrolling:touch;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
#viewer{width:100%;display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px 0 16px}
.page-canvas{display:block;max-width:100%;height:auto;box-shadow:0 2px 8px rgba(0,0,0,0.3);background:#fff;pointer-events:none}
.loading{position:fixed;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;color:#ccc;background:#2a2a2a;z-index:10}
.spinner{width:40px;height:40px;border:3px solid rgba(255,255,255,0.1);border-top:3px solid #1A56DB;border-radius:50%;animation:spin 0.8s linear infinite}
.page-info{color:#888;font-size:12px;padding:4px 0}
.error{position:fixed;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;color:#ccc;padding:32px;text-align:center;background:#2a2a2a;z-index:20}
.error h3{font-size:18px;color:#fff}.error p{font-size:13px;color:#999;line-height:1.5}
@keyframes spin{to{transform:rotate(360deg)}}
@media print{body{display:none!important}}
</style>
</head><body>
<div id="loading" class="loading"><div class="spinner"></div><p>Loading PDF...</p></div>
<div id="viewer"></div>
<script>
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
(function(){
  var pdfUrl=${JSON.stringify(pdfUrl)};
  function renderPdf(url){
    return pdfjsLib.getDocument({url:url,withCredentials:true}).promise.then(function(pdf){
      document.getElementById('loading').style.display='none';
      var viewer=document.getElementById('viewer');
      viewer.innerHTML='';
      var n=pdf.numPages;
      function renderPage(num){
        pdf.getPage(num).then(function(page){
          var w=Math.min(window.innerWidth-16,900);
          var vp=page.getViewport({scale:1});
          var scale=w/vp.width;
          var svp=page.getViewport({scale:scale*2});
          var canvas=document.createElement('canvas');
          canvas.className='page-canvas';
          canvas.width=svp.width;canvas.height=svp.height;
          canvas.style.width=(svp.width/2)+'px';canvas.style.height=(svp.height/2)+'px';
          viewer.appendChild(canvas);
          var info=document.createElement('div');
          info.className='page-info';info.textContent='Page '+num+' of '+n;
          viewer.appendChild(info);
          page.render({canvasContext:canvas.getContext('2d'),viewport:svp}).promise.then(function(){
            if(num<n)renderPage(num+1);
          });
        });
      }
      renderPage(1);
    });
  }
  renderPdf(pdfUrl).catch(function(){
    document.getElementById('loading').style.display='none';
    var d=document.createElement('div');d.className='error';
    d.innerHTML='<h3>Unable to load PDF</h3><p>Please try again or contact support.</p>';
    document.body.appendChild(d);
  });
  document.addEventListener('contextmenu',function(e){e.preventDefault();});
  document.addEventListener('keydown',function(e){
    if(e.key==='PrintScreen'||(e.ctrlKey&&(e.key==='p'||e.key==='P'||e.key==='s'||e.key==='S'))){e.preventDefault();}
  });
})();
</script></body></html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.send(html);
  });

  app.get("/api/pdf-proxy", (req: Request, res: Response) => {
    (async () => {
      const user = await getAuthUser(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const { url } = req.query;
      if (!url || typeof url !== "string") {
        return res.status(400).json({ message: "URL is required" });
      }

      let currentUrl = url;
      for (let redirectCount = 0; redirectCount <= MAX_PDF_PROXY_REDIRECTS; redirectCount += 1) {
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(currentUrl);
        } catch {
          return res.status(400).json({ message: "Invalid URL" });
        }

        if (parsedUrl.protocol !== "https:") {
          return res.status(400).json({ message: "Only HTTPS PDF URLs are allowed" });
        }
        if (isPrivateOrLocalHost(parsedUrl.hostname)) {
          return res.status(403).json({ message: "Blocked host" });
        }

        const hostname = parsedUrl.hostname.toLowerCase();
        const isAllowedHost = PDF_PROXY_ALLOWED_HOSTS.has(hostname);
        const isGoogleDrive = hostname.includes("drive.google.com") || hostname.includes("docs.google.com");
        const isPdfUrl = parsedUrl.pathname.toLowerCase().endsWith(".pdf");
        if (!isAllowedHost && !isPdfUrl) {
          return res.status(400).json({ message: "Only trusted hosts and PDF links are allowed" });
        }

        if (isGoogleDrive) {
          const fileIdMatch = currentUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
          if (fileIdMatch) {
            currentUrl = `https://drive.google.com/uc?export=download&id=${fileIdMatch[1]}`;
            continue;
          }
        }

        const upstream = await fetch(currentUrl, {
          method: "GET",
          redirect: "manual",
          headers: {
            "User-Agent": "3i-learning-pdf-proxy/1.0",
            Accept: "application/pdf,*/*",
          },
          signal: AbortSignal.timeout(30000),
        });

        if (upstream.status >= 300 && upstream.status < 400) {
          const location = upstream.headers.get("location");
          if (!location) return res.status(502).json({ message: "Invalid redirect from source" });
          currentUrl = new URL(location, currentUrl).toString();
          continue;
        }
        if (!upstream.ok || !upstream.body) {
          return res.status(502).json({ message: "Failed to fetch PDF" });
        }

        const contentLength = Number(upstream.headers.get("content-length") || "0");
        if (Number.isFinite(contentLength) && contentLength > MAX_PDF_PROXY_BYTES) {
          return res.status(413).json({ message: "PDF too large" });
        }
        const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
        if (contentType && !contentType.includes("pdf") && !contentType.includes("octet-stream")) {
          return res.status(400).json({ message: "Source is not a PDF" });
        }

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Cache-Control", "private, max-age=600");
        if (contentLength > 0) {
          res.setHeader("Content-Length", String(contentLength));
        }
        const { Readable } = await import("stream");
        Readable.fromWeb(upstream.body as any).pipe(res);
        return;
      }

      return res.status(400).json({ message: "Too many redirects" });
    })().catch((err: any) => {
      console.error("[PDF-Proxy] Request error:", err?.message || err);
      if (!res.headersSent) {
        res.status(502).json({ message: "Failed to fetch PDF" });
      }
    });
  });
}

