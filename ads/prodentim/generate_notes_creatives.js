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

const creatives = [
  {
    filename: "notes_ad_1_hygienist.png",
    date: "May 14, 2026 at 9:42 PM",
    title: "12 years as a dental hygienist. Here's what toothpaste brands don't want you to know:",
    paragraphs: [
      "1. Alcohol mouthwash is the biggest scam. It wipes out 99% of bacteria, including the good strains that prevent morning breath.",
      "2. Scrubbing harder with hard bristles destroys your protective enamel layer and irritates gums.",
      "3. Persistent bad breath is an oral microbiome issue, NOT a brushing issue.",
      "4. The patients with the cleanest breath don't use 5 products. They take chewable oral probiotics to repopulate good bacteria.",
      "Stopped using commercial rinses 3 months ago. Rebuilt my oral flora. Haven't had bad breath since."
    ]
  },
  {
    filename: "notes_ad_2_relationship.png",
    date: "June 2, 2026 at 8:15 AM",
    title: "My husband stopped kissing me goodbye in the morning. I'm 38.",
    paragraphs: [
      "I thought it was just 'getting older' or 10 years of marriage.",
      "Until I caught him subtly holding his breath when I leaned in on the couch.",
      "I was brushing 3x a day, tongue scraping, using clinical rinses.",
      "Nothing worked for more than 20 minutes.",
      "A periodontist friend finally told me: 'You are killing your good oral flora. You need to repopulate it, not sterilize it.'",
      "Started taking a chewable dental probiotic every night.",
      "Day 12: He kissed me before my morning coffee. I literally cried in the kitchen."
    ]
  },
  {
    filename: "notes_ad_3_dentists.png",
    date: "April 18, 2026 at 10:04 PM",
    title: "17 years of bad breath. What 4 dentists and $3,200 never told me:",
    paragraphs: [
      "4 dentists (\"everything looks textbook clean\")\n2 ENTs (\"sinuses are clear\")\n1 tonsillectomy ($2,200 out of pocket, didn't fix it)\nDozen mouthwashes (masks odor for 15 minutes)",
      "The 1 thing nobody explained:\nYour mouth is an ecosystem, not a kitchen floor. Sterilizing it with alcohol only leaves room for bad bacteria to return stronger.",
      "Started repopulating with 3.5B targeted oral probiotics.",
      "Week 2: First time in my adult life I spoke to someone up close without covering my mouth."
    ]
  },
  {
    filename: "notes_ad_4_darkmode.png",
    isDark: true,
    date: "Tonight at 11:28 PM",
    title: "Why brushing your teeth harder is actually giving you worse breath:",
    paragraphs: [
      "• 80% of bad breath originates from bacterial imbalance, NOT plaque.",
      "• Alcohol mouthwash nukes both good & bad bacteria.",
      "• Bad bacteria repopulate 4x faster in a dry, sterile mouth.",
      "• Reintroducing 3.5 Billion targeted oral probiotics (Lactobacillus strains) crowds out odor-causing compounds at the root.",
      "One chewable tablet before bed. Wake up with a balanced mouth."
    ]
  }
];

