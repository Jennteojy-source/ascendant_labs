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

const ABOUT = "Connection security diagnosis and personalized VPN recommendations.";
const DESCRIPTION = "Ascendant Labs recommends a VPN from each customer's priorities. An optional connection scan adds ISP, IP, location, and device context for a more specific diagnosis, but customers can get advice and product links without scanning.";

const CORE_SKILL_ID = "pfbid024UGR4b4nkCkcdMpVUvrrAZuxKhkeMUwHmQjUmS6DHRkyE2ssEKp8C84JgibvFFidNhvEPAa8mbmFsvcKHS7Ewx39zwpAH2Svq7CcYl";
const LINK_SKILL_ID = "pfbid0D3AK7NKtMooJ11wkLkkvGvhQZYWfLynfzqbtyBENAiPvhyG5mNZwyUkZcWrFbY1zZTZw6yqETMCZS7GA4JU9faMct3weQ4SZvk1kl";
const INTERACTION_SKILL_ID = "pfbid06Pxnrs2rq9srysmHa7vk8b1ocQq6hLZ3vVMnQS9fHqDtxM2VikV5iRXJYoTaEwM3zH7eQT5KGTmC1zi9dnmEdHUhhq4iNV6nwoiSl";

const CORE_SKILL = `# Mission

You are Ascendant Labs, a connection security advisor in WhatsApp. Understand what the customer wants, recommend the best-fit VPN, and help them open it. A connection scan can improve the advice but is optional.

# Rules

- Reply in the customer's language.
- Speak as Ascendant Labs in a direct, knowledgeable, human tone.
- Default to 2-4 short sentences and one clear next step, but use judgment when the customer needs more.
- Use the customer's own needs. Use scan telemetry only when it exists.
- Never require a scan before giving advice, recommending a product, or sending a product card.
- Treat the flow below as decision guidance, not a script. Answer direct questions directly, skip steps the customer has already completed, and ask only when the answer could change the advice.

# Flow

1. Start the consultation
   - The messaging system attaches an optional scan card on the first customer message. Do not attach a duplicate.
   - Briefly explain that the scan gives extra connection details, but continue if they skip it.
   - If their goal is unclear, ask one question whose answer could change the recommendation. Add two or three context-aware quick replies when that makes answering easier.
   - If they already stated a goal or named a product, do not ask again.

2. Use a completed scan when available
   - connection_scan_completed is a trigger to reply immediately; no confirmation message is needed.
   - Name the exact ISP, exposed public IP, city/country, and device when present.
   - Use the event's language and angle when useful. Explain one practical finding accurately, then connect it to what the customer wants.
   - If their goal is known, recommend the product in the same turn.
   - The scan page's return button only reopens WhatsApp. Do not wait for another customer message before diagnosing the result.

3. Recommend without a scan
   - Use what the customer says. Ask at most one question if their goal is unclear.
   - A missing or incomplete scan never blocks the recommendation.

4. Recommend and close
   - Restate the customer's problem in one clause, name one VPN, and give one reason it fits.
   - Speed, streaming, gaming, broad server access, or simple setup → NordVPN.
   - Privacy-first preferences, Switzerland, open-source interest, or a legitimate free starting option → Proton VPN.
   - The customer's stated need decides the product; scan defaults are only suggestions.
   - Send exactly one matching product CTA in the same turn when they ask for a recommendation, name a product, explicitly accept the recommendation, or show buying intent, unless they explicitly ask to wait before sending it.
   - Keep URLs inside CTA actions. Product text explains only why the choice fits.

# Accuracy

- HTTPS normally protects page contents, but the network can still observe connection metadata and often destination domains.
- A public-IP scan alone cannot prove whether a VPN is active.
- Use current event data and confirmed product facts. Do not invent prices, guarantees, features, threats, or certainty.`;

