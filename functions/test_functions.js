// Mock CAPI calls response or verify triggers make calls
function jestFn(impl = () => {}) {
  const fn = (...args) => {
    fn.mock.calls.push(args);
    return impl(...args);
  };
  fn.mock = { calls: [] };
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

  if (passed) {
    console.log("\n🎉 All tests passed successfully!");
    process.exit(0);
  }

  console.error("\n❌ Some tests failed.");
  process.exit(1);
}

runTests();
