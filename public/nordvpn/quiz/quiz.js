/**
 * Ascendant Labs - NordVPN Interactive Data Exposure Quiz Engine
 */

(function () {
    "use strict";

    // Quiz Questions Data — 100% User-Friendly (No Technical Jargon)
    const QUIZ_QUESTIONS = [
        {
            id: "connection_type",
            category: "Internet Usage",
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.55a11 11 0 0114.08 0M1.42 9a16 16 0 0121.16 0M8.53 16.11a6 6 0 016.95 0M12 20h.01"/></svg>`,
            emoji: "🌐",
            shortLabel: "Connection Type",
            title: "Where do you connect to the internet most?",
            subtitle: "Your internet company can track and log every website you visit on unencrypted networks.",
            options: [
                { text: "Home Wi-Fi", risk: 20 },
                { text: "Mobile / Cellular Data", risk: 15 },
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
            subtitle: "Incognito only clears history on your device screen. Your internet company still logs every website.",
            options: [
                { text: "Yes — Thought Incognito hid sites from everyone", risk: 25 },
                { text: "Sometimes — Wasn't sure what it actually hid", risk: 20 },
                { text: "No — I knew my internet company could still see my sites", risk: 0 }
            ]
        },
        {
            id: "data_sales",
            category: "Browsing History",
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>`,
            emoji: "💰",
            shortLabel: "Data Sales",
            title: "Did you know internet companies can legally sell your browsing history?",
            subtitle: "Without protection, internet companies build search profiles linked directly to your location.",
            options: [
                { text: "No idea! I thought my browsing was private", risk: 25 },
                { text: "Heard rumors, but didn't think mine did", risk: 20 },
                { text: "Yes — I knew companies log and sell browsing activity", risk: 10 }
            ]
        },
        {
            id: "sensitive_searches",
            category: "Search Privacy",
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
            emoji: "👁️",
            shortLabel: "Search Activity",
            title: "Do you ever look up private, medical, or financial topics online?",
            subtitle: "Unless your connection is locked down, every website name you open can be recorded.",
            options: [
                { text: "Yes — Frequently", risk: 25 },
                { text: "Sometimes", risk: 15 },
                { text: "Rarely", risk: 0 }
            ]
        },
        {
            id: "vpn_objection",
            category: "Privacy Protection",
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`,
            emoji: "🔒",
            shortLabel: "Protection App",
            title: "What is currently stopping you from locking down your privacy?",
            subtitle: "A protection app (VPN) scrambles your internet activity into an unreadable tunnel in 1 tap.",
            options: [
                { text: "Thought Incognito mode was enough until today", risk: 25, objection: "awareness" },
                { text: "Seems too expensive", risk: 20, objection: "price" },
                { text: "Seems too confusing to set up", risk: 20, objection: "complexity" },
                { text: "Not sure if I really need one", risk: 20, objection: "apathy" },
                { text: "I already use a protection app regularly", risk: 0, objection: "existing_user" }
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

        // Initialize Meta Pixel once with Advanced Matching (external_id), then fire PageView
        if (typeof window.fbq === "function") {
            window.fbq("init", "868721989329074", clickId ? { external_id: clickId } : {});
            window.fbq("track", "PageView");
        }

        // Fire initial CAPI & Pixel ViewContent event on quiz landing
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
        const eventId = `${eventName.toLowerCase()}_${clickId}`;
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
            offer_id: "658",
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

        // Bind InitiateCheckout CAPI event on CTA click
        ctaButton.addEventListener("click", () => {
            sendCapiEvent("InitiateCheckout", {
                content_name: "NordVPN Affiliate CTA",
                currency: "USD",
                value: 0
            });
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
        qSub.textContent = question.subtitle;

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
                statusEl.textContent = ip ? `Reading IP: ${ip}` : `Scanning ${getDeviceOs()} fingerprint...`;
                check1.classList.add("done");
                check1.querySelector(".check-icon").textContent = "✓";
            } else if (progress >= 65 && progress < 95) {
                const isp = displayIsp();
                statusEl.textContent = isp ? `ISP: ${isp}` : "Analyzing exposure vectors...";
                check2.classList.add("done");
                check2.querySelector(".check-icon").textContent = "✓";
            } else if (progress >= 95) {
                statusEl.textContent = "Finalizing vulnerability matrix...";
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

        // 1-Sentence Ultra-Fast Bridge
        const expText = document.getElementById("vpn-exp-text");
        if (expText) {
            if (ispName && city) {
                expText.innerHTML = `Shields your <strong>${ispName}</strong> connection &amp; hides your <strong>${city}</strong> location in 1 click.`;
            } else if (ispName) {
                expText.innerHTML = `Shields your <strong>${ispName}</strong> connection &amp; hides your internet address in 1 click.`;
            } else {
                expText.innerHTML = `Shields your internet connection &amp; hides your location in 1 click.`;
            }
        }

        // Categorize Risk Level & set status headline
        if (calculatedPercentage >= 70) {
            if (resultStatusTag) {
                resultStatusTag.className = "result-badge risk-critical";
                resultRiskLevel.textContent = "HIGH EXPOSURE RISK";
            }
            if (resultHeadline) resultHeadline.textContent = "Your Connection Is Unprotected";
        } else if (calculatedPercentage >= 45) {
            if (resultStatusTag) {
                resultStatusTag.className = "result-badge risk-elevated";
                resultRiskLevel.textContent = "ELEVATED PRIVACY RISK";
            }
            if (resultHeadline) resultHeadline.textContent = "Vulnerabilities Found";
        } else {
            if (resultStatusTag) {
                resultStatusTag.className = "result-badge risk-elevated";
                resultRiskLevel.textContent = "MODERATE EXPOSURE";
            }
            if (resultHeadline) resultHeadline.textContent = "Your Activity Is Exposed";
        }

        // Render personalized protection checkmarks based on quiz answers
        const protectionList = document.getElementById("protection-list");
        if (protectionList) {
            protectionList.innerHTML = "";

            // Build personalized points based on what the user actually answered
            const protectionPoints = [];

            // Check Q1 (ISP Connection) — index 0
            const connAnswer = selectedAnswers[0];
            if (connAnswer && connAnswer.risk > 0) {
                protectionPoints.push(ispName
                    ? `✓ <strong>Blocks ${ispName} Logging:</strong> Encrypts browsing before your ISP sees it`
                    : `✓ <strong>Blocks ISP Logging:</strong> Encrypts browsing before your provider sees it`);
            }

            // Check Q2 (Incognito Myth) — index 1
            const incognitoAnswer = selectedAnswers[1];
            if (incognitoAnswer && incognitoAnswer.risk > 0) {
                protectionPoints.push(`✓ <strong>True Incognito Shield:</strong> Hides site names from your network provider`);
            }

            // Check Q3 (ISP Data Sales) — index 2
            const salesAnswer = selectedAnswers[2];
            if (salesAnswer && salesAnswer.risk > 0) {
                protectionPoints.push(`✓ <strong>Stops Data Monetization:</strong> Prevents ISPs from logging & selling search history`);
            }

            // Check Q4 (DNS Exposure) — index 3
            const dnsAnswer = selectedAnswers[3];
            if (dnsAnswer && dnsAnswer.risk > 0) {
                protectionPoints.push(`✓ <strong>Encrypted DNS:</strong> Scrambles all domain requests into unreadable noise`);
            }

            // Check Q5 (VPN Shield / Objection) — index 4
            const vpnAnswer = selectedAnswers[4];
            if (vpnAnswer) {
                protectionPoints.push(city
                    ? `✓ <strong>Masks Location & IP:</strong> Protects your ${city} IP address from websites`
                    : `✓ <strong>Masks Location & IP:</strong> Protects your physical IP address from websites`);
            }

            // If user scored low risk on everything, show generic top 3
            if (protectionPoints.length === 0) {
                protectionPoints.push(
                    ispName ? `✓ <strong>Blocks ${ispName} Logging:</strong> Encrypts activity from your ISP` : `✓ <strong>Blocks ISP Logging:</strong> Encrypts activity from your provider`,
                    `✓ <strong>True Incognito Shield:</strong> Hides website domains from DNS logs`,
                    city ? `✓ <strong>Masks Location & IP:</strong> Protects your ${city} IP address` : `✓ <strong>Masks Location & IP:</strong> Protects your physical IP address`
                );
            }

            // Show top 3 most relevant points
            protectionPoints.slice(0, 3).forEach(pt => {
                const item = document.createElement("div");
                item.className = "bullet-row-simple";
                item.innerHTML = pt;
                protectionList.appendChild(item);
            });
        }

        // Render personalized objection-buster based on Q5 answer
        const objectionBuster = document.getElementById("objection-buster");
        if (objectionBuster) {
            const deviceName = getDeviceOs().replace(/ \(.*\)/, "");
            const objectionMessages = {
                awareness: `🕵️ <strong>Incognito Myth Busted:</strong> Incognito mode only wipes screen history. Your ISP still logs every site you visit. NordVPN encrypts your connection so your ISP sees zero activity.`,
                price: `💰 <strong>Affordable Protection:</strong> NordVPN is just <strong>$3.09/mo</strong> (less than a coffee) with a <strong>30-day money-back guarantee</strong>.`,
                complexity: `⚡ <strong>1-Tap Setup:</strong> Download NordVPN on your ${deviceName} and tap Quick Connect — encrypted in under 15 seconds.`,
                apathy: `🔍 <strong>Active Exposure:</strong> Your ISP logs every domain you visit right now. NordVPN makes your browsing 100% unreadable.`,
                existing_user: `✅ <strong>Fastest Speeds:</strong> NordVPN offers top speeds and an audited zero-logs policy — see if it beats your current provider.`
            };

            if (userObjection && objectionMessages[userObjection]) {
                objectionBuster.innerHTML = objectionMessages[userObjection];
                objectionBuster.style.display = "block";
            } else {
                objectionBuster.style.display = "none";
            }
        }

        // Personalized CTA button text based on objection
        if (ctaButton) {
            const btnSpan = ctaButton.querySelector("span");
            if (btnSpan) {
                const ctaTexts = {
                    price: "Try NordVPN Risk-Free — $3.09/mo →",
                    complexity: "Get 1-Click Protection →",
                    apathy: "Hide My Activity Now →",
                    awareness: "Start My Private Tunnel →",
                    existing_user: "Compare NordVPN →"
                };
                btnSpan.textContent = ctaTexts[userObjection] || "Get NordVPN Protection →";
            }
        }

        // Fire CAPI CompleteRegistration event on completing quiz & pass rich analytics payload
        sendCapiEvent("CompleteRegistration", {
            content_name: "NordVPN Quiz Complete",
            risk_score: calculatedPercentage,
            objection: userObjection,
            answers: selectedAnswers,
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
