// offscreen.js - 音声キャプチャ & 周波数解析

let audioContext = null;
let analyser = null;
let source = null;
let stream = null;
let animationId = null;

// ============================================================
// 音声キャプチャ開始
// ============================================================
async function startCapture(streamId) {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
    });

    console.log('[MV-OFF] 音声ストリーム取得成功');

    audioContext = new AudioContext();
    source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);

    // タブの音声をスピーカーにも出力
    source.connect(audioContext.destination);

    console.log('[MV-OFF] 解析開始');
    sendFrequencyData();
  } catch (err) {
    console.error('[MV-OFF] キャプチャエラー:', err);
  }
}

// ============================================================
// 周波数データ送信ループ (30fps)
// ============================================================
function sendFrequencyData() {
  if (!analyser) return;

  const frequencyData = new Uint8Array(analyser.frequencyBinCount);
  const timeData = new Uint8Array(analyser.fftSize);

  analyser.getByteFrequencyData(frequencyData);
  analyser.getByteTimeDomainData(timeData);

  const freqSlice = Array.from(frequencyData.slice(0, 128));
  const timeSlice = Array.from(timeData.slice(0, 512));

  chrome.runtime.sendMessage({
    type: 'frequency-data',
    target: 'content',
    frequencyData: freqSlice,
    timeData: timeSlice,
  });

  animationId = setTimeout(sendFrequencyData, 1000 / 30);
}

// ============================================================
// 停止
// ============================================================
function stopCapture() {
  if (animationId) {
    clearTimeout(animationId);
    animationId = null;
  }
  if (source) {
    try { source.disconnect(); } catch {}
  }
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
  }
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close().catch(() => {});
  }
  source = null;
  stream = null;
  audioContext = null;
  analyser = null;
  console.log('[MV-OFF] キャプチャ停止');
}

// ============================================================
// メッセージ受信
// ============================================================
chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== 'offscreen') return;

  if (message.type === 'start-capture') {
    console.log('[MV-OFF] start-capture受信');
    startCapture(message.streamId);
  } else if (message.type === 'stop-capture') {
    stopCapture();
  }
});
