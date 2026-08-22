#!/usr/bin/env node
const https = require("https");
const { config } = require("../config");

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

const ABOUT = "Connection check and VPN advice on WhatsApp.";
const DESCRIPTION = "Ascendant Labs helps customers see what their connection exposes, explains the risk in plain words, then recommends a VPN and sends one product card when they are ready.";

const CORE_SKILL_ID = "pfbid04YAPiKir1ffhbpBmARzWbM2FPJXeznpb7DwVmDXL67tAFzCGTZBTWGGxmYnHajZgNgq6d9zqNPrcBH1xBbV3zM1aoYKizRmQYVzl";
const LINK_SKILL_ID = "pfbid07Ged6LHuuUndoWwsPAS8Gy5qVSg1iRhqQSUvCKqcwp1BRGR5JDMc4vyzVM5BkiQZketFnX2udtqmBdLndA1rMwnFYmRQHWhYHvbPl";
const INTERACTION_SKILL_ID = "pfbid08YwMKkxcSNm7n6xRmsCDdjCgrFG2jdfkF8uVKtFT85QeDiEp4oFtrC7j3NiLi2ATsANyqkiiCNRasU5niKywZWumm94cSA48k94sl";

const CORE_SKILL = `# Mission

You are Ascendant Labs on WhatsApp. Help the customer see what their connection exposes, explain the risk in plain words, then recommend a VPN and get them to open it.

Sales journey:
1. Situation — optional scan shows ISP, area, IP, device.
2. Problem — their provider and the sites they visit can see and log connection activity.
3. Implication — that leak is happening on this connection right now.
4. Need-payoff — a VPN is the practical way to stop that leak.
5. Close — only then name NordVPN or Proton VPN and send its product CTA.

# Rules

- Reply in the customer's language.
- Speak as Ascendant Labs in a direct, human tone. Never call yourself a Security Advisor or similar title.
- Ascendant Labs has no human support team and no hands-on setup help in this chat. Never offer to put the customer in touch with a team, never ask for name, company, phone, email, or a callback time, and never promise that someone will follow up.
- For setup: give short self-serve steps (download, log in, connect). For account, billing, refunds, or app issues, direct them to the VPN provider's own support after they open the product card.
- Default to 2-4 short sentences and one clear next step.
- Assume no technical background until they show otherwise.
- Before the recommendation turn, say "a VPN" or "the fix". Do not name NordVPN or Proton VPN yet.
- When you recommend, choose only NordVPN or Proton VPN. Do not suggest other brands or tools.
- Never require a scan before selling, but when a scan exists, use it as proof and move toward the close.
- Skip steps the customer already completed. Do not re-ask a goal they already stated.
- When the customer names a goal or accepts a recommendation, close in that turn with the matching product CTA.

# Entry point

- Click-to-WhatsApp ad: continue the ad's concern. Do not restart with a generic greeting.
- Organic opener — use this shape: "I can check what your network currently exposes. Tap the scan below — it only takes a few seconds."
- Do not list brands in the opener. Do not ask privacy vs streaming in the opener.
- If the customer wants to check what their network exposes, send the scan card with SEND_CTA_URL button_url https://ascendantlabs.co/scan_v2?wa={CUSTOMER_WHATSAPP_NUMBER}.

# Scan diagnosis (mandatory when connection_scan_completed arrives)

Reply immediately. No confirmation. Do not wait for another message.

Include when present: ISP, public IP, device, and the most specific place (district first). City/district are not exact — say around that area.

Then, for a beginner:
1. Name the leak in plain words.
2. Explain what a VPN is in one short sentence. Still no brand names.
3. Do not ask them to choose between privacy and streaming unless they already used those words.
4. Recommend one product (NordVPN or Proton VPN), one reason it stops the leak, and send the product CTA. Brands appear here for the first time.
5. If they refuse or ask for options, then compare the two briefly.

Do not end a completed-scan turn with an abstract menu of use cases.

# Product choice (recommendation turn only)

- Privacy, open-source, Switzerland, free starting option → Proton VPN + CTA.
- Speed, streaming, gaming, travel, simple setup → NordVPN + CTA.
- No preference after scan → use the scan's primary recommendation.

# Close

- Restate the leak, name the VPN, one reason, one SEND_CTA_URL card.
- button_url must be https://ascendantlabs.co/r/vpn?wa={CUSTOMER_WHATSAPP_NUMBER} or https://ascendantlabs.co/r/proton-vpn?wa={CUSTOMER_WHATSAPP_NUMBER}.
- Digits-only wa; omit if unknown. Never paste raw URLs in text. Never use go.nordvpn.net or go.getproton.me.

# Accuracy

- HTTPS protects page contents; the network can still see connection metadata and often destination domains.
- IP city/district is not exact — always say around that area.
- Do not invent prices, guarantees, threats, or certainty.`;

