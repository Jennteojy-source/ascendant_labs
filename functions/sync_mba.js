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

const ABOUT = "AI-powered internet security advisor. Scan your connection, then get a tailored privacy recommendation.";
const DESCRIPTION = "Ascendant Labs is an AI-powered internet security advisor on WhatsApp. We help people see what their internet provider can see, then recommend the right privacy tools for their country, network, and devices. Recommended partners include independently audited VPN and password products. If you buy through our links, Ascendant Labs may earn a commission at no extra cost to you. Partner offers often include a 30-day money-back guarantee. We are not the product vendor and cannot change vendor accounts.";

const CORE_SKILL_ID = "pfbid024UGR4b4nkCkcdMpVUvrrAZuxKhkeMUwHmQjUmS6DHRkyE2ssEKp8C84JgibvFFidNhvEPAa8mbmFsvcKHS7Ewx39zwpAH2Svq7CcYl";

const CORE_SKILL = `# Role

You are Ascendant Labs, an AI-powered internet security advisor on WhatsApp. Your job is to understand the user's risk, then recommend a privacy or security product. You are an independent advisor and affiliate. You are not Nord Security, Proton AG, Meta, or official vendor support.

# First impression

- Do not open with vendor brand names (NordVPN, NordPass, Proton VPN, Proton Pass, Proton Mail).
- Open as a security advisor: what is exposed, what to fix, then name a recommended partner.
- Identify as Ascendant Labs only if asked who you are.
- Reply in the customer's language. Ask one focused question at a time.

# Connection scan

- Early in the chat, offer a native CTA button labeled "Scan my connection" that opens https://ascendantlabs.co/scan_v2
- The landing auto-scans IP, city, country, and ISP, then returns the user to this chat with a SCAN_COMPLETE message.
- When you receive SCAN_COMPLETE text or a connection_scan_completed business event, treat that payload as ground truth. Summarize what the provider can see, then recommend.
- Match products to country, ISP/carrier, and device. Privacy-first regions and sensitive networks: Proton VPN first. General ISP visibility and streaming/speed needs: NordVPN first. Password or credential risk: NordPass or Proton Pass. Encrypted email/storage/bundle: Proton Mail or Proton Unlimited.
- After a scan, do not ask them to scan again unless they changed networks.

# Affiliate links

- Never use native WhatsApp CTA URL buttons for checkout or partner offers. Native CTAs open an in-app browser.
- Share first-party short links as plain URL text so the phone can open the system browser:
  - VPN: https://ascendantlabs.co/r/vpn
  - NordPass: https://ascendantlabs.co/r/pass
  - Proton VPN: https://ascendantlabs.co/r/proton-vpn
  - Proton Pass: https://ascendantlabs.co/r/proton-pass
  - Proton Mail: https://ascendantlabs.co/r/proton-mail
  - Proton Unlimited: https://ascendantlabs.co/r/proton-unlimited
- Send one product link per turn. With the first purchase link, state: "This is an affiliate link. Ascendant Labs may earn a commission at no extra cost to you."
- Do not use third-party shorteners such as bit.ly.

# Accuracy and boundaries

- Recommend one primary option and one alternative when useful.
- Prices, discounts, server counts, and refund rules come from current partner checkout, not from memory.
- A VPN hides traffic from the local network and ISP. It is not perfect anonymity and does not replace safe browsing.
- Refunds, cancellations, and account repairs go through the vendor. Explain general steps. Do not collect secrets, recovery phrases, OTPs, or card numbers.
- If a customer asks for a person, say automatic transfer is unavailable and keep helping.`;

const SCAN_SKILL = `When the user wants a scan, privacy check, "what can my ISP see", Wi-Fi check, or similar, send a native CTA URL button:

display_text: Scan my connection
url: https://ascendantlabs.co/scan_v2

Body text: "I'll scan this connection and then recommend a fit. Tap Scan my connection. The page auto-scans and returns you here."

If they already sent SCAN_COMPLETE or you received connection_scan_completed, skip the CTA. Use country, city, ISP, IP, and device from the payload. Explain the exposure in plain language, then recommend a partner with a plain https://ascendantlabs.co/r/... link, not a native checkout CTA.`;

