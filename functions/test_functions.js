// Mock CAPI calls response or verify triggers make calls
function jestFn(impl = () => {}) {
  const fn = (...args) => {
    fn.mock.calls.push(args);
    return impl(...args);
  };
  fn.mock = { calls: [] };
  fn.mockImplementation = (nextImpl) => { impl = nextImpl; };
  return fn;
}

const mockAdd = jestFn();
const mockDocSet = jestFn();
let mockDocCreateImpl = () => Promise.resolve();
const mockDocCreate = jestFn((...args) => mockDocCreateImpl(...args));
const mockDocGet = jestFn(() => Promise.resolve({
  exists: true,
  data: () => ({
    ip: "127.0.0.1",
    userAgent: "Mozilla/5.0 Mock",
    tracking: { fbclid: "meta_click_123" },
    timestamp: { toDate: () => new Date() }
  })
}));
const mockDoc = jestFn(() => ({
  set: mockDocSet,
  get: mockDocGet,
  create: mockDocCreate,
}));
const mockCollection = jestFn(() => ({
  add: mockAdd,
  doc: mockDoc,
}));
const mockFieldValue = {
  serverTimestamp: () => "mocked-timestamp",
  increment: (n) => n,
};

const adminMock = {
  initializeApp: () => {},
  firestore: () => ({
    collection: mockCollection,
  }),
};
adminMock.firestore.FieldValue = mockFieldValue;

require.cache[require.resolve("firebase-admin")] = {
  id: "firebase-admin",
  filename: "firebase-admin",
  loaded: true,
  exports: adminMock,
};

const functions = require("./index.js");

