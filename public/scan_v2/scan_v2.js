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
    const returnHint = document.getElementById("return-hint");
    const doneSummary = document.getElementById("done-summary");

    const FALLBACK_WA = "https://wa.me/6580340915";

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

    function setReturnLink(returnUrls) {
        const web = (returnUrls && returnUrls.waMe) || FALLBACK_WA;
        if (returnLink) {
            returnLink.href = web;
            returnLink.textContent = "Return to chat";
        }
        if (returnHint) {
            returnHint.textContent = "Your advisor already has this scan. Tap below to go back to WhatsApp.";
        }
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

    /**
     * Eases to 92% over ~5s, then holds there until release() is called so the
     * counter never reads 100% while telemetry is still in flight.
     */
    function startAnimation(phases) {
        const RAMP_MS = 5000;
        const HOLD_PCT = 92;
        const SETTLE_MS = 700;
        const MAX_WAIT_MS = 9000;
        const started = Date.now();
        let releaseRequested = false;
        let releasedAt = 0;
        let shown = -1;

        const done = new Promise((resolve) => {
            const tick = () => {
                const elapsed = Date.now() - started;
                if (!releasedAt && (releaseRequested || elapsed > MAX_WAIT_MS) && elapsed >= RAMP_MS) {
                    releasedAt = Date.now();
                }

                let progress;
                if (releasedAt) {
                    const ratio = Math.min((Date.now() - releasedAt) / SETTLE_MS, 1);
                    progress = HOLD_PCT + ratio * (100 - HOLD_PCT);
                } else {
                    const linear = Math.min(elapsed / RAMP_MS, 1);
                    progress = (1 - Math.pow(1 - linear, 2.2)) * HOLD_PCT;
                }

                const rounded = Math.min(Math.floor(progress), 100);
                if (percentEl) percentEl.textContent = `${rounded}%`;

                const index = Math.min(Math.floor(rounded / 25), phases.length - 1);
                if (statusEl && index !== shown) {
                    shown = index;
                    statusEl.textContent = phases[index];
                }

                if (rounded >= 100) {
                    resolve();
                    return;
                }
                setTimeout(tick, 60);
            };
            tick();
        });

        return {
            done,
            release() { releaseRequested = true; },
        };
    }

    async function run() {
        const phases = [
            "Checking IP, location, and network provider…",
            "Reading your public IP…",
            "Pinpointing city and network operator…",
            "Packing results for your advisor…",
        ];

        const animation = startAnimation(phases);
        let payload = null;

        try {
            payload = await completeScan();
            const tel = (payload && payload.telemetry) || {};
            if (tel.ip) phases[1] = `Public IP detected: ${tel.ip}`;
            if (tel.city || tel.country) phases[2] = `Located: ${[tel.city, tel.country].filter(Boolean).join(", ")}`;
            if (tel.isp) phases[3] = `Your provider: ${tel.isp}`;
        } catch (err) {
            console.warn("Scan complete error:", err);
        }

        animation.release();
        await animation.done;

        const tel = (payload && payload.telemetry) || {};
        const bits = [tel.isp, tel.city, tel.country].filter(Boolean);
        if (doneSummary) {
            doneSummary.textContent = bits.length
                ? `Exposed on this connection: ${bits.join(" · ")}`
                : "Scan saved. Your advisor already has it.";
        }
        setReturnLink(payload && payload.returnUrls);
        switchScreen(screenDone);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", run);
    } else {
        run();
    }
})();
