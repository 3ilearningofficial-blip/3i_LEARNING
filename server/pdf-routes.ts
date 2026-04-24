import type { Express, Request, Response } from "express";
import * as http from "node:http";
import * as https from "node:https";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterPdfRoutesDeps = {
  app: Express;
  db: DbClient;
};

export function registerPdfRoutes({ app, db }: RegisterPdfRoutesDeps): void {
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
    const { url } = req.query;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ message: "URL is required" });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({ message: "Invalid URL" });
    }

    const isGoogleDrive = parsedUrl.hostname.includes("drive.google.com") || parsedUrl.hostname.includes("docs.google.com");
    const isPdfUrl = parsedUrl.pathname.toLowerCase().endsWith(".pdf");
    if (!isPdfUrl && !isGoogleDrive) {
      return res.status(400).json({ message: "Only PDF files and Google Drive links are allowed" });
    }

    let finalUrl = url;
    if (isGoogleDrive) {
      const fileIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (fileIdMatch) {
        finalUrl = `https://drive.google.com/uc?export=download&id=${fileIdMatch[1]}`;
      }
    }

    const finalParsed = new URL(finalUrl);
    const protocol = finalParsed.protocol === "https:" ? https : http;
    const options = {
      hostname: finalParsed.hostname,
      path: finalParsed.pathname + finalParsed.search,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/pdf,*/*",
      },
      timeout: 30000,
    };

    console.log(`[PDF-Proxy] Fetching: ${parsedUrl.hostname}${parsedUrl.pathname}`);

    const proxyReq = protocol.request(options, (proxyRes: any) => {
      if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
        const redirectUrl = new URL(proxyRes.headers.location, url);
        console.log(`[PDF-Proxy] Following redirect to: ${redirectUrl.href}`);
        proxyRes.resume();
        req.query.url = redirectUrl.href;
        return (app as any)._router.handle(req, res, () => {});
      }

      if (proxyRes.statusCode !== 200) {
        console.log(`[PDF-Proxy] Upstream returned ${proxyRes.statusCode}`);
        proxyRes.resume();
        return res.status(proxyRes.statusCode).json({ message: "Failed to fetch PDF" });
      }

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Cache-Control", "public, max-age=86400");
      if (proxyRes.headers["content-length"]) {
        res.setHeader("Content-Length", proxyRes.headers["content-length"]);
      }
      proxyRes.pipe(res);
    });

    proxyReq.on("error", (err: any) => {
      console.error("[PDF-Proxy] Request error:", err.message);
      if (!res.headersSent) {
        res.status(502).json({ message: "Failed to fetch PDF" });
      }
    });

    proxyReq.on("timeout", () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.status(504).json({ message: "PDF download timed out" });
      }
    });

    proxyReq.end();
  });
}

