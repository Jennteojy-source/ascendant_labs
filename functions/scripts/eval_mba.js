#!/usr/bin/env node
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

const scenarios = [
  {
    id: "quick-replies",
    turns: [
      {
        message: "I do not want a scan and I am not sure what I need. Ask one useful question with quick choices.",
        expect: {
          language: "en",
          text: true,
          quickReplies: true,
          noScanGate: true,
        },
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
          noSalesAction: true,
          noScanGate: true,
        },
      },
      {
        message: "De acuerdo, envíame ahora el enlace de esa recomendación.",
        expect: { salesAction: true, noScanGate: true },
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
          noSalesAction: true,
          noScanGate: true,
        },
      },
      {
        message: "Pode enviar agora o link da recomendação.",
        expect: { salesAction: true, noScanGate: true },
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
          noSalesAction: true,
          noScanGate: true,
        },
      },
      {
        message: "Baik, kirim tautan rekomendasi itu sekarang.",
        expect: { salesAction: true, noScanGate: true },
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
          noSalesAction: true,
          noScanGate: true,
        },
      },
      {
        message: "حسناً، أرسل رابط التوصية الآن.",
        expect: { salesAction: true, noScanGate: true },
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
          noSalesAction: true,
          noScanGate: true,
        },
      },
      {
        message: "I changed my mind: streaming performance and gaming matter most, and I can pay. Update the recommendation, but still wait on the link.",
        expect: {
          language: "en",
          text: true,
          product: "NordVPN",
          noSalesAction: true,
          noScanGate: true,
        },
      },
      {
        message: "That works. Send the current recommendation now.",
        expect: { salesAction: true, noScanGate: true },
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
  return /(must|required|need to).{0,30}scan|scan.{0,30}(required|first|before)|debes.{0,30}escane|precisa.{0,30}verifica|harus.{0,30}pindai|يجب.{0,30}الفحص/iu.test(text);
}

function hasSalesLanguage(text) {
  return /\b(tap|open|link|card|enlace|abrir|link|cartão|tautan|buka)\b|رابط|افتح/iu.test(text);
}

function isActionOnly(result) {
  return !String(result.agent_response || "").trim()
    && !result.handoff_reason
    && !result.no_response_reason;
}

