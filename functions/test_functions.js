const mockAdd = jestFn();
const mockDocSet = jestFn();
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

// Mock CAPI calls response or verify triggers make calls
function jestFn(impl = () => {}) {
  const fn = (...args) => {
    fn.mock.calls.push(args);
    return impl(...args);
  };
  fn.mock = { calls: [] };
  return fn;
}

async function runTests() {
  console.log("Running Cloud Functions trigger-decoupled CAPI tests...\n");

  let passed = true;

  // Test 1: redirectNordVpn HTTP redirects and writes click doc to Firestore
  try {
    mockDoc.mock.calls = [];
    mockDocSet.mock.calls = [];
    const req = {
      query: {
        fbclid: "meta_click_123",
        utm_source: "facebook",
        utm_campaign: "vpn_test",
      },
      get: (header) => {
        if (header === "referer") return "https://facebook.com";
        if (header === "user-agent") return "Mozilla/5.0 Mock";
        return "";
      },
      headers: { "user-agent": "Mozilla/5.0 Mock" },
      ip: "127.0.0.1",
      path: "/r/nordvpn",
    };

    let redirectUrl = "";
    let redirectStatus = 0;
    const res = {
      headersSent: false,
      redirect: (status, url) => {
        redirectStatus = status;
        redirectUrl = url;
        res.headersSent = true;
      },
    };

    await functions.redirectNordVpn(req, res);

    if (redirectStatus !== 302) {
      throw new Error(`Expected redirect status 302, got ${redirectStatus}`);
    }

    const expectedUrl =
      "https://go.nordvpn.net/aff_c?offer_id=15&aff_id=152405&url_id=902&aff_click_id=meta_click_123&aff_sub=meta_click_123";
    if (redirectUrl !== expectedUrl) {
      throw new Error(`Expected redirect URL '${expectedUrl}', got '${redirectUrl}'`);
    }

    if (mockDocSet.mock.calls.length !== 1) {
      throw new Error(`Expected 1 Firestore set call, got ${mockDocSet.mock.calls.length}`);
    }

    if (mockDoc.mock.calls[0][0] !== "meta_click_123") {
      throw new Error(`Expected click document ID to be meta_click_123, got ${mockDoc.mock.calls[0][0]}`);
    }

    const clickData = mockDocSet.mock.calls[0][0];
    if (
      clickData.clickId !== "meta_click_123" ||
      clickData.tracking.fbclid !== "meta_click_123" ||
      clickData.offerId !== 15
    ) {
      throw new Error(`Firestore click data mismatch: ${JSON.stringify(clickData)}`);
    }

    console.log("✅ Test 1 Passed: redirectNordVpn with fbclid redirected and saved to Firestore.");
  } catch (err) {
    console.error("❌ Test 1 Failed:", err.message);
    passed = false;
  }

  // Test 2: redirectNordVpn HTTP works without fbclid
  try {
    mockDoc.mock.calls = [];
    mockDocSet.mock.calls = [];
    const req = {
      query: {},
      get: () => "",
      headers: {},
      ip: "127.0.0.1",
      path: "/r/nordvpn",
    };

    let redirectUrl = "";
    let redirectStatus = 0;
    const res = {
      headersSent: false,
      redirect: (status, url) => {
        redirectStatus = status;
        redirectUrl = url;
        res.headersSent = true;
      },
    };

    await functions.redirectNordVpn(req, res);

    if (redirectStatus !== 302) {
      throw new Error(`Expected redirect status 302, got ${redirectStatus}`);
    }

    const baseUrl = "https://go.nordvpn.net/aff_c?offer_id=15&aff_id=152405&url_id=902";
    if (!redirectUrl.startsWith(baseUrl) || !redirectUrl.includes("aff_click_id=")) {
      throw new Error(`Expected generated aff_click_id redirect, got '${redirectUrl}'`);
    }

    if (mockDocSet.mock.calls.length !== 1) {
      throw new Error(`Expected 1 Firestore set call, got ${mockDocSet.mock.calls.length}`);
    }

    console.log("✅ Test 2 Passed: redirectNordVpn without fbclid redirected and saved to Firestore.");
  } catch (err) {
    console.error("❌ Test 2 Failed:", err.message);
    passed = false;
  }

  // Test 3: nordVpnWebhook accepts conversion payload and logs to Firestore (auth removed)
  try {
    mockDoc.mock.calls = [];
    mockDocSet.mock.calls = [];
    const req = {
      query: {
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
          send: (body) => {
            responseBody = body;
          },
          json: (body) => {
            responseBody = JSON.stringify(body);
          },
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

    if (mockDocSet.mock.calls.length !== 1) {
      throw new Error(`Expected 1 Firestore set call, got ${mockDocSet.mock.calls.length}`);
    }

    const convData = mockDocSet.mock.calls[0][0];
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

  // Test 4: handleRedirectClickCreated logic works and sends CAPI ViewContent
  try {
    mockDoc.mock.calls = [];
    mockDocSet.mock.calls = [];
    const clickId = "meta_click_123";
    const clickData = {
      clickId: "meta_click_123",
      tracking: { fbclid: "meta_click_123" },
      ip: "127.0.0.1",
      userAgent: "Mozilla/5.0 Mock",
      timestamp: { toDate: () => new Date() },
      landingPath: "/r/nordvpn"
    };

    await functions.handleRedirectClickCreated(clickId, clickData);
    console.log("✅ Test 4 Passed: handleRedirectClickCreated executed successfully.");
  } catch (err) {
    console.error("❌ Test 4 Failed:", err.message);
    passed = false;
  }

  // Test 5: handleConversionCreated logic works and sends CAPI Purchase
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
    console.log("✅ Test 5 Passed: handleConversionCreated executed successfully.");
  } catch (err) {
    console.error("❌ Test 5 Failed:", err.message);
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