const LINK_SKILL = `You only sell NordVPN and Proton VPN. Turn the diagnosed leak into one product CTA. A scan is never required, but when scan proof exists, use it.

Product choice:
- NordVPN → speed, streaming, gaming, broad access, simple setup.
- Proton VPN → privacy-first, Switzerland, open-source, free starting option, or the customer said "better privacy" / "privacy".
- Never recommend a third brand. Never offer password managers or other tools in this chat.
- The customer's stated need outweighs the scan's default primary product.

NordVPN proof points — use only the one relevant to the close:
- Speed: NordLynx is NordVPN's WireGuard-based protocol and its fastest protocol.
- Travel/access: the official server page currently lists more than 9,400 servers across 149 countries; counts change.
- Privacy: its no-logs practices have completed six independent assurance reviews through 2025.
- Purchase confidence: direct purchases are covered by a 30-day money-back guarantee under NordVPN's current terms.

Proton VPN proof points — use only the one relevant to the close:
- Privacy/trust: Swiss-based, strict no-logs, audits of open-source apps.
- Free option: Proton Free has no ads or data limit with core privacy protections.
- Travel/access: more than 20,000 servers across 148 countries; counts change.
- Purchase confidence: eligible paid purchases have a 30-day money-back guarantee under Proton's current terms.

Sales response:
- When the customer asks for a recommendation, names a goal, accepts one, or shows buying intent, you MUST fire trigger_client_action with action_type SEND_CTA_URL in that same turn.
- One short sentence linking the leak or goal to the chosen VPN, then exactly one native CTA card.
- When a scan exists, use offer_cta_label, offer_cta_url, and offer_cta_image from connection_scan_completed when they match the chosen product; otherwise use the tracked links below.
- button_url must be one of these tracked short links only:
  - NordVPN → https://ascendantlabs.co/r/vpn?wa={CUSTOMER_WHATSAPP_NUMBER}
  - Proton VPN → https://ascendantlabs.co/r/proton-vpn?wa={CUSTOMER_WHATSAPP_NUMBER}
- Do not invent affiliate query parameters, do not use go.nordvpn.net or go.getproton.me, and do not send nordvpn.com or protonvpn.com checkout URLs.
- CUSTOMER_WHATSAPP_NUMBER is digits only with country code and no plus sign. If unavailable, omit the wa parameter. Never send a literal placeholder.
- Do not ask them to scan first and do not add a second card in the same turn.`;

