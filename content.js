// content.js - YouTube動画プレーヤーにビジュアライザーを重ねる
// ポートベース接続を使用

if (window.__mv_loaded) {
  console.log('[MV] 二重実行防止');
} else {
  window.__mv_loaded = true;
  console.log('[MV] Content Script ロード完了');

  // ==========================================================================
  // 状態
  // ==========================================================================
  const CANVAS_ID = 'mv-visualizer-canvas';
  const CONTAINER_ID = 'mv-visualizer-container';
  const DEFAULT_SETTINGS = { mode: 'bars', colorTheme: 'rainbow', sensitivity: 1, opacity: 0.7, enabled: true };

  let settings = { ...DEFAULT_SETTINGS };
  let canvas = null;
  let ctx = null;
  let frequencyData = null;
  let timeData = null;
  let isCapturing = false;
  let animationId = null;


  // 設定読み込み
  chrome.storage.local.get(['mvSettings'], (r) => {
    if (r && r.mvSettings) settings = { ...DEFAULT_SETTINGS, ...r.mvSettings };
  });

  // ==========================================================================
  // Service Workerへポート接続（最重要）
  // ==========================================================================
  const port = chrome.runtime.connect({ name: 'mv-visualizer' });
  console.log('[MV] Service Workerにポート接続');

  port.onMessage.addListener((message) => {
    if (message.type === 'frequency-data') {
      frequencyData = message.frequencyData;
      timeData = message.timeData;
      return;
    }

    if (message.type === 'capture-started') {
      console.log('[MV] capture-started 受信!');
      isCapturing = true;
      injectCanvas();
      if (!animationId) { console.log('[MV] 描画ループ開始'); draw(); }
    }

    if (message.type === 'capture-stopped') {
      console.log('[MV] capture-stopped 受信');
      isCapturing = false;
      frequencyData = null;
      timeData = null;
      if (animationId) { cancelAnimationFrame(animationId); animationId = null; }
      removeCanvas();
    }

    if (message.type === 'capture-paused') {
      console.log('[MV] capture-paused 受信（Canvas維持）');
      frequencyData = null;
      timeData = null;
    }



    if (message.type === 'settings-changed') {
      settings = { ...DEFAULT_SETTINGS, ...message.settings };
      console.log('[MV] 設定変更:', settings.mode, settings.colorTheme);
      if (!settings.enabled) removeCanvas();
      else if (isCapturing && !document.getElementById(CANVAS_ID)) injectCanvas();
    }
  });

  port.onDisconnect.addListener(() => {
    console.log('[MV] ポート切断');
  });

  // フォールバック: onMessage もリスナー登録
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'capture-started') {
      console.log('[MV] capture-started (onMessage フォールバック)');
      isCapturing = true;
      injectCanvas();
      if (!animationId) draw();
    }
    if (message.type === 'capture-stopped') {
      isCapturing = false;
      frequencyData = null; timeData = null;
      if (animationId) { cancelAnimationFrame(animationId); animationId = null; }
      removeCanvas();
    }
  });

  // ==========================================================================
  // Canvas 注入
  // ==========================================================================
  function injectCanvas() {
    if (document.getElementById(CANVAS_ID)) return;

    // #movie_playerに直接注入（ブラウザテストで確認済み）
    const moviePlayer = document.querySelector('#movie_player');
    if (!moviePlayer) { console.warn('[MV] #movie_player未発見、リトライ'); setTimeout(injectCanvas, 1000); return; }

    const rect = moviePlayer.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) { setTimeout(injectCanvas, 1000); return; }

    const container = document.createElement('div');
    container.id = CONTAINER_ID;
    // ピクセル指定 + z-index:99999（YouTubeの深いレイヤー構造を上回る）
    container.style.cssText = `position:absolute;top:0;left:0;width:${rect.width}px;height:${rect.height}px;z-index:99999;pointer-events:none;overflow:hidden;`;

    canvas = document.createElement('canvas');
    canvas.id = CANVAS_ID;
    canvas.style.cssText = 'display:block;position:absolute;top:0;left:0;pointer-events:none;';

    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';

    container.appendChild(canvas);
    moviePlayer.appendChild(container);

    ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    console.log('[MV] Canvas注入成功:', rect.width, 'x', rect.height);
  }

  function removeCanvas() {
    const el = document.getElementById(CONTAINER_ID);
    if (el) el.remove();
    canvas = null; ctx = null;
  }

  function resizeCanvas() {
    if (!canvas) return;
    const p = document.querySelector('#movie_player');
    if (!p) return;
    const r = p.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    // コンテナサイズもピクセル更新
    const container = document.getElementById(CONTAINER_ID);
    if (container) { container.style.width = r.width + 'px'; container.style.height = r.height + 'px'; }
    const dpr = window.devicePixelRatio || 1;
    canvas.width = r.width * dpr;
    canvas.height = r.height * dpr;
    canvas.style.width = r.width + 'px';
    canvas.style.height = r.height + 'px';
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ==========================================================================
  // カラー
  // ==========================================================================
  function getColor(i, total, value) {
    const n = value / 255;
    switch (settings.colorTheme) {
      case 'rainbow': return `hsl(${(i/total)*360},85%,${45+n*30}%)`;
      case 'neon': { const c=['#0ff','#f0f','#ff0','#0f8','#f48']; return c[Math.floor((i/total)*c.length)%c.length]; }
      case 'mono': { const b=Math.floor(150+n*105); return `rgb(${b},${b},${b})`; }
      case 'ocean': return `hsl(${180+(i/total)*40},70%,${35+n*40}%)`;
      case 'custom': {
        const rgb = settings.customRGB || { r: 88, g: 166, b: 255 };
        const f = 0.5 + n * 0.5;
        return `rgb(${Math.floor(rgb.r*f)},${Math.floor(rgb.g*f)},${Math.floor(rgb.b*f)})`;
      }
      default: return '#58a6ff';
    }
  }
  function getGlow() {
    if (settings.colorTheme === 'custom') {
      const rgb = settings.customRGB || { r: 88, g: 166, b: 255 };
      return `rgba(${rgb.r},${rgb.g},${rgb.b},0.3)`;
    }
    return { rainbow:'rgba(88,166,255,0.3)', neon:'rgba(255,0,255,0.3)', mono:'rgba(255,255,255,0.2)', ocean:'rgba(0,200,200,0.3)' }[settings.colorTheme] || 'rgba(88,166,255,0.3)';
  }

  // ==========================================================================
  // 描画
  // ==========================================================================
  function draw() {
    animationId = requestAnimationFrame(draw);
    if (!canvas || !ctx || !settings.enabled || !frequencyData || frequencyData.length === 0) return;
    const p = document.querySelector('#movie_player');
    if (!p) return;

    // YouTubeの動画が再生中でなければ描画しない
    const video = document.querySelector('video.html5-main-video');
    if (video && video.paused) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }

    const rc = p.getBoundingClientRect();
    const w = rc.width, h = rc.height;
    if (w === 0 || h === 0) return;
    if (Math.abs(parseFloat(canvas.style.width) - w) > 2) resizeCanvas();
    ctx.clearRect(0, 0, w, h);

    const data = frequencyData, bufLen = data.length, sens = settings.sensitivity;
    let sum = 0; for (let i = 0; i < bufLen; i++) sum += data[i];
    const avg = (sum / bufLen / 255) * sens;

    // エネルギーが閾値以下なら描画しない（他タブの微小な音声混入を除外）
    if (avg < 0.02) return;

    ctx.globalAlpha = settings.opacity;
    switch (settings.mode) {
      case 'bars': drawBars(w, h, data, bufLen, sens); break;
      case 'wave': drawWave(w, h, sens); break;
      case 'circle': drawCircle(w, h, data, bufLen, sens); break;
    }
    ctx.globalAlpha = 1;
  }

  function drawBars(w, h, data, n, s) {
    const bars = Math.min(n, 128), bw = (w/bars)*0.8, gap = (w/bars)*0.2;
    for (let i = 0; i < bars; i++) {
      const v = data[i]*s, bh = (v/255)*h;
      ctx.fillStyle = getColor(i, bars, v);
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = v > 200 ? 8 : 0;
      ctx.fillRect(i*(bw+gap), h-bh, bw, bh);
      ctx.shadowBlur = 0;
    }
  }

  function drawWave(w, h, s) {
    if (!timeData || !timeData.length) return;
    const len = timeData.length, sw = w/len;

    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const v = (timeData[i]/128-1)*s, y = h/2+v*h*0.35;
      ctx.strokeStyle = getColor(i, len, Math.abs(v)*255);
      i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i*sw, y);
    }
    ctx.shadowColor = getGlow(); ctx.shadowBlur = 10;
    ctx.stroke(); ctx.shadowBlur = 0;

    // ミラー波形
    ctx.globalAlpha = settings.opacity * 0.3;
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const v = (timeData[i]/128-1)*s, y = h/2-v*h*0.35;
      i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i*sw, y);
    }
    ctx.strokeStyle = getGlow();
    ctx.stroke();
    ctx.globalAlpha = settings.opacity;
  }

  function drawCircle(w, h, data, n, s) {
    const cx = w/2, cy = h/2, bars = Math.min(n, 180), br = Math.min(w,h)*0.12;
    for (let i = 0; i < bars; i++) {
      const v = data[i]*s, a = (i/bars)*Math.PI*2-Math.PI/2;
      const bl = (v/255)*Math.min(w,h)*0.4;
      ctx.beginPath();
      ctx.moveTo(cx+Math.cos(a)*br, cy+Math.sin(a)*br);
      ctx.lineTo(cx+Math.cos(a)*(br+bl), cy+Math.sin(a)*(br+bl));
      ctx.strokeStyle = getColor(i, bars, v); ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(cx, cy, br*0.9, 0, Math.PI*2);
    ctx.strokeStyle = getGlow(); ctx.lineWidth = 2;
    ctx.shadowColor = getGlow(); ctx.shadowBlur = 8; ctx.stroke(); ctx.shadowBlur = 0;
  }

  setupObserver();

  // ==========================================================================
  // 動画再生検知 → service-workerに通知（再生タブ追従用）
  // ==========================================================================
  let watchedVideo = null;
  function watchVideoPlay() {
    const video = document.querySelector('video.html5-main-video');
    if (!video || video === watchedVideo) return;
    watchedVideo = video;

    // 再生開始イベント
    video.addEventListener('play', () => {
      console.log('[MV] 動画再生開始検知 (playイベント)');
      try { port.postMessage({ type: 'video-playing' }); } catch {}
    });

    // すでに再生中なら即通知
    if (!video.paused) {
      console.log('[MV] 動画がすでに再生中 → 通知');
      try { port.postMessage({ type: 'video-playing' }); } catch {}
    }

    console.log('[MV] video playイベント監視開始');
  }
  watchVideoPlay();
  setInterval(watchVideoPlay, 2000);

  window.addEventListener('resize', () => { if (canvas) resizeCanvas(); });

  // 既存キャプチャ復帰
  chrome.storage.local.get(['isActive'], (r) => {
    if (r && r.isActive) {
      console.log('[MV] 既存キャプチャ復帰');
      isCapturing = true;
      if (window.location.pathname.startsWith('/watch')) setTimeout(() => { injectCanvas(); draw(); }, 2000);
    }
  });

} // end guard
