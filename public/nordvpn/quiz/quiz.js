/**
 * Ascendant Labs - NordVPN Interactive Data Exposure Quiz Engine
 */

(function () {
    "use strict";

    // Quiz Questions Data — 100% Relatable Everyday Questions
    const QUIZ_QUESTIONS = [
        {
            id: "wifi",
            category: "Network Security",
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.55a11 11 0 0114.08 0M1.42 9a16 16 0 0121.16 0M8.53 16.11a6 6 0 016.95 0M12 20h.01"/></svg>`,
            emoji: "📶",
            shortLabel: "Public Wi-Fi",
            title: "How often do you connect to public Wi-Fi in cafes, airports, or hotels?",
            subtitle: "Connecting to open public networks exposes your phone or laptop traffic.",
            options: [
                { text: "Never — I only use cellular / home Wi-Fi", risk: 0 },
                { text: "Occasionally when traveling", risk: 15 },
                { text: "Frequently (Weekly or Daily)", risk: 30 }
            ]
        },
        {
            id: "ads",
            category: "Ad Surveillance",
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
            emoji: "👁️",
            shortLabel: "Targeted Ads",
            title: "Have you ever searched an item and seen creepy ads for it 10 minutes later?",
            subtitle: "Ad networks follow your browser footprint across different websites.",
            options: [
                { text: "Rarely", risk: 0 },
                { text: "Sometimes", risk: 12 },
                { text: "Constantly — It feels like I am being watched", risk: 25 }
            ]
        },
        {
            id: "incognito",
            category: "Browsing Privacy",
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>`,
            emoji: "🕵️",
            shortLabel: "Incognito Myth",
            title: "Did you know 'Incognito Mode' does NOT hide your browsing from your Wi-Fi owner or ISP?",
            subtitle: "Incognito only deletes local browser history — your network still logs every site.",
            options: [
                { text: "Yes, I already knew that", risk: 0 },
                { text: "I had no idea! I thought it was completely private", risk: 25 },
                { text: "I use Incognito expecting full privacy", risk: 25 }
            ]
        },
        {
            id: "location",
            category: "Location Tracking",
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a8 8 0 00-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 00-8-8zm0 11a3 3 0 110-6 3 3 0 010 6z"/></svg>`,
            emoji: "📍",
            shortLabel: "IP Exposure",
            title: "Are you aware websites can see your exact city location and IP address right now?",
            subtitle: "Your public IP address reveals your location to any website you open.",
            options: [
                { text: "Yes, I use a VPN to mask it", risk: 0 },
                { text: "I knew IP exists, but not exact location", risk: 15 },
                { text: "No, I thought my location was hidden", risk: 25 }
            ]
        },
        {
            id: "isp_logging",
            category: "ISP Data Selling",
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
            emoji: "🛡️",
            shortLabel: "ISP Tracking",
            title: "How do you feel about your internet provider tracking & selling your browsing history?",
            subtitle: "In many countries, ISPs legally log and monetize customer browsing data.",
            options: [
                { text: "I don't mind", risk: 0 },
                { text: "Somewhat bothered", risk: 15 },
                { text: "Extremely bothered — My browsing should be private!", risk: 25 }
            ]
        }
    ];

    // State Variables
    let currentStepIndex = 0;
    let selectedAnswers = [];
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

                // Dynamically update Live Telemetry Teaser on Page 1 for maximum CTR curiosity!
                const teaserEl = document.getElementById("intro-teaser-text");
                if (teaserEl) {
                    const locStr = displayLoc();
                    const ispStr = displayIsp();
                    if (locStr && ispStr) {
                        teaserEl.innerHTML = `⚠️ <strong>UNPROTECTED:</strong> ${locStr} (${ispStr}) Exposed`;
                    } else if (locStr) {
                        teaserEl.innerHTML = `⚠️ <strong>UNPROTECTED:</strong> ${locStr} Network Exposed`;
                    } else {
                        teaserEl.innerHTML = `⚠️ <strong>UNPROTECTED:</strong> Public IP &amp; Location Exposed`;
                    }
                }
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

    function startQuiz() {
        currentStepIndex = 0;
        selectedAnswers = [];
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

        currentStepText.textContent = index + 1;
        categoryBadge.textContent = question.category;
        progressFill.style.width = `${((index + 1) / QUIZ_QUESTIONS.length) * 100}%`;

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
        const totalRiskPoints = selectedAnswers.reduce((sum, item) => sum + item.risk, 0);
        const maxPoints = 120;
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

        // Render 3 Ultra-Clean 1-Line Checkmarks
        const protectionList = document.getElementById("protection-list");
        if (protectionList) {
            protectionList.innerHTML = "";
            const protectionPoints = [
                ispName ? `✓ <strong>Stops ISP Tracking:</strong> Hides activity from ${ispName}` : `✓ <strong>Stops ISP Tracking:</strong> Hides activity from your provider`,
                city ? `✓ <strong>Hides Location & IP:</strong> Protects your ${city} address` : `✓ <strong>Hides Location & IP:</strong> Protects your physical address`,
                `✓ <strong>Blocks Ads & Viruses:</strong> Built-in automatic protection`
            ];

            protectionPoints.forEach(pt => {
                const item = document.createElement("div");
                item.className = "bullet-row-simple";
                item.innerHTML = pt;
                protectionList.appendChild(item);
            });
        }

        if (ctaButton) {
            const btnSpan = ctaButton.querySelector("span");
            if (btnSpan) btnSpan.textContent = "Get NordVPN Protection →";
        }

        // Fire CAPI CompleteRegistration event on completing quiz & pass rich analytics payload
        sendCapiEvent("CompleteRegistration", {
            content_name: "NordVPN Quiz Complete",
            risk_score: calculatedPercentage,
            answers: selectedAnswers,
            quizResult: {
                score: calculatedPercentage,
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