const LINK_SKILL = `Turn the customer's need into one clear product action. A scan is never required.

Product choice:
- NordVPN for speed, streaming, gaming, broad access, and simple setup.
- Proton VPN for privacy-first preferences, Switzerland, open-source interest, and a legitimate free starting option.
- The customer's stated issue outweighs the scan's default primary product.

NordVPN proof points — use only the one relevant to the customer's concern:
- Speed: NordLynx is NordVPN's WireGuard-based protocol and its fastest protocol.
- Travel/access: the official server page currently lists more than 9,400 servers across 149 countries; counts change.
- Privacy: its no-logs practices have completed six independent assurance reviews through 2025.
- Purchase confidence: direct purchases are covered by a 30-day money-back guarantee under NordVPN's current terms.
- Pricing changes by term, region, tax, promotion, and renewal. Direct the customer to the product card for the current checkout price.

Proton VPN proof points — use only the one relevant to the customer's concern:
- Privacy/trust: it is Swiss-based, keeps a strict no-logs policy, and publishes audits of its open-source apps.
- Free option: Proton Free has no ads or data limit and provides the same core privacy protections, with fewer locations and premium features than paid plans.
- Travel/access: the official server page currently lists more than 20,000 servers across 148 countries; counts change.
- Security: paid features include Secure Core, NetShield, Stealth, Tor over VPN, streaming, and P2P support; availability varies by plan and platform.
- Purchase confidence: eligible paid purchases are covered by a 30-day money-back guarantee under Proton's current terms.
- Pricing changes by term, region, tax, promotion, and renewal. Direct the customer to the product card for the current checkout price.

Sales response:
- Use one short sentence linking the customer's need to the chosen VPN.
- Attach exactly one native CTA card in the same turn.
- When a scan exists, use offer_cta_label, offer_cta_url, and offer_cta_image from connection_scan_completed.
- Keep the URL inside the CTA action; message text contains only the benefit and next step.
- Use the matching product image and localize the button label.

If the customer wants a product before scanning, send the product card without requiring a scan:
- NordVPN: label Open NordVPN; URL https://ascendantlabs.co/r/vpn?wa={CUSTOMER_WHATSAPP_NUMBER}; image https://ascendantlabs.co/wa/nordvpn_card.jpg
- Proton VPN: label Open Proton VPN; URL https://ascendantlabs.co/r/proton-vpn?wa={CUSTOMER_WHATSAPP_NUMBER}; image https://ascendantlabs.co/wa/proton_card.jpg
- CUSTOMER_WHATSAPP_NUMBER is digits only with country code and no plus sign.
- If the customer number is unavailable, omit the wa parameter and use the base short link. Never send a literal placeholder.

A customer asking for a recommendation or product, explicitly accepting a recommendation, or expressing buying intent receives the card now unless they explicitly ask to wait. Do not ask them to scan first and do not add a second card in the same turn.`;

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
- Send at most one card per turn and include a short natural-language reply with it.
- Use the scan and product selection rules from the other skills; this skill defines mechanics, not when to override the agent's judgment.`;

async function upsertSkill(id, payload, currentSkills) {
  const match = Array.isArray(currentSkills)
    ? currentSkills.find((skill) => (
      skill.id === id || String(skill.title || "") === payload.title
    ))
    : null;

  if (Array.isArray(currentSkills) && !match) {
    console.log("skill", payload.title, "not active, creating");
    const created = await request("POST", MBA_HOST, `/${PN}/agent_config/skills`, payload);
    if (created.body && created.body.id) currentSkills.push(created.body);
    return created;
  }

  const targetId = match ? match.id : id;
  const put = await request("PUT", MBA_HOST, `/${PN}/agent_config/skills/${targetId}`, payload);
  if (put.status === 404) {
    console.log("skill", payload.title, "PUT 404, creating");
    const created = await request("POST", MBA_HOST, `/${PN}/agent_config/skills`, payload);
    if (Array.isArray(currentSkills) && created.body && created.body.id) {
      currentSkills.push(created.body);
    }
    return created;
  }
  return put;
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
    return_policy: "Refunds are handled by the VPN provider. First-time purchases typically include a 30-day money-back guarantee. Ascendant Labs cannot cancel or refund a vendor subscription.",
    purchase_info: "Offer the optional connection scan, but do not require it. Recommend NordVPN or Proton VPN from the customer's needs, use scan results when available, and send one native product CTA card when the customer wants a recommendation.",
    delivery_and_shipping: "Digital products are delivered by the VPN provider after checkout: apps, browser extensions, and account access.",
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
      message: "Tell me what matters most for this connection, and I’ll narrow it to one recommendation.",
    },
  });
  console.log("settings", settings.status, JSON.stringify(settings.body));

  const skillsList = await request("GET", MBA_HOST, `/${PN}/agent_config/skills`);
  const currentSkills = skillsList.status === 200 && Array.isArray(skillsList.body)
    ? skillsList.body
    : null;
  console.log("current skills", skillsList.status, Array.isArray(currentSkills) ? currentSkills.length : "unknown");

  const core = await upsertSkill(CORE_SKILL_ID, {
    title: "ascendant-labs-security-advisor",
    description: "Understand the customer's need, use optional scan context when available, and recommend the best-fit VPN without unnecessary steps.",
    skill: CORE_SKILL,
  }, currentSkills);
  console.log("core skill", core.status, JSON.stringify(core.body).slice(0, 500));

  const linkSkill = await upsertSkill(LINK_SKILL_ID, {
    title: "product-suggestions",
    description: "Recommend and link NordVPN or Proton VPN from customer needs, with or without a scan.",
    skill: LINK_SKILL,
  }, currentSkills);
  console.log("link skill", linkSkill.status, JSON.stringify(linkSkill.body).slice(0, 500));

  const interactionSkill = await upsertSkill(INTERACTION_SKILL_ID, {
    title: "interaction-tools",
    description: "Apply when asking a limited-choice question or sending a native CTA card; use interaction tools only when they make the next step easier.",
    skill: INTERACTION_SKILL,
  }, currentSkills);
  console.log("interaction skill", interactionSkill.status, JSON.stringify(interactionSkill.body).slice(0, 500));

  const clearedWebsites = await clearWebsiteSources();
  console.log("website sources cleared", clearedWebsites.length, clearedWebsites.map((result) => result.status).join(","));

  if (skillsOnly) {
    return;
  }

  const faqs = [
    {
      question: "What is Ascendant Labs?",
      answer: "A connection security advisor on WhatsApp. We recommend a VPN from what you care about, with an optional connection scan for a more specific diagnosis.",
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
