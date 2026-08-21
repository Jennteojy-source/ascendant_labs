#!/usr/bin/env node
/**
 * Multi-turn evaluation for the Meta Business AI agent.
 *
 * Transport: POST /{phone_number_id}/agent_test (Meta sandbox; no WhatsApp delivery).
 * Assertions: local heuristics. agent_test does not return CTA payloads; an empty
 * agent_response with no handoff/no_response is the only reliable signal that a
 * client action (SEND_CTA_URL) fired.
 *
 * Meta's agent-eval/cases endpoint is read-only here (cases are empty; POST 405),
 * so this harness is the operable automated eval.
 */
const https = require("https");
const { config } = require("../config");

const PN = config.whatsappPhoneNumberId;
const TOKEN = config.wabaToken;
const API_HOST = "api.facebook.com";
const API_HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  "X-API-Version": "2.0.0",
};

if (!TOKEN || !PN) {
  console.error("Missing WABA_TOKEN or WhatsApp phone number id");
  process.exit(1);
}

const requestedScenario = process.argv
  .find((arg) => arg.startsWith("--scenario="))
  ?.split("=")
  .slice(1)
  .join("=");
const configOnly = process.argv.includes("--config-only");
const verbose = process.argv.includes("--verbose");

const TRACKED_NORD = "https://ascendantlabs.co/r/vpn";
const TRACKED_PROTON = "https://ascendantlabs.co/r/proton-vpn";

const scenarios = [
  {
    id: "clarify-without-cta",
    turns: [
      {
        message: "I do not want a scan and I am not sure what I need. Ask one useful question.",
        expect: {
          language: "en",
          text: true,
          noClientAction: true,
          noScanGate: true,
        },
      },
    ],
  },
  {
    id: "vpn-beginner",
    turns: [
      {
        message: "A friend said I should get a VPN but honestly I have no idea what that even is. Is it some kind of antivirus?",
        expect: {
          language: "en",
          text: true,
          noClientAction: true,
          noScanGate: true,
          forbidTerms: ["DNS", "tunneling", "tunnelling", "WireGuard", "OpenVPN", "AES-256"],
        },
      },
    ],
  },
  {
    id: "cta-nord-on-request",
    turns: [
      {
        message: "No scan. I care about streaming, gaming, and speed. Recommend NordVPN but do not send the link yet.",
        expect: {
          language: "en",
          text: true,
          product: "NordVPN",
          noClientAction: true,
          noScanGate: true,
        },
      },
      {
        message: "Send the NordVPN product card now.",
        expect: { clientAction: true, noScanGate: true },
      },
    ],
  },
  {
    id: "cta-proton-on-request",
    turns: [
      {
        message: "No scan. I want privacy, open-source apps, and a free option. Recommend Proton VPN but do not send the link yet.",
        expect: {
          language: "en",
          text: true,
          product: "Proton VPN",
          noClientAction: true,
          noScanGate: true,
        },
      },
      {
        message: "Send the Proton VPN product card now.",
        expect: { clientAction: true, noScanGate: true },
      },
    ],
  },
  {
    id: "spanish-privacy-to-proton",
    turns: [
      {
        message: "No quiero hacer el escaneo. Busco privacidad, software abierto y una opción gratuita. Dime qué VPN encaja mejor y por qué, pero todavía no envíes el enlace.",
        expect: {
          language: "es",
          text: true,
          product: "Proton VPN",
          noClientAction: true,
          noScanGate: true,
        },
      },
      {
        message: "De acuerdo, envíame ahora el enlace de esa recomendación.",
        expect: { clientAction: true, noScanGate: true },
      },
    ],
  },
  {
    id: "portuguese-streaming-to-nord",
    turns: [
      {
        message: "Não quero fazer a verificação. Minha prioridade é streaming, jogos e velocidade. Diga qual VPN combina melhor comigo, mas ainda não envie o link.",
        expect: {
          language: "pt",
          text: true,
          product: "NordVPN",
          noClientAction: true,
          noScanGate: true,
        },
      },
      {
        message: "Pode enviar agora o link da recomendação.",
        expect: { clientAction: true, noScanGate: true },
      },
    ],
  },
  {
    id: "indonesian-travel-to-nord",
    turns: [
      {
        message: "Saya tidak ingin memindai. Saya sering bepergian dan mengutamakan streaming serta kecepatan. Rekomendasikan VPN, tetapi jangan kirim tautannya dulu.",
        expect: {
          language: "id",
          text: true,
          product: "NordVPN",
          noClientAction: true,
          noScanGate: true,
        },
      },
      {
        message: "Baik, kirim tautan rekomendasi itu sekarang.",
        expect: { clientAction: true, noScanGate: true },
      },
    ],
  },
  {
    id: "arabic-privacy-to-proton",
    turns: [
      {
        message: "لا أريد إجراء الفحص. أريد الخصوصية وبرامج مفتوحة المصدر وخياراً مجانياً. أوصني بخدمة مناسبة، لكن لا ترسل الرابط بعد.",
        expect: {
          language: "ar",
          text: true,
          product: "Proton VPN",
          noClientAction: true,
          noScanGate: true,
        },
      },
      {
        message: "حسناً، أرسل رابط التوصية الآن.",
        expect: { clientAction: true, noScanGate: true },
      },
    ],
  },
  {
    id: "priority-change",
    turns: [
      {
        message: "I care about a free option, open-source apps, and privacy. Recommend the best fit, but do not send the link yet.",
        expect: {
          language: "en",
          text: true,
          product: "Proton VPN",
          noClientAction: true,
          noScanGate: true,
        },
      },
      {
        message: "I changed my mind: streaming performance and gaming matter most, and I can pay. Update the recommendation, but still wait on the link.",
        expect: {
          language: "en",
          text: true,
          product: "NordVPN",
          noClientAction: true,
          noScanGate: true,
        },
      },
      {
        message: "That works. Send the current recommendation now.",
        expect: { clientAction: true, noScanGate: true },
      },
    ],
  },
];