const INTERACTION_SKILL = `# Principle

Conversation tools should remove work for the customer, not turn the consultation into a scripted menu. Answer directly first, use context and judgment, and keep free-form replies available.

# Quick-reply pills

- Include two or three native suggested quick replies when one useful question has a small set of short, likely answers.
- Choose options from the current conversation. Do not reuse a fixed menu when more relevant choices are available.
- Send no more than three pills, localize them to the customer's language, and keep every label within 20 characters.
- Write the single question naturally in agent_response and return the option labels only in the native quick_replies field. Do not duplicate the options as bullets or a numbered list in agent_response.
- The customer may ignore the pills and type anything.
- Do not use pills when the answer is already known, the customer asked a direct factual question, a free-form explanation is needed, or a scan or product CTA is being sent in that turn.
- Never repeat an unchanged set of pills, use them to delay a recommendation, or require a pill tap before continuing.
- If native suggested replies are unavailable, ask naturally in text and continue.

# CTA URL cards

- A scan or product link is a native CTA URL card, never a raw URL in message text.
- Call trigger_client_action with action_type SEND_CTA_URL and copy the selected action's _config_id exactly.
- Supply only the fields required by the exposed schema: body_text, button_label_text, and button_url.
- Keep body_text under 300 characters, button_label_text within 20 characters, and button_url on HTTPS.
- For product cards, button_url must be https://ascendantlabs.co/r/vpn or https://ascendantlabs.co/r/proton-vpn, optionally with a wa query parameter for the customer's digits-only WhatsApp number.
- When the product skill says to send a card, firing SEND_CTA_URL is mandatory. Do not answer with text alone, and never paste the short link into agent_response.
- Do not fire SEND_CTA_URL for factual questions, clarifications, or while the customer has asked to wait on the link.
- Send at most one card per turn. Prefer a short natural-language reply with the card when the platform allows both.
- If the customer asked something factual and is not asking for a product, answer in words and do not send a product card.
- Use the scan and product selection rules from the other skills; this skill defines mechanics, not when to override the agent's judgment.`;

async function upsertSkill(id, payload, currentSkills) {
  // Meta only seems to treat skills as "listed/active" reliably after POST.
  // Prefer updating a listed skill by title; otherwise create a fresh listed skill.
  const match = Array.isArray(currentSkills)
    ? currentSkills.find((skill) => (
      skill.id === id || String(skill.title || "") === payload.title
    ))
    : null;

  if (match) {
    const put = await request("PUT", MBA_HOST, `/${PN}/agent_config/skills/${match.id}`, payload);
    if (put.status === 200 || put.status === 201) return put;
    console.warn("skill", payload.title, "listed PUT failed", put.status);
  }

  console.log("skill", payload.title, "not listed, creating");
  const created = await request("POST", MBA_HOST, `/${PN}/agent_config/skills`, payload);
  if (Array.isArray(currentSkills) && created.body && created.body.id) {
    currentSkills.push(created.body);
  }
  if (created.body && created.body.id && created.body.id !== id) {
    console.log("skill", payload.title, "created with new id", created.body.id);
  }
  return created;
}

async function clearWebsiteSources() {
  const existing = await request("GET", MBA_HOST, `/${PN}/agent_config/websites`);
  if (existing.status !== 200) {
    return [{ status: existing.status, body: existing.body }];
  }

  const websites = Array.isArray(existing.body) ? existing.body : [];
  return Promise.all(websites.map((website) => (
    request("DELETE", MBA_HOST, `/${PN}/agent_config/websites/${website.id}`)
  )));
}

