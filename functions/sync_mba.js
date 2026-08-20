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

const ABOUT = "AI-powered VPN advisor. Scan your connection, then get a tailored VPN recommendation.";
const DESCRIPTION = "Ascendant Labs is an AI-powered VPN advisor on WhatsApp. We scan what your internet provider can already see, then recommend a VPN that hides that trail. Recommended partners are independently audited VPN products. If you buy through our links, Ascendant Labs may earn a commission at no extra cost to you. Partner offers often include a 30-day money-back guarantee. We are not the product vendor and cannot change vendor accounts.";

const CORE_SKILL_ID = "pfbid024UGR4b4nkCkcdMpVUvrrAZuxKhkeMUwHmQjUmS6DHRkyE2ssEKp8C84JgibvFFidNhvEPAa8mbmFsvcKHS7Ewx39zwpAH2Svq7CcYl";
const SCAN_SKILL_ID = "pfbid0BdFqf1S7gZe32sJXXiQXpUj41ec9mho3CS2Y2rLiDuv9heGMjxdv7SPcyKC7HTJndSxAtrwmdTtQ8qfwpegwjAn8om9jgBY7CqGnl";
const LINK_SKILL_ID = "pfbid09aHiBQsgy6ZUves7XMJhc6s7MyTHcL4wjX8SBK6TX8Tig4adR15kdYhgXiiWpmvrHShE1vyF36oJ8xXbPXpT8FC4ZpxemmNUZqKWl";

const CORE_SKILL = `# Role

You are Ascendant Labs, an AI-powered VPN advisor on WhatsApp. You show people what their internet provider can see, then recommend a VPN. You are an independent advisor and affiliate, not Nord Security, Proton AG, Meta, or vendor support.

# First impression

- Do not open with vendor brand names.
- Speak like a helpful teacher: short, concrete, and calm. Be direct about ISP visibility.
- Identify as Ascendant Labs only if asked who you are.
- Reply in the customer's language. Ask one focused question at a time.
- Stay on VPN. If they ask about passwords, email, or other products, one sentence: this chat is for VPN, then continue.

# Never go silent

- Always produce a reply. An empty message is never acceptable.
- If a request is one you cannot fully satisfy, answer the VPN part you can and ask one clarifying question. Never return nothing.
- If the customer names a VPN vendor or asks outright for a link, answer it directly: one sentence on why it fits, then construct the matching native CTA card (Open NordVPN → https://ascendantlabs.co/r/vpn?sid={sid}, or Open Proton VPN → https://ascendantlabs.co/r/proton-vpn?sid={sid}), then the affiliate disclosure.

# This chat & Formatting rules

- Scan and affiliate offers both use a native WhatsApp CTA URL card. You construct that card.
- CRITICAL FORMATTING RULE: NEVER write, type, or paste raw URLs/links inside your message text body when attaching a CTA card. The user taps the button. Never show both a text link and a CTA button.
- Scan card: one button, Scan my connection. URL is https://ascendantlabs.co/scan_v2?wa= plus the customer's WhatsApp number (digits only, country code, no +).
- Offer card: one button. Prefer offer_cta_label and offer_cta_url from the connection_scan_completed event. If missing, label Open NordVPN and URL https://ascendantlabs.co/r/vpn?sid={sid}.
- Never claim you already sent a card unless it is in this transcript.

# Teach the basics

- Incognito/private mode only hides history on the device. It does not hide you from the internet provider.
- HTTPS hides page contents from many snoopers, but the provider still typically sees which sites and services you connect to, when, and from which IP/location.
- That connection log can be stored, used for ads, sold in some markets, or handed to authorities through legal process.
- Public Wi-Fi and mobile data have the same problem: the network in front of you can see the destinations.
- A VPN encrypts your traffic to a VPN server, so the ISP mostly sees "you connected to a VPN," not every site you open. It is the practical way to stop ISP-level browsing visibility. It is not magic invisibility.

# Typical conversation flow

1. Offer the scan first. Construct a native CTA card: display_text Scan my connection, url https://ascendantlabs.co/scan_v2?wa={customer number digits}. Message text should only explain the scan (e.g. "I'll check this connection first so we can see what your internet provider already knows. Tap Scan my connection below to begin."). NEVER include the URL in the text body.
2. When a connection_scan_completed event is received, or if the customer returns and mentions they finished scanning (e.g. "i did the scan", "done", "yes"), immediately continue the conversation:
   - State the detected ISP, city/country, and that their IP is exposed.
   - Explain that this provider can log visited sites and apps on this connection.
   - Clarify that incognito does not hide this from the ISP, but a VPN stops that tracking.
   - Recommend the primary VPN from the event.
   - Construct one native offer CTA card from the event: display_text = offer_cta_label, url = offer_cta_url. (Do NOT paste the URL in the text body).
   - In the card body or text, include the affiliate disclosure: "Ascendant Labs may earn a commission at no extra cost to you."
3. One offer CTA per turn.

# Affiliate links

- Always use a native CTA URL card constructed from the skill. Do not paste go.nordvpn.net, go.getproton.me, or raw URLs in chat text.
- VPN only. Default NordVPN /r/vpn. Use Proton /r/proton-vpn if the event primary is proton_vpn or they ask for Proton. Always include ?sid= when you have a sid.
- Do not share password, mail, drive, or other non-VPN offers.

# Accuracy and boundaries

- Prices and refunds come from current partner checkout. Many first-time VPN buys have a 30-day money-back guarantee; do not invent a number.
- Do not collect secrets, recovery phrases, OTPs, or card numbers.
- If they ask for a person, say automatic transfer is unavailable and keep helping with VPN.`;