const languageMarkers = {
  en: [" the ", " you ", " your ", " for ", " privacy ", " speed "],
  es: [" que ", " para ", " privacidad ", " conexión ", " proveedor ", " puedes ", " recomiendo "],
  pt: [" que ", " para ", " privacidade ", " conexão ", " velocidade ", " você ", " recomendo "],
  id: [" anda ", " untuk ", " dengan ", " privasi ", " koneksi ", " kecepatan ", " rekomendasi "],
};

function apiRequest(method, path, body) {
  const payload = body ? JSON.stringify(body) : "";
  const headers = { ...API_HEADERS };
  if (payload) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(payload);
  }

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: API_HOST,
      path,
      method,
      headers,
      timeout: 60000,
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        let parsed = data;
        try { parsed = data ? JSON.parse(data) : {}; } catch (_) {}
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${method} ${path} returned ${res.statusCode}: ${data}`));
          return;
        }
        resolve(parsed);
      });
    });
    req.on("timeout", () => req.destroy(new Error(`Timed out: ${method} ${path}`)));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function looksLikeLanguage(text, language) {
  if (!text) return false;
  if (language === "ar") {
    return (text.match(/[\u0600-\u06ff]/g) || []).length >= 12;
  }
  const normalized = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  const markers = languageMarkers[language] || [];
  return markers.filter((marker) => normalized.includes(marker)).length >= 2;
}

function hasScanGate(text) {
  // Match only clear requirements, not "scan is optional" or "before you scan".
  return /\b(must|need to|have to|required to)\b[^.!?]{0,40}\bscan\b|\bscan\b[^.!?]{0,20}\b(is required|is mandatory|required first)\b|debes[^.!?]{0,30}escane|precisa[^.!?]{0,30}verifica|harus[^.!?]{0,30}pindai|يجب[^.!?]{0,30}الفحص/iu.test(text)
    && !/\b(no|not|n't|never|without|don't|do not|does not|optional|skip|sin|sem|tanpa|بدون)\b[^.!?]{0,40}\b(scan|escane|verifica|pindai|الفحص)\b/iu.test(text);
}

/**
 * agent_test returns an empty agent_response when the agent fires a client
 * action such as SEND_CTA_URL. That is the only reliable tool-call signal.
 */
function firedClientAction(result) {
  const text = String(result.agent_response || "").trim();
  const productIds = Array.isArray(result.product_variant_ids) ? result.product_variant_ids : [];
  return (!text && !result.handoff_reason && !result.no_response_reason) || productIds.length > 0;
}

function evaluateTurn(result, expected) {
  const failures = [];
  const text = String(result.agent_response || "").trim();
  const quickReplies = Array.isArray(result.quick_replies) ? result.quick_replies : [];
  const clientAction = firedClientAction(result);

  if (result.handoff_reason) failures.push(`unexpected handoff: ${result.handoff_reason}`);
  if (result.no_response_reason) failures.push(`no response: ${result.no_response_reason}`);

  if (expected.text && !text && !clientAction) {
    failures.push("expected a natural-language response");
  }
  if (text.length > 1200) failures.push(`response is too long (${text.length} characters)`);
  if (/https?:\/\//i.test(text)) failures.push("raw URL appeared in message text");
  if (/go\.nordvpn\.net|go\.getproton\.me|nordvpn\.com\/|protonvpn\.com\//i.test(text)) {
    failures.push("partner or affiliate URL leaked into message text");
  }
  if (expected.language && text && !looksLikeLanguage(text, expected.language)) {
    failures.push(`response does not look like language '${expected.language}'`);
  }
  if (expected.product && text && !text.toLowerCase().includes(expected.product.toLowerCase())) {
    failures.push(`expected recommendation '${expected.product}'`);
  }
  if (expected.product && !text && !clientAction) {
    failures.push(`could not verify recommendation '${expected.product}'`);
  }
  if (expected.noScanGate && hasScanGate(text)) {
    failures.push("scan was presented as a requirement");
  }
  if (Array.isArray(expected.forbidTerms)) {
    const used = expected.forbidTerms.filter((term) => (
      new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)
    ));
    if (used.length) failures.push(`used unexplained jargon: ${used.join(", ")}`);
  }
  if (expected.singleQuestion) {
    const questionCount = (text.match(/\?|؟/g) || []).length;
    if (questionCount > 1) failures.push(`asked ${questionCount} questions in one turn`);
    if (/^\s*(\d[.)]|[-*•])\s+/m.test(text)) {
      failures.push("options were listed in message text instead of quick replies");
    }
  }

  if (quickReplies.length > 3) {
    failures.push(`expected at most 3 native quick replies, received ${quickReplies.length}`);
  }
  for (const reply of quickReplies) {
    if (!reply || String(reply).length > 20) {
      failures.push(`invalid quick reply label: '${reply}'`);
    }
  }

  if (expected.noClientAction && clientAction) {
    failures.push("fired a client action / product CTA when the customer asked to wait or only wanted clarification");
  }
  if (expected.clientAction && !clientAction) {
    failures.push("did not fire SEND_CTA_URL client action (agent_test returned text instead of an empty action turn)");
  }

  return { failures, clientAction, quickReplies, text };
}

async function evaluateConfiguration() {
  const skills = await apiRequest("GET", `/${PN}/agent_config/skills`);
  const websites = await apiRequest("GET", `/${PN}/agent_config/websites`);
  let skillList = Array.isArray(skills) ? skills : [];

  // Meta's list endpoint can go empty while a skill still exists by id.
  if (!skillList.length) {
    const fs = require("fs");
    const path = require("path");
    const syncSrc = fs.readFileSync(path.join(__dirname, "sync_mba.js"), "utf8");
    const idMatch = syncSrc.match(/const CORE_SKILL_ID = "([^"]+)"/);
    if (idMatch) {
      try {
        const core = await apiRequest("GET", `/${PN}/agent_config/skills/${idMatch[1]}`);
        if (core && core.title) skillList = [core];
      } catch (_) {}
    }
  }

  const titles = skillList.map((skill) => skill.title).sort();
  const expectedTitles = [
    "ascendant-labs-security-advisor",
  ].sort();
  const failures = [];

  if (!skillList.length) {
    failures.push("no active sales skill found — run npm run sync-mba -- --skills");
    return failures;
  }

  if (JSON.stringify(titles) !== JSON.stringify(expectedTitles)) {
    failures.push(`active skills differ: ${titles.join(", ")}`);
  }
  if (skillList.some((skill) => /consultation-flow|cta-card-mechanics|connection-scan-context|product-suggestions|interaction-tools/.test(skill.title))) {
    failures.push("a legacy or redundant skill is still active");
  }
  if (Array.isArray(websites) && websites.length !== 0) {
    failures.push(`expected zero website sources, found ${websites.length}`);
  }

  const core = skillList.find((skill) => skill.title === "ascendant-labs-security-advisor");

  if (!core?.skill?.includes("Reply in the customer's language")) {
    failures.push("core skill does not require customer-language replies");
  }
  if (!core?.skill?.includes("connection_scan_completed")) {
    failures.push("core skill does not handle completed scans");
  }
  if (!core?.skill?.includes("around")) {
    failures.push("core skill does not frame scan location as approximate");
  }
  if (!core?.skill?.includes("NordVPN or Proton VPN")) {
    failures.push("core skill does not limit products to NordVPN and Proton VPN");
  }
  if (!core?.skill?.includes("Do not ask them to choose between")) {
    failures.push("core skill still pushes privacy-vs-streaming on beginners");
  }
  if (!core?.skill?.includes(TRACKED_NORD)) {
    failures.push("NordVPN tracked product link is missing");
  }
  if (!core?.skill?.includes(TRACKED_PROTON)) {
    failures.push("Proton VPN tracked product link is missing");
  }
  if (!core?.skill?.includes("SEND_CTA_URL")) {
    failures.push("CTA client-action guidance is missing");
  }

  return failures;
}

async function agentTest(userMsg, conversationId, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await apiRequest("POST", `/${PN}/agent_test`, {
        user_msg: userMsg,
        conversation_id: conversationId,
      });
    } catch (err) {
      lastError = err;
      if (!/returned 5\d\d/.test(err.message) || attempt === attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  throw lastError;
}

async function runScenario(scenario) {
  let conversationId = `mba-eval-${scenario.id}-${Date.now()}`;
  const failures = [];
  console.log(`\n[${scenario.id}]`);

  for (let index = 0; index < scenario.turns.length; index += 1) {
    const turn = scenario.turns[index];
    let result;
    try {
      result = await agentTest(turn.message, conversationId);
    } catch (err) {
      failures.push(`turn ${index + 1}: ${err.message}`);
      console.log(`  FAIL turn ${index + 1}: request error`);
      break;
    }

    conversationId = result.conversation_id || conversationId;
    const evaluated = evaluateTurn(result, turn.expect);
    if (verbose) {
      console.log(`  --- turn ${index + 1} raw ---`);
      console.log(`  ${JSON.stringify({
        agent_response: result.agent_response,
        quick_replies: result.quick_replies,
        product_variant_ids: result.product_variant_ids,
        handoff_reason: result.handoff_reason,
        no_response_reason: result.no_response_reason,
      })}`);
    }
    if (evaluated.failures.length) {
      for (const failure of evaluated.failures) {
        failures.push(`turn ${index + 1}: ${failure}`);
      }
      console.log(`  FAIL turn ${index + 1}: ${evaluated.failures.join("; ")}`);
    } else {
      const mode = evaluated.clientAction
        ? "client action SEND_CTA_URL"
        : `${evaluated.text.length} chars, ${evaluated.quickReplies.length} quick replies`;
      console.log(`  PASS turn ${index + 1}: ${mode}`);
    }
  }

  return failures;
}

async function main() {
  const failures = [];
  console.log("Meta Business Agent multi-turn evaluation");
  console.log("Transport: POST /{phone_number_id}/agent_test");
  console.log("Tool-call signal: empty agent_response ⇒ SEND_CTA_URL fired");

  const configFailures = await evaluateConfiguration();
  if (configFailures.length) {
    for (const failure of configFailures) failures.push(`configuration: ${failure}`);
    console.log(`\n[configuration]\n  FAIL ${configFailures.join("; ")}`);
  } else {
    console.log("\n[configuration]\n  PASS skills, tracked short links, SEND_CTA_URL guidance");
  }

  if (!configOnly) {
    const selected = requestedScenario
      ? scenarios.filter((scenario) => scenario.id === requestedScenario)
      : scenarios;
    if (!selected.length) throw new Error(`Unknown scenario: ${requestedScenario}`);
    for (const scenario of selected) {
      const scenarioFailures = await runScenario(scenario);
      for (const failure of scenarioFailures) failures.push(`${scenario.id}: ${failure}`);
    }
  }

  console.log(`\nResult: ${failures.length ? "FAIL" : "PASS"}`);
  if (failures.length) {
    for (const failure of failures) console.log(`- ${failure}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
