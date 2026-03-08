(() => {
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const clearBtn = document.getElementById('clearBtn');
  const promptInput = document.getElementById('promptInput');
  const imageUrlInput = document.getElementById('imageUrlInput');
  const imageFileInput = document.getElementById('imageFileInput');
  const imageFileName = document.getElementById('imageFileName');
  const clearImageFileBtn = document.getElementById('clearImageFileBtn');
  const selectImageFileBtn = document.getElementById('selectImageFileBtn');
  const ratioSelect = document.getElementById('ratioSelect');
  const lengthSelect = document.getElementById('lengthSelect');
  const resolutionSelect = document.getElementById('resolutionSelect');
  const presetSelect = document.getElementById('presetSelect');
  const statusText = document.getElementById('statusText');
  const progressBar = document.getElementById('progressBar');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const durationValue = document.getElementById('durationValue');
  const aspectValue = document.getElementById('aspectValue');
  const lengthValue = document.getElementById('lengthValue');
  const resolutionValue = document.getElementById('resolutionValue');
  const presetValue = document.getElementById('presetValue');
  const videoEmpty = document.getElementById('videoEmpty');
  const videoStage = document.getElementById('videoStage');
  const historyList = document.getElementById('historyList');
  const historyEmpty = document.getElementById('historyEmpty');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');

  const HISTORY_KEY = 'grok2api_video_history';
  const MAX_HISTORY = 20;

  let currentSource = null;
  let currentTaskId = '';
  let isRunning = false;
  let progressBuffer = '';
  let contentBuffer = '';
  let collectingContent = false;
  let startAt = 0;
  let fileDataUrl = '';
  let elapsedTimer = null;
  let lastProgress = 0;
  let videoRendered = false;
  let currentPreviewItem = null;
  let previewCount = 0;
  const DEFAULT_REASONING_EFFORT = 'low';

  function toast(message, type) {
    if (typeof showToast === 'function') {
      showToast(message, type);
    }
  }

  function setStatus(state, text) {
    if (!statusText) return;
    statusText.textContent = text;
    statusText.classList.remove('connected', 'connecting', 'error');
    if (state) {
      statusText.classList.add(state);
    }
  }

  function setButtons(running) {
    if (!startBtn || !stopBtn) return;
    if (running) {
      startBtn.classList.add('hidden');
      stopBtn.classList.remove('hidden');
    } else {
      startBtn.classList.remove('hidden');
      stopBtn.classList.add('hidden');
      startBtn.disabled = false;
    }
  }

  function updateProgress(value) {
    const safe = Math.max(0, Math.min(100, Number(value) || 0));
    lastProgress = safe;
    if (progressFill) {
      progressFill.style.width = `${safe}%`;
    }
    if (progressText) {
      progressText.textContent = `${safe}%`;
    }
  }

  // --- History ---
  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function saveHistoryData(history) {
    try {
      const trimmed = history.slice(0, MAX_HISTORY).map(item => {
        const copy = { ...item };
        if (copy.content && copy.content.length > 2000) {
          const urlMatch = copy.content.match(/https?:\/\/[^\s"'<>]+/i);
          if (urlMatch) { copy.content = urlMatch[0]; copy.type = 'url'; }
          else { copy.content = copy.content.substring(0, 2000); }
        }
        return copy;
      });
      localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
    } catch (e) {
      try {
        const reduced = history.slice(0, Math.floor(MAX_HISTORY / 2));
        localStorage.setItem(HISTORY_KEY, JSON.stringify(reduced));
      } catch (e2) { /* ignore */ }
    }
  }

  function saveToHistory() {
    if (!currentPreviewItem) return;
    const url = currentPreviewItem.dataset.url || '';
    const body = currentPreviewItem.querySelector('.video-item-body');
    const html = body ? body.innerHTML : '';
    const isHtml = /<video[\s>]/i.test(html);
    const content = url || html;
    if (!content) return;
    const elapsed = startAt ? Date.now() - startAt : 0;
    const history = loadHistory();
    history.unshift({
      prompt: promptInput ? promptInput.value.trim() : '',
      content: content,
      type: isHtml ? 'html' : 'url',
      timestamp: Date.now(),
      elapsed: elapsed,
      params: {
        aspect_ratio: ratioSelect ? ratioSelect.value : '3:2',
        video_length: lengthSelect ? lengthSelect.value : '6',
        resolution_name: resolutionSelect ? resolutionSelect.value : '480p',
        preset: presetSelect ? presetSelect.value : 'normal',
      },
    });
    saveHistoryData(history);
    renderHistory();
  }

  function deleteHistoryItem(index) {
    const history = loadHistory();
    if (index >= 0 && index < history.length) {
      const item = history[index];
      // Delete cached video file (and related preview image) on server
      const videoName = extractVideoName(item);
      if (videoName) {
        deleteVideoCacheFile(videoName);
      }
      history.splice(index, 1);
      saveHistoryData(history);
      renderHistory();
    }
  }

  function extractVideoName(item) {
    if (!item || !item.content) return null;
    const content = item.content;
    // Match /v1/files/video/xxx.mp4 or full URL with video filename
    const match = content.match(/(?:\/v1\/files\/video\/|\/video\/)([^\s"'<>?#]+\.mp4)/i);
    if (match) return decodeURIComponent(match[1]);
    // Fallback: match any xxx-generated_video*.mp4 pattern
    const fallback = content.match(/([a-f0-9-]+-generated_video[^\s"'<>?#]*\.mp4)/i);
    if (fallback) return fallback[1];
    return null;
  }

  async function deleteVideoCacheFile(name) {
    try {
      const authHeader = await ensureFunctionKey();
      if (!authHeader) return;
      await fetch('/v1/function/video/cache/delete', {
        method: 'POST',
        headers: {
          ...buildAuthHeaders(authHeader),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name })
      });
    } catch (e) {
      // Silent fail, history item is already removed
    }
  }

  function clearAllHistory() {
    try { localStorage.removeItem(HISTORY_KEY); } catch (e) { /* ignore */ }
    renderHistory();
    toast(t('video.historyCleared') || 'History cleared', 'success');
  }

  function replayHistoryItem(item) {
    if (!item || !item.content) return;
    if (!videoStage) return;
    // Clear previous preview before replaying
    videoStage.innerHTML = '';
    previewCount = 1;
    const slot = document.createElement('div');
    slot.className = 'video-item';
    slot.dataset.index = String(previewCount);

    const header = document.createElement('div');
    header.className = 'video-item-bar';
    const title = document.createElement('div');
    title.className = 'video-item-title';
    title.textContent = t('video.videoTitle', { n: previewCount });
    const actions = document.createElement('div');
    actions.className = 'video-item-actions';
    const openBtn = document.createElement('a');
    openBtn.className = 'geist-button-outline text-xs px-3 video-open hidden';
    openBtn.target = '_blank';
    openBtn.rel = 'noopener';
    openBtn.textContent = t('video.open');
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'geist-button-outline text-xs px-3 video-download';
    downloadBtn.type = 'button';
    downloadBtn.textContent = t('imagine.download');
    downloadBtn.disabled = true;
    actions.appendChild(openBtn);
    actions.appendChild(downloadBtn);
    header.appendChild(title);
    header.appendChild(actions);

    const body = document.createElement('div');
    body.className = 'video-item-body';
    const link = document.createElement('div');
    link.className = 'video-item-link';

    slot.appendChild(header);
    slot.appendChild(body);
    slot.appendChild(link);

    const content = item.content || '';
    const isHtml = item.type === 'html';
    let videoUrl = '';
    if (isHtml) {
      body.innerHTML = content;
      const videoEl = body.querySelector('video');
      if (videoEl) {
        videoEl.controls = true;
        const src = videoEl.querySelector('source');
        videoUrl = (src && src.getAttribute('src')) || videoEl.getAttribute('src') || '';
      }
    } else {
      videoUrl = content;
      // Try to resolve local cache path for playback
      const localUrl = resolveLocalVideoUrl(videoUrl);
      body.innerHTML = '<video controls preload="metadata"><source src="' + localUrl + '" type="video/mp4"></video>';
    }
    updateItemLinks(slot, videoUrl);
    videoStage.appendChild(slot);
    videoStage.classList.remove('hidden');
    if (videoEmpty) videoEmpty.classList.add('hidden');
  }

  function resolveLocalVideoUrl(url) {
    if (!url) return url;
    // Already a local path
    if (url.startsWith('/v1/files/')) return url;
    // Extract video filename from external URL or raw content
    const match = url.match(/([a-f0-9-]+-generated_video[^\s"'<>?#]*\.mp4)/i);
    if (match) return '/v1/files/video/' + match[1];
    return url;
  }

  function renderHistory() {
    if (!historyList) return;
    const history = loadHistory();
    historyList.innerHTML = '';
    if (history.length === 0) {
      if (historyEmpty) historyEmpty.style.display = '';
      if (clearHistoryBtn) clearHistoryBtn.classList.add('hidden');
      return;
    }
    if (historyEmpty) historyEmpty.style.display = 'none';
    if (clearHistoryBtn) clearHistoryBtn.classList.remove('hidden');

    history.forEach((item, index) => {
      const el = document.createElement('div');
      el.className = 'video-history-item';

      const info = document.createElement('div');
      info.className = 'video-history-info';

      const promptEl = document.createElement('div');
      promptEl.className = 'video-history-prompt';
      promptEl.textContent = item.prompt || '(no prompt)';

      const timeEl = document.createElement('div');
      timeEl.className = 'video-history-time';
      const date = new Date(item.timestamp);
      timeEl.textContent = date.toLocaleString(undefined, {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      });
      if (item.elapsed) {
        timeEl.textContent += ' · ' + Math.round(item.elapsed / 1000) + 's';
      }

      info.appendChild(promptEl);
      info.appendChild(timeEl);
      el.appendChild(info);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'video-history-delete';
      deleteBtn.title = t('common.delete');
      deleteBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteHistoryItem(index);
      });
      el.appendChild(deleteBtn);

      el.addEventListener('click', () => {
        replayHistoryItem(item);
        historyList.querySelectorAll('.video-history-item').forEach(i => i.classList.remove('active'));
        el.classList.add('active');
      });

      historyList.appendChild(el);
    });
  }

  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', clearAllHistory);
  }

  function updateMeta() {
    if (aspectValue && ratioSelect) {
      aspectValue.textContent = ratioSelect.value;
    }
    if (lengthValue && lengthSelect) {
      lengthValue.textContent = `${lengthSelect.value}s`;
    }
    if (resolutionValue && resolutionSelect) {
      resolutionValue.textContent = resolutionSelect.value;
    }
    if (presetValue && presetSelect) {
      presetValue.textContent = presetSelect.value;
    }
  }

  function resetOutput(keepPreview) {
    progressBuffer = '';
    contentBuffer = '';
    collectingContent = false;
    videoRendered = false;
    lastProgress = 0;
    currentPreviewItem = null;
    updateProgress(0);
    setIndeterminate(false);
    if (!keepPreview) {
      if (videoStage) {
        videoStage.innerHTML = '';
        videoStage.classList.add('hidden');
      }
      if (videoEmpty) {
        videoEmpty.classList.remove('hidden');
      }
      previewCount = 0;
    }
    if (durationValue) {
      durationValue.textContent = t('video.elapsedTimeNone');
    }
  }

  function initPreviewSlot() {
    if (!videoStage) return;
    previewCount += 1;
    currentPreviewItem = document.createElement('div');
    currentPreviewItem.className = 'video-item';
    currentPreviewItem.dataset.index = String(previewCount);
    currentPreviewItem.classList.add('is-pending');

    const header = document.createElement('div');
    header.className = 'video-item-bar';

    const title = document.createElement('div');
    title.className = 'video-item-title';
    title.textContent = t('video.videoTitle', { n: previewCount });

    const actions = document.createElement('div');
    actions.className = 'video-item-actions';

    const openBtn = document.createElement('a');
    openBtn.className = 'geist-button-outline text-xs px-3 video-open hidden';
    openBtn.target = '_blank';
    openBtn.rel = 'noopener';
    openBtn.textContent = t('video.open');

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'geist-button-outline text-xs px-3 video-download';
    downloadBtn.type = 'button';
    downloadBtn.textContent = t('imagine.download');
    downloadBtn.disabled = true;

    actions.appendChild(openBtn);
    actions.appendChild(downloadBtn);
    header.appendChild(title);
    header.appendChild(actions);

    const body = document.createElement('div');
    body.className = 'video-item-body';
    body.innerHTML = '<div class="video-item-placeholder">' + t('video.generatingPlaceholder') + '</div>';

    const link = document.createElement('div');
    link.className = 'video-item-link';

    currentPreviewItem.appendChild(header);
    currentPreviewItem.appendChild(body);
    currentPreviewItem.appendChild(link);
    videoStage.appendChild(currentPreviewItem);
    videoStage.classList.remove('hidden');
    if (videoEmpty) {
      videoEmpty.classList.add('hidden');
    }
  }

  function ensurePreviewSlot() {
    if (!currentPreviewItem) {
      initPreviewSlot();
    }
    return currentPreviewItem;
  }

  function updateItemLinks(item, url) {
    if (!item) return;
    const openBtn = item.querySelector('.video-open');
    const downloadBtn = item.querySelector('.video-download');
    const link = item.querySelector('.video-item-link');
    const safeUrl = url || '';
    item.dataset.url = safeUrl;
    if (link) {
      link.textContent = safeUrl;
      link.classList.toggle('has-url', Boolean(safeUrl));
    }
    if (openBtn) {
      if (safeUrl) {
        openBtn.href = safeUrl;
        openBtn.classList.remove('hidden');
      } else {
        openBtn.classList.add('hidden');
        openBtn.removeAttribute('href');
      }
    }
    if (downloadBtn) {
      downloadBtn.dataset.url = safeUrl;
      downloadBtn.disabled = !safeUrl;
    }
    if (safeUrl) {
      item.classList.remove('is-pending');
    }
  }

  function setIndeterminate(active) {
    if (!progressBar) return;
    if (active) {
      progressBar.classList.add('indeterminate');
    } else {
      progressBar.classList.remove('indeterminate');
    }
  }

  function startElapsedTimer() {
    stopElapsedTimer();
    if (!durationValue) return;
    elapsedTimer = setInterval(() => {
      if (!startAt) return;
      const seconds = Math.max(0, Math.round((Date.now() - startAt) / 1000));
      durationValue.textContent = t('video.elapsedTime', { sec: seconds });
    }, 1000);
  }

  function stopElapsedTimer() {
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
  }

  function clearFileSelection() {
    fileDataUrl = '';
    if (imageFileInput) {
      imageFileInput.value = '';
    }
    if (imageFileName) {
      imageFileName.textContent = t('common.noFileSelected');
    }
  }

  function normalizeAuthHeader(authHeader) {
    if (!authHeader) return '';
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }
    return authHeader;
  }

  function buildSseUrl(taskId, rawPublicKey) {
    const httpProtocol = window.location.protocol === 'https:' ? 'https' : 'http';
    const base = `${httpProtocol}://${window.location.host}/v1/function/video/sse`;
    const params = new URLSearchParams();
    params.set('task_id', taskId);
    params.set('t', String(Date.now()));
    if (rawPublicKey) {
      params.set('function_key', rawPublicKey);
    }
    return `${base}?${params.toString()}`;
  }

  async function createVideoTask(authHeader) {
    const prompt = promptInput ? promptInput.value.trim() : '';
    const rawUrl = imageUrlInput ? imageUrlInput.value.trim() : '';
    if (fileDataUrl && rawUrl) {
      toast(t('video.referenceConflict'), 'error');
      throw new Error('invalid_reference');
    }
    const imageUrl = fileDataUrl || rawUrl;
    const res = await fetch('/v1/function/video/start', {
      method: 'POST',
      headers: {
        ...buildAuthHeaders(authHeader),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt,
        image_url: imageUrl || null,
        reasoning_effort: DEFAULT_REASONING_EFFORT,
        aspect_ratio: ratioSelect ? ratioSelect.value : '3:2',
        video_length: lengthSelect ? parseInt(lengthSelect.value, 10) : 6,
        resolution_name: resolutionSelect ? resolutionSelect.value : '480p',
        preset: presetSelect ? presetSelect.value : 'normal'
      })
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Failed to create task');
    }
    const data = await res.json();
    return data && data.task_id ? String(data.task_id) : '';
  }

  async function stopVideoTask(taskId, authHeader) {
    if (!taskId) return;
    try {
      await fetch('/v1/function/video/stop', {
        method: 'POST',
        headers: {
          ...buildAuthHeaders(authHeader),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ task_ids: [taskId] })
      });
    } catch (e) {
      // ignore
    }
  }

  function extractVideoInfo(buffer) {
    if (!buffer) return null;
    if (buffer.includes('<video')) {
      const matches = buffer.match(/<video[\s\S]*?<\/video>/gi);
      if (matches && matches.length) {
        return { html: matches[matches.length - 1] };
      }
    }
    const mdMatches = buffer.match(/\[video\]\(([^)]+)\)/g);
    if (mdMatches && mdMatches.length) {
      const last = mdMatches[mdMatches.length - 1];
      const urlMatch = last.match(/\[video\]\(([^)]+)\)/);
      if (urlMatch) {
        return { url: urlMatch[1] };
      }
    }
    const urlMatches = buffer.match(/https?:\/\/[^\s<)]+/g);
    if (urlMatches && urlMatches.length) {
      return { url: urlMatches[urlMatches.length - 1] };
    }
    return null;
  }

  function renderVideoFromHtml(html) {
    videoRendered = true;
    const container = ensurePreviewSlot();
    if (!container) return;
    const body = container.querySelector('.video-item-body');
    if (!body) return;
    body.innerHTML = html;
    const videoEl = body.querySelector('video');
    let videoUrl = '';
    if (videoEl) {
      videoEl.controls = true;
      videoEl.preload = 'metadata';
      const source = videoEl.querySelector('source');
      if (source && source.getAttribute('src')) {
        videoUrl = source.getAttribute('src');
      } else if (videoEl.getAttribute('src')) {
        videoUrl = videoEl.getAttribute('src');
      }
    }
    updateItemLinks(container, videoUrl);
  }

  function renderVideoFromUrl(url) {
    videoRendered = true;
    const container = ensurePreviewSlot();
    if (!container) return;
    const safeUrl = url || '';
    const body = container.querySelector('.video-item-body');
    if (!body) return;
    body.innerHTML = `\n      <video controls preload="metadata">\n        <source src="${safeUrl}" type="video/mp4">\n      </video>\n    `;
    updateItemLinks(container, safeUrl);
  }

  function handleDelta(text) {
    if (!text) return;
    if (text.includes('<think>') || text.includes('</think>')) {
      return;
    }
    if (text.includes('超分辨率') || text.includes('super resolution')) {
      setStatus('connecting', t('video.superResolutionInProgress'));
      setIndeterminate(true);
      if (progressText) {
        progressText.textContent = t('video.superResolutionInProgress');
      }
      return;
    }

    if (!collectingContent) {
      const maybeVideo = text.includes('<video') || text.includes('[video](') || text.includes('http://') || text.includes('https://');
      if (maybeVideo) {
        collectingContent = true;
      }
    }

    if (collectingContent) {
      contentBuffer += text;
      const info = extractVideoInfo(contentBuffer);
      if (info) {
        if (info.html) {
          renderVideoFromHtml(info.html);
        } else if (info.url) {
          renderVideoFromUrl(info.url);
        }
      }
      return;
    }

    progressBuffer += text;
    const roundMatches = [...progressBuffer.matchAll(/\[round=(\d+)\/(\d+)\]\s*progress=([0-9]+(?:\.[0-9]+)?)%/g)];
    if (roundMatches.length) {
      const last = roundMatches[roundMatches.length - 1];
      const round = parseInt(last[1], 10);
      const total = parseInt(last[2], 10);
      const value = parseFloat(last[3]);
      setIndeterminate(false);
      updateProgress(value);
      if (progressText && Number.isFinite(round) && Number.isFinite(total) && total > 0) {
        progressText.textContent = `${Math.round(value)}% · ${round}/${total}`;
      }
      progressBuffer = progressBuffer.slice(Math.max(0, progressBuffer.length - 300));
      return;
    }

    const genericProgressMatches = [...progressBuffer.matchAll(/progress=([0-9]+(?:\.[0-9]+)?)%/g)];
    if (genericProgressMatches.length) {
      const last = genericProgressMatches[genericProgressMatches.length - 1];
      const value = parseFloat(last[1]);
      setIndeterminate(false);
      updateProgress(value);
      progressBuffer = progressBuffer.slice(Math.max(0, progressBuffer.length - 240));
      return;
    }

    const matches = [...progressBuffer.matchAll(/进度\s*(\d+)%/g)];
    if (matches.length) {
      const last = matches[matches.length - 1];
      const value = parseInt(last[1], 10);
      setIndeterminate(false);
      updateProgress(value);
      progressBuffer = progressBuffer.slice(Math.max(0, progressBuffer.length - 200));
    }
  }

  function closeSource() {
    if (currentSource) {
      try {
        currentSource.close();
      } catch (e) {
        // ignore
      }
      currentSource = null;
    }
  }

  async function startConnection() {
    const prompt = promptInput ? promptInput.value.trim() : '';
    if (!prompt) {
      toast(t('common.enterPrompt'), 'error');
      return;
    }

    if (isRunning) {
      toast(t('video.alreadyGenerating'), 'warning');
      return;
    }

    const authHeader = await ensureFunctionKey();
    if (authHeader === null) {
      toast(t('common.configurePublicKey'), 'error');
      window.location.href = '/login';
      return;
    }

    isRunning = true;
    startBtn.disabled = true;
    updateMeta();
    resetOutput(true);
    initPreviewSlot();
    setStatus('connecting', t('common.connecting'));

    let taskId = '';
    try {
      taskId = await createVideoTask(authHeader);
    } catch (e) {
      setStatus('error', t('common.createTaskFailed'));
      startBtn.disabled = false;
      isRunning = false;
      return;
    }

    currentTaskId = taskId;
    startAt = Date.now();
    setStatus('connected', t('common.generating'));
    setButtons(true);
    setIndeterminate(true);
    startElapsedTimer();

    const rawPublicKey = normalizeAuthHeader(authHeader);
    const url = buildSseUrl(taskId, rawPublicKey);
    closeSource();
    const es = new EventSource(url);
    currentSource = es;

    es.onopen = () => {
      setStatus('connected', t('common.generating'));
    };

    es.onmessage = (event) => {
      if (!event || !event.data) return;
      if (event.data === '[DONE]') {
        finishRun();
        return;
      }
      let payload = null;
      try {
        payload = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      if (payload && payload.error) {
        toast(payload.error, 'error');
        setStatus('error', t('common.generationFailed'));
        finishRun(true);
        return;
      }
      // Credits events from backend (OAuth users)
      if (payload.type === 'credits_update' && payload.credits !== undefined) {
        const creditsEl = document.getElementById('credits-value');
        if (creditsEl) creditsEl.textContent = payload.credits;
        return;
      }
      if (payload.type === 'credits_error') {
        toast(payload.message || t('common.insufficientCredits') || 'Insufficient credits', 'error');
        return;
      }
      const choice = payload.choices && payload.choices[0];
      const delta = choice && choice.delta ? choice.delta : null;
      if (delta && delta.content) {
        handleDelta(delta.content);
      }
      if (choice && choice.finish_reason === 'stop') {
        finishRun();
      }
    };

    es.onerror = () => {
      if (!isRunning) return;
      setStatus('error', t('common.connectionError'));
      finishRun(true);
    };
  }

  async function stopConnection() {
    const authHeader = await ensureFunctionKey();
    if (authHeader !== null) {
      await stopVideoTask(currentTaskId, authHeader);
    }
    closeSource();
    isRunning = false;
    currentTaskId = '';
    stopElapsedTimer();
    setButtons(false);
    setStatus('', t('common.notConnected'));
  }

  function removePendingSlot() {
    if (currentPreviewItem && currentPreviewItem.classList.contains('is-pending')) {
      currentPreviewItem.remove();
      currentPreviewItem = null;
      // If stage is empty, show empty state
      if (videoStage && !videoStage.children.length) {
        videoStage.classList.add('hidden');
        if (videoEmpty) videoEmpty.classList.remove('hidden');
      }
    }
  }

  function finishRun(hasError) {
    if (!isRunning) return;
    closeSource();
    isRunning = false;
    setButtons(false);
    stopElapsedTimer();
    if (!hasError && !videoRendered) {
      // Stream finished but no video rendered — likely moderation rejection
      removePendingSlot();
      setStatus('error', t('common.generationFailed'));
      const raw = (contentBuffer || progressBuffer || '').trim();
      if (raw) {
        const msg = raw.length > 200 ? raw.substring(0, 200) + '...' : raw;
        if (progressText) progressText.textContent = msg;
      }
      toast(t('video.moderationRejected') || 'Video generation rejected', 'error');
      return;
    }
    if (hasError) {
      removePendingSlot();
    }
    if (!hasError) {
      setStatus('connected', t('common.done'));
      setIndeterminate(false);
      updateProgress(100);
      // Save to history
      if (videoRendered && currentPreviewItem) {
        saveToHistory();
      }
    }
    if (durationValue && startAt) {
      const seconds = Math.max(0, Math.round((Date.now() - startAt) / 1000));
      durationValue.textContent = t('video.elapsedTime', { sec: seconds });
    }
  }

  if (startBtn) {
    startBtn.addEventListener('click', () => startConnection());
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', () => stopConnection());
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => resetOutput());
  }

  if (videoStage) {
    videoStage.addEventListener('click', async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.classList.contains('video-download')) return;
      event.preventDefault();
      const item = target.closest('.video-item');
      if (!item) return;
      const url = item.dataset.url || target.dataset.url || '';
      const index = item.dataset.index || '';
      if (!url) return;
      try {
        const response = await fetch(url, { mode: 'cors' });
        if (!response.ok) {
          throw new Error('download_failed');
        }
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = blobUrl;
        anchor.download = index ? `grok_video_${index}.mp4` : 'grok_video.mp4';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(blobUrl);
      } catch (e) {
        toast(t('video.downloadFailed'), 'error');
      }
    });
  }

  if (imageFileInput) {
    imageFileInput.addEventListener('change', () => {
      const file = imageFileInput.files && imageFileInput.files[0];
      if (!file) {
        clearFileSelection();
        return;
      }
      if (imageUrlInput && imageUrlInput.value.trim()) {
        imageUrlInput.value = '';
      }
      if (imageFileName) {
        imageFileName.textContent = file.name;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          fileDataUrl = reader.result;
        } else {
          fileDataUrl = '';
          toast(t('common.fileReadFailed'), 'error');
        }
      };
      reader.onerror = () => {
        fileDataUrl = '';
        toast(t('common.fileReadFailed'), 'error');
      };
      reader.readAsDataURL(file);
    });
  }

  if (selectImageFileBtn && imageFileInput) {
    selectImageFileBtn.addEventListener('click', () => {
      imageFileInput.click();
    });
  }

  if (clearImageFileBtn) {
    clearImageFileBtn.addEventListener('click', () => {
      clearFileSelection();
    });
  }

  if (imageUrlInput) {
    imageUrlInput.addEventListener('input', () => {
      if (imageUrlInput.value.trim() && fileDataUrl) {
        clearFileSelection();
      }
    });
  }

  // Clipboard paste support for reference image
  document.addEventListener('paste', (event) => {
    if (!event.clipboardData || !event.clipboardData.items) return;
    // Don't hijack paste when user is typing in a text field (unless it's the image URL input)
    const active = document.activeElement;
    if (active && active !== imageUrlInput && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;

    for (const item of event.clipboardData.items) {
      if (!item.type.startsWith('image/')) continue;
      event.preventDefault();
      const file = item.getAsFile();
      if (!file) return;
      if (imageUrlInput) imageUrlInput.value = '';
      if (imageFileName) imageFileName.textContent = file.name || 'clipboard.png';
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          fileDataUrl = reader.result;
          toast(t('video.imagePasted') || 'Image pasted', 'success');
        }
      };
      reader.onerror = () => {
        toast(t('common.fileReadFailed'), 'error');
      };
      reader.readAsDataURL(file);
      return;
    }
  });

  if (promptInput) {
    promptInput.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        startConnection();
      }
    });
  }

  updateMeta();
  renderHistory();
})();
