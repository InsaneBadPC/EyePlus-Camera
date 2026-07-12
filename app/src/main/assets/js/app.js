(() => {
    "use strict";

    const API = "";
    let ws = null;
    let token = localStorage.getItem("eyeplus_token") || "";
    let currentMode = localStorage.getItem("eyeplus_mode") || "local";
    let cameraOnline = false;
    let isRecording = false;
    let isLocalRecording = false;
    let recTimer = null;
    let recSeconds = 0;
    let mediaRecorder = null;
    let audioChunks = [];
    let isVoiceRecording = false;
    let currentSnapshot = null;
    let motionRecordChunks = [];
    let autoRecordEnabled = true;
    let motionSensitivity = "medium";
    let motionCooldown = false;
    let canvasStream = null;
    let recordedChunks = [];
    let wsReconnectTimer = null;
    let wsPingTimer = null;

    const isNative = !!window.NativeBridge;
    const APP_VERSION = "v1.2";

    const $ = (s) => document.querySelector(s);
    const $$ = (s) => document.querySelectorAll(s);

    document.addEventListener("DOMContentLoaded", () => {
        console.log("EYEPLUS " + APP_VERSION + " loaded, isNative=" + isNative);
        showMain();
        initAuth();
        initModeSwitch();
        initNavigation();
        initPTZ();
        initQuickActions();
        initChat();
        initSettings();
        initModals();
        initLocalRecording();
        initProviderUI();
        initVoiceButtons();
        connectWebSocket();
        checkCameraStatus();
        setInterval(checkCameraStatus, 15000);
        applyMode();
        updateProviderStatus();
    });

    // ─── Auth ───
    function initAuth() {
        if (isNative) {
            showMain();
            return;
        }

        $("#auth-form").addEventListener("submit", async (e) => {
            e.preventDefault();
            const email = $("#auth-email").value;
            const pass = $("#auth-password").value;
            try {
                const res = await fetch(`${API}/api/auth/login`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email, password: pass }),
                });
                if (res.ok) {
                    const data = await res.json();
                    token = data.access_token;
                    localStorage.setItem("eyeplus_token", token);
                    showMain();
                } else {
                    showToast("Neplatne prihlasovaci udaje");
                }
            } catch {
                showToast("Chyba pripojeni k serveru");
            }
        });

        $("#auth-register").addEventListener("click", async () => {
            const email = $("#auth-email").value;
            const pass = $("#auth-password").value;
            if (!email || !pass) { showToast("Vyplnte email a heslo"); return; }
            try {
                const res = await fetch(`${API}/api/auth/register`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email, password: pass }),
                });
                showToast(res.ok ? "Registrace uspesna!" : "Registrace selhala");
            } catch {
                showToast("Chyba pripojeni");
            }
        });

        $("#auth-skip").addEventListener("click", () => {
            token = "demo";
            localStorage.setItem("eyeplus_token", token);
            showMain();
        });
    }

    function showMain() {
        $("#auth-screen").classList.remove("active");
        $("#main-screen").classList.add("active");
        loadSettings();
    }

    // ─── Mode Switch ───
    function initModeSwitch() {
        $$(".mode-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const mode = btn.dataset.mode;
                switchMode(mode);
            });
        });

        $$("[data-select-mode]").forEach(el => {
            el.addEventListener("click", () => {
                const mode = el.dataset.selectMode;
                switchMode(mode);
                $$("[data-select-mode]").forEach(m => m.classList.remove("active"));
                el.classList.add("active");
            });
        });
    }

    function switchMode(mode) {
        currentMode = mode;
        localStorage.setItem("eyeplus_mode", mode);

        $$(".mode-btn").forEach(b => b.classList.remove("active"));
        const activeBtn = $(`.mode-btn[data-mode="${mode}"]`);
        if (activeBtn) activeBtn.classList.add("active");

        applyMode();
        reconnectWebSocket();

        fetch(`${API}/api/mode`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode }),
        }).catch(() => {});
    }

    function applyMode() {
        const bar = $("#mode-bar");
        const text = $("#mode-text");
        const vpsSettings = $("#vps-settings");
        const placeholder = $("#placeholder-hint");

        if (currentMode === "local") {
            bar.className = "mode-bar local";
            text.textContent = "LOKALNI - Primo ke kamerce, bez VPS";
            if (vpsSettings) vpsSettings.style.opacity = "0.5";
            if (placeholder) placeholder.textContent = "Lokalni rezim: kamera musi byt ve stejne WiFi";
        } else {
            bar.className = "mode-bar online";
            text.textContent = "ONLINE - Pres Termux gateway na VPS";
            if (vpsSettings) vpsSettings.style.opacity = "1";
            if (placeholder) placeholder.textContent = "Online rezim: pripojte Termux gateway";
        }
    }

    // ─── Navigation ───
    function initNavigation() {
        $$(".nav-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                $$(".nav-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                const tab = btn.dataset.tab;

                $$(".panel").forEach(p => p.classList.add("hidden"));

                if (tab === "recordings") {
                    $("#recordings-panel").classList.remove("hidden");
                    loadRecordings();
                } else if (tab === "ai") {
                    $("#ai-panel").classList.remove("hidden");
                } else if (tab === "settings") {
                    $("#settings-panel").classList.remove("hidden");
                } else if (tab === "agents") {
                    $("#agents-panel").classList.remove("hidden");
                }
            });
        });

        $$(".btn-close").forEach(btn => {
            btn.addEventListener("click", () => {
                $(`#${btn.dataset.close}`).classList.add("hidden");
                $$(".nav-btn").forEach(b => b.classList.remove("active"));
                $$(".nav-btn")[0].classList.add("active");
            });
        });
    }

    // ─── PTZ ───
    function initPTZ() {
        $$(".ptz-btn[data-pan]").forEach(btn => {
            const startMove = () => sendPTZ(
                parseFloat(btn.dataset.pan),
                parseFloat(btn.dataset.tilt), 0
            );
            const stopMove = () => sendPTZStop();

            btn.addEventListener("mousedown", startMove);
            btn.addEventListener("mouseup", stopMove);
            btn.addEventListener("mouseleave", stopMove);
            btn.addEventListener("touchstart", (e) => { e.preventDefault(); startMove(); });
            btn.addEventListener("touchend", (e) => { e.preventDefault(); stopMove(); });
        });

        $$(".ptz-btn[data-zoom]").forEach(btn => {
            const startZoom = () => sendPTZ(0, 0, parseFloat(btn.dataset.zoom));
            const stopZoom = () => sendPTZStop();

            btn.addEventListener("mousedown", startZoom);
            btn.addEventListener("mouseup", stopZoom);
            btn.addEventListener("mouseleave", stopZoom);
            btn.addEventListener("touchstart", (e) => { e.preventDefault(); startZoom(); });
            btn.addEventListener("touchend", (e) => { e.preventDefault(); stopZoom(); });
        });

        $("#ptz-home").addEventListener("click", () => sendPTZStop());

        const touchZone = $("#ptz-touch-zone");
        let touchStart = null;

        touchZone.addEventListener("touchstart", (e) => {
            if (e.target.closest(".ptz-btn")) return;
            touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        });

        touchZone.addEventListener("touchmove", (e) => {
            if (!touchStart) return;
            const dx = e.touches[0].clientX - touchStart.x;
            const dy = e.touches[0].clientY - touchStart.y;
            sendPTZ(
                Math.max(-1, Math.min(1, dx / 50)),
                Math.max(-1, Math.min(1, dy / 50)), 0
            );
        });

        touchZone.addEventListener("touchend", () => {
            touchStart = null;
            sendPTZStop();
        });
    }

    function sendPTZ(pan, tilt, zoom) {
        if (currentMode === "local") {
            fetch(`${API}/api/camera/ptz-direct`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pan, tilt, zoom }),
            }).catch(() => {});
        } else {
            sendWS({ type: "ptz_move", pan, tilt, zoom });
        }
    }

    function sendPTZStop() {
        if (currentMode === "local") {
            fetch(`${API}/api/camera/ptz-direct/stop`, { method: "POST" }).catch(() => {});
        } else {
            sendWS({ type: "ptz_stop" });
        }
    }

    // ─── Quick Actions ───
    function initQuickActions() {
        $("#btn-record").addEventListener("click", toggleRecording);
        $("#btn-settings").addEventListener("click", () => {
            $$(".nav-btn").forEach(b => b.classList.remove("active"));
            $$(".panel").forEach(p => p.classList.add("hidden"));
            $$(".nav-btn")[3].classList.add("active");
            $("#settings-panel").classList.remove("hidden");
        });

        $("#btn-snapshot").addEventListener("click", takeSnapshot);
        $("#btn-speak").addEventListener("click", () => {
            $("#speak-modal").classList.remove("hidden");
        });
        $("#btn-ai-analyze").addEventListener("click", analyzeCurrentFrame);
        $("#btn-cloud-upload").addEventListener("click", () => uploadSnapshot("cloud"));
        $("#btn-save-phone").addEventListener("click", () => {
            const canvas = $("#video-canvas");
            if (!canvas.width) { showToast("Zadny video stream"); return; }
            saveImageToStorage(canvas.toDataURL("image/jpeg", 0.9), `eyeplus_${Date.now()}.jpg`);
            showToast("Snimek ulozen do telefonu!");
        });

        if ($("#btn-check-camera")) {
            $("#btn-check-camera").addEventListener("click", checkCameraIP);
        }

        if ($("#btn-discover-cameras")) {
            $("#btn-discover-cameras").addEventListener("click", discoverCameras);
        }
    }

    async function discoverCameras() {
        const container = $("#discovered-cameras");
        if (!container || !window.EyePlusDiscovery) { showToast("ONVIF modul neni dostupny"); return; }
        container.classList.remove("hidden");
        container.innerHTML = '<div style="color:var(--text2);padding:8px;">Hledám kamery v síti...</div>';

        try {
            const cameras = await window.EyePlusDiscovery.discoverCameras();
            if (cameras.length === 0) {
                container.innerHTML = '<div style="color:var(--text2);padding:8px;">Žádné kamery nenalezeny. Zkuste zadat IP manuálně.</div>';
                return;
            }
            container.innerHTML = cameras.map(cam =>
                `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:6px;">
                    <div>
                        <strong style="font-size:13px;">${cam.name || 'Kamera'}</strong>
                        <span style="font-size:12px;color:var(--text2);margin-left:6px;">${cam.ip}</span>
                        <span style="font-size:10px;color:var(--accent);margin-left:6px;">${cam.source || ''}</span>
                    </div>
                    <button class="btn-primary btn-sm" onclick="document.getElementById('set-cam-ip').value='${cam.ip}';showToast('IP nastavena: ${cam.ip}')">Použít</button>
                </div>`
            ).join("");
        } catch (e) {
            container.innerHTML = `<div style="color:var(--red);padding:8px;">Chyba: ${e.message}</div>`;
        }
    }

    function toggleRecording() {
        if (isRecording) {
            stopLocalRecording();
        } else {
            startLocalRecording();
        }
    }

    function takeSnapshot() {
        const canvas = $("#video-canvas");
        if (!canvas.width) { showToast("Zadny video stream"); return; }
        currentSnapshot = canvas.toDataURL("image/jpeg", 0.9);
        $("#snapshot-img").src = currentSnapshot;
        $("#snapshot-modal").classList.remove("hidden");
    }

    async function analyzeCurrentFrame() {
        const canvas = $("#video-canvas");
        if (!canvas.width) { showToast("Zadny video stream"); return; }

        showToast("Analyzuji scenu...");
        const b64 = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];

        try {
            let analysis;
            if (window.EyePlusAI) {
                analysis = await window.EyePlusAI.analyzeFrame(b64);
            } else {
                const res = await fetch(`${API}/api/ai/analyze`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ image_b64: b64 }),
                });
                const data = await res.json();
                analysis = data.analysis || "Nepodarilo se analyzovat";
            }
            addChatMessage("assistant", analysis || "Nepodarilo se analyzovat");
            $$(".nav-btn").forEach(b => b.classList.remove("active"));
            $$(".panel").forEach(p => p.classList.add("hidden"));
            $$(".nav-btn")[2].classList.add("active");
            $("#ai-panel").classList.remove("hidden");
        } catch (e) {
            showToast("Chyba pri analyze: " + (e.message || ""));
        }
    }

    async function checkCameraIP() {
        const ip = $("#set-cam-ip").value.trim();
        if (!ip) { showToast("Zadejte IP adresu"); return; }

        const resultEl = $("#cam-check-result");
        resultEl.textContent = "Kontroluji...";
        resultEl.style.color = "var(--warning)";

        try {
            const res = await fetch(`${API}/api/camera/check`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ camera_ip: ip }),
            });
            const data = await res.json();
            cameraOnline = data.online;
            if (data.online) {
                resultEl.textContent = "Kamera online!";
                resultEl.style.color = "var(--success)";
                $("#camera-status").textContent = "ONLINE";
                $("#camera-status").className = "status-badge online";
            } else {
                resultEl.textContent = "Kamera nedostupna";
                resultEl.style.color = "var(--danger)";
            }
        } catch {
            resultEl.textContent = "Chyba pripojeni";
            resultEl.style.color = "var(--danger)";
        }
    }

    // ─── Local Recording ───
    function initLocalRecording() {
        autoRecordEnabled = localStorage.getItem("eyeplus_auto_record") !== "false";
        motionSensitivity = localStorage.getItem("eyeplus_motion_sensitivity") || "medium";
    }

    function startLocalRecording() {
        const canvas = $("#video-canvas");
        if (!canvas.width) { showToast("Zadny video stream"); return; }

        try {
            recordedChunks = [];
            canvasStream = canvas.captureStream(25);
            mediaRecorder = new MediaRecorder(canvasStream, {
                mimeType: "video/webm;codecs=vp9",
                videoBitsPerSecond: 2500000,
            });

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) recordedChunks.push(e.data);
            };

            mediaRecorder.onstop = () => {
                const blob = new Blob(recordedChunks, { type: "video/webm" });
                saveRecordingToStorage(blob);
            };

            mediaRecorder.start(1000);
            isRecording = true;
            recSeconds = 0;

            $("#btn-record").classList.add("recording");
            $("#rec-indicator").classList.remove("hidden");
            recTimer = setInterval(() => {
                recSeconds++;
                const m = Math.floor(recSeconds / 60).toString().padStart(2, "0");
                const s = (recSeconds % 60).toString().padStart(2, "0");
                $("#rec-timer").textContent = `${m}:${s}`;
            }, 1000);

            showToast("Nahravani spusteno");
        } catch (e) {
            showToast("Nahravani neni podporovano v tomto prohlizeci");
        }
    }

    function stopLocalRecording() {
        if (mediaRecorder && mediaRecorder.state === "recording") {
            mediaRecorder.stop();
        }
        isRecording = false;
        clearInterval(recTimer);
        $("#btn-record").classList.remove("recording");
        $("#rec-indicator").classList.add("hidden");
        showToast("Nahravani zastaveno, ukladam...");
    }

    function saveRecordingToStorage(blob) {
        const filename = `eyeplus_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.webm`;

        if (isNative && window.NativeBridge && window.NativeBridge.saveVideo) {
            const reader = new FileReader();
            reader.onload = () => {
                const base64 = reader.result.split(",")[1];
                window.NativeBridge.saveVideo(base64, filename);
            };
            reader.readAsDataURL(blob);
            showToast(`Zaznam ulozen nativne: ${filename}`);
            return;
        }

        downloadBlob(URL.createObjectURL(blob), filename);
        showToast(`Zaznam ulozen: ${filename}`);
    }

    function saveImageToStorage(dataUrl, filename) {
        if (isNative && window.NativeBridge && window.NativeBridge.saveImage) {
            const base64 = dataUrl.split(",")[1];
            window.NativeBridge.saveImage(base64, filename);
            return;
        }
        downloadBlob(dataUrl, filename);
    }

    async function startMotionRecording() {
        if (isRecording || isLocalRecording || motionCooldown) return;

        const settings = getLocalSettings();
        const duration = parseInt(settings.recordDuration) || 30;

        const canvas = $("#video-canvas");
        if (!canvas.width) return;

        try {
            motionRecordChunks = [];
            const stream = canvas.captureStream(25);
            const recorder = new MediaRecorder(stream, {
                mimeType: "video/webm;codecs=vp9",
                videoBitsPerSecond: 2000000,
            });

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) motionRecordChunks.push(e.data);
            };

            recorder.onstop = () => {
                isLocalRecording = false;
                const blob = new Blob(motionRecordChunks, { type: "video/webm" });
                saveRecordingToStorage(blob);

                fetch(`${API}/api/local/motion-event`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        timestamp: Date.now() / 1000,
                        confidence: 0.8,
                    }),
                }).catch(() => {});
            };

            recorder.start(1000);
            isLocalRecording = true;
            showToast(`Detekce pohybu! Nahravam ${duration}s...`);

            setTimeout(() => {
                if (recorder.state === "recording") recorder.stop();
            }, duration * 1000);

            motionCooldown = true;
            setTimeout(() => { motionCooldown = false; }, (duration + 5) * 1000);

        } catch (e) {
            console.error("Motion recording error:", e);
        }
    }

    function downloadBlob(dataUrl, filename) {
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    // ─── Chat ───
    function initChat() {
        $("#btn-send").addEventListener("click", sendChat);
        $("#chat-input").addEventListener("keydown", (e) => {
            if (e.key === "Enter") sendChat();
        });
        $("#btn-voice").addEventListener("click", toggleVoice);
    }

    async function sendChat() {
        const input = $("#chat-input");
        const msg = input.value.trim();
        if (!msg) return;

        addChatMessage("user", msg);
        input.value = "";

        try {
            let reply;
            if (window.EyePlusAI) {
                reply = await window.EyePlusAI.chat([{ role: "user", content: msg }]);
            } else {
                const res = await fetch(`${API}/api/ai/chat`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ message: msg }),
                });
                const data = await res.json();
                reply = data.response || "Nemohu odpovedet";
            }
            addChatMessage("assistant", reply || "Nemohu odpovedet");
        } catch (e) {
            addChatMessage("assistant", "Chyba pripojeni k AI: " + (e.message || ""));
        }
    }

    function addChatMessage(role, text) {
        const container = $("#chat-messages");
        const div = document.createElement("div");
        div.className = `chat-msg ${role}`;
        div.textContent = text;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }

    async function toggleVoice() {
        const btn = $("#btn-voice");

        if (isVoiceRecording) {
            isVoiceRecording = false;
            btn.classList.remove("recording");
            if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioChunks = [];
            const recorder = new MediaRecorder(stream);
            isVoiceRecording = true;
            btn.classList.add("recording");

            recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
            recorder.onstop = async () => {
                stream.getTracks().forEach(t => t.stop());
                if (audioChunks.length === 0) return;

                const blob = new Blob(audioChunks, { type: "audio/webm" });

                if (window.EyePlusAI) {
                    try {
                        addChatMessage("user", "Hlasovy prikaz...");
                        const text = await window.EyePlusAI.transcribeAudio(blob);
                        if (text) addChatMessage("user", text);
                        const response = await window.EyePlusAI.chat([{ role: "user", content: text }]);
                        addChatMessage("assistant", response);
                    } catch (e) {
                        addChatMessage("assistant", "Chyba zpracovani hlasu: " + e.message);
                    }
                    return;
                }

                const formData = new FormData();
                formData.append("audio", blob, "voice.webm");
                addChatMessage("user", "Hlasovy prikaz...");

                try {
                    const res = await fetch(`${API}/api/ai/voice-command`, { method: "POST", body: formData });
                    const data = await res.json();
                    if (data.transcription) addChatMessage("user", data.transcription);
                    if (data.response) addChatMessage("assistant", data.response);
                    if (data.audio_b64) playAudioBase64(data.audio_b64);
                } catch {
                    addChatMessage("assistant", "Chyba zpracovani hlasu");
                }
            };

            recorder.start();
            setTimeout(() => {
                if (isVoiceRecording) {
                    isVoiceRecording = false;
                    btn.classList.remove("recording");
                    if (recorder.state === "recording") recorder.stop();
                }
            }, 10000);
        } catch {
            showToast("Mikrofon neni dostupny");
        }
    }

    function playAudioBase64(b64) {
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: "audio/mp3" });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.play().catch(() => {});
        audio.onended = () => URL.revokeObjectURL(url);
    }

    // ─── Voice Buttons ───
    function initVoiceButtons() {
        const voiceBtn = $("#btn-voice-command");
        if (voiceBtn) {
            voiceBtn.addEventListener("click", runVoiceCommand);
        }

        const speakCameraBtn = $("#btn-speak-camera");
        if (speakCameraBtn) {
            speakCameraBtn.addEventListener("click", openSpeakCameraModal);
        }
    }

    async function runVoiceCommand() {
        if (!window.EyePlusVoice || !window.EyePlusAI) {
            showToast("Voice modul neni dostupny");
            return;
        }

        const voiceBtn = $("#btn-voice-command");
        voiceBtn.classList.add("recording");
        showToast("Nahravam hlasovy prikaz (3s)...");

        const canvas = $("#video-canvas");
        let cameraFrame = null;
        if (canvas.width) {
            cameraFrame = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
        }

        try {
            const result = await window.EyePlusVoice.voiceCommand(cameraFrame);
            voiceBtn.classList.remove("recording");

            if (result.error) {
                showToast("Chyba: " + result.error);
                return;
            }

            if (result.text) {
                addChatMessage("user", result.text);
            }
            if (result.aiResponse) {
                addChatMessage("assistant", result.aiResponse);
            }

            $$(".nav-btn").forEach(b => b.classList.remove("active"));
            $$(".panel").forEach(p => p.classList.add("hidden"));
            $$(".nav-btn")[2].classList.add("active");
            $("#ai-panel").classList.remove("hidden");
        } catch (e) {
            voiceBtn.classList.remove("recording");
            showToast("Chyba hlasoveho prikazu: " + (e.message || ""));
        }
    }

    function openSpeakCameraModal() {
        $("#speak-modal").classList.remove("hidden");
    }

    async function speakThroughCamera(text) {
        if (!text) return;

        if (window.EyePlusVoice) {
            const wsUrl = currentMode === "online" ? getWSUrl() : null;
            try {
                await window.EyePlusVoice.speakThroughCamera(text, wsUrl);
                showToast("Prehravano na kamerce!");
            } catch (e) {
                showToast("Chyba pri prehravani: " + (e.message || ""));
            }
            return;
        }

        showToast("Odesilam na kameru...");
        try {
            const formData = new FormData();
            formData.append("text", text);
            const res = await fetch(`${API}/api/ai/speak`, { method: "POST", body: formData });
            const data = await res.json();
            showToast(data.status === "sent" ? "Prehravano na kamerce!" : "Odeslano");
        } catch {
            showToast("Chyba pri odesilani");
        }
    }

    // ─── WebSocket ───
    function getWSUrl() {
        if (currentMode === "online") {
            const s = JSON.parse(localStorage.getItem("eyeplus_settings") || "{}");
            const vpsUrl = s.vps_url || location.host;
            const proto = vpsUrl.startsWith("https") ? "wss:" : "ws:";
            const host = vpsUrl.replace(/^https?:\/\//, "");
            return `${proto}//${host}/ws/stream`;
        }
        const proto = location.protocol === "https:" ? "wss:" : "ws:";
        return `${proto}//${location.host}/ws/stream`;
    }

    function connectWebSocket() {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        try {
            ws = new WebSocket(getWSUrl());
        } catch {
            scheduleReconnect();
            return;
        }

        ws.onopen = () => {
            showToast("Pripojeno ke streamu");
            ws.send("ping");
        };

        ws.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                handleWSMessage(data);
            } catch {}
        };

        ws.onerror = () => {};
        ws.onclose = () => scheduleReconnect();
    }

    function scheduleReconnect() {
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = setTimeout(connectWebSocket, 3000);
    }

    function reconnectWebSocket() {
        if (ws) {
            clearTimeout(wsPingTimer);
            ws.onclose = null;
            ws.close();
            ws = null;
        }
        connectWebSocket();
    }

    function handleWSMessage(data) {
        switch (data.type) {
            case "frame":
                renderFrame(data.data);
                break;
            case "motion_detected":
                showMotionAlert(data.data);
                if (autoRecordEnabled) startMotionRecording();
                break;
            case "audio_data":
                if (data.data) playAudioBase64(data.data);
                break;
            case "pong":
                clearTimeout(wsPingTimer);
                wsPingTimer = setTimeout(() => ws && ws.send("ping"), 5000);
                break;
        }
    }

    function sendWS(msg) {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    }

    function renderFrame(b64Data) {
        const canvas = $("#video-canvas");
        const ctx = canvas.getContext("2d");
        const img = new Image();
        img.onload = () => {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            $("#video-placeholder").classList.add("hidden");
        };
        img.src = `data:image/jpeg;base64,${b64Data}`;
    }

    function showMotionAlert(data) {
        const alert = $("#motion-alert");
        const time = $("#motion-time");
        alert.classList.remove("hidden");
        if (time) time.textContent = new Date().toLocaleTimeString("cs-CZ");
        setTimeout(() => alert.classList.add("hidden"), 5000);
    }

    // ─── Camera Status ───
    async function checkCameraStatus() {
        try {
            const res = await fetch(`${API}/api/mode`);
            const data = await res.json();
            cameraOnline = data.camera_online;
            const badge = $("#camera-status");
            badge.textContent = cameraOnline ? "ONLINE" : "OFFLINE";
            badge.className = `status-badge ${cameraOnline ? "online" : "offline"}`;
        } catch {}
    }

    // ─── Recordings ───
    async function loadRecordings() {
        try {
            const res = await fetch(`${API}/api/local/recordings`);
            const data = await res.json();
            const list = $("#recordings-list");
            const countEl = $("#storage-count");
            const sizeEl = $("#storage-size");

            const storageRes = await fetch(`${API}/api/local/storage-info`);
            const storage = await storageRes.json();
            if (countEl) countEl.textContent = storage.count;
            if (sizeEl) sizeEl.textContent = `${storage.total_mb} MB`;

            if (!data.recordings || data.recordings.length === 0) {
                list.innerHTML = '<p class="empty-state">Zatim zadne zaznamy</p>';
                return;
            }

            list.innerHTML = data.recordings.map(r => `
                <div class="recording-item">
                    <div class="recording-icon">${r.filename.includes("motion") ? "!" : ">"}</div>
                    <div class="recording-info">
                        <h4>${r.filename}</h4>
                        <p>${r.created_at} - ${formatSize(r.size)}</p>
                    </div>
                    <div class="recording-actions">
                        <button class="rec-btn" onclick="window._downloadRecording('${r.filename}')" title="Stahnout do telefonu">V</button>
                        <button class="rec-btn" onclick="window._deleteRecording('${r.filename}')" title="Smazat">X</button>
                    </div>
                </div>
            `).join("");
        } catch {}
    }

    window._downloadRecording = (filename) => {
        if (isNative && window.NativeBridge && window.NativeBridge.downloadFile) {
            window.NativeBridge.downloadFile(`${API}/api/local/recordings/${encodeURIComponent(filename)}`);
            return;
        }
        window.open(`${API}/api/local/recordings/${encodeURIComponent(filename)}`, "_blank");
    };

    window._deleteRecording = async (filename) => {
        if (!confirm(`Smazat zaznam ${filename}?`)) return;
        try {
            await fetch(`${API}/api/local/recordings/${encodeURIComponent(filename)}`, { method: "DELETE" });
            showToast("Zaznam smazan");
            loadRecordings();
        } catch {
            showToast("Chyba mazani");
        }
    };

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
        return (bytes / 1048576).toFixed(1) + " MB";
    }

    // ─── Provider UI ───
    function initProviderUI() {
        const select = $("#set-ai-provider");
        const modelSelect = $("#set-ai-model-select");
        const apiKeyInput = $("#set-provider-api-key");
        const testBtn = $("#btn-test-provider");
        const statusEl = $("#provider-status");

        if (!select || !window.EyePlusAI) return;

        const providers = window.EyePlusAI.getAllProviders();
        const currentProvider = window.EyePlusAI.getActiveProvider();

        select.innerHTML = providers.map(p =>
            `<option value="${p.id}" ${p.id === currentProvider ? "selected" : ""}>${p.name}${p.hasSTT ? " (STT)" : ""}</option>`
        ).join("");

        populateModelSelect(select.value);
        loadProviderApiKey(select.value);

        select.addEventListener("change", () => {
            populateModelSelect(select.value);
            loadProviderApiKey(select.value);
            updateProviderStatus();
        });

        if (modelSelect) {
            modelSelect.addEventListener("change", () => {
                const s = window.EyePlusAI.getSettings();
                s.ai_model = modelSelect.value;
                window.EyePlusAI.saveSettings(s);
            });
        }

        if (testBtn) {
            testBtn.addEventListener("click", async () => {
                testBtn.textContent = "Testuji...";
                testBtn.disabled = true;
                const key = apiKeyInput ? apiKeyInput.value.trim() : "";
                if (key) {
                    const s = window.EyePlusAI.getSettings();
                    s[`${select.value}_api_key`] = key;
                    window.EyePlusAI.saveSettings(s);
                }
                const ok = await window.EyePlusAI.testProvider(select.value, key);
                testBtn.textContent = ok ? "OK!" : "Selhalo";
                testBtn.disabled = false;
                if (statusEl) {
                    statusEl.textContent = ok ? "Provider funkcni!" : "Provider neodpovida";
                    statusEl.className = ok ? "status-online" : "status-offline";
                }
                setTimeout(() => { testBtn.textContent = "Otestovat"; }, 2000);
            });
        }

        if (apiKeyInput) {
            apiKeyInput.addEventListener("change", () => {
                const s = window.EyePlusAI.getSettings();
                s[`${select.value}_api_key`] = apiKeyInput.value.trim();
                window.EyePlusAI.saveSettings(s);
                updateProviderStatus();
            });
        }
    }

    function populateModelSelect(providerId) {
        const modelSelect = $("#set-ai-model-select");
        if (!modelSelect || !window.EyePlusAI) return;

        const providers = window.EyePlusAI.getAllProviders();
        const provider = providers.find(p => p.id === providerId);
        if (!provider) return;

        const currentModel = window.EyePlusAI.getActiveModel();
        modelSelect.innerHTML = provider.models.map(m =>
            `<option value="${m.id}" ${m.id === currentModel ? "selected" : ""}>${m.name}</option>`
        ).join("");
    }

    function loadProviderApiKey(providerId) {
        const input = $("#set-provider-api-key");
        if (!input || !window.EyePlusAI) return;
        input.value = window.EyePlusAI.getApiKey(providerId) || "";
    }

    function updateProviderStatus() {
        const el = $("#provider-status-current");
        if (!el) return;

        if (!window.EyePlusAI) {
            el.textContent = "AI modul neni dostupny";
            el.className = "status-offline";
            return;
        }

        const provider = window.EyePlusAI.getActiveProvider();
        const key = window.EyePlusAI.getApiKey(provider);
        const providers = window.EyePlusAI.getAllProviders();
        const info = providers.find(p => p.id === provider);

        if (key && info) {
            el.textContent = `${info.name} - aktivni`;
            el.className = "status-online";
        } else if (info) {
            el.textContent = `${info.name} - neni klic`;
            el.className = "status-warning";
        } else {
            el.textContent = "Zadny provider";
            el.className = "status-offline";
        }
    }

    // ─── Settings ───
    function initSettings() {
        $("#btn-save-settings").addEventListener("click", saveSettings);
        $("#btn-logout").addEventListener("click", () => {
            token = "";
            localStorage.removeItem("eyeplus_token");
            location.reload();
        });

        $("#btn-test-telegram").addEventListener("click", () => testNotification("telegram"));
        $("#btn-test-email").addEventListener("click", () => testNotification("email"));
        $("#btn-test-whatsapp").addEventListener("click", () => testNotification("whatsapp"));

        const autoRec = $("#set-auto-record");
        if (autoRec) {
            autoRec.checked = autoRecordEnabled;
            autoRec.addEventListener("change", () => {
                autoRecordEnabled = autoRec.checked;
                localStorage.setItem("eyeplus_auto_record", autoRecordEnabled);
            });
        }

        const motionSens = $("#set-motion-sensitivity");
        if (motionSens) {
            motionSens.value = motionSensitivity;
            motionSens.addEventListener("change", () => {
                motionSensitivity = motionSens.value;
                localStorage.setItem("eyeplus_motion_sensitivity", motionSensitivity);
            });
        }
    }

    function getLocalSettings() {
        return {
            recordDuration: localStorage.getItem("eyeplus_record_duration") || "30",
            motionSensitivity: localStorage.getItem("eyeplus_motion_sensitivity") || "medium",
            autoRecord: localStorage.getItem("eyeplus_auto_record") !== "false",
        };
    }

    function loadSettings() {
        const s = JSON.parse(localStorage.getItem("eyeplus_settings") || "{}");
        const fields = {
            "set-cam-ip": "camera_ip",
            "set-cam-user": "camera_user",
            "set-cam-pass": "camera_pass",
            "set-cam-rtsp-port": "camera_rtsp_port",
            "set-tts-voice": "tts_voice",
            "set-tg-token": "tg_token",
            "set-tg-chat": "tg_chat",
            "set-email-user": "email_user",
            "set-email-pass": "email_pass",
            "set-wa-token": "wa_token",
            "set-wa-phone-id": "wa_phone_id",
            "set-wa-to": "wa_to",
            "set-vps-url": "vps_url",
            "set-gateway-secret": "gateway_secret",
            "set-record-duration": "record_duration",
        };
        for (const [id, key] of Object.entries(fields)) {
            const el = $(`#${id}`);
            if (el && s[key]) el.value = s[key];
        }

        const providerKeyMap = {
            "set-or-key": "openrouter",
            "set-groq-key": "groq",
            "set-openai-key": "openai",
            "set-anthropic-key": "anthropic",
            "set-cf-key": "cloudflare",
            "set-hf-key": "huggingface",
            "set-ds-key": "deepseek",
            "set-mistral-key": "mistral",
        };
        for (const [id, prov] of Object.entries(providerKeyMap)) {
            const el = $(`#${id}`);
            if (el) {
                const saved = s[`${prov}_api_key`];
                const def = window.EyePlusAI?.PROVIDERS?.[prov] ? (window.EyePlusAI.getApiKey(prov) || "") : "";
                el.value = saved || def;
            }
        }

        if (s.ai_provider) {
            const radio = $(`input[name="active-provider"][value="${s.ai_provider}"]`);
            if (radio) radio.checked = true;
        }
    }

    function saveSettings() {
        const fields = {
            "set-cam-ip": "camera_ip",
            "set-cam-user": "camera_user",
            "set-cam-pass": "camera_pass",
            "set-cam-rtsp-port": "camera_rtsp_port",
            "set-tts-voice": "tts_voice",
            "set-tg-token": "tg_token",
            "set-tg-chat": "tg_chat",
            "set-email-user": "email_user",
            "set-email-pass": "email_pass",
            "set-wa-token": "wa_token",
            "set-wa-phone-id": "wa_phone_id",
            "set-wa-to": "wa_to",
            "set-vps-url": "vps_url",
            "set-gateway-secret": "gateway_secret",
            "set-record-duration": "record_duration",
        };
        const s = JSON.parse(localStorage.getItem("eyeplus_settings") || "{}");
        for (const [id, key] of Object.entries(fields)) {
            const el = $(`#${id}`);
            if (el) s[key] = el.value;
        }

        const activeRadio = $('input[name="active-provider"]:checked');
        if (activeRadio) s.ai_provider = activeRadio.value;

        const providerKeyMap = {
            "set-or-key": "openrouter",
            "set-groq-key": "groq",
            "set-openai-key": "openai",
            "set-anthropic-key": "anthropic",
            "set-cf-key": "cloudflare",
            "set-hf-key": "huggingface",
            "set-ds-key": "deepseek",
            "set-mistral-key": "mistral",
        };
        for (const [id, prov] of Object.entries(providerKeyMap)) {
            const el = $(`#${id}`);
            if (el && el.value.trim()) {
                s[`${prov}_api_key`] = el.value.trim();
            }
        }

        localStorage.setItem("eyeplus_settings", JSON.stringify(s));
        showToast("Nastaveni ulozeno");
        updateProviderStatus();
    }

    async function testNotification(channel) {
        let config = {};
        if (channel === "telegram") {
            config = { bot_token: $("#set-tg-token").value, chat_id: $("#set-tg-chat").value };
        } else if (channel === "email") {
            config = { smtp_user: $("#set-email-user").value, smtp_pass: $("#set-email-pass").value };
        } else if (channel === "whatsapp") {
            config = { token: $("#set-wa-token").value, phone: $("#set-wa-to").value };
        }

        try {
            const res = await fetch(`${API}/api/notifications/test`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ channel, config }),
            });
            const data = await res.json();
            showToast(data.success ? "Test uspesny!" : "Test selhal - zkontrolujte udaje");
        } catch {
            showToast("Chyba odeslani testu");
        }
    }

    // ─── Modals ───
    function initModals() {
        $$("[data-close]").forEach(btn => {
            btn.addEventListener("click", () => $(`#${btn.dataset.close}`).classList.add("hidden"));
        });

        $("#btn-speak-send").addEventListener("click", async () => {
            const text = $("#speak-text").value.trim();
            if (!text) return;
            await speakThroughCamera(text);
            $("#speak-modal").classList.add("hidden");
            $("#speak-text").value = "";
        });

        $("#btn-snapshot-download").addEventListener("click", () => {
            if (!currentSnapshot) return;
            saveImageToStorage(currentSnapshot, `eyeplus_${Date.now()}.jpg`);
            showToast("Snimek ulozen do telefonu!");
        });

        $("#btn-snapshot-cloud").addEventListener("click", () => uploadSnapshot("cloud"));
    }

    async function uploadSnapshot(type) {
        if (!currentSnapshot) { showToast("Nejprve udelejte snimek"); return; }
        showToast("Nahravam...");
        try {
            const res = await fetch(`${API}/api/cloud/upload`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    filepath: currentSnapshot,
                    filename: `eyeplus_${Date.now()}.jpg`,
                }),
            });
            const data = await res.json();
            showToast(data.url ? "Nahrano na Drive!" : (data.error || "Upload selhal"));
        } catch {
            showToast("Chyba pri nahravani");
        }
    }

    // ─── Toast ───
    function showToast(msg) {
        const toast = $("#toast");
        toast.textContent = msg;
        toast.classList.remove("hidden");
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => toast.classList.add("hidden"), 3000);
    }
})();
