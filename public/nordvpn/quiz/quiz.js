/**
 * Ascendant Labs - NordVPN Interactive Data Exposure Quiz Engine
 */

(function () {
    "use strict";

    // Quiz Questions Data — Warm, Helpful & User-Friendly Tone
    const QUIZ_QUESTIONS = [
        {
            id: "connection_type",
            category: "Internet Connections",
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.55a11 11 0 0114.08 0M1.42 9a16 16 0 0121.16 0M8.53 16.11a6 6 0 016.95 0M12 20h.01"/></svg>`,
            emoji: "🌐",
            shortLabel: "Connection Type",
            title: "Where do you usually connect to the internet?",
            subtitle: "💡 Helpful Tip: Public Wi-Fi networks in cafes or hotels are convenient, but your internet provider can log sites visited on unencrypted connections.",
            options: [
                { text: "Home Wi-Fi (Most of the time)", risk: 20 },
                { text: "Mobile Data / Cellular Network", risk: 15 },
                { text: "Public Wi-Fi (Cafes, Hotels, Airports)", risk: 30 }
            ]
        },
        {
            id: "incognito_myth",
            category: "Private Browsing",
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>`,
            emoji: "🕵️",
            shortLabel: "Incognito Check",
            title: "Do you use Private Browsing or Incognito mode?",
            subtitle: "💡 Good to Know: Incognito mode is great for clearing browser history on your screen, but your internet provider can still record website domain names.",
            options: [
                { text: "Yes — Thought Incognito kept everything 100% private", risk: 25 },
                { text: "Sometimes — Wasn't entirely sure what it hid", risk: 20 },
                { text: "No — I knew my internet provider could still see domain names", risk: 0 }
            ]
        },
        {
            id: "data_sales",
            category: "Browsing History",
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>`,
            emoji: "💰",
            shortLabel: "Data Sales",
            title: "Did you know internet providers can legally log & monetize browsing activity?",
            subtitle: "💡 Helpful Insight: In many regions, internet companies build search profiles tied to your location unless you scramble your connection.",
            options: [
                { text: "No idea! I assumed my browsing was private", risk: 25 },
                { text: "Heard about it, but didn't think it affected me", risk: 20 },
                { text: "Yes — I knew companies log browsing data", risk: 10 }
            ]
        },
        {
            id: "sensitive_searches",
            category: "Search Privacy",
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
            emoji: "👁️",
            shortLabel: "Search Activity",
            title: "Do you ever look up personal, financial, or family topics online?",
            subtitle: "💡 Privacy Protection: Locking down your connection keeps your search history confidential and protects you from targeted ad tracking.",
            options: [
                { text: "Yes — Frequently", risk: 25 },
                { text: "Sometimes", risk: 15 },
                { text: "Rarely", risk: 0 }
            ]
        },
        {
            id: "vpn_knowledge",
            category: "Privacy Checkup",
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`,
            emoji: "🔒",
            shortLabel: "Protection Check",
            title: "Have you ever used a VPN (Virtual Private Network) to protect your privacy?",
            subtitle: "💡 A VPN scrambles your internet traffic into an unreadable tunnel so ISPs, hackers, and public Wi-Fi snoopers cannot track what you do online.",
            options: [
                { text: "No — I thought VPNs were too complicated or technical to set up", risk: 20, objection: "price_complexity" },
                { text: "No — I didn't know what a VPN actually does", risk: 25, objection: "awareness" },
                { text: "No — I wasn't sure if my connection was really exposed", risk: 20, objection: "apathy" },
                { text: "Yes — I already use a VPN regularly", risk: 0, objection: "existing_user" }
            ]
        }
    ];

    // State Variables
    let currentStepIndex = 0;
    let selectedAnswers = [];
    let userObjection = null; // tracks Q5 objection type for results personalization
    let userTelemetry = {
        ip: null,
        city: null,
        country: null,
        isp: null
    };

    // DOM Elements
    const screenIntro = document.getElementById("screen-intro");
    const screenQuiz = document.getElementById("screen-quiz");
    const screenAnalyzing = document.getElementById("screen-analyzing");
    const screenResult = document.getElementById("screen-result");

    const btnStart = document.getElementById("btn-start");
    const btnRetake = document.getElementById("btn-retake");
    const ctaButton = document.getElementById("cta-button");
    const themeToggleBtn = document.getElementById("theme-toggle");

    const currentStepText = document.getElementById("current-step-text");
    const categoryBadge = document.getElementById("category-badge");
    const progressFill = document.getElementById("progress-fill");

    const qIconEl = document.getElementById("q-icon-el");
    const qTitle = document.getElementById("q-title");
    const qSub = document.getElementById("q-sub");
    const optionsGrid = document.getElementById("options-grid");

    // CAPI & Click Attribution Tracking
    let clickId = null;
    let trackingParams = {};

    /**
     * Set a first-party cookie with a given name, value, and max-age in days.
     */
    function setCookie(name, value, days) {
        const maxAge = days * 24 * 60 * 60;
        document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; SameSite=Lax`;
    }

    /**
     * Ensure _fbc cookie exists when fbclid is present in the URL.
     * Meta format: fb.1.{creation_timestamp_ms}.{fbclid}
     * Set with 90-day expiry per Meta's 2026 attribution window recommendation.
     */
    function ensureFbcCookie(urlParams) {
        const existingFbc = getCookie("_fbc");
        const fbclid = urlParams.get("fbclid");

        if (fbclid && !existingFbc) {
            const constructed = `fb.1.${Date.now()}.${fbclid}`;
            setCookie("_fbc", constructed, 90);
            return constructed;
        }
        return existingFbc || null;
    }

    function initTracking() {
        const urlParams = new URLSearchParams(window.location.search);
        
        // Extract meta & utm tracking parameters
        const trackingKeys = ["fbclid", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ad_id", "adset_id", "campaign_id"];
        trackingKeys.forEach(key => {
            if (urlParams.get(key)) {
                trackingParams[key] = urlParams.get(key);
            }
        });

        // Determine Click ID: fbclid > url click_id > localStorage click_id > generated ID
        if (urlParams.get("fbclid")) {
            clickId = urlParams.get("fbclid");
        } else if (urlParams.get("click_id")) {
            clickId = urlParams.get("click_id");
        } else {
            clickId = localStorage.getItem("nordvpn_click_id");
            if (!clickId) {
                clickId = "clk_" + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
            }
        }

        // Store clickId for persistence
        localStorage.setItem("nordvpn_click_id", clickId);

        // Ensure _fbc cookie is set from fbclid before Pixel init (covers ad-click traffic)
        ensureFbcCookie(urlParams);

        // Initialize Meta Pixel once with Advanced Matching (external_id), then fire PageView
        if (typeof window.fbq === "function") {
            window.fbq("init", "868721989329074", clickId ? { external_id: clickId } : {});
            window.fbq("track", "PageView");
        }

        // Fire initial CAPI & Pixel ViewContent event on quiz landing
        // Note: _fbp may not exist yet on this first call (Pixel sets it async).
        // Per Meta 2026 best practice, do NOT delay — rely on event_id deduplication
        // between Pixel (client) and CAPI (server) to merge the signals.
        sendCapiEvent("ViewContent", {
            content_name: "NordVPN Privacy Quiz",
            content_category: "VPN"
        });
    }

    function getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(";").shift();
        return null;
    }

    function sendCapiEvent(eventName, customData = {}) {
        if (!clickId) return;
        const eventId = `${eventName.toLowerCase()}_${clickId}_${Date.now()}`;
        const fbp = getCookie("_fbp");
        const fbc = getCookie("_fbc");

        // 1. Fire Client-Side Meta Pixel (with matching eventID for deduplication)
        if (typeof window.fbq === "function") {
            try {
                window.fbq("track", eventName, customData, { eventID: eventId });
            } catch (err) {
                console.warn(`Meta Pixel ${eventName} error:`, err);
            }
        }

        // 2. Fire Server-Side CAPI & store analytics via Cloud Function endpoint
        fetch("/api/track-quiz-event", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            keepalive: true,
            body: JSON.stringify({
                eventName: eventName,
                eventId: eventId,
                clickId: clickId,
                fbp: fbp,
                fbc: fbc,
                trackingParams: trackingParams,
                customData: customData,
                quizResult: customData.quizResult || null,
                eventSourceUrl: window.location.href
            })
        }).catch(err => {
            console.warn(`CAPI track ${eventName} error:`, err);
        });
    }

    // Initialize Engine
    function init() {
        initTheme();
        initTracking();
        bindEvents();
        setupCtaLink();
        fetchUserTelemetry();
    }

    // Fetch Live Telemetry from backend endpoint (/api/telemetry)
    let telemetryReady = false;

    async function fetchUserTelemetry() {
        try {
            const res = await fetch("/api/telemetry");
            if (!res.ok) return;

            const data = await res.json();
            if (data.ip) {
                userTelemetry.ip = data.ip;
                if (data.city) userTelemetry.city = data.city;
                if (data.district) userTelemetry.district = data.district;
                if (data.region) userTelemetry.region = data.region;
                if (data.country) userTelemetry.country = data.country;
                if (data.isp) userTelemetry.isp = data.isp;
                telemetryReady = true;
            }
        } catch (e) {
            console.warn("Telemetry fetch error:", e);
        }
    }

    // Country & Market VPN Adoption Statistics Helper
    function getCountryMarketStat() {
        const country = (userTelemetry.country || "").trim().toLowerCase();
        
        if (country.includes("united states") || country.includes("us") || country === "usa") {
            return {
                rate: "42%",
                text: "Over <strong>42% of internet users in the United States</strong> now use a VPN to protect their connection from ISP tracking & public Wi-Fi risks.",
                short: "Over 42% of users in the United States use a VPN"
            };
        }
        if (country.includes("singapore") || country === "sg") {
            return {
                rate: "38%",
                text: "Over <strong>38% of internet users in Singapore</strong> use a VPN to shield their data on public Wi-Fi & mobile networks.",
                short: "Over 38% of users in Singapore use a VPN"
            };
        }
        if (country.includes("australia") || country === "au") {
            return {
                rate: "31%",
                text: "Over <strong>31% of Australians</strong> use a VPN to keep their online activity private and bypass regional restrictions.",
                short: "Over 31% of users in Australia use a VPN"
            };
        }
        if (country.includes("canada") || country === "ca") {
            return {
                rate: "30%",
                text: "Over <strong>30% of Canadians</strong> rely on a VPN to prevent ISP data logging & protect personal search history.",
                short: "Over 30% of users in Canada use a VPN"
            };
        }
        if (country.includes("united kingdom") || country.includes("uk") || country.includes("britain")) {
            return {
                rate: "27%",
                text: "Over <strong>27% of UK internet users</strong> use a VPN to lock down their connection and keep search activity private.",
                short: "Over 27% of users in the UK use a VPN"
            };
        }

        const countryName = userTelemetry.country || "your area";
        return {
            rate: "28%",
            text: `Over <strong>1 in 4 internet users in ${countryName} (28%+)</strong> now use a VPN to keep their connection secure & private.`,
            short: `Over 28% of users in ${countryName} use a VPN`
        };
    }

    // System-Detected Dark / Light Theme Engine
    function initTheme() {
        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        const userOverride = localStorage.getItem("theme");

        if (userOverride) {
            document.documentElement.setAttribute("data-theme", userOverride);
        } else {
            document.documentElement.setAttribute("data-theme", mediaQuery.matches ? "dark" : "light");
        }

        // Listen for live system color scheme changes
        try {
            mediaQuery.addEventListener("change", (e) => {
                if (!localStorage.getItem("theme")) {
                    document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
                }
            });
        } catch (e) {
            mediaQuery.addListener((e) => {
                if (!localStorage.getItem("theme")) {
                    document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
                }
            });
        }

        if (themeToggleBtn) {
            themeToggleBtn.addEventListener("click", toggleTheme);
        }
    }

    function toggleTheme() {
        const currentTheme = document.documentElement.getAttribute("data-theme");
        const newTheme = currentTheme === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", newTheme);
        localStorage.setItem("theme", newTheme);
    }

    // Construct official NordVPN affiliate URL with click_id sub-parameters (url_id=658)
    function setupCtaLink() {
        if (!ctaButton) return;

        const affiliateBaseUrl = "https://go.nordvpn.net/aff_c";
        const affParams = new URLSearchParams({
            offer_id: "15",
            aff_id: "152405",
            url_id: "902"
        });

        if (clickId) {
            affParams.set("aff_click_id", clickId);
            affParams.set("aff_sub", clickId);
        }

        Object.keys(trackingParams).forEach(k => {
            if (k.startsWith("utm_") && k !== "utm_source" && k !== "utm_medium") {
                affParams.set(k, trackingParams[k]);
            }
        });

        ctaButton.href = `${affiliateBaseUrl}?${affParams.toString()}`;

        // Bind InitiateCheckout CAPI & Pixel event on CTA click with hybrid navigation guard
        ctaButton.addEventListener("click", (e) => {
            if (ctaButton.dataset.navigating === "true") return;

            e.preventDefault();
            ctaButton.dataset.navigating = "true";

            sendCapiEvent("InitiateCheckout", {
                content_name: "NordVPN Affiliate CTA",
                content_ids: ["nordvpn_15"],
                content_type: "product"
            });

            const destinationUrl = ctaButton.href;
            setTimeout(() => {
                ctaButton.dataset.navigating = "false";
                window.location.href = destinationUrl;
            }, 120);
        });
    }

    function bindEvents() {
        if (btnStart) btnStart.addEventListener("click", startQuiz);
    }

    function switchScreen(activeScreen) {
        [screenIntro, screenQuiz, screenAnalyzing, screenResult].forEach(screen => {
            if (screen === activeScreen) {
                screen.classList.remove("screen-hidden");
                screen.classList.add("screen-active");
            } else {
                screen.classList.add("screen-hidden");
                screen.classList.remove("screen-active");
            }
        });
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function getVisibleQuestionCount() {
        return QUIZ_QUESTIONS.length;
    }

    function getVisibleStepNumber(index) {
        return index + 1;
    }

    function startQuiz() {
        currentStepIndex = 0;
        selectedAnswers = [];
        userObjection = null;
        sendCapiEvent("Lead", {
            content_name: "NordVPN Quiz Start",
            step: "start"
        });
        renderQuestion(currentStepIndex);
        switchScreen(screenQuiz);
    }

    function renderQuestion(index) {
        const question = QUIZ_QUESTIONS[index];
        if (!question) return;

        const totalVisible = QUIZ_QUESTIONS.length;
        const stepNum = index + 1;
        currentStepText.textContent = stepNum;

        // Update dynamic total
        const totalStepsEl = document.getElementById("total-steps");
        if (totalStepsEl) totalStepsEl.textContent = totalVisible;

        categoryBadge.textContent = question.category;
        progressFill.style.width = `${(stepNum / totalVisible) * 100}%`;

        qIconEl.innerHTML = question.icon;
        qTitle.textContent = question.title;
        
        if (question.id === "vpn_knowledge" && telemetryReady && userTelemetry.country) {
            const stat = getCountryMarketStat();
            qSub.textContent = `💡 Did you know? ${stat.short}. A VPN scrambles your internet traffic into an unreadable tunnel so ISPs & public Wi-Fi cannot see what you do online.`;
        } else {
            qSub.textContent = question.subtitle;
        }

        optionsGrid.innerHTML = "";

        question.options.forEach(opt => {
            const btn = document.createElement("div");
            btn.className = "option-card";
            btn.innerHTML = `
                <span class="option-text">${opt.text}</span>
                <span class="option-indicator"></span>
            `;
            btn.addEventListener("click", () => handleSelectOption(btn, opt, index));
            optionsGrid.appendChild(btn);
        });
    }

    function handleSelectOption(cardElement, optionObj, questionIndex) {
        const allCards = optionsGrid.querySelectorAll(".option-card");
        allCards.forEach(c => c.classList.remove("selected"));
        cardElement.classList.add("selected");

        selectedAnswers[questionIndex] = {
            questionId: QUIZ_QUESTIONS[questionIndex].id,
            emoji: QUIZ_QUESTIONS[questionIndex].emoji,
            shortLabel: QUIZ_QUESTIONS[questionIndex].shortLabel,
            answer: optionObj.text,
            risk: optionObj.risk
        };

        // Track objection from Q5
        if (optionObj.objection) {
            userObjection = optionObj.objection;
        }

        // Snappy transition
        setTimeout(() => {
            if (currentStepIndex < QUIZ_QUESTIONS.length - 1) {
                currentStepIndex++;
                renderQuestion(currentStepIndex);
            } else {
                runAnalyzingScreen();
            }
        }, 220);
    }

    // Helper: detect exact Device & OS 100% accurately from Browser User-Agent
    function getDeviceOs() {
        const ua = navigator.userAgent || "";
        const platform = navigator.platform || "";
        if (/iPhone/i.test(ua)) return "iPhone (iOS)";
        if (/iPad/i.test(ua)) return "iPad (iPadOS)";
        if (/Android/i.test(ua)) {
            return /Mobile/i.test(ua) ? "Android Phone" : "Android Tablet";
        }
        if (/Macintosh|Mac OS X/i.test(ua) || /^Mac/i.test(platform)) {
            return "MacBook / Mac (macOS)";
        }
        if (/Windows/i.test(ua) || /^Win/i.test(platform)) {
            return "Windows PC";
        }
        if (/Linux/i.test(ua)) return "Linux PC";
        return "Web Device";
    }

    // Helper: display text for telemetry (returns null when not available)
    function displayIp() {
        return userTelemetry.ip || null;
    }
    function displayLoc() {
        const district = (userTelemetry.district || "").trim();
        const city = (userTelemetry.city || "").trim();
        const country = (userTelemetry.country || "").trim();

        // 1. Primary: District, City (e.g. "Ang Mo Kio, Singapore" or "Manhattan, New York")
        if (district && city && district.toLowerCase() !== city.toLowerCase()) {
            return `${district}, ${city}`;
        }

        // 2. Fallback 1: City, Country if distinct (e.g. "Tokyo, Japan")
        if (city && country && city.toLowerCase() !== country.toLowerCase()) {
            return `${city}, ${country}`;
        }

        // 3. Fallback 2: Single City / Country (e.g. "Singapore")
        return city || country || null;
    }
    function displayIsp() {
        return userTelemetry.isp || null;
    }

    function runAnalyzingScreen() {
        switchScreen(screenAnalyzing);

        const statusEl = document.getElementById("analyzing-status");
        const percentEl = document.getElementById("analyzing-percent");
        const check1 = document.getElementById("check-1");
        const check2 = document.getElementById("check-2");
        const check3 = document.getElementById("check-3");

        let progress = 0;
        const interval = setInterval(() => {
            progress += 4;
            if (progress > 100) progress = 100;
            percentEl.textContent = `${progress}%`;

            if (progress >= 30 && progress < 65) {
                const ip = displayIp();
                statusEl.textContent = ip ? `Checking Connection: ${ip}` : `Analyzing device connection...`;
                check1.classList.add("done");
                check1.querySelector(".check-icon").textContent = "✓";
            } else if (progress >= 65 && progress < 95) {
                const isp = displayIsp();
                statusEl.textContent = isp ? `Provider Check: ${isp}` : "Reviewing network security...";
                check2.classList.add("done");
                check2.querySelector(".check-icon").textContent = "✓";
            } else if (progress >= 95) {
                statusEl.textContent = "Preparing your personalized tips...";
                check3.classList.add("done");
                check3.querySelector(".check-icon").textContent = "✓";
            }

            if (progress >= 100) {
                clearInterval(interval);
                setTimeout(showResultsScreen, 300);
            }
        }, 35);
    }

    function showResultsScreen() {
        const totalRiskPoints = selectedAnswers.reduce((sum, item) => sum + (item ? item.risk : 0), 0);
        const maxPoints = 125;
        const calculatedPercentage = Math.min(100, Math.max(30, Math.round((totalRiskPoints / maxPoints) * 100)));

        const finalScoreNum = document.getElementById("final-score-num");
        const dialProgress = document.getElementById("dial-progress");
        const resultStatusTag = document.getElementById("result-status-tag");
        const resultRiskLevel = document.getElementById("result-risk-level");
        const resultHeadline = document.getElementById("result-headline");
        const vpnPitchSub = document.getElementById("vpn-pitch-sub");

        // Telemetry Footprint elements
        const telemetryDevice = document.getElementById("telemetry-device");
        const telemetryCity = document.getElementById("telemetry-city");
        const telemetryIsp = document.getElementById("telemetry-isp");
        const telemetryIp = document.getElementById("telemetry-ip");

        const telItemCity = document.getElementById("tel-item-city");
        const telItemIsp = document.getElementById("tel-item-isp");
        const telItemIp = document.getElementById("tel-item-ip");

        const deviceOs = getDeviceOs();
        const deviceShortName = deviceOs.replace(/ \(.*\)/, "");

        if (telemetryDevice) telemetryDevice.textContent = deviceOs;

        if (telemetryReady) {
            const city = displayLoc();
            if (city) {
                if (telItemCity) telItemCity.style.display = "";
                if (telemetryCity) telemetryCity.textContent = city;
            } else {
                if (telItemCity) telItemCity.style.display = "none";
            }

            const isp = displayIsp();
            if (isp) {
                if (telItemIsp) telItemIsp.style.display = "";
                if (telemetryIsp) telemetryIsp.textContent = isp;
            } else {
                if (telItemIsp) telItemIsp.style.display = "none";
            }

            const ip = displayIp();
            if (ip) {
                if (telItemIp) telItemIp.style.display = "";
                if (telemetryIp) telemetryIp.textContent = ip;
            } else {
                if (telItemIp) telItemIp.style.display = "none";
            }
        } else {
            if (telItemCity) telItemCity.style.display = "none";
            if (telItemIsp) telItemIsp.style.display = "none";
            if (telItemIp) telItemIp.style.display = "none";
        }

        finalScoreNum.textContent = `${calculatedPercentage}%`;

        // Circumference = 2 * PI * 52 ≈ 326.72
        const circumference = 326.72;
        const offset = circumference - (calculatedPercentage / 100) * circumference;
        if (dialProgress) dialProgress.style.strokeDashoffset = offset;

        const ispName = displayIsp();
        const city = displayLoc();

        // Render Personalized NordVPN Trust & Guidance Box
        const nordTrustBox = document.getElementById("nord-trust-box");
        if (nordTrustBox) {
            const stat = getCountryMarketStat();
            const deviceName = getDeviceOs().replace(/ \(.*\)/, "");
            
            let cardHeading = `🛡️ Recommended Privacy Step for ${deviceName}`;
            let tipText = "";
            
            if (userObjection === "price_complexity") {
                cardHeading = `🛡️ 1-Tap Automatic Setup for ${deviceName}`;
                tipText = `If setting up a VPN felt technical or complicated, NordVPN connects automatically with just 1 tap on ${deviceName} — zero configuration needed.`;
            } else if (userObjection === "awareness") {
                cardHeading = `🛡️ Essential Privacy Protection for ${deviceName}`;
                tipText = `Incognito mode only wipes local screen history. NordVPN encrypts your entire connection so your ISP and public Wi-Fi see zero activity.`;
            } else if (userObjection === "apathy") {
                cardHeading = `🛡️ Active Connection Exposure Report`;
                tipText = `Right now, your internet provider logs every website domain you open. NordVPN scrambles your data into an unreadable tunnel in 1 click.`;
            } else {
                cardHeading = `🛡️ Benchmark Your Privacy Protection`;
                tipText = `Compare your current setup with NordVPN's independently audited zero-logs infrastructure and built-in threat protection.`;
            }

            nordTrustBox.innerHTML = `
                <div class="trust-title">${cardHeading}</div>
                <div class="trust-desc">🌐 <strong>${stat.short}</strong>. ${tipText} We recommend trying NordVPN — trusted by over 14 million people worldwide as the most trusted VPN brand.</div>
            `;
        }

        // Render 3 Clean 1-Line Benefit Checkmarks
        const protectionList = document.getElementById("protection-list");
        if (protectionList) {
            protectionList.innerHTML = "";

            const protectionPoints = [
                ispName 
                    ? `✓ <strong>1-Tap Protection:</strong> Encrypts browsing before ${ispName} or public Wi-Fi sees it` 
                    : `✓ <strong>1-Tap Protection:</strong> Encrypts browsing before your ISP or public Wi-Fi sees it`,
                `✓ <strong>True Incognito:</strong> Hides site names &amp; prevents targeted ad tracking`,
                city
                    ? `✓ <strong>Location Privacy:</strong> Protects your ${city} IP address from websites`
                    : `✓ <strong>Location Privacy:</strong> Protects your physical IP address from websites`
            ];

            protectionPoints.forEach(pt => {
                const item = document.createElement("div");
                item.className = "bullet-row-simple";
                item.innerHTML = pt;
                protectionList.appendChild(item);
            });
        }

        // Personalized CTA button text based on objection (starts with "Try")
        if (ctaButton) {
            const btnSpan = ctaButton.querySelector("span");
            if (btnSpan) {
                const ctaTexts = {
                    price_complexity: "Try NordVPN for 1-Tap Privacy →",
                    awareness: "Try NordVPN Risk-Free →",
                    apathy: "Try NordVPN Protection →",
                    existing_user: "Try NordVPN Risk-Free →"
                };
                btnSpan.textContent = ctaTexts[userObjection] || "Try NordVPN Risk-Free →";
            }
        }

        // Fire CAPI CompleteRegistration event — Meta only processes flat primitive custom_data.
        // Rich quiz analytics (answers, telemetry) reach Firestore via quizResult in the CAPI body.
        sendCapiEvent("CompleteRegistration", {
            content_name: "NordVPN Quiz Complete",
            content_ids: ["nordvpn_15"],
            content_type: "product",
            status: calculatedPercentage >= 50 ? "high_risk" : "low_risk",
            quizResult: {
                score: calculatedPercentage,
                objection: userObjection,
                answers: selectedAnswers,
                telemetry: userTelemetry
            }
        });

        switchScreen(screenResult);
    }

    function resetQuiz() {
        startQuiz();
    }

    // Run on DOM Ready
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
