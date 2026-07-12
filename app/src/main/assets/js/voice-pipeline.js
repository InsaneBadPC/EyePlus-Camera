window.EyePlusVoice = (function() {

let mediaRecorder = null;
let audioChunks = [];

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioChunks = [];
  mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) audioChunks.push(e.data);
  };

  mediaRecorder.start(100);
  return new Promise(resolve => resolve({ stop: () => stopRecording() }));
}

function stopRecording() {
  return new Promise(resolve => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      resolve(new Blob(audioChunks, { type: 'audio/webm' }));
      return;
    }
    mediaRecorder.onstop = () => {
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      mediaRecorder.stream.getTracks().forEach(t => t.stop());
      resolve(blob);
    };
    mediaRecorder.stop();
  });
}

async function textToSpeech(text, voice) {
  const settings = window.EyePlusAI.getSettings();
  const ttsVoice = voice || settings.tts_voice || 'cs-CZ-AntoninNeural';

  const r = await fetch('/api/ai/tts-preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice: ttsVoice })
  });

  if (!r.ok) {
    const edgeR = await edgeTTS(text, ttsVoice);
    return edgeR;
  }

  const data = await r.json();
  if (data.audio_base64) {
    return Uint8Array.from(atob(data.audio_base64), c => c.charCodeAt(0));
  }
  throw new Error('TTS selhalo');
}

async function edgeTTS(text, voice) {
  const url = `https://edge-tts.52dasi.com/?voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(text)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Edge TTS selhalo');
  return await r.arrayBuffer();
}

function playAudio(data) {
  return new Promise((resolve, reject) => {
    let blob;
    if (data instanceof Blob) {
      blob = data;
    } else if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
      blob = new Blob([data], { type: 'audio/mpeg' });
    } else if (typeof data === 'string') {
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
      blob = new Blob([bytes], { type: 'audio/mpeg' });
    } else {
      reject(new Error('Neznamy format audio dat'));
      return;
    }

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
    audio.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    audio.play().catch(reject);
  });
}

async function voiceCommand(cameraFrame) {
  const settings = window.EyePlusAI.getSettings();

  const result = { text: null, aiResponse: null, audio: null, error: null };

  try {
    const recording = await startRecording();
    const btn = document.querySelector('.voice-record-indicator');
    if (btn) btn.classList.add('recording');

    await new Promise(resolve => setTimeout(resolve, 3000));

    if (btn) btn.classList.remove('recording');
    const audioBlob = await recording.stop();

    result.text = await window.EyePlusAI.transcribeAudio(audioBlob);

    const messages = [{ role: 'user', content: result.text }];
    if (cameraFrame) {
      result.aiResponse = await window.EyePlusAI.analyzeFrame(cameraFrame, result.text);
    } else {
      result.aiResponse = await window.EyePlusAI.chat(messages);
    }

    result.audio = await textToSpeech(result.aiResponse);
    await playAudio(result.audio);

  } catch (e) {
    result.error = e.message;
  }

  return result;
}

async function speakThroughCamera(text, wsUrl) {
  const audioData = await textToSpeech(text);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(audioData)));

  if (wsUrl) {
    const ws = new WebSocket(wsUrl);
    return new Promise((resolve, reject) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'play_audio', data: base64 }));
        setTimeout(() => { ws.close(); resolve(); }, 2000);
      };
      ws.onerror = reject;
    });
  }

  try {
    await fetch('/api/ai/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, send_to_camera: true })
    });
  } catch (e) {
    console.error('Speak failed:', e);
  }
}

function getVoices() {
  return [
    { id: 'cs-CZ-AntoninNeural', name: 'Antonin (CZ muz)', lang: 'cs' },
    { id: 'cs-CZ-VlastaNeural', name: 'Vlasta (CZ zena)', lang: 'cs' },
    { id: 'en-US-GuyNeural', name: 'Guy (EN muz)', lang: 'en' },
    { id: 'en-US-JennyNeural', name: 'Jenny (EN zena)', lang: 'en' },
    { id: 'sk-SK-LukasNeural', name: 'Lukas (SK muz)', lang: 'sk' },
    { id: 'de-DE-ConradNeural', name: 'Conrad (DE muz)', lang: 'de' },
    { id: 'fr-FR-HenriNeural', name: 'Henri (FR muz)', lang: 'fr' },
  ];
}

return {
  startRecording,
  stopRecording,
  textToSpeech,
  edgeTTS,
  playAudio,
  voiceCommand,
  speakThroughCamera,
  getVoices
};

})();
