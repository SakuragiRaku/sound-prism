// popup.js - 設定UI制御

document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('toggle-btn');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const modePills = document.getElementById('mode-pills');
  const colorPills = document.getElementById('color-pills');
  const sensitivitySlider = document.getElementById('sensitivity');
  const opacitySlider = document.getElementById('opacity');
  const customColorInput = document.getElementById('custom-color');
  const rgbLabel = document.getElementById('rgb-label');

  let settings = {
    mode: 'bars',
    colorTheme: 'rainbow',
    sensitivity: 1,
    opacity: 0.7,
    enabled: true,
    customRGB: { r: 88, g: 166, b: 255 },
  };

  // ============================================================
  // 設定読み込み
  // ============================================================
  function loadSettings() {
    chrome.storage.local.get(['mvSettings', 'isActive'], (result) => {
      if (result.mvSettings) {
        settings = { ...settings, ...result.mvSettings };
      }
      updateUI(result.isActive || false);
    });
  }

  // ============================================================
  // UI更新
  // ============================================================
  function updateUI(isActive) {
    // ステータス
    statusDot.className = 'status-dot ' + (isActive ? 'active' : '');
    statusText.textContent = isActive ? 'キャプチャ中' : '停止中';
    toggleBtn.textContent = isActive ? '⏸ 停止' : '▶ 開始';
    toggleBtn.className = 'toggle-btn' + (isActive ? ' active' : '');

    // モード
    modePills.querySelectorAll('.pill').forEach(p =>
      p.classList.toggle('active', p.dataset.value === settings.mode)
    );

    // カラー
    colorPills.querySelectorAll('.pill').forEach(p =>
      p.classList.toggle('active', p.dataset.value === settings.colorTheme)
    );

    // スライダー
    sensitivitySlider.value = settings.sensitivity;
    opacitySlider.value = settings.opacity;

    // RGBピッカー
    const rgbPicker = document.getElementById('rgb-picker');
    if (rgbPicker) rgbPicker.style.display = settings.colorTheme === 'custom' ? 'block' : 'none';
    if (customColorInput && settings.customRGB) {
      const hex = '#' + [settings.customRGB.r, settings.customRGB.g, settings.customRGB.b].map(c => c.toString(16).padStart(2, '0')).join('');
      customColorInput.value = hex;
      if (rgbLabel) rgbLabel.textContent = hex.toUpperCase();
    }
  }

  // ============================================================
  // 設定保存 & 同期
  // ============================================================
  function saveAndSync() {
    chrome.storage.local.set({ mvSettings: settings });
    chrome.runtime.sendMessage({
      type: 'settings-changed',
      settings: settings,
    });
  }

  // ============================================================
  // イベント
  // ============================================================
  toggleBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'toggle-capture' }, (response) => {
      if (response && response.success) {
        updateUI(response.isActive);
      } else if (response && response.error) {
        statusText.textContent = response.error;
        statusText.style.color = '#f85149';
        setTimeout(() => {
          statusText.style.color = '';
          loadSettings();
        }, 2000);
      }
    });
  });

  modePills.addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    settings.mode = pill.dataset.value;
    modePills.querySelectorAll('.pill').forEach(p =>
      p.classList.toggle('active', p.dataset.value === settings.mode)
    );
    saveAndSync();
  });

  colorPills.addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    settings.colorTheme = pill.dataset.value;
    colorPills.querySelectorAll('.pill').forEach(p =>
      p.classList.toggle('active', p.dataset.value === settings.colorTheme)
    );
    // RGBピッカーの表示切り替え
    const rgbPicker = document.getElementById('rgb-picker');
    if (rgbPicker) rgbPicker.style.display = settings.colorTheme === 'custom' ? 'block' : 'none';
    saveAndSync();
  });

  // RGBカラーピッカー
  if (customColorInput) {
    customColorInput.addEventListener('input', (e) => {
      const hex = e.target.value;
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      settings.customRGB = { r, g, b };
      if (rgbLabel) rgbLabel.textContent = hex.toUpperCase();
      saveAndSync();
    });
  }

  sensitivitySlider.addEventListener('input', (e) => {
    settings.sensitivity = parseFloat(e.target.value);
    saveAndSync();
  });

  opacitySlider.addEventListener('input', (e) => {
    settings.opacity = parseFloat(e.target.value);
    saveAndSync();
  });

  // 初期読み込み
  loadSettings();
});
