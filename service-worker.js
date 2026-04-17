// service-worker.js - Music Visualizer Chrome拡張

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
let activeTabId = null;
let isActive = false;
const contentPorts = new Map();

// --- Offscreen Document 管理 ---
async function hasOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
  });
  return contexts.length > 0;
}

async function setupOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ['USER_MEDIA'],
      justification: 'タブの音声をキャプチャして周波数解析を行う',
    });
  } catch (e) {
    if (!e.message.includes('single offscreen')) throw e;
  }
}

async function removeOffscreenDocument() {
  if (!(await hasOffscreenDocument())) return;
  await chrome.offscreen.closeDocument();
}

// --- ポート接続管理 ---
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'mv-visualizer') {
    const tabId = port.sender.tab.id;
    contentPorts.set(tabId, port);
    console.log('[MV-SW] Content Script接続! tabId:', tabId);

    port.onDisconnect.addListener(() => {
      contentPorts.delete(tabId);
    });

    // Content Scriptからのメッセージ受信
    port.onMessage.addListener((msg) => {
      // 動画の再生開始通知 → ビジュアライザー追従
      if (msg.type === 'video-playing' && isActive && tabId !== activeTabId) {
        // tabCaptureはアクティブタブでのみ動作するため確認
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0] && tabs[0].id === tabId) {
            console.log('[MV-SW] 再生開始検出（アクティブタブ確認済み）→ 追従:', tabId);
            startCaptureForTab(tabId).catch(e =>
              console.error('[MV-SW] 追従キャプチャ失敗:', e)
            );
          } else {
            console.log('[MV-SW] 再生検出したがアクティブタブではないためスキップ');
          }
        });
      }
    });
  }
});

function getPort(tabId) {
  return contentPorts.get(tabId) || null;
}

// --- tabCapture 制御 ---
async function startCaptureForTab(tabId) {
  try {
    // 既存キャプチャを停止
    if (await hasOffscreenDocument()) {
      chrome.runtime.sendMessage({ type: 'stop-capture', target: 'offscreen' });
      await new Promise(r => setTimeout(r, 300));
      await removeOffscreenDocument();
    }

    // 前のタブにpause通知（Canvasは維持、データだけ停止）
    if (activeTabId && activeTabId !== tabId) {
      const oldPort = getPort(activeTabId);
      if (oldPort) {
        try { oldPort.postMessage({ type: 'capture-paused' }); } catch {}
      }
    }

    await setupOffscreenDocument();
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    console.log('[MV-SW] streamId取得成功 tabId:', tabId);

    chrome.runtime.sendMessage({
      type: 'start-capture',
      target: 'offscreen',
      streamId: streamId,
    });

    activeTabId = tabId;
    isActive = true;

    // 新しいタブにstart通知
    const port = getPort(tabId);
    if (port) {
      port.postMessage({ type: 'capture-started' });
      console.log('[MV-SW] capture-started送信 tabId:', tabId);
    } else {
      chrome.tabs.sendMessage(tabId, { type: 'capture-started' }).catch(() => {});
    }

    await chrome.storage.local.set({ isActive: true, activeTabId: tabId });
    return true;
  } catch (err) {
    console.error('[MV-SW] tabCapture エラー:', err);
    return false;
  }
}

async function stopCapture() {
  chrome.runtime.sendMessage({ type: 'stop-capture', target: 'offscreen' });

  for (const [, port] of contentPorts) {
    try { port.postMessage({ type: 'capture-stopped' }); } catch {}
  }

  activeTabId = null;
  isActive = false;
  await chrome.storage.local.set({ isActive: false, activeTabId: null });
  await removeOffscreenDocument();
}

// --- メッセージハンドラ ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'frequency-data' && message.target === 'content') {
    if (activeTabId) {
      const port = getPort(activeTabId);
      if (port) {
        try { port.postMessage({ type: 'frequency-data', frequencyData: message.frequencyData, timeData: message.timeData }); } catch {}
      }
    }
    return;
  }

  if (message.type === 'toggle-capture') {
    (async () => {
      if (isActive) {
        await stopCapture();
        sendResponse({ success: true, isActive: false });
      } else {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url && tab.url.includes('youtube.com')) {
          const success = await startCaptureForTab(tab.id);
          sendResponse({ success, isActive: success });
        } else {
          sendResponse({ success: false, error: 'YouTubeタブを開いてください' });
        }
      }
    })();
    return true;
  }

  if (message.type === 'settings-changed') {
    for (const [, port] of contentPorts) {
      try { port.postMessage({ type: 'settings-changed', settings: message.settings }); } catch {}
    }
    return;
  }

});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  contentPorts.delete(tabId);
  if (activeTabId === tabId) await stopCapture();
});