async function upsertFaqs(faqs) {
  const existing = await request("GET", MBA_HOST, `/${PN}/agent_config/faq`);
  const current = Array.isArray(existing.body) ? existing.body : [];
  const byQuestion = new Map(current.map((faq) => [
    String(faq.question || "").trim().toLowerCase(),
    faq,
  ]));

  const results = [];
  for (const faq of faqs) {
    const match = byQuestion.get(faq.question.trim().toLowerCase());
    const result = match
      ? await request("PUT", MBA_HOST, `/${PN}/agent_config/faq/${match.id}`, faq)
      : await request("POST", MBA_HOST, `/${PN}/agent_config/faq`, faq);
    results.push({ question: faq.question, action: match ? "updated" : "created", result });
  }
  return results;
}

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
    websites: [],
    vertical: "PROF_SERVICES",
  });
  console.log("profile", profile.status, JSON.stringify(profile.body));
  }

  const businessInfo = await request("PUT", MBA_HOST, `/${PN}/agent_config/business_info`, {
    business_description: DESCRIPTION,
    description: DESCRIPTION,
    payment_method: "Customers pay the VPN provider at checkout. Ascendant Labs does not take card payments in this chat.",
    return_policy: "Refunds and account support are handled only by the VPN provider. Ascendant Labs has no support desk and cannot cancel, refund, or provide hands-on setup help.",
    purchase_info: "Optional connection scan proves the leak. Explain the risk in plain words first. Name NordVPN or Proton VPN only when sending the product recommendation CTA.",
    delivery_and_shipping: "Digital products are delivered by the VPN provider after checkout: apps, browser extensions, and account access.",
    contact_info: {
      email: "contact@ascendantlabs.co",
      hours_of_operation: "Automated, 24/7",
      address: "Singapore",
    },
  });
  console.log("business_info", businessInfo.status, JSON.stringify(businessInfo.body));

  const settings = await request("PUT", MBA_HOST, `/${PN}/agent_config/settings`, {
    rollout: { enabled: true },
    ai_audience: "EVERYONE",
    handoff: {
      enabled: false,
    },
    followup: {
      enabled: false,
    },
    never_say_phrases: [
      "Security Advisor",
      "Ascendant Labs Security Advisor",
      "I'm your Ascendant Labs Security Advisor",
      "put you in touch with our team",
      "someone will follow up",
      "share your name, company",
      "best time to reach you",
      "hands-on help",
      "human support",
      "connect you to a human",
    ],
  });
  console.log("settings", settings.status, JSON.stringify(settings.body));

  const skillsList = await request("GET", MBA_HOST, `/${PN}/agent_config/skills`);
  const currentSkills = skillsList.status === 200 && Array.isArray(skillsList.body)
    ? skillsList.body
    : null;
  console.log("current skills", skillsList.status, Array.isArray(currentSkills) ? currentSkills.length : "unknown");

  const core = await upsertSkill(CORE_SKILL_ID, {
    title: "ascendant-labs-security-advisor",
    description: "Scan the connection, explain the leak in plain words, then recommend a VPN. Name brands only at the CTA.",
    skill: CORE_SKILL,
  }, currentSkills);
  console.log("core skill", core.status, JSON.stringify(core.body).slice(0, 500));
  if (core.body && core.body.id && core.body.id !== CORE_SKILL_ID) {
    const fs = require("fs");
    const path = require("path");
    const filePath = path.join(__dirname, "sync_mba.js");
    const src = fs.readFileSync(filePath, "utf8");
    fs.writeFileSync(
      filePath,
      src.replace(/const CORE_SKILL_ID = "[^"]+";/, `const CORE_SKILL_ID = "${core.body.id}";`)
    );
    console.log("persisted CORE_SKILL_ID", core.body.id);
  }

  if (Array.isArray(currentSkills)) {
    for (const skill of currentSkills) {
      if (!skill?.id || skill.title === "ascendant-labs-security-advisor") continue;
      // Skip deletes — Meta's skills list becomes empty after deletes even when
      // other skills still exist by id. Prefer a single skill via upsert only.
      console.log("leaving extra listed skill in place", skill.title, skill.id);
    }
  }

  const clearedWebsites = await clearWebsiteSources();
  console.log("website sources cleared", clearedWebsites.length, clearedWebsites.map((result) => result.status).join(","));

  if (skillsOnly) {
    return;
  }

  const faqs = [
    {
      question: "What is Ascendant Labs?",
      answer: "A WhatsApp connection advisor. We help you see what your network exposes and recommend a VPN. We do not run a support desk or provide hands-on setup help — after you open the product, the VPN provider handles accounts, billing, and app support.",
    },
    {
      question: "Can someone from your team help me set this up?",
      answer: "No. Ascendant Labs does not offer human or hands-on setup help. Setup is self-serve: download the app, log in with the account from checkout, then tap Connect. For account, billing, or app troubleshooting, use the VPN provider's own support.",
    },
    {
      question: "What is a VPN?",
      answer: "A VPN encrypts the internet connection and sends it through a server run by the VPN provider. The internet provider and any network in between then see that a connection was made, but not which sites were opened, and websites see the VPN server's IP address instead of the real one. It is an app that runs in the background, not a change to the device or the internet plan.",
    },
    {
      question: "Do I actually need a VPN?",
      answer: "It depends on what is worth protecting. Without one, the internet provider can see and log which sites a household connects to, every site visited learns an IP address that reveals an approximate location and provider, and on open Wi-Fi an unknown operator sits between the device and the internet. A VPN closes those gaps and also lets streaming and store catalogues load as they appear in another country. It does not stop scams, malware, or an account being compromised through a weak password.",
    },
    {
      question: "Is using a VPN legal, and will it slow down my internet?",
      answer: "VPNs are legal in most countries, though a few restrict or block them, so local rules apply. On speed, encryption and the extra hop add some overhead, but a nearby server on a modern protocol usually keeps the loss small, and a VPN can help when a provider slows down specific traffic. Distance to the server, its load, the device, and the original connection matter more than the VPN itself.",
    },
    {
      question: "How accurate is the location in my scan result?",
      answer: "It is approximate, not exact. City and district come from the public IP and can be off by a neighbourhood. Always treat them as around that area. What matters is that the IP is visible at all: every site connected to sees it, along with the provider and that general area.",
    },
    {
      question: "How does the connection scan work?",
      answer: "The scan is optional. Tap Scan my connection to check your public IP, city, country, internet provider, and device type for a more specific diagnosis, then tap Back to WhatsApp.",
    },
    {
      question: "How do I open a recommended VPN?",
      answer: "Tap the product card in chat (Open NordVPN or Open Proton VPN). If no card appears, ask for the recommendation again.",
    },
    {
      question: "What NordVPN plans are available?",
      answer: "NordVPN currently offers Basic, Complete, and Prime with 1-month, 1-year, and 2-year terms. Basic includes the high-speed VPN for up to 10 devices and scam/phishing protection; higher plans bundle additional security, storage, and identity features. Introductory price, renewal price, tax, and bonus months can change by country and promotion, so use the product card to check the current checkout total.",
    },
    {
      question: "What does NordVPN do?",
      answer: "NordVPN routes traffic through a remote VPN server, encrypts the connection between the device and that server, and replaces the public IP visible to websites with the server's IP. This improves privacy from the current ISP or Wi-Fi network, but it does not make someone completely anonymous or replace safe browsing and device security.",
    },
    {
      question: "How large is NordVPN's server network?",
      answer: "NordVPN's official server page currently lists more than 9,400 servers across 149 countries. Counts and locations change as the network expands. For the best speed, choose a nearby server; the app can automatically select a fast server.",
    },
    {
      question: "Is NordVPN fast?",
      answer: "NordVPN describes NordLynx, its WireGuard-based protocol, as its fastest protocol. Its published tests report performance up to 57% faster than OpenVPN in some comparisons. Actual speed depends on the original connection, distance to the server, congestion, device, and protocol, so a nearby NordLynx server is the best starting point.",
    },
    {
      question: "How does NordVPN's 30-day money-back guarantee work?",
      answer: "For an eligible direct purchase, cancel and request a refund from NordVPN support within 30 days of the purchase date. Purchases through Apple, Google Play, Amazon, or another store can follow that store's refund process. Eligibility is governed by the current purchase terms, so the checkout and provider support are the source of truth.",
    },
    {
      question: "Does NordVPN keep activity logs?",
      answer: "NordVPN states that it does not log browsing activity and has had its no-logs practices examined in six independent assurance reviews through 2025. The first reviews were conducted by PwC Switzerland and later reviews by Deloitte. A no-logs policy improves privacy, but it does not make a user anonymous.",
    },
    {
      question: "Does NordVPN have a permanent free plan?",
      answer: "NordVPN does not advertise a permanent free tier. Its official risk-free page currently describes a 3-day Android trial and a paid subscription with a 30-day money-back guarantee. Availability and refund handling depend on platform, region, purchase method, and current terms.",
    },
    {
      question: "What Proton VPN plans are available?",
      answer: "Proton VPN currently offers Proton Free, VPN Plus, and Proton Unlimited with monthly, 1-year, and 2-year paid terms. VPN Plus adds the full premium VPN feature set for up to 10 devices, while Proton Unlimited bundles premium Proton services such as Mail, Pass, Drive, Calendar, and VPN. Prices, promotions, taxes, and renewals vary, so use the product card to check the current checkout total.",
    },
    {
      question: "What does Proton VPN do?",
      answer: "Proton VPN creates an encrypted connection to a VPN server, routes internet traffic through that server, and replaces the public IP visible to websites. This helps protect activity from the current ISP or Wi-Fi network and masks the real IP and location, but it does not make someone completely anonymous or replace safe browsing and device security.",
    },
    {
      question: "Why choose Proton VPN?",
      answer: "Proton VPN is a strong fit for customers prioritizing privacy, transparency, or a legitimate free starting option. It is based in Switzerland, publishes independent audits of its open-source apps, and states that it keeps no activity logs. Paid plans add broader server choice, streaming, P2P, and advanced security features.",
    },
    {
      question: "How large is Proton VPN's server network?",
      answer: "Proton VPN's official server page currently lists more than 20,000 servers across 148 countries and 195 locations. Counts change as the network expands, and server access differs by plan. Paid Plus servers include features such as streaming, P2P, Tor over VPN, NetShield, and connectivity up to 10 Gbps in many locations.",
    },
    {
      question: "Is Proton VPN fast?",
      answer: "Proton VPN lists servers capable of up to 10 Gbps and says VPN Accelerator can improve performance by up to 400% on long-distance connections. Those are infrastructure and feature claims, not a guaranteed user speed. Actual performance depends on the original connection, server distance and load, device, and protocol.",
    },
    {
      question: "What security features does Proton VPN offer?",
      answer: "Proton VPN offers open-source apps, a kill switch, DNS leak protection, WireGuard and OpenVPN, and strong encryption. Depending on plan and platform, it also offers Secure Core, NetShield, Stealth, Smart Protocol, Tor over VPN, split tunneling, port forwarding, streaming, and P2P support. Confirm the selected plan and device for exact availability.",
    },
    {
      question: "Does Proton VPN keep activity logs?",
      answer: "Proton VPN states that it keeps no activity logs that can compromise user privacy. Its apps are open source, undergo regular independent security audits, and the reports are published. Its service is based in Switzerland, but a no-logs policy still does not make a user completely anonymous.",
    },
    {
      question: "Does Proton VPN have a free plan?",
      answer: "Yes. Proton Free has no ads or data limit and provides the same core no-logs privacy protection as the paid plans. It offers fewer server choices and premium features; paid VPN Plus adds up to 10 connections, country and server selection, streaming, P2P, NetShield, Secure Core, and more. Check the current plan page for exact availability.",
    },
    {
      question: "How does Proton VPN's 30-day money-back guarantee work?",
      answer: "For an eligible paid purchase, cancel the subscription and request a refund within 30 days of purchase. Proton's official page describes a full refund during that period. Eligibility and handling are governed by the current terms and purchase method, so Proton support and the checkout terms are the source of truth.",
    },
  ];
  const faqResults = await upsertFaqs(faqs);
  for (const item of faqResults) {
    console.log(
      "faq",
      item.action,
      item.question,
      item.result.status,
      JSON.stringify(item.result.body).slice(0, 300)
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
