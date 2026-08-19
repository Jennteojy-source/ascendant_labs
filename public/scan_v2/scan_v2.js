(function () {
    "use strict";

    const params = new URLSearchParams(window.location.search);
    const sid = params.get("sid") || ("scn_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36));
    const waId = (params.get("wa") || params.get("wa_id") || "").replace(/\D/g, "");
    const percentEl = document.getElementById("analyzing-percent");
    const statusEl = document.getElementById("analyzing-status");
    const screenAnalyzing = document.getElementById("screen-analyzing");
    const screenDone = document.getElementById("screen-done");
    const returnLink = document.getElementById("return-link");
    const doneSummary = document.getElementById("done-summary");

    function getDeviceOs() {
        const ua = navigator.userAgent || "";
        if (/iPhone/i.test(ua)) return "iPhone";
        if (/iPad/i.test(ua)) return "iPad";
        if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "Android phone" : "Android tablet";
        if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
        if (/Windows/i.test(ua)) return "Windows PC";
        return "Web Device";
    }

    function switchScreen(active) {
        [screenAnalyzing, screenDone].forEach((screen) => {
            if (!screen) return;
            screen.classList.toggle("screen-hidden", screen !== active);
            screen.classList.toggle("screen-active", screen === active);
        });
    }

    function returnToWhatsApp(returnUrls) {
        const deep = (returnUrls && returnUrls.deepLink) || "";
        const web = (returnUrls && returnUrls.waMe) || "https://wa.me/6580340915";
        if (returnLink) returnLink.href = web;

        const tryClose = () => {
            try { window.close(); } catch (_) {}
            setTimeout(() => {
                if (!window.closed) window.location.replace(deep || web);
            }, 200);
        };

        if (deep) {
            window.location.href = deep;
            setTimeout(() => {
                window.location.replace(web);
                setTimeout(tryClose, 400);
            }, 450);
            return;
        }
        window.location.replace(web);
        setTimeout(tryClose, 400);
    }

    async function completeScan() {
        const res = await fetch("/api/scan-complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            keepalive: true,
            body: JSON.stringify({
                sid,
                waId,
                clickId: params.get("click_id") || params.get("fbclid") || "",
                device: getDeviceOs(),
            }),
        });
        if (!res.ok) throw new Error("scan_failed");
        return res.json();
    }

    function animate(statusMessages) {
        return new Promise((resolve) => {
            let progress = 0;
            const timer = setInterval(() => {
                progress += 4;
                if (progress > 100) progress = 100;
                if (percentEl) percentEl.textContent = `${progress}%`;
                if (statusEl) {
                    if (progress < 25) statusEl.textContent = statusMessages[0];
                    else if (progress < 55) statusEl.textContent = statusMessages[1];
                    else if (progress < 80) statusEl.textContent = statusMessages[2];
                    else statusEl.textContent = statusMessages[3];
                }
                if (progress >= 100) {
                    clearInterval(timer);
                    resolve();
                }
            }, 32);
        });
    }

    async function run() {
        const messages = [
            "Checking IP, location, and network provider…",
            "Reading public IP…",
            "Pinpointing city and network…",
            "Packing results for your advisor…",
        ];
        const animation = animate(messages);
        let payload = null;
        try {
            payload = await completeScan();
            const tel = (payload && payload.telemetry) || {};
            if (tel.ip) messages[1] = `Detected IP: ${tel.ip}`;
            if (tel.city || tel.country) messages[2] = `Location: ${[tel.city, tel.country].filter(Boolean).join(", ")}`;
            if (tel.isp) messages[3] = `Provider: ${tel.isp}`;
        } catch (err) {
            console.warn("Scan complete error:", err);
        }
        await animation;

        const tel = (payload && payload.telemetry) || {};
        const bits = [tel.isp, tel.city, tel.country].filter(Boolean);
        if (doneSummary) {
            doneSummary.textContent = bits.length
                ? `Visible on this network: ${bits.join(" · ")}. Returning to WhatsApp.`
                : "Scan saved. Returning to WhatsApp.";
        }
        switchScreen(screenDone);
        setTimeout(() => returnToWhatsApp(payload && payload.returnUrls), 700);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", run);
    } else {
        run();
    }
})();