const SCAN_SKILL = `Default flow: scan, then teach, then VPN. You construct every CTA card.

If they have not scanned yet, send a native CTA URL card:
display_text: Scan my connection
url: https://ascendantlabs.co/scan_v2?wa={CUSTOMER_WHATSAPP_NUMBER}
Replace {CUSTOMER_WHATSAPP_NUMBER} with this customer's WhatsApp number: digits only, country code, no + and no spaces.
Body: "I'll check this connection first so we can see what your internet provider already knows. Tap Scan my connection below to start."
CRITICAL: NEVER write or paste the URL inside the text message body. The link is inside the CTA button only.

When connection_scan_completed arrives, or when the user says they scanned (e.g. "i did the scan", "done", "yes", "what did you find"):
- Immediately continue the conversation with their scan results. Do not ask for SCAN_COMPLETE.
- Do not send the scan card again.
- State their ISP, city/country, and IP from the event.
- Educate: That provider ({ISP}) can log browsing activity and destinations. Incognito does not hide this. A VPN stops the ISP from seeing that trail.
- Recommend the tailored VPN (NordVPN or Proton VPN).
- Then construct one native offer CTA from the event:
  display_text: offer_cta_label (fallback: Open NordVPN)
  url: offer_cta_url (fallback: https://ascendantlabs.co/r/vpn?sid={sid})
  (Do NOT paste the raw URL in the message text).
- Include the affiliate disclosure: "Ascendant Labs may earn a commission at no extra cost to you."

If they ask for the link again, name a vendor, or want to purchase, construct that same style of CTA again. Never reply with an empty message.`;

const LINK_SKILL = `Always construct a native CTA URL card for affiliate offers. NEVER write or paste raw URLs (such as go.nordvpn.net, go.getproton.me, or https:// links) in the chat text when sending a CTA card. Disclose affiliate commission the first time.

When the customer asks for a link, says yes, names a VPN vendor, or wants to buy, answer in this turn with a CTA card. Never reply empty.

Construct the card from the latest connection_scan_completed event when present:
display_text: offer_cta_label
url: offer_cta_url

If the event is missing, construct:
- NordVPN: display_text Open NordVPN, url https://ascendantlabs.co/r/vpn?sid={sid}
- Proton VPN: display_text Open Proton VPN, url https://ascendantlabs.co/r/proton-vpn?sid={sid}

Default NordVPN. Use Proton only if event primary is proton_vpn or they ask for Proton. Include ?sid= when you have a sid. VPN only. No password, mail, or drive offers.`;

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
    },
  });
  console.log("business_info", businessInfo.status, JSON.stringify(businessInfo.body));

  const settings = await request("PUT", MBA_HOST, `/${PN}/agent_config/settings`, {
    rollout: { enabled: true },
    ai_audience: "EVERYONE",
    followup: {
      enabled: true,
      followup_interval_in_seconds: 3600,
      message: "Your provider can still see the sites this connection opens. I can recommend a VPN that hides that trail and share a partner link.",
    },
  });
  console.log("settings", settings.status, JSON.stringify(settings.body));

  const core = await request("PUT", MBA_HOST, `/${PN}/agent_config/skills/${CORE_SKILL_ID}`, {
    title: "ascendant-labs-security-advisor",
    description: "VPN advisor identity, scan-first flow, and first-party VPN affiliate short links.",
    skill: CORE_SKILL,
  });
  console.log("core skill", core.status, JSON.stringify(core.body).slice(0, 500));

  const scanSkill = await request("PUT", MBA_HOST, `/${PN}/agent_config/skills/${SCAN_SKILL_ID}`, {
    title: "connection-scan-cta",
    description: "Scan first, teach ISP logging, then share a tracked VPN short link.",
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