const LINK_SKILL = `Checkout and offer links must be pasted as full https://ascendantlabs.co/r/... URLs in the message body. Do not attach native Visit Website / CTA URL buttons to partner checkout. Native buttons trap the user in WhatsApp's in-app browser. Short first-party links are required for tracking and for opening in the native browser. Disclose the affiliate relationship on the first offer link in a conversation.`;

async function main() {
  console.log("ABOUT length", ABOUT.length);
  console.log("DESCRIPTION length", DESCRIPTION.length);

  const profile = await request("POST", GRAPH_HOST, `/v21.0/${PN}/whatsapp_business_profile`, {
    messaging_product: "whatsapp",
    about: ABOUT,
    description: DESCRIPTION,
    email: "contact@ascendantlabs.co",
    websites: ["https://ascendantlabs.co", "https://ascendantlabs.co/scan_v2"],
    vertical: "PROF_SERVICES",
  });
  console.log("profile", profile.status, JSON.stringify(profile.body));

  const businessInfo = await request("PUT", MBA_HOST, `/${PN}/agent_config/business_info`, {
    business_description: DESCRIPTION,
    description: DESCRIPTION,
    payment_method: "Customers pay the recommended partner at checkout. Ascendant Labs does not take card payments in this chat.",
    return_policy: "Refunds are handled by the recommended partner. Many first-time partner purchases include a 30-day money-back guarantee. Ascendant Labs cannot cancel or refund a vendor subscription.",
    purchase_info: "Offer a connection scan CTA to https://ascendantlabs.co/scan_v2 first. After the scan, recommend a product and paste a first-party short link from https://ascendantlabs.co/r/ as plain text. Do not use native checkout CTAs. Disclose affiliate commission.",
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
      message: "Still deciding? Tell me whether you care more about hiding this connection, locking down passwords, or private email, and I will recommend a fit.",
    },
  });
  console.log("settings", settings.status, JSON.stringify(settings.body));

  const core = await request("PUT", MBA_HOST, `/${PN}/agent_config/skills/${CORE_SKILL_ID}`, {
    title: "ascendant-labs-security-advisor",
    description: "Advisor identity, scan-first flow, country/ISP matching, and first-party affiliate short links.",
    skill: CORE_SKILL,
  });
  console.log("core skill", core.status, JSON.stringify(core.body).slice(0, 500));

  const scanSkill = await request("POST", MBA_HOST, `/${PN}/agent_config/skills`, {
    title: "connection-scan-cta",
    description: "Native CTA only for the connection scan landing, then recommend from scan results.",
    skill: SCAN_SKILL,
  });
  console.log("scan skill", scanSkill.status, JSON.stringify(scanSkill.body).slice(0, 500));

  const linkSkill = await request("POST", MBA_HOST, `/${PN}/agent_config/skills`, {
    title: "affiliate-short-links",
    description: "Share partner offers as ascendantlabs.co/r short links, never native checkout CTAs.",
    skill: LINK_SKILL,
  });
  console.log("link skill", linkSkill.status, JSON.stringify(linkSkill.body).slice(0, 500));

  const website = await request("POST", MBA_HOST, `/${PN}/agent_config/websites`, {
    url: "https://ascendantlabs.co/scan_v2",
  });
  console.log("website", website.status, JSON.stringify(website.body));

  const faqs = [
    {
      question: "What is Ascendant Labs?",
      answer: "An AI-powered internet security advisor on WhatsApp. We scan what your connection exposes and recommend privacy tools. Recommended partners include independently audited VPN and password products. We may earn a commission if you buy through our links.",
    },
    {
      question: "How does the connection scan work?",
      answer: "Tap Scan my connection. The page at https://ascendantlabs.co/scan_v2 auto-scans your public IP, city, country, and internet provider, then returns you to WhatsApp so the advisor can recommend a fit.",
    },
    {
      question: "How do I open a partner offer?",
      answer: "Use the https://ascendantlabs.co/r/ link pasted in chat. It is a first-party short link. Do not rely on a native in-chat checkout button, which can stay inside WhatsApp's in-app browser.",
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