function evaluateTurn(result, expected) {
  const failures = [];
  const text = String(result.agent_response || "").trim();
  const quickReplies = Array.isArray(result.quick_replies) ? result.quick_replies : [];
  const productIds = Array.isArray(result.product_variant_ids) ? result.product_variant_ids : [];
  const actionOnly = isActionOnly(result);

  if (result.handoff_reason) failures.push(`unexpected handoff: ${result.handoff_reason}`);
  if (result.no_response_reason) failures.push(`no response: ${result.no_response_reason}`);
  if (expected.text && !text) failures.push("expected a natural-language response");
  if (text.length > 1200) failures.push(`response is too long (${text.length} characters)`);
  if (/https?:\/\//i.test(text)) failures.push("raw URL appeared in message text");
  if (expected.language && text && !looksLikeLanguage(text, expected.language)) {
    failures.push(`response does not look like language '${expected.language}'`);
  }
  if (expected.product && text && !text.toLowerCase().includes(expected.product.toLowerCase())) {
    failures.push(`expected recommendation '${expected.product}'`);
  }
  if (expected.product && !text) failures.push(`could not verify recommendation '${expected.product}'`);
  if (expected.noScanGate && hasScanGate(text)) failures.push("scan was presented as a requirement");

  if (expected.quickReplies) {
    if (quickReplies.length < 2 || quickReplies.length > 3) {
      failures.push(`expected 2-3 native quick replies, received ${quickReplies.length}`);
    }
    for (const reply of quickReplies) {
      if (!reply || String(reply).length > 20) {
        failures.push(`invalid quick reply label: '${reply}'`);
      }
      if (reply && text.toLowerCase().includes(String(reply).toLowerCase())) {
        failures.push(`quick reply duplicated in message text: '${reply}'`);
      }
    }
  }

  if (expected.noSalesAction && (actionOnly || productIds.length > 0)) {
    failures.push("sent a sales action after the customer explicitly asked to wait");
  }
  if (expected.salesAction) {
    const hasActionSignal = actionOnly || productIds.length > 0 || hasSalesLanguage(text);
    if (!hasActionSignal) failures.push("did not produce a product-link action");
  }

  return { failures, actionOnly, quickReplies, text };
}

async function evaluateConfiguration() {
  const skills = await apiRequest("GET", `/${PN}/agent_config/skills`);
  const websites = await apiRequest("GET", `/${PN}/agent_config/websites`);
  const skillList = Array.isArray(skills) ? skills : [];
  const titles = skillList.map((skill) => skill.title).sort();
  const expectedTitles = [
    "ascendant-labs-security-advisor",
    "interaction-tools",
    "product-suggestions",
  ].sort();
  const failures = [];

  if (JSON.stringify(titles) !== JSON.stringify(expectedTitles)) {
    failures.push(`active skills differ: ${titles.join(", ")}`);
  }
  if (skillList.some((skill) => /consultation-flow|cta-card-mechanics|connection-scan-context/.test(skill.title))) {
    failures.push("a legacy or redundant skill is still active");
  }
  if (Array.isArray(websites) && websites.length !== 0) {
    failures.push(`expected zero website sources, found ${websites.length}`);
  }

  const core = skillList.find((skill) => skill.title === "ascendant-labs-security-advisor");
  const products = skillList.find((skill) => skill.title === "product-suggestions");
  const tools = skillList.find((skill) => skill.title === "interaction-tools");
  if (!core?.skill?.includes("Reply in the customer's language")) {
    failures.push("core skill does not require customer-language replies");
  }
  if (!core?.skill?.includes("connection_scan_completed")) {
    failures.push("core skill does not handle completed scans");
  }
  if (!products?.skill?.includes("https://ascendantlabs.co/r/vpn")) {
    failures.push("NordVPN tracked product link is missing");
  }
  if (!products?.skill?.includes("https://ascendantlabs.co/r/proton-vpn")) {
    failures.push("Proton VPN tracked product link is missing");
  }
  if (!tools?.skill?.includes("quick_replies")) {
    failures.push("native quick-reply guidance is missing");
  }
  if (!tools?.skill?.includes("SEND_CTA_URL")) {
    failures.push("CTA client-action guidance is missing");
  }

  return failures;
}

async function runScenario(scenario) {
  let conversationId = `mba-eval-${scenario.id}-${Date.now()}`;
  const failures = [];
  console.log(`\n[${scenario.id}]`);

  for (let index = 0; index < scenario.turns.length; index += 1) {
    const turn = scenario.turns[index];
    let result;
    try {
      result = await apiRequest("POST", `/${PN}/agent_test`, {
        user_msg: turn.message,
        conversation_id: conversationId,
      });
    } catch (err) {
      failures.push(`turn ${index + 1}: ${err.message}`);
      console.log(`  FAIL turn ${index + 1}: request error`);
      break;
    }

    conversationId = result.conversation_id || conversationId;
    const evaluated = evaluateTurn(result, turn.expect);
    if (evaluated.failures.length) {
      for (const failure of evaluated.failures) {
        failures.push(`turn ${index + 1}: ${failure}`);
      }
      console.log(`  FAIL turn ${index + 1}: ${evaluated.failures.join("; ")}`);
    } else {
      const mode = evaluated.actionOnly
        ? "client action"
        : `${evaluated.text.length} chars, ${evaluated.quickReplies.length} quick replies`;
      console.log(`  PASS turn ${index + 1}: ${mode}`);
    }
  }

  return failures;
}

async function main() {
  const failures = [];
  console.log("Meta Business Agent multi-turn evaluation");

  const configFailures = await evaluateConfiguration();
  if (configFailures.length) {
    for (const failure of configFailures) failures.push(`configuration: ${failure}`);
    console.log(`\n[configuration]\n  FAIL ${configFailures.join("; ")}`);
  } else {
    console.log("\n[configuration]\n  PASS active skills, tracked links, and knowledge sources");
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
