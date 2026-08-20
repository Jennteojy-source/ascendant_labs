(function () {
    "use strict";

    const I18N = {
        en: {
            code: "en",
            name: "English",
            flag: "🇺🇸",
            dir: "ltr",
            pageTitle: "Connection Scan | Ascendant Labs",
            scanningTitle: "Scanning this connection",
            phases: [
                "Checking IP, location, and network provider…",
                "Reading your public IP…",
                "Pinpointing city and network operator…",
                "Packing results for your advisor…",
            ],
            ipDetected: (ip) => `Public IP detected: ${ip}`,
            locationDetected: (loc) => `Located: ${loc}`,
            providerDetected: (isp) => `Your provider: ${isp}`,
            scanComplete: "SCAN COMPLETE",
            scanSaved: "Scan saved",
            summaryPrefix: "Exposed on this connection: ",
            summaryFallback: "Scan saved. Your advisor already has it.",
            returnBtn: "Return to chat",
            returnHint: "Tap to go back to WhatsApp. No need to send a message.",
        },
        es: {
            code: "es",
            name: "Español",
            flag: "🇪🇸",
            dir: "ltr",
            pageTitle: "Escaneo de Conexión | Ascendant Labs",
            scanningTitle: "Escaneando esta conexión",
            phases: [
                "Verificando IP, ubicación y proveedor de red…",
                "Leyendo tu dirección IP pública…",
                "Detectando ciudad y operador de red…",
                "Preparando resultados para tu asesor…",
            ],
            ipDetected: (ip) => `IP pública detectada: ${ip}`,
            locationDetected: (loc) => `Ubicación: ${loc}`,
            providerDetected: (isp) => `Tu proveedor: ${isp}`,
            scanComplete: "ESCANEO COMPLETADO",
            scanSaved: "Escaneo guardado",
            summaryPrefix: "Expuesto en esta conexión: ",
            summaryFallback: "Escaneo guardado. Tu asesor ya tiene el reporte.",
            returnBtn: "Volver al chat",
            returnHint: "Toca para regresar a WhatsApp. No necesitas enviar ningún mensaje.",
        },
        pt: {
            code: "pt",
            name: "Português",
            flag: "🇧🇷",
            dir: "ltr",
            pageTitle: "Verificação de Conexão | Ascendant Labs",
            scanningTitle: "Analisando esta conexão",
            phases: [
                "Verificando IP, localização e provedor de internet…",
                "Identificando seu IP público…",
                "Localizando cidade e operadora de rede…",
                "Organizando dados para seu consultor…",
            ],
            ipDetected: (ip) => `IP público detectado: ${ip}`,
            locationDetected: (loc) => `Localização: ${loc}`,
            providerDetected: (isp) => `Seu provedor: ${isp}`,
            scanComplete: "ANÁLISE CONCLUÍDA",
            scanSaved: "Análise salva",
            summaryPrefix: "Exposto nesta conexão: ",
            summaryFallback: "Análise concluída. Seu consultor já recebeu o relatório.",
            returnBtn: "Voltar para o chat",
            returnHint: "Toque para voltar ao WhatsApp. Não é necessário enviar mensagem.",
        },
        ar: {
            code: "ar",
            name: "العربية",
            flag: "🇸🇦",
            dir: "rtl",
            pageTitle: "فحص الاتصال | Ascendant Labs",
            scanningTitle: "جارٍ فحص هذا الاتصال",
            phases: [
                "التحقق من عنوان IP والموقع ومزود الشبكة…",
                "قراءة عنوان IP العام الخاص بك…",
                "تحديد المدينة ومشغل الشبكة…",
                "تجهيز النتائج لمستشارك…",
            ],
            ipDetected: (ip) => `تم رصد عنوان IP العام: ${ip}`,
            locationDetected: (loc) => `الموقع: ${loc}`,
            providerDetected: (isp) => `مزود الخدمة: ${isp}`,
            scanComplete: "اكتمل الفحص",
            scanSaved: "تم حفظ الفحص",
            summaryPrefix: "المعلومات المكشوفة في هذا الاتصال: ",
            summaryFallback: "تم حفظ الفحص. مستشارك لديه التقرير بالفعل.",
            returnBtn: "العودة إلى المحادثة",
            returnHint: "اضغط للعودة إلى واتساب. لا حاجة لإرسال أي رسالة.",
        },
        id: {
            code: "id",
            name: "Bahasa Indonesia",
            flag: "🇮🇩",
            dir: "ltr",
            pageTitle: "Pemindaian Koneksi | Ascendant Labs",
            scanningTitle: "Memindai koneksi ini",
            phases: [
                "Memeriksa IP, lokasi, dan penyedia jaringan…",
                "Membaca IP publik Anda…",
                "Menentukan kota dan operator jaringan…",
                "Menyiapkan hasil untuk penasihat Anda…",
            ],
            ipDetected: (ip) => `IP publik terdeteksi: ${ip}`,
            locationDetected: (loc) => `Lokasi: ${loc}`,
            providerDetected: (isp) => `Penyedia internet: ${isp}`,
            scanComplete: "PEMINDAIAN SELESAI",
            scanSaved: "Pemindaian disimpan",
            summaryPrefix: "Terekspos pada koneksi ini: ",
            summaryFallback: "Pemindaian disimpan. Penasihat Anda sudah menerimanya.",
            returnBtn: "Kembali ke chat",
            returnHint: "Ketuk untuk kembali ke WhatsApp. Tidak perlu mengirim pesan.",
        },
    };

    const params = new URLSearchParams(window.location.search);
    const sid = params.get("sid") || ("scn_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36));
    const waId = (params.get("wa") || params.get("wa_id") || "").replace(/\D/g, "");

    const percentEl = document.getElementById("analyzing-percent");
    const statusEl = document.getElementById("analyzing-status");
    const titleEl = document.getElementById("analyzing-title");
    const screenAnalyzing = document.getElementById("screen-analyzing");
    const screenDone = document.getElementById("screen-done");
    const doneTitle = document.getElementById("done-title");
    const badgeText = document.getElementById("badge-text");
    const returnLink = document.getElementById("return-link");
    const returnHint = document.getElementById("return-hint");
    const doneSummary = document.getElementById("done-summary");

    const langPickerWrapper = document.getElementById("lang-picker-wrapper");
    const langBtn = document.getElementById("lang-btn");
    const langCurrent = document.getElementById("lang-current");
    const langDropdown = document.getElementById("lang-dropdown");

    const FALLBACK_WA = "https://wa.me/6580340915";

    let currentLang = "en";
    let activePhases = [...I18N.en.phases];
    let latestTelemetry = null;
    let latestReturnUrls = null;

    function detectInitialLanguage() {
        const queryLang = (params.get("lang") || params.get("l") || "").toLowerCase().slice(0, 2);
        if (queryLang && I18N[queryLang]) return queryLang;

        try {
            const saved = localStorage.getItem("ascendant_scan_lang");
            if (saved && I18N[saved]) return saved;
        } catch (_) {}

        const browserLangs = navigator.languages || [navigator.language || "en"];
        for (const lang of browserLangs) {
            const code = String(lang || "").toLowerCase().slice(0, 2);
            if (code && I18N[code]) return code;
        }

        return "en";
    }

    function setLanguage(code, persist = true) {
        if (!I18N[code]) code = "en";
        currentLang = code;
        const dict = I18N[code];

        document.documentElement.lang = code;
        document.documentElement.dir = dict.dir;
        document.title = dict.pageTitle;

        if (langCurrent) langCurrent.textContent = dict.name;
        if (titleEl) titleEl.textContent = dict.scanningTitle;
        if (badgeText) badgeText.textContent = dict.scanComplete;
        if (doneTitle) doneTitle.textContent = dict.scanSaved;
        if (returnLink) returnLink.textContent = dict.returnBtn;
        if (returnHint) returnHint.textContent = dict.returnHint;

        if (langDropdown) {
            langDropdown.querySelectorAll(".lang-option").forEach((opt) => {
                opt.classList.toggle("active", opt.getAttribute("data-lang") === code);
            });
        }

        activePhases = [...dict.phases];
        if (latestTelemetry) {
            if (latestTelemetry.ip) activePhases[1] = dict.ipDetected(latestTelemetry.ip);
            if (latestTelemetry.city || latestTelemetry.country) {
                activePhases[2] = dict.locationDetected([latestTelemetry.city, latestTelemetry.country].filter(Boolean).join(", "));
            }
            if (latestTelemetry.isp) activePhases[3] = dict.providerDetected(latestTelemetry.isp);

            const bits = [latestTelemetry.isp, latestTelemetry.city, latestTelemetry.country].filter(Boolean);
            if (doneSummary) {
                doneSummary.textContent = bits.length
                    ? `${dict.summaryPrefix}${bits.join(" · ")}`
                    : dict.summaryFallback;
            }
        }

        if (persist) {
            try { localStorage.setItem("ascendant_scan_lang", code); } catch (_) {}
        }
    }

    function initLangPicker() {
        if (!langBtn || !langPickerWrapper) return;

        langBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const isOpen = langPickerWrapper.classList.toggle("open");
            langBtn.setAttribute("aria-expanded", String(isOpen));
        });

        if (langDropdown) {
            langDropdown.addEventListener("click", (e) => {
                const opt = e.target.closest(".lang-option");
                if (!opt) return;
                const targetLang = opt.getAttribute("data-lang");
                setLanguage(targetLang, true);
                langPickerWrapper.classList.remove("open");
                langBtn.setAttribute("aria-expanded", "false");
            });
        }

        document.addEventListener("click", (e) => {
            if (!langPickerWrapper.contains(e.target)) {
                langPickerWrapper.classList.remove("open");
                langBtn.setAttribute("aria-expanded", "false");
            }
        });
    }

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
        latestReturnUrls = returnUrls;
        const web = (returnUrls && returnUrls.waMe) || FALLBACK_WA;
        if (returnLink) {
            returnLink.href = web;
            returnLink.textContent = I18N[currentLang].returnBtn;
        }
        if (returnHint) {
            returnHint.textContent = I18N[currentLang].returnHint;
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
                lang: currentLang,
                clickId: params.get("click_id") || params.get("fbclid") || "",
                device: getDeviceOs(),
            }),
        });
        if (!res.ok) throw new Error("scan_failed");
        return res.json();
    }

    function startAnimation() {
        const RAMP_MS = 4800;
        const HOLD_PCT = 92;
        const SETTLE_MS = 600;
        const MAX_WAIT_MS = 8000;
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

                const index = Math.min(Math.floor(rounded / 25), activePhases.length - 1);
                if (statusEl && index !== shown) {
                    shown = index;
                    statusEl.textContent = activePhases[index];
                }

                if (rounded >= 100) {
                    resolve();
                    return;
                }
                setTimeout(tick, 50);
            };
            tick();
        });

        return {
            done,
            release() { releaseRequested = true; },
        };
    }

    async function run() {
        const detected = detectInitialLanguage();
        setLanguage(detected, false);
        initLangPicker();

        const animation = startAnimation();
        let payload = null;

        try {
            payload = await completeScan();
            latestTelemetry = (payload && payload.telemetry) || {};

            // If user hasn't explicitly chosen a language, adapt to country if clear match
            if (!params.get("lang")) {
                const country = String(latestTelemetry.country || "").toLowerCase();
                if (/brazil|brasil|portugal/i.test(country) && currentLang === "en") {
                    setLanguage("pt", false);
                } else if (/spain|mexico|colombia|argentina|peru|chile|ecuador|guatemala|cuba|bolivia|dominican|honduras|paraguay|el salvador|nicaragua|costa rica|panama|uruguay|puerto rico/i.test(country) && currentLang === "en") {
                    setLanguage("es", false);
                } else if (/saudi|arabia|emirates|uae|egypt|qatar|kuwait|oman|bahrain|jordan|lebanon|iraq|morocco|algeria|tunisia/i.test(country) && currentLang === "en") {
                    setLanguage("ar", false);
                } else if (/indonesia/i.test(country) && currentLang === "en") {
                    setLanguage("id", false);
                }
            }

            const dict = I18N[currentLang];
            if (latestTelemetry.ip) activePhases[1] = dict.ipDetected(latestTelemetry.ip);
            if (latestTelemetry.city || latestTelemetry.country) {
                activePhases[2] = dict.locationDetected([latestTelemetry.city, latestTelemetry.country].filter(Boolean).join(", "));
            }
            if (latestTelemetry.isp) activePhases[3] = dict.providerDetected(latestTelemetry.isp);
        } catch (err) {
            console.warn("Scan complete error:", err);
        }

        animation.release();
        await animation.done;

        const dict = I18N[currentLang];
        const tel = latestTelemetry || {};
        const bits = [tel.isp, tel.city, tel.country].filter(Boolean);
        if (doneSummary) {
            doneSummary.textContent = bits.length
                ? `${dict.summaryPrefix}${bits.join(" · ")}`
                : dict.summaryFallback;
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
