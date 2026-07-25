/**
 * Ascendant Labs - NordVPN Interactive Data Exposure Quiz Engine
 */

(function () {
    "use strict";

    // Quiz Questions Data
    const QUIZ_QUESTIONS = [
        {
            id: "wifi",
            category: "Network Security",
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.55a11 11 0 0114.08 0M1.42 9a16 16 0 0121.16 0M8.53 16.11a6 6 0 016.95 0M12 20h.01"/></svg>`,
            emoji: "📶",
            shortLabel: "Public Wi-Fi",
            title: "How often do you connect to public Wi-Fi?",
            subtitle: "Airports, coffee shops, hotels, gyms, or public transport.",
            options: [
                { text: "Never", risk: 0 },
                { text: "A few times a year", risk: 15 },
                { text: "Frequently (Weekly/Daily)", risk: 30 }
            ]
        },
        {
            id: "cookies",
            category: "Web Tracking",
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1010 10A10 10 0 0012 2zm-1 5a1.5 1.5 0 11-1.5 1.5A1.5 1.5 0 0111 7zm5 3a1.5 1.5 0 11-1.5 1.5A1.5 1.5 0 0116 10zm-7 4a1.5 1.5 0 11-1.5 1.5A1.5 1.5 0 019 14zm6 2a1.5 1.5 0 11-1.5 1.5A1.5 1.5 0 0115 16z"/></svg>`,
            emoji: "🍪",
            shortLabel: "Cookie Tracking",
            title: "How often do you click 'Accept All' on cookie popups?",
            subtitle: "When reading news or browsing new websites.",
            options: [
                { text: "Rarely (I reject optional cookies)", risk: 0 },
                { text: "Sometimes", risk: 15 },
                { text: "Every day (I accept immediately)", risk: 25 }
            ]
        },
        {
            id: "location",
            category: "Mobile Geolocation",
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a8 8 0 00-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 00-8-8zm0 11a3 3 0 110-6 3 3 0 010 6z"/></svg>`,
            emoji: "📍",
            shortLabel: "Location Access",
            title: "How many apps have access to your phone location?",
            subtitle: "Including social media, shopping, games, and weather apps.",
            options: [
                { text: "Only essential apps (Maps / Rideshare)", risk: 0 },
                { text: "Some apps", risk: 15 },
                { text: "Not sure / Most apps I download", risk: 25 }
            ]
        },
        {
            id: "ads",
            category: "Ad Surveillance",
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
            emoji: "👁️",
            shortLabel: "Ad Tracking",
            title: "Have you ever searched an item and seen ads for it shortly afterwards?",
            subtitle: "Targeted ads appearing across social media or web pages.",
            options: [
                { text: "Never", risk: 0 },
                { text: "Sometimes", risk: 10 },
                { text: "Frequently (It happens all the time)", risk: 20 }
            ]
        },
        {
            id: "passwords",
            category: "Credential Security",
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`,
            emoji: "🔑",
            shortLabel: "Password Reuse",
            title: "Do you reuse passwords across multiple online accounts?",
            subtitle: "Or use simple variations for convenience.",
            options: [
                { text: "No, I use unique passwords / manager", risk: 0 },
                { text: "For a few non-important sites", risk: 12 },
                { text: "Yes, I use 1 or 2 passwords for almost everything", risk: 20 }
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

        // Fire initial CAPI ViewContent event on quiz landing
        sendCapiEvent("ViewContent", {
            content_name: "NordVPN Privacy Quiz",
            content_category: "VPN"
        });
    }

    function sendCapiEvent(eventName, customData = {}) {
        if (!clickId) return;
        const payload = {
            eventName: eventName,
            eventId: `${eventName.toLowerCase()}_${clickId}`,
            clickId: clickId,
            trackingParams: trackingParams,
            customData: customData,
            eventSourceUrl: window.location.href
        };

        fetch("/api/track-quiz-event", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
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

    // Fetch Live User IP, Location, and ISP via multiple APIs
    async function fetchUserTelemetry() {
        // Primary: ipapi.co (returns IP, city, country, org)
        try {
            const res = await fetch("https://ipapi.co/json/");
            if (res.ok) {
                const data = await res.json();
                if (data.ip) userTelemetry.ip = data.ip;
                if (data.city) userTelemetry.city = data.city;
                if (data.country_name) userTelemetry.country = data.country_name;
                if (data.org) userTelemetry.isp = data.org;
                // If org is missing, try asn
                if (!userTelemetry.isp && data.asn) userTelemetry.isp = data.asn;
                return; // Success — done
            }
        } catch (e) { /* fall through to secondary */ }

        // Secondary: ip-api.com (returns IP, city, country, isp)
        try {
            const res2 = await fetch("http://ip-api.com/json/?fields=query,city,country,isp");
            if (res2.ok) {
                const data2 = await res2.json();
                if (data2.query) userTelemetry.ip = data2.query;
                if (data2.city) userTelemetry.city = data2.city;
                if (data2.country) userTelemetry.country = data2.country;
                if (data2.isp) userTelemetry.isp = data2.isp;
                return;
            }
        } catch (e) { /* fall through to tertiary */ }

        // Tertiary: ipify (IP only)
        try {
            const res3 = await fetch("https://api.ipify.org?format=json");
            if (res3.ok) {
                const data3 = await res3.json();
                if (data3.ip) userTelemetry.ip = data3.ip;
            }
        } catch (err) {
            console.log("All telemetry APIs failed — using detected defaults.");
        }
    }

    // Theme Switcher (Dark / Light Mode)
    function initTheme() {
        const savedTheme = localStorage.getItem("theme");
        if (savedTheme) {
            document.documentElement.setAttribute("data-theme", savedTheme);
        } else {
            const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
            document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
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

    // Construct official NordVPN affiliate URL with click_id sub-parameters
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
            if (k.startsWith("utm_")) {
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
        if (btnRetake) btnRetake.addEventListener("click", resetQuiz);
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

    // Helper: display text for telemetry or fallback
    function displayIp() {
        return userTelemetry.ip || "Detected";
    }
    function displayLoc() {
        const parts = [userTelemetry.city, userTelemetry.country].filter(Boolean);
        return parts.length > 0 ? parts.join(", ") : "Visible to ISP";
    }
    function displayIsp() {
        return userTelemetry.isp || "Your Internet Provider";
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
                statusEl.textContent = `Reading IP: ${displayIp()}`;
                check1.classList.add("done");
                check1.querySelector(".check-icon").textContent = "✓";
            } else if (progress >= 65 && progress < 95) {
                statusEl.textContent = `ISP: ${displayIsp()}`;
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

        // Telemetry Footprint elements (populated from live detection)
        const telemetryIp = document.getElementById("telemetry-ip");
        const telemetryLoc = document.getElementById("telemetry-loc");
        const telemetryIsp = document.getElementById("telemetry-isp");

        if (telemetryIp) telemetryIp.textContent = displayIp();
        if (telemetryLoc) telemetryLoc.textContent = displayLoc();
        if (telemetryIsp) telemetryIsp.textContent = displayIsp();

        finalScoreNum.textContent = `${calculatedPercentage}%`;

        // Circumference = 2 * PI * 52 ≈ 326.72
        const circumference = 326.72;
        const offset = circumference - (calculatedPercentage / 100) * circumference;
        dialProgress.style.strokeDashoffset = offset;

        const ispName = displayIsp();

        // Categorize Risk Level & set one-liner pitch using detected info
        if (calculatedPercentage >= 70) {
            resultStatusTag.className = "result-badge risk-critical";
            resultRiskLevel.textContent = "CRITICAL EXPOSURE";
            resultHeadline.textContent = "High Risk Detected";
            vpnPitchSub.textContent = `Your IP is exposed to ${ispName}. NordVPN encrypts everything in 1 click.`;
        } else if (calculatedPercentage >= 45) {
            resultStatusTag.className = "result-badge risk-elevated";
            resultRiskLevel.textContent = "ELEVATED RISK";
            resultHeadline.textContent = "Vulnerabilities Found";
            vpnPitchSub.textContent = `${ispName} can see every site you visit. NordVPN hides your IP & activity instantly.`;
        } else {
            resultStatusTag.className = "result-badge risk-elevated";
            resultRiskLevel.textContent = "MODERATE EXPOSURE";
            resultHeadline.textContent = "Good Habits — IP Still Exposed";
            vpnPitchSub.textContent = `Even with safe habits, ${ispName} logs all your traffic. NordVPN shields you 24/7.`;
        }

        // Render Compact Visual Risk Bars
        const riskBars = document.getElementById("risk-bars");
        riskBars.innerHTML = "";
        selectedAnswers.forEach(ans => {
            let level, cssClass, barWidth;
            if (ans.risk === 0) {
                level = "Safe";
                cssClass = "safe";
                barWidth = "20%";
            } else if (ans.risk <= 15) {
                level = "Moderate";
                cssClass = "moderate";
                barWidth = "60%";
            } else {
                level = "At Risk";
                cssClass = "critical";
                barWidth = "100%";
            }

            const bar = document.createElement("div");
            bar.className = "risk-bar-item";
            bar.innerHTML = `
                <span class="risk-bar-icon">${ans.emoji}</span>
                <span class="risk-bar-label">${ans.shortLabel}</span>
                <div class="risk-bar-track">
                    <div class="risk-bar-fill ${cssClass}" style="width: 0%;"></div>
                </div>
                <span class="risk-bar-tag ${cssClass}">${level}</span>
            `;
            riskBars.appendChild(bar);

            // Animate bar fill after append
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    bar.querySelector(".risk-bar-fill").style.width = barWidth;
                });
            });
        });

        // Fire CAPI CompleteRegistration event on completing quiz and pass answers
        sendCapiEvent("CompleteRegistration", {
            content_name: "NordVPN Quiz Complete",
            risk_score: calculatedPercentage,
            answers: selectedAnswers
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