async function runTests() {
  console.log("Running Cloud Functions CAPI Quiz Event & Webhook tests...\n");

  let passed = true;

  // Test 1: trackQuizEvent handles ViewContent and saves telemetry to Firestore
  try {
    mockDoc.mock.calls = [];
    mockDocSet.mock.calls = [];
    const req = {
      body: {
        eventName: "ViewContent",
        clickId: "meta_click_123",
        trackingParams: { fbclid: "meta_click_123", utm_source: "facebook" },
        customData: { content_name: "NordVPN Privacy Quiz" },
      },
      get: (header) => (header === "user-agent" ? "Mozilla/5.0 Mock" : ""),
      ip: "127.0.0.1",
    };

    let responseStatus = 0;
    let responseJson = null;
    const res = {
      status: (code) => {
        responseStatus = code;
        return {
          json: (data) => { responseJson = data; },
        };
      },
    };

    await functions.trackQuizEvent(req, res);

    if (responseStatus !== 200) {
      throw new Error(`Expected status 200, got ${responseStatus}`);
    }
    if (!responseJson || !responseJson.success || responseJson.eventName !== "ViewContent") {
      throw new Error(`Invalid response JSON: ${JSON.stringify(responseJson)}`);
    }

    if (mockDocSet.mock.calls.length !== 1) {
      throw new Error(`Expected 1 Firestore set call, got ${mockDocSet.mock.calls.length}`);
    }

    const clickData = mockDocSet.mock.calls[0][0];
    if (
      clickData.ip !== "127.0.0.1" ||
      clickData.userAgent !== "Mozilla/5.0 Mock"
    ) {
      throw new Error(`Firestore click data mismatch: ${JSON.stringify(clickData)}`);
    }

    console.log("✅ Test 1 Passed: trackQuizEvent ViewContent saved telemetry to Firestore.");
  } catch (err) {
    console.error("❌ Test 1 Failed:", err.message);
    passed = false;
  }

  // Test 2: trackQuizEvent handles Lead, CompleteRegistration, InitiateCheckout
  try {
    const events = ["Lead", "CompleteRegistration", "InitiateCheckout"];
    for (const eventName of events) {
      mockDocSet.mock.calls = [];
      const req = {
        body: {
          eventName,
          clickId: "meta_click_123",
          trackingParams: { fbclid: "meta_click_123" },
        },
        get: () => "Mozilla/5.0 Mock",
        ip: "127.0.0.1",
      };

      let responseStatus = 0;
      const res = {
        status: (code) => {
          responseStatus = code;
          return { json: () => {} };
        },
      };

      await functions.trackQuizEvent(req, res);

      if (responseStatus !== 200) {
        throw new Error(`Expected status 200 for ${eventName}, got ${responseStatus}`);
      }
    }

    console.log("✅ Test 2 Passed: trackQuizEvent processed Lead, CompleteRegistration, and InitiateCheckout.");
  } catch (err) {
    console.error("❌ Test 2 Failed:", err.message);
    passed = false;
  }

  // Test 3: nordVpnWebhook accepts conversion payload with valid API key and logs to Firestore
  try {
    mockDoc.mock.calls = [];
    mockDocCreate.mock.calls = [];
    const req = {
      query: {
        key: "11f70bb6b8ef56267f8174fdc34a2ac4ab8ab363c9544907819eb38fa0f6fc19",
        click_id: "meta_click_123",
        transaction_id: "trans_999",
        payout: "20.50",
        offer_id: "15",
        sale_amount: "50.00",
      },
      get: () => "",
    };

    let responseStatus = 0;
    let responseBody = "";
    const res = {
      status: (code) => {
        responseStatus = code;
        return {
          send: (body) => { responseBody = body; },
          json: (body) => { responseBody = JSON.stringify(body); },
        };
      },
    };

    await functions.nordVpnWebhook(req, res);

    if (responseStatus !== 200) {
      throw new Error(`Expected status 200, got ${responseStatus}`);
    }
    if (responseBody !== "success") {
      throw new Error(`Expected body 'success', got '${responseBody}'`);
    }

    if (mockDocCreate.mock.calls.length !== 1) {
      throw new Error(`Expected 1 Firestore create call, got ${mockDocCreate.mock.calls.length}`);
    }

    const convData = mockDocCreate.mock.calls[0][0];
    if (
      convData.clickId !== "meta_click_123" ||
      convData.transactionId !== "trans_999" ||
      convData.payout !== 20.5 ||
      convData.saleAmount !== 50
    ) {
      throw new Error(`Firestore conversion data mismatch: ${JSON.stringify(convData)}`);
    }

    console.log("✅ Test 3 Passed: nordVpnWebhook processed valid payload and saved to Firestore.");
  } catch (err) {
    console.error("❌ Test 3 Failed:", err.message);
    passed = false;
  }

  // Test 4: handleConversionCreated logic works and sends CAPI Purchase
  try {
    mockDoc.mock.calls = [];
    mockDocSet.mock.calls = [];
    const transactionId = "trans_999";
    const conversionData = {
      clickId: "meta_click_123",
      transactionId: "trans_999",
      payout: 20.5,
      saleAmount: 50
    };

    await functions.handleConversionCreated(transactionId, conversionData);
    console.log("✅ Test 4 Passed: handleConversionCreated executed successfully.");
  } catch (err) {
    console.error("❌ Test 4 Failed:", err.message);
    passed = false;
  }

  // Test 5: nordVpnWebhook rejects conversion payload with missing transaction_id
  try {
    const req = {
      query: {
        click_id: "meta_click_123",
        // missing transaction_id
      },
      get: () => "",
    };

    let responseStatus = 0;
    const res = {
      status: (code) => {
        responseStatus = code;
        return { send: () => {} };
      },
    };

    await functions.nordVpnWebhook(req, res);

    if (responseStatus !== 400) {
      throw new Error(`Expected status 400, got ${responseStatus}`);
    }
    console.log("✅ Test 5 Passed: nordVpnWebhook rejected missing transaction_id.");
  } catch (err) {
    console.error("❌ Test 5 Failed:", err.message);
    passed = false;
  }

  // Test 6: nordVpnWebhook handles duplicate conversion gracefully
  try {
    const originalCreateImpl = mockDocCreateImpl;
    mockDocCreateImpl = () => {
      const err = new Error("Document already exists");
      err.code = 6;
      return Promise.reject(err);
    };

    const req = {
      query: {
        key: "11f70bb6b8ef56267f8174fdc34a2ac4ab8ab363c9544907819eb38fa0f6fc19",
        click_id: "meta_click_123",
        transaction_id: "trans_999",
      },
      get: () => "",
    };

    let responseStatus = 0;
    let responseBody = "";
    const res = {
      status: (code) => {
        responseStatus = code;
        return { send: (body) => { responseBody = body; } };
      },
    };

    await functions.nordVpnWebhook(req, res);

    mockDocCreateImpl = originalCreateImpl;

    if (responseStatus !== 200) {
      throw new Error(`Expected status 200, got ${responseStatus}`);
    }
    if (responseBody !== "duplicate") {
      throw new Error(`Expected body 'duplicate', got '${responseBody}'`);
    }
    console.log("✅ Test 6 Passed: nordVpnWebhook handled duplicate conversion gracefully.");
  } catch (err) {
    console.error("❌ Test 6 Failed:", err.message);
    passed = false;
  }

  // Test 7: buildScanCompletedEvent returns stringified payload conforming to Meta JSON schema
  try {
    const scan = {
      sid: "scn_test_123",
      ip: "107.170.45.227",
      city: "Singapore",
      country: "Singapore",
      isp: "StarHub Cable Vision Ltd",
      device: "iPhone",
      waId: "6598533674",
    };
    const recommendation = {
      primary: "nordvpn",
      alternative: "proton_vpn",
      angle: "StarHub can observe your traffic.",
      shortLinks: {
        primary: "https://ascendantlabs.co/r/vpn?sid=scn_test_123",
        alternative: "https://ascendantlabs.co/r/proton-vpn?sid=scn_test_123",
      },
    };

    const evt = functions.buildScanCompletedEvent(scan, recommendation, "Scan finished.");

    if (evt.type !== "connection_scan_completed") {
      throw new Error(`Expected type 'connection_scan_completed', got '${evt.type}'`);
    }
    if (typeof evt.description !== "string" || !evt.description) {
      throw new Error(`Expected description to be a non-empty string`);
    }
    if (typeof evt.payload !== "string") {
      throw new Error(`Expected event.payload to be a JSON string, got type '${typeof evt.payload}'`);
    }

    const parsed = JSON.parse(evt.payload);
    if (parsed.sid !== "scn_test_123" || parsed.isp !== "StarHub Cable Vision Ltd" || parsed.primary !== "nordvpn") {
      throw new Error(`Parsed payload content mismatch: ${JSON.stringify(parsed)}`);
    }
    const offerUrl = new URL(parsed.offer_cta_url);
    if (offerUrl.searchParams.get("wa") !== "6598533674") {
      throw new Error(`Expected product URL to include wa attribution key, got '${parsed.offer_cta_url}'`);
    }
    const offerValues = [...offerUrl.searchParams.values()];
    if (new Set(offerValues).size !== offerValues.length) {
      throw new Error(`Product URL repeats an identifier across keys: '${parsed.offer_cta_url}'`);
    }
    if (parsed.location_precision !== "approximate" || !parsed.approximate_location.includes("Singapore")) {
      throw new Error(`Expected an approximate location in the payload, got '${parsed.approximate_location}'`);
    }

    console.log("✅ Test 7 Passed: buildScanCompletedEvent produces schema-compliant stringified payload.");
  } catch (err) {
    console.error("❌ Test 7 Failed:", err.message);
    passed = false;
  }

  // Test 8: Click-to-WhatsApp referral fields are extracted without modifying ctwa_clid
  try {
    const rawClid = "ARAkLkA8rmlFeiCktEJQ-QTwRiyYHAFDLMNDBH0CD3qpjd0HR4irJ6LEkR7JwFF4XvnO2E4Nx0";
    const attribution = functions.extractAdContext({
      referral: {
        ctwa_clid: rawClid,
        source_id: "120212345678901",
        source_type: "ad",
        source_url: "https://fb.me/example",
        headline: "Private connection",
      },
    });
    if (!attribution || attribution.ctwaClid !== rawClid || attribution.adId !== "120212345678901") {
      throw new Error(`CTWA attribution mismatch: ${JSON.stringify(attribution)}`);
    }
    console.log("✅ Test 8 Passed: extractAdContext preserves CTWA click attribution.");
  } catch (err) {
    console.error("❌ Test 8 Failed:", err.message);
    passed = false;
  }

  // Test 9: Business Messaging CAPI uses Meta's LeadSubmitted schema
  try {
    const { buildWhatsAppCapiPayload, sendWhatsAppCapiEvent } = require("./lib/capi");
    const payload = buildWhatsAppCapiPayload({
      eventName: "LeadSubmitted",
      eventId: "ctwa_offer_test_1",
      eventTime: 1787284800123,
      ctwaClid: "raw_ctwa_click_id",
      wabaId: "1243210237822104",
    });
    const event = payload.data && payload.data[0];
    if (
      !event ||
      event.event_name !== "LeadSubmitted" ||
      event.action_source !== "business_messaging" ||
      event.messaging_channel !== "whatsapp" ||
      event.event_time !== 1787284800 ||
      event.user_data.ctwa_clid !== "raw_ctwa_click_id" ||
      event.user_data.whatsapp_business_account_id !== "1243210237822104" ||
      Object.prototype.hasOwnProperty.call(event, "custom_data")
    ) {
      throw new Error(`Invalid WhatsApp CAPI payload: ${JSON.stringify(payload)}`);
    }
    const skipped = await sendWhatsAppCapiEvent({
      eventId: "ctwa_missing_clid",
      ctwaClid: "",
    });
    if (!skipped || !skipped.skipped || skipped.reason !== "missing_ctwa_clid") {
      throw new Error(`Expected missing-clid event to skip: ${JSON.stringify(skipped)}`);
    }
    console.log("✅ Test 9 Passed: LeadSubmitted payload is valid and missing clid is skipped.");
  } catch (err) {
    console.error("❌ Test 9 Failed:", err.message);
    passed = false;
  }

  // Test 10: waId resolves CTWA attribution without a connection scan
  try {
    mockDocGet.mockImplementation(() => Promise.resolve({
      exists: true,
      data: () => ({
        waId: "6598533674",
        ctwaClid: "clid_without_scan",
        adId: "120212345678901",
      }),
    }));
    const { resolveOfferAttribution } = require("./routes/affiliate");
    const attribution = await resolveOfferAttribution({ waId: "6598533674", sid: "" });
    if (
      attribution.waId !== "6598533674" ||
      attribution.ctwaClid !== "clid_without_scan" ||
      attribution.adId !== "120212345678901"
    ) {
      throw new Error(`No-scan attribution mismatch: ${JSON.stringify(attribution)}`);
    }
    console.log("✅ Test 10 Passed: product attribution resolves by waId without a scan.");
  } catch (err) {
    console.error("❌ Test 10 Failed:", err.message);
    passed = false;
  }

  // Test 11: redirect response is sent before attribution/logging completes
  try {
    let resolveLookup;
    mockDocGet.mockImplementation(() => new Promise((resolve) => {
      resolveLookup = resolve;
    }));
    let responseSent = false;
    const req = {
      originalUrl: "/r/not-configured?wa=6598533674",
      url: "/r/not-configured?wa=6598533674",
      path: "/r/not-configured",
      query: { wa: "6598533674" },
      get: (header) => (header === "user-agent" ? "WhatsApp Test" : ""),
      ip: "127.0.0.1",
    };
    const res = {
      set: () => {},
      status: () => ({
        json: () => { responseSent = true; },
        send: () => { responseSent = true; },
      }),
      redirect: () => { responseSent = true; },
    };
    const pending = functions.affiliateRedirect(req, res);
    if (!responseSent) {
      throw new Error("Redirect response waited for Firestore attribution lookup");
    }
    resolveLookup({ exists: true, data: () => ({ waId: "6598533674" }) });
    await pending;
    console.log("✅ Test 11 Passed: redirect responds before attribution and tracking complete.");
  } catch (err) {
    console.error("❌ Test 11 Failed:", err.message);
    passed = false;
  }

  if (passed) {
    console.log("\n🎉 All tests passed successfully!");
    process.exit(0);
  }

  console.error("\n❌ Some tests failed.");
  process.exit(1);
}

runTests();
