const http = require("http");
const fs = require("fs");
const path = require("path");

function getWebSocketUrl() {
  return new Promise((resolve, reject) => {
    http.get("http://127.0.0.1:9222/json/version", (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve(json.webSocketDebuggerUrl);
        } catch (e) {
          reject(e);
        }
      });
    }).on("error", reject);
  });
}

function sendCDP(ws, method, params = {}) {
  return new Promise((resolve) => {
    const id = Math.floor(Math.random() * 1000000);
    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === id) {
        ws.removeEventListener("message", handler);
        resolve(msg.result);
      }
    };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function run() {
  const browserWsUrl = await getWebSocketUrl();
  const ws = new (globalThis.WebSocket)(browserWsUrl);
  await new Promise(r => ws.onopen = r);

  // Read the original image as base64
  const imgPath = path.resolve("ads/prodentim/creatives/prodentim_image_4.jpg");
  const imgBase64 = fs.readFileSync(imgPath).toString("base64");
  const dataUri = `data:image/jpeg;base64,${imgBase64}`;

  const days = [
    "DAY 1", "DAY 4", "DAY 8",
    "DAY 12", "DAY 16", "DAY 20",
    "DAY 24", "DAY 27", "DAY 30"
  ];

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; -webkit-font-smoothing: antialiased; }
    body {
      margin: 0;
      padding: 0;
      width: 1080px;
      height: 1080px;
      background-color: #0f1419;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      flex-direction: column;
      position: relative;
      overflow: hidden;
    }
    .header-bar {
      height: 72px;
      background: #161f28;
      border-bottom: 2px solid #233140;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 32px;
      color: #fff;
    }
    .header-title {
      font-size: 26px;
      font-weight: 700;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      display: flex;
      align-items: center;
      gap: 10px;
      color: #38bdf8;
    }
    .header-subtitle {
      font-size: 20px;
      font-weight: 500;
      color: #94a3b8;
    }
    .grid-container {
      flex: 1;
      position: relative;
      background-image: url('${dataUri}');
      background-size: cover;
      background-position: center;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      grid-template-rows: repeat(3, 1fr);
      gap: 4px;
      background-color: #ffffff;
    }
    .grid-cell {
      position: relative;
      padding: 14px;
      display: flex;
      align-items: flex-end;
      justify-content: flex-start;
    }
    .day-badge {
      background: rgba(15, 23, 42, 0.78);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.35);
      border-radius: 8px;
      padding: 6px 14px;
      color: #ffffff;
      font-size: 22px;
      font-weight: 800;
      letter-spacing: 1px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    }
    .day-badge.highlight {
      background: rgba(16, 185, 129, 0.85);
      border-color: #34d399;
    }
    .footer-bar {
      height: 64px;
      background: #161f28;
      border-top: 2px solid #233140;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 32px;
      color: #e2e8f0;
      font-size: 21px;
      font-weight: 600;
    }
    .footer-highlight {
      color: #10b981;
      display: flex;
      align-items: center;
      gap: 8px;
    }
  </style>
</head>
<body>
  <div class="header-bar">
    <div class="header-title">
      <span>🔬</span> 30-Day Oral Microbiome Journal
    </div>
    <div class="header-subtitle">Daily Visual Progress Log</div>
  </div>

  <div class="grid-container">
    ${days.map((d, i) => `
      <div class="grid-cell">
        <div class="day-badge ${i >= 6 ? 'highlight' : ''}">${d}</div>
      </div>
    `).join('')}
  </div>

  <div class="footer-bar">
    <span>Focus: Good Flora Repopulation</span>
    <span class="footer-highlight">✓ 3.5B Targeted Probiotic Chewable</span>
  </div>
</body>
</html>`;

  console.log("Creating CDP target...");
  const { targetId } = await sendCDP(ws, "Target.createTarget", { url: "about:blank" });
  const pageWsUrl = `ws://127.0.0.1:9222/devtools/page/${targetId}`;
  const pageWs = new (globalThis.WebSocket)(pageWsUrl);
  await new Promise(r => pageWs.onopen = r);

  await sendCDP(pageWs, "Emulation.setDeviceMetricsOverride", {
    width: 1080,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false
  });

  await sendCDP(pageWs, "Page.enable");
  const { frameTree } = await sendCDP(pageWs, "Page.getFrameTree");
  await sendCDP(pageWs, "Page.setDocumentContent", {
    frameId: frameTree.frame.id,
    html: html
  });

  await new Promise(r => setTimeout(r, 600));

  const screenshot = await sendCDP(pageWs, "Page.captureScreenshot", {
    format: "png",
    clip: { x: 0, y: 0, width: 1080, height: 1080, scale: 1 }
  });

  const outPath = path.resolve("ads/prodentim/creatives/enhanced_tongue_tracker_ad.png");
  fs.writeFileSync(outPath, Buffer.from(screenshot.data, "base64"));
  console.log(`Saved enhanced ad to: ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);

  pageWs.close();
  await sendCDP(ws, "Target.closeTarget", { targetId });
  ws.close();
}

run().catch(console.error);
