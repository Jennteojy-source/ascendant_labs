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
      background-color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      overflow: hidden;
    }
    .status-bar {
      height: 60px;
      padding: 16px 44px 0 44px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 600;
      font-size: 26px;
      color: #000;
    }
    .status-icons {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .header {
      padding: 10px 40px 20px 40px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #e5e5ea;
    }
    .back {
      display: flex;
      align-items: center;
      color: #007aff;
      font-size: 28px;
    }
    .contact-info {
      text-align: center;
    }
    .avatar {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 34px;
      margin: 0 auto 8px auto;
    }
    .contact-name {
      font-size: 28px;
      font-weight: 600;
      color: #000;
    }
    .chat-area {
      flex: 1;
      padding: 30px 48px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .date-divider {
      text-align: center;
      color: #8e8e93;
      font-size: 20px;
      margin-bottom: 10px;
      font-weight: 500;
    }
    .message {
      max-width: 78%;
      padding: 18px 24px;
      font-size: 28px;
      line-height: 1.35;
      border-radius: 28px;
      position: relative;
    }
    .incoming {
      align-self: flex-start;
      background-color: #e9e9eb;
      color: #000000;
      border-bottom-left-radius: 6px;
    }
    .outgoing {
      align-self: flex-end;
      background-color: #007aff;
      color: #ffffff;
      border-bottom-right-radius: 6px;
    }
    .delivered {
      align-self: flex-end;
      font-size: 18px;
      color: #8e8e93;
      margin-top: -12px;
      margin-right: 8px;
    }
  </style>
</head>
<body>
  <div>
    <div class="status-bar">
      <span>9:41</span>
      <div class="status-icons">
        <!-- Signal -->
        <svg width="28" height="20" viewBox="0 0 24 16" fill="#000">
          <rect x="1" y="11" width="3.5" height="5" rx="1"/>
          <rect x="6.5" y="8" width="3.5" height="8" rx="1"/>
          <rect x="12" y="4" width="3.5" height="12" rx="1"/>
          <rect x="17.5" y="0.5" width="3.5" height="15.5" rx="1"/>
        </svg>
        <!-- Wifi -->
        <svg width="24" height="20" viewBox="0 0 24 18" fill="#000">
          <path d="M12 4C7.3 4 3.1 5.8 0 8.8L2.4 11.2C4.9 8.9 8.3 7.5 12 7.5C15.7 7.5 19.1 8.9 21.6 11.2L24 8.8C20.9 5.8 16.7 4 12 4ZM12 9C9.2 9 6.7 10.1 4.8 12L7.2 14.4C8.5 13.2 10.2 12.5 12 12.5C13.8 12.5 15.5 13.2 16.8 14.4L19.2 12C17.3 10.1 14.8 9 12 9ZM12 14C10.6 14 9.5 15.1 9.5 16.5C9.5 17.9 10.6 19 12 19C13.4 19 14.5 17.9 14.5 16.5C14.5 15.1 13.4 14 12 14Z"/>
        </svg>
        <!-- Battery -->
        <svg width="34" height="18" viewBox="0 0 30 16" fill="none" stroke="#000" stroke-width="2">
          <rect x="1" y="1" width="24" height="14" rx="4"/>
          <rect x="3" y="3" width="18" height="10" rx="2" fill="#000"/>
          <path d="M27 6V10" stroke="#000" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </div>
    </div>

    <div class="header">
      <div class="back">‹ Messages</div>
      <div class="contact-info">
        <div class="avatar">👩‍⚕️</div>
        <div class="contact-name">Dr. Rachel (Dental)</div>
      </div>
      <div style="width: 80px;"></div>
    </div>
  </div>

  <div class="chat-area">
    <div class="date-divider">Today 9:28 AM</div>
    
    <div class="message incoming">
      Hey! Quick question... did you ever figure out why your tongue kept getting that stubborn white film even after scraping?
    </div>

    <div class="message outgoing">
      YES. Stop scraping it!! My periodontist said scraping strips your good bacteria and makes the odor-producing sulfur bacteria grow back 3x faster.
    </div>

    <div class="message incoming">
      Wait seriously?? What do you do instead then?
    </div>

    <div class="message outgoing">
      You have to repopulate your oral microbiome. I take 1 chewable probiotic tablet with 3.5B live strains before bed. By week 2 the white film stopped returning completely.
    </div>

    <div class="message incoming">
      Omg send me the link right now 🙏
    </div>

    <div class="delivered">Delivered</div>
  </div>
  
  <div style="height: 30px;"></div>
</body>
</html>`;

  console.log("Rendering iMessage creative...");
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

  await new Promise(r => setTimeout(r, 400));

  const screenshot = await sendCDP(pageWs, "Page.captureScreenshot", {
    format: "png",
    clip: { x: 0, y: 0, width: 1080, height: 1080, scale: 1 }
  });

  const outPath = path.resolve("ads/prodentim/creatives/policy_safe_imessage_conversation.png");
  fs.writeFileSync(outPath, Buffer.from(screenshot.data, "base64"));
  console.log(`Saved iMessage ad to: ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);

  pageWs.close();
  await sendCDP(ws, "Target.closeTarget", { targetId });
  ws.close();
}

run().catch(console.error);
