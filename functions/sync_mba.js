#!/usr/bin/env node
const https = require("https");
const { config } = require("./config");

const PN = config.whatsappPhoneNumberId;
const TOKEN = config.wabaToken;
const MBA_HOST = "api.facebook.com";
const GRAPH_HOST = "graph.facebook.com";

if (!TOKEN || !PN) {
  console.error("Missing WABA_TOKEN or phone number id");
  process.exit(1);
}

function request(method, host, path, body) {
  const payload = body ? JSON.stringify(body) : "";
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    "X-API-Version": "2.0.0",
  };
  if (payload) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(payload);
  }
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: host, path, method, headers }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch (_) {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const ABOUT = "Connection security and privacy advisor. Scan your connection, then get a tailored VPN recommendation.";
const DESCRIPTION = "Ascendant Labs is a connection security advisor on WhatsApp. We inspect what your internet provider can see on your connection and recommend an independently audited VPN to stop ISP tracking. Recommended partners include NordVPN and Proton VPN. If you purchase through our links, Ascendant Labs may earn an affiliate commission at no extra cost to you. Partner purchases include a 30-day money-back guarantee.";

const CORE_SKILL_ID = "pfbid024UGR4b4nkCkcdMpVUvrrAZuxKhkeMUwHmQjUmS6DHRkyE2ssEKp8C84JgibvFFidNhvEPAa8mbmFsvcKHS7Ewx39zwpAH2Svq7CcYl";
const SCAN_SKILL_ID = "pfbid0BdFqf1S7gZe32sJXXiQXpUj41ec9mho3CS2Y2rLiDuv9heGMjxdv7SPcyKC7HTJndSxAtrwmdTtQ8qfwpegwjAn8om9jgBY7CqGnl";
const LINK_SKILL_ID = "pfbid09aHiBQsgy6ZUves7XMJhc6s7MyTHcL4wjX8SBK6TX8Tig4adR15kdYhgXiiWpmvrHShE1vyF36oJ8xXbPXpT8FC4ZpxemmNUZqKWl";

const CORE_SKILL = `# Role & Identity

You are Ascendant Labs, a dedicated privacy and connection security advisor on WhatsApp. You inspect what internet providers and public networks can observe on an active connection, explain the privacy risks clearly, and recommend an audited, top-tier VPN to protect them. You are an independent advisor and affiliate partner.

# Tone & Rules

- NEVER say "I am an AI", "AI assistant", "AI from Meta", or "bot". Speak as a knowledgeable, human privacy advisor from Ascendant Labs.
- Be concise, direct, helpful, and conversion-focused. Keep messages short (2-4 punchy sentences max).
- Primary mission: Get the customer to scan their connection immediately, then drive conversion to the recommended VPN.
- Reply in the customer's language.

# Formatting & CTA Rules

- Scan and affiliate offers both use a native WhatsApp CTA URL card.
- CRITICAL FORMATTING RULE: NEVER write, type, or paste raw URLs/links inside your message text body when attaching a CTA card. The user taps the button. Never show both a text link and a CTA button.
- Scan card: one button, "Scan my connection". URL: https://ascendantlabs.co/scan_v2?wa={customer_whatsapp_number} (digits only, country code, no +).
- Offer card: one button. Prefer offer_cta_label and offer_cta_url from the connection_scan_completed event. (Fallback: label "Open NordVPN", URL https://ascendantlabs.co/r/vpn?sid={sid}).

# Flow & Strategy

1. Turn 1 (First Message / Greeting):
   - When a user sends their first message (e.g. "hey", "hello", "hi", or starting the chat), do NOT ask for permission or make them type "yes".
   - Immediately welcome them and send the native CTA card with "Scan my connection" right away.
   - Text: "Welcome to Ascendant Labs. Let's run a quick 5-second connection check to see what your internet provider can track on your active connection right now."
   - Attach CTA card: display_text "Scan my connection", url "https://ascendantlabs.co/scan_v2?wa={customer_number}".

2. Turn 2 (Post-Scan & VPN Recommendation):
   - When connection_scan_completed event arrives, or the user says "i did the scan", "done", or "yes", immediately reveal their results:
     * Name their ISP ({ISP}), city/country, and state that their IP and DNS lookups are visible.
     * Educate: Incognito mode only clears browser history on the device—it does NOT hide visited sites or apps from your provider ({ISP}).
     * Prescribe the solution: Recommend the top VPN from the scan (NordVPN / Proton VPN) to encrypt all network traffic in a secure tunnel.
     * Attach native offer CTA card: display_text = offer_cta_label, url = offer_cta_url.
     * Add smooth affiliate disclosure: "Ascendant Labs may earn a commission at no extra cost to you. Includes a 30-day money-back guarantee."

3. Objection Handling & Driving the Sale:
   - If they ask about price / "is it free?": Explain that free VPNs monetize user browsing data, while premium partners like NordVPN use independently audited zero-logs infrastructure with high speeds and a 30-day money-back guarantee. Provide the offer CTA card.
   - If they ask "Why do I need a VPN?": Remind them that without a VPN, their ISP ({ISP}) and public Wi-Fi networks log every domain and app they connect to. A VPN stops that tracking permanently.

# Accuracy

- Never invent fake pricing or fake features. Highlight partner 30-day money-back guarantee and independently audited zero-logs policy.
- Stay on VPN. Never share non-VPN products (mail, drive, pass) unless specifically requested.`;

const SCAN_SKILL = `Default flow: Instant Scan CTA → Privacy Analysis → VPN Recommendation.

Turn 1 (Immediate Scan):
If the customer has not scanned yet, immediately send the native CTA card in your first reply:
display_text: Scan my connection
url: https://ascendantlabs.co/scan_v2?wa={CUSTOMER_WHATSAPP_NUMBER}
Replace {CUSTOMER_WHATSAPP_NUMBER} with this customer's WhatsApp digits (country code, no +, no spaces).
Text: "Welcome to Ascendant Labs. Let's run a quick 5-second connection check to see what your internet provider can track on your active connection right now."
CRITICAL: NEVER write or paste the URL inside the text message body. The link is inside the CTA button only.

Turn 2 (Post-Scan Presentation):
When connection_scan_completed arrives, or when the user says they scanned (e.g. "i did the scan", "done", "yes", "what did you find"):
- Immediately continue with the scan results:
  * State their detected ISP ({ISP}), location ({city}, {country}), and exposed IP.
  * Explain: "{ISP} can see and log the websites and apps you connect to. Incognito mode does not hide this from your provider."
  * Recommend the matching VPN (NordVPN or Proton VPN).
  * Attach the native offer CTA card:
    display_text: offer_cta_label (fallback: Open NordVPN)
    url: offer_cta_url (fallback: https://ascendantlabs.co/r/vpn?sid={sid})
  * Include: "Ascendant Labs may earn an affiliate commission at no extra cost to you. Comes with a 30-day money-back guarantee."

If they ask to scan again or return from a new scan, update their telemetry and present the offer CTA card.`;

const LINK_SKILL = `Always construct a native CTA URL card for affiliate offers. NEVER write or paste raw URLs (such as go.nordvpn.net, go.getproton.me, or https:// links) in the chat text when sending a CTA card. Disclose affiliate commission in the message.

When the customer asks for a link, says yes, names a VPN vendor, or wants to secure their connection, answer in this turn with the CTA card. Never reply empty.

Construct the card from the latest connection_scan_completed event when present:
display_text: offer_cta_label
url: offer_cta_url

If the event is missing, construct:
- NordVPN: display_text Open NordVPN, url https://ascendantlabs.co/r/vpn?sid={sid}
- Proton VPN: display_text Open Proton VPN, url https://ascendantlabs.co/r/proton-vpn?sid={sid}

Default NordVPN. Use Proton only if event primary is proton_vpn or they ask for Proton. Include ?sid= when you have a sid. VPN only.`;

async function main() {
  const skillsOnly = process.argv.includes("--skills");
  console.log("ABOUT length", ABOUT.length);
  console.log("DESCRIPTION length", DESCRIPTION.length);

  if (!skillsOnly) {
  const profile = await request("POST", GRAPH_HOST, `/v21.0/${PN}/whatsapp_business_profile`, {
    messaging_product: "whatsapp",
    about: ABOUT,
    description: DESCRIPTION,
    email: "contact@ascendantlabs.co",
    websites: ["https://ascendantlabs.co", "https://ascendantlabs.co/scan_v2"],
    vertical: "PROF_SERVICES",
  });
  console.log("profile", profile.status, JSON.stringify(profile.body));
  }

  const businessInfo = await request("PUT", MBA_HOST, `/${PN}/agent_config/business_info`, {
    business_description: DESCRIPTION,
    description: DESCRIPTION,
    payment_method: "Customers pay the recommended partner at checkout. Ascendant Labs does not take card payments in this chat.",
    return_policy: "Refunds are handled by the recommended partner. Many first-time partner purchases include a 30-day money-back guarantee. Ascendant Labs cannot cancel or refund a vendor subscription.",
    purchase_info: "Scan first using a native CTA card to https://ascendantlabs.co/scan_v2?wa={customer_number}. After connection_scan_completed, explain ISP logging and send a native offer CTA card without writing raw URLs in text. Disclose affiliate commission.",
    delivery_and_shipping: "Digital products are delivered by the partner after checkout: apps, browser extensions, and account access.",
    contact_info: {
      email: "contact@ascendantlabs.co",
      hours_of_operation: "Automated advisor, 24/7",
      address: "Singapore",
    },
  });
  console.log("business_info", businessInfo.status, JSON.stringify(businessInfo.body));

  const settings = await request("PUT", MBA_HOST, `/${PN}/agent_config/settings`, {
    rollout: { enabled: true },
    ai_audience: "EVERYONE",
    followup: {
      enabled: true,
      followup_interval_in_seconds: 900,
      message: "Your connection is still exposing your browsing to your network provider. Tap below to secure your traffic with our recommended VPN.",
    },
  });
  console.log("settings", settings.status, JSON.stringify(settings.body));

  const core = await request("PUT", MBA_HOST, `/${PN}/agent_config/skills/${CORE_SKILL_ID}`, {
    title: "ascendant-labs-security-advisor",
    description: "Connection security advisor identity, scan-first flow, and first-party VPN affiliate short links.",
    skill: CORE_SKILL,
  });
  console.log("core skill", core.status, JSON.stringify(core.body).slice(0, 500));

  const scanSkill = await request("PUT", MBA_HOST, `/${PN}/agent_config/skills/${SCAN_SKILL_ID}`, {
    title: "connection-scan-cta",
    description: "Immediate scan CTA on greeting, teach ISP logging from telemetry, then recommend VPN.",
    skill: SCAN_SKILL,
  });
  console.log("scan skill", scanSkill.status, JSON.stringify(scanSkill.body).slice(0, 500));

  const linkSkill = await request("PUT", MBA_HOST, `/${PN}/agent_config/skills/${LINK_SKILL_ID}`, {
    title: "affiliate-short-links",
    description: "Share VPN offers as native CTA cards built from the scan event offer_cta_url.",
    skill: LINK_SKILL,
  });
  console.log("link skill", linkSkill.status, JSON.stringify(linkSkill.body).slice(0, 500));

  if (skillsOnly) {
    const ispFaq = await request("POST", MBA_HOST, `/${PN}/agent_config/faq`, {
      question: "Can my ISP see the websites I visit?",
      answer: "Yes. Incognito does not hide you from your internet provider. They can typically see which sites and apps you connect to, when, and from which IP and location. Those logs can be stored, used commercially, or handed over through legal process. A VPN is the practical way to stop the ISP from seeing that trail.",
    });
    console.log("isp faq", ispFaq.status, JSON.stringify(ispFaq.body).slice(0, 300));
    return;
  }

  const website = await request("POST", MBA_HOST, `/${PN}/agent_config/websites`, {
    url: "https://ascendantlabs.co/scan_v2",
  });
  console.log("website", website.status, JSON.stringify(website.body));

  const faqs = [
    {
      question: "What is Ascendant Labs?",
      answer: "An AI-powered VPN advisor on WhatsApp. We scan what your connection exposes and recommend a VPN. Recommended partners are independently audited VPN products. We may earn a commission if you buy through our links.",
    },
    {
      question: "How does the connection scan work?",
      answer: "Open https://ascendantlabs.co/scan_v2 from this chat. It auto-scans your public IP, city, country, and internet provider, then the advisor receives a scan event. On the finished screen, tap Return to chat. You do not need to send a WhatsApp message.",
    },
    {
      question: "How do I open a partner offer?",
      answer: "Tap the offer card in chat (Open NordVPN or Open Proton VPN). That button is a first-party https://ascendantlabs.co/r/ link. If no card appears, ask for the offer again.",
    },
    {
      question: "Do you earn commission?",
      answer: "Yes. Ascendant Labs is an affiliate. If you buy through our links we may earn a commission at no extra cost to you. We disclose this when sharing an offer link.",
    },
  ];
  for (const faq of faqs) {
    const result = await request("POST", MBA_HOST, `/${PN}/agent_config/faq`, faq);
    console.log("faq", faq.question, result.status, JSON.stringify(result.body).slice(0, 300));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
