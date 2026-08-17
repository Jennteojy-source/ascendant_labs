/**
 * Ascendant Labs - NordVPN connection scan
 */
(function () {
    "use strict";

    let clickId = null;
    let trackingParams = {};
    let telemetryReady = false;
    let userTelemetry = {
        ip: null,
        city: null,
        district: null,
        region: null,
        country: null,
        isp: null
    };

    const screenIntro = document.getElementById("screen-intro");
    const screenAnalyzing = document.getElementById("screen-analyzing");
    const screenResult = document.getElementById("screen-result");
    const btnScan = document.getElementById("btn-scan");
    const ctaButton = document.getElementById("cta-button");
    const themeToggleBtn = document.getElementById("theme-toggle");

    function setCookie(name, value, days) {
        const maxAge = days * 24 * 60 * 60;
        document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; SameSite=Lax`;
    }

    function getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(";").shift();
        return null;
    }

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
        const trackingKeys = ["fbclid", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ad_id", "adset_id", "campaign_id"];
        trackingKeys.forEach((key) => {
            if (urlParams.get(key)) trackingParams[key] = urlParams.get(key);
        });

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

        localStorage.setItem("nordvpn_click_id", clickId);
        ensureFbcCookie(urlParams);

        if (typeof window.fbq === "function") {
            window.fbq("init", "868721989329074", clickId ? { external_id: clickId } : {});
            window.fbq("track", "PageView");
        }

        sendCapiEvent("ViewContent", {
            content_name: "NordVPN Privacy Scan",
            content_category: "VPN"
        });
    }

    function sendCapiEvent(eventName, customData = {}) {
        if (!clickId) return;
        const eventId = `${eventName.toLowerCase()}_${clickId}_${Date.now()}`;
        const fbp = getCookie("_fbp");
        const fbc = getCookie("_fbc");

        if (typeof window.fbq === "function") {
            try {
                window.fbq("track", eventName, customData, { eventID: eventId });
            } catch (err) {
                console.warn(`Meta Pixel ${eventName} error:`, err);
            }
        }

        fetch("/api/track-quiz-event", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            keepalive: true,
            body: JSON.stringify({
                eventName,
                eventId,
                clickId,
                fbp,
                fbc,
                trackingParams,
                customData,
                quizResult: customData.quizResult || null,
                eventSourceUrl: window.location.href
            })
        }).catch((err) => {
            console.warn(`CAPI track ${eventName} error:`, err);
        });
    }

    function initTheme() {
        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        const userOverride = localStorage.getItem("theme");
        document.documentElement.setAttribute(
            "data-theme",
            userOverride || (mediaQuery.matches ? "dark" : "light")
        );

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
            themeToggleBtn.addEventListener("click", () => {
                const currentTheme = document.documentElement.getAttribute("data-theme");
                const newTheme = currentTheme === "dark" ? "light" : "dark";
                document.documentElement.setAttribute("data-theme", newTheme);
                localStorage.setItem("theme", newTheme);
            });
        }
    }

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

    function setupCtaLink() {
        if (!ctaButton) return;

        const affParams = new URLSearchParams({
            offer_id: "15",
            aff_id: "152405",
            url_id: "902"
        });

        if (clickId) {
            affParams.set("aff_click_id", clickId);
            affParams.set("aff_sub", clickId);
        }

        Object.keys(trackingParams).forEach((k) => {
            if (k.startsWith("utm_") && k !== "utm_source" && k !== "utm_medium") {
                affParams.set(k, trackingParams[k]);
            }
        });

        ctaButton.href = `https://go.nordvpn.net/aff_c?${affParams.toString()}`;

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

    function switchScreen(activeScreen) {
        [screenIntro, screenAnalyzing, screenResult].forEach((screen) => {
            if (!screen) return;
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

    function getDeviceOs() {
        const ua = navigator.userAgent || "";
        const platform = navigator.platform || "";
        if (/iPhone/i.test(ua)) return "iPhone";
        if (/iPad/i.test(ua)) return "iPad";
        if (/Android/i.test(ua)) {
            return /Mobile/i.test(ua) ? "Android phone" : "Android tablet";
        }
        if (/Macintosh|Mac OS X/i.test(ua) || /^Mac/i.test(platform)) return "Mac";
        if (/Windows/i.test(ua) || /^Win/i.test(platform)) return "Windows PC";
        if (/Linux/i.test(ua)) return "Linux";
        return "Web Device";
    }

    function displayLoc() {
        const district = (userTelemetry.district || "").trim();
        const city = (userTelemetry.city || "").trim();
        const country = (userTelemetry.country || "").trim();
        if (district && city && district.toLowerCase() !== city.toLowerCase()) {
            return `${district}, ${city}`;
        }
        if (city && country && city.toLowerCase() !== country.toLowerCase()) {
            return `${city}, ${country}`;
        }
        return city || country || null;
    }

    function waitForTelemetry(timeoutMs) {
        if (telemetryReady) return Promise.resolve();
        return new Promise((resolve) => {
            const started = Date.now();
            const timer = setInterval(() => {
                if (telemetryReady || Date.now() - started >= timeoutMs) {
                    clearInterval(timer);
                    resolve();
                }
            }, 80);
        });
    }

    function setTelemetryRow(itemId, valueEl, value) {
        const item = document.getElementById(itemId);
        const el = document.getElementById(valueEl);
        if (!item || !el) return;
        if (value) {
            item.style.display = "";
            el.textContent = value;
        } else if (itemId !== "tel-item-device") {
            item.style.display = "none";
        } else {
            el.textContent = "Web Device";
        }
    }

    function showResultsScreen() {
        const deviceOs = getDeviceOs();
        const city = displayLoc();
        const isp = userTelemetry.isp || null;
        const ip = userTelemetry.ip || null;

        setTelemetryRow("tel-item-device", "telemetry-device", deviceOs);
        setTelemetryRow("tel-item-city", "telemetry-city", city);
        setTelemetryRow("tel-item-isp", "telemetry-isp", isp);
        setTelemetryRow("tel-item-ip", "telemetry-ip", ip);

        const deviceIcon = document.getElementById("device-icon");
        if (deviceIcon) {
            const isPhone = /iPhone|Android phone/i.test(deviceOs);
            deviceIcon.innerHTML = isPhone
                ? '<rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>'
                : '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>';
        }

        const vpnWhy = document.getElementById("vpn-why");
        if (vpnWhy) {
            const provider = isp || "your provider";
            vpnWhy.textContent = `A VPN hides the sites you visit from ${provider}, and masks this IP from websites.`;
        }

        switchScreen(screenResult);
    }

    async function runScan() {
        if (btnScan) {
            if (btnScan.dataset.scanning === "true") return;
            btnScan.dataset.scanning = "true";
            btnScan.disabled = true;
        }

        sendCapiEvent("Lead", {
            content_name: "NordVPN Connection Scan",
            content_ids: ["nordvpn_15"],
            content_type: "product",
            status: "scan_started",
            quizResult: {
                score: null,
                objection: "scan",
                answers: [],
                telemetry: userTelemetry
            }
        });

        switchScreen(screenAnalyzing);

        const statusEl = document.getElementById("analyzing-status");
        const percentEl = document.getElementById("analyzing-percent");

        let progress = 0;
        const interval = setInterval(() => {
            progress += 8;
            if (progress > 100) progress = 100;
            if (percentEl) percentEl.textContent = `${progress}%`;

            if (progress >= 40 && progress < 80) {
                if (statusEl) {
                    statusEl.textContent = userTelemetry.ip
                        ? `Found IP ${userTelemetry.ip}`
                        : "Checking your connection...";
                }
            } else if (progress >= 80) {
                if (statusEl) {
                    statusEl.textContent = userTelemetry.isp
                        ? `Provider: ${userTelemetry.isp}`
                        : "Preparing results...";
                }
            }

            if (progress >= 100) {
                clearInterval(interval);
                waitForTelemetry(400).then(showResultsScreen);
            }
        }, 32);
    }

    function init() {
        initTheme();
        initTracking();
        setupCtaLink();
        fetchUserTelemetry();
        if (btnScan) btnScan.addEventListener("click", runScan);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