function generateHTML(creative) {
  const isDark = creative.isDark || false;
  const bgColor = isDark ? "#1c1c1e" : "#ffffff";
  const textColor = isDark ? "#f2f2f7" : "#1c1c1e";
  const titleColor = isDark ? "#ffffff" : "#000000";
  const iconColor = isDark ? "#ffffff" : "#000000";
  const subtextColor = isDark ? "#98989f" : "#8e8e93";

  const paragraphsHTML = creative.paragraphs.map(p => {
    const formatted = p.replace(/\n/g, "<br/>");
    return `<p style="margin: 0 0 20px 0; font-size: 32px; line-height: 1.45; color: ${textColor};">${formatted}</p>`;
  }).join("");

  return `<!DOCTYPE html>
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
      background-color: ${bgColor};
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif;
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
      letter-spacing: -0.3px;
      color: ${iconColor};
    }
    .status-icons {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .nav-bar {
      height: 70px;
      padding: 0 36px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .back-btn {
      display: flex;
      align-items: center;
      color: #e59d23;
      font-size: 30px;
      font-weight: 400;
      cursor: pointer;
    }
    .back-btn svg {
      margin-right: 6px;
      width: 24px;
      height: 32px;
      fill: #e59d23;
    }
    .nav-actions {
      display: flex;
      align-items: center;
      gap: 24px;
      color: #e59d23;
    }
    .nav-actions svg {
      width: 32px;
      height: 32px;
      fill: #e59d23;
    }
    .content-area {
      flex: 1;
      padding: 24px 52px 40px 52px;
    }
    .timestamp {
      text-align: center;
      color: ${subtextColor};
      font-size: 22px;
      font-weight: 400;
      margin-bottom: 34px;
      letter-spacing: -0.2px;
    }
    .note-title {
      font-size: 44px;
      font-weight: 700;
      color: ${titleColor};
      line-height: 1.25;
      letter-spacing: -0.5px;
      margin: 0 0 32px 0;
    }
  </style>
</head>
<body>
  <div>
    <div class="status-bar">
      <span>9:41</span>
      <div class="status-icons">
        <!-- Signal -->
        <svg width="28" height="20" viewBox="0 0 24 16" fill="${iconColor}">
          <rect x="1" y="11" width="3.5" height="5" rx="1"/>
          <rect x="6.5" y="8" width="3.5" height="8" rx="1"/>
          <rect x="12" y="4" width="3.5" height="12" rx="1"/>
          <rect x="17.5" y="0.5" width="3.5" height="15.5" rx="1"/>
        </svg>
        <!-- Wifi -->
        <svg width="24" height="20" viewBox="0 0 24 18" fill="${iconColor}">
          <path d="M12 4C7.3 4 3.1 5.8 0 8.8L2.4 11.2C4.9 8.9 8.3 7.5 12 7.5C15.7 7.5 19.1 8.9 21.6 11.2L24 8.8C20.9 5.8 16.7 4 12 4ZM12 9C9.2 9 6.7 10.1 4.8 12L7.2 14.4C8.5 13.2 10.2 12.5 12 12.5C13.8 12.5 15.5 13.2 16.8 14.4L19.2 12C17.3 10.1 14.8 9 12 9ZM12 14C10.6 14 9.5 15.1 9.5 16.5C9.5 17.9 10.6 19 12 19C13.4 19 14.5 17.9 14.5 16.5C14.5 15.1 13.4 14 12 14Z"/>
        </svg>
        <!-- Battery -->
        <svg width="34" height="18" viewBox="0 0 30 16" fill="none" stroke="${iconColor}" stroke-width="2">
          <rect x="1" y="1" width="24" height="14" rx="4"/>
          <rect x="3" y="3" width="18" height="10" rx="2" fill="${iconColor}"/>
          <path d="M27 6V10" stroke="${iconColor}" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </div>
    </div>

    <div class="nav-bar">
      <div class="back-btn">
        <svg viewBox="0 0 24 24">
          <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
        </svg>
        Notes
      </div>
      <div class="nav-actions">
        <!-- Share -->
        <svg viewBox="0 0 24 24" fill="none" stroke="#e59d23" stroke-width="2.2">
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
          <polyline points="16 6 12 2 8 6"/>
          <line x1="12" y1="2" x2="12" y2="15"/>
        </svg>
        <!-- Ellipsis Circle -->
        <svg viewBox="0 0 24 24" fill="none" stroke="#e59d23" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <circle cx="8" cy="12" r="1.2" fill="#e59d23"/>
          <circle cx="12" cy="12" r="1.2" fill="#e59d23"/>
          <circle cx="16" cy="12" r="1.2" fill="#e59d23"/>
        </svg>
      </div>
    </div>
  </div>

  <div class="content-area">
    <div class="timestamp">${creative.date}</div>
    <div class="note-title">${creative.title}</div>
    ${paragraphsHTML}
  </div>
</body>
</html>`;
}

async function renderCreatives() {
  const browserWsUrl = await getWebSocketUrl();
  console.log("Connecting to Chrome at:", browserWsUrl);

  const WS = globalThis.WebSocket;
  const ws = new WS(browserWsUrl);
  await new Promise(r => ws.onopen = r);

  const outDir = path.resolve("ads/prodentim/creatives");

  for (const c of creatives) {
    console.log(`Generating creative: ${c.filename}...`);
    // Create new target
    const { targetId } = await sendCDP(ws, "Target.createTarget", { url: "about:blank" });
    
    // Connect to page target
    const pageWsUrl = `ws://127.0.0.1:9222/devtools/page/${targetId}`;
    const pageWs = new WS(pageWsUrl);
    await new Promise(r => pageWs.onopen = r);

    // Set viewport to 1080x1080
    await sendCDP(pageWs, "Emulation.setDeviceMetricsOverride", {
      width: 1080,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false
    });

    const html = generateHTML(c);
    await sendCDP(pageWs, "Page.enable");
    
    // Set document content
    const { frameTree } = await sendCDP(pageWs, "Page.getFrameTree");
    await sendCDP(pageWs, "Page.setDocumentContent", {
      frameId: frameTree.frame.id,
      html: html
    });

    // Wait 300ms for layout
    await new Promise(r => setTimeout(r, 300));

    // Capture screenshot
    const screenshot = await sendCDP(pageWs, "Page.captureScreenshot", {
      format: "png",
      clip: { x: 0, y: 0, width: 1080, height: 1080, scale: 1 }
    });

    const outPath = path.join(outDir, c.filename);
    fs.writeFileSync(outPath, Buffer.from(screenshot.data, "base64"));
    console.log(`Saved: ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);

    // Close page
    pageWs.close();
    await sendCDP(ws, "Target.closeTarget", { targetId });
  }

  ws.close();
  console.log("All creatives successfully generated!");
}

renderCreatives().catch(console.error);
