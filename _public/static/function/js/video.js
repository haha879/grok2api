(() => {
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const clearBtn = document.getElementById('clearBtn');
  const queueBtn = document.getElementById('queueBtn');
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
  const taskCenterList = document.getElementById('taskCenterList');
  const taskCenterEmpty = document.getElementById('taskCenterEmpty');
  const clearTaskCenterBtn = document.getElementById('clearTaskCenterBtn');

  const HISTORY_KEY = 'grok2api_video_history';
  const MAX_HISTORY = 20;
  const TASK_CENTER_KEY = 'grok2api_video_tasks';
  const MAX_TASKS = 30;
  const TASK_RETENTION_MS = 24 * 60 * 60 * 1000;
  const REFERENCE_UPLOAD_ENDPOINT = '/v1/function/video/reference/upload';

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
  let currentRunInput = null;
  let cachedFileDataUrl = '';
  let cachedReferenceUrl = '';
  let queueDispatching = false;

  function toast(message, type) {
    if (typeof showToast === 'function') {
      showToast(message, type);
    }
  }

  function tt(key, fallback, params) {
    const applyParams = (template) => {
      let out = String(template || '');
      if (!params || typeof params !== 'object') return out;
      Object.keys(params).forEach((name) => {
        out = out.replace(new RegExp(`\\{${name}\\}`, 'g'), String(params[name]));
      });
      return out;
    };
    if (typeof t !== 'function') return applyParams(fallback || key);
    const value = t(key, params);
    if (!value || value === key) {
      return applyParams(fallback || key);
    }
    return value;
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

  function updateProgress(value, textOverride) {
    const safe = Math.max(0, Math.min(100, Number(value) || 0));
    lastProgress = safe;
    if (progressFill) {
      progressFill.style.width = `${safe}%`;
    }
    if (progressText) {
      progressText.textContent = String(textOverride || `${safe}%`);
    }
    if (currentTaskId) {
      setTaskProgress(currentTaskId, safe, progressText ? progressText.textContent : `${safe}%`);
    }
  }

  // --- Task Center ---
  function normalizeTaskStatus(status) {
    const value = String(status || '').toLowerCase();
    if (value === 'queued' || value === 'running' || value === 'done' || value === 'error' || value === 'stopped') {
      return value;
    }
    return 'stopped';
  }

  function loadTaskCenter() {
    try {
      const raw = localStorage.getItem(TASK_CENTER_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(item => item && typeof item.task_id === 'string' && item.task_id);
    } catch (e) {
      return [];
    }
  }

  function saveTaskCenterData(tasks) {
    const now = Date.now();
    const valid = (Array.isArray(tasks) ? tasks : [])
      .filter(item => item && item.task_id)
      .filter(item => {
        const status = normalizeTaskStatus(item.status);
        if (status === 'running' || status === 'queued') return true;
        const updatedAt = Number(item.updated_at || item.created_at || 0);
        return now - updatedAt <= TASK_RETENTION_MS;
      })
      .sort((a, b) => Number(b.updated_at || b.created_at || 0) - Number(a.updated_at || a.created_at || 0))
      .slice(0, MAX_TASKS);
    try {
      localStorage.setItem(TASK_CENTER_KEY, JSON.stringify(valid));
    } catch (e) {
      // ignore
    }
  }

  function upsertTask(taskId, patch, seed) {
    if (!taskId) return null;
    const tasks = loadTaskCenter();
    const now = Date.now();
    let idx = tasks.findIndex(item => item.task_id === taskId);
    if (idx < 0) {
      if (!seed) return null;
      tasks.unshift({
        task_id: taskId,
        status: 'running',
        progress: 0,
        progress_text: '0%',
        output_url: '',
        error_message: '',
        created_at: now,
        updated_at: now,
        ...seed,
      });
      idx = 0;
    }
    tasks[idx] = {
      ...tasks[idx],
      ...(patch || {}),
      status: normalizeTaskStatus((patch && patch.status) || tasks[idx].status),
      updated_at: now,
    };
    saveTaskCenterData(tasks);
    renderTaskCenter();
    return tasks[idx];
  }

  function findTask(taskId) {
    if (!taskId) return null;
    return loadTaskCenter().find(item => item.task_id === taskId) || null;
  }

  function getStatusText(status) {
    const keyMap = {
      queued: 'video.taskStatusQueued',
      running: 'video.taskStatusRunning',
      done: 'video.taskStatusDone',
      error: 'video.taskStatusError',
      stopped: 'video.taskStatusStopped',
    };
    const fallbackMap = {
      queued: '排队中',
      running: '运行中',
      done: '已完成',
      error: '失败',
      stopped: '已停止',
    };
    const key = keyMap[status] || keyMap.stopped;
    return tt(key, fallbackMap[status] || fallbackMap.stopped);
  }

  function formatTaskTime(ts) {
    const value = Number(ts || 0);
    if (!Number.isFinite(value) || value <= 0) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function getQueuedTasks(tasks) {
    return (Array.isArray(tasks) ? tasks : loadTaskCenter())
      .filter(item => normalizeTaskStatus(item.status) === 'queued')
      .sort((a, b) => Number(a.queued_at || a.created_at || 0) - Number(b.queued_at || b.created_at || 0));
  }

  function estimateAverageTaskSeconds() {
    const history = loadHistory()
      .map(item => Number(item && item.elapsed) || 0)
      .filter(ms => ms > 0)
      .slice(0, 8);
    if (!history.length) return 90;
    const avgMs = history.reduce((sum, item) => sum + item, 0) / history.length;
    return Math.max(15, Math.round(avgMs / 1000));
  }

  function formatEta(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function collectCurrentRunInput() {
    const prompt = promptInput ? promptInput.value.trim() : '';
    const rawUrl = imageUrlInput ? imageUrlInput.value.trim() : '';
    if (fileDataUrl && rawUrl) {
      toast(t('video.referenceConflict'), 'error');
      throw new Error('invalid_reference');
    }
    const imageUrl = fileDataUrl || rawUrl;
    return {
      prompt,
      image_url: imageUrl || '',
      aspect_ratio: ratioSelect ? ratioSelect.value : '3:2',
      video_length: lengthSelect ? parseInt(lengthSelect.value, 10) : 6,
      resolution_name: resolutionSelect ? resolutionSelect.value : '480p',
      preset: presetSelect ? presetSelect.value : 'normal',
      reasoning_effort: DEFAULT_REASONING_EFFORT,
    };
  }

  function buildTaskSeed(input) {
    const imageUrl = String((input && input.image_url) || '');
    const persistentImageUrl = imageUrl && !imageUrl.startsWith('data:') ? imageUrl : '';
    return {
      prompt: String((input && input.prompt) || ''),
      params: {
        aspect_ratio: String((input && input.aspect_ratio) || '3:2'),
        video_length: Number((input && input.video_length) || 6),
        resolution_name: String((input && input.resolution_name) || '480p'),
        preset: String((input && input.preset) || 'normal'),
      },
      image_url: persistentImageUrl,
      has_volatile_reference: Boolean(imageUrl && !persistentImageUrl),
    };
  }

  function buildRunInputFromTask(task) {
    const params = (task && task.params) || {};
    return {
      prompt: String((task && task.prompt) || ''),
      image_url: String((task && task.image_url) || ''),
      aspect_ratio: String(params.aspect_ratio || '3:2'),
      video_length: Number(params.video_length || 6),
      resolution_name: String(params.resolution_name || '480p'),
      preset: String(params.preset || 'normal'),
      reasoning_effort: DEFAULT_REASONING_EFFORT,
    };
  }

  function setTaskRunning(taskId, input) {
    return upsertTask(taskId, {
      status: 'running',
      progress: 0,
      progress_text: '0%',
      output_url: '',
      error_message: '',
    }, buildTaskSeed(input));
  }

  function setTaskProgress(taskId, value, textOverride) {
    if (!taskId) return;
    const progressNum = Math.max(0, Math.min(100, Number(value) || 0));
    const progressTextValue = String(textOverride || `${Math.round(progressNum)}%`);
    upsertTask(taskId, { progress: progressNum, progress_text: progressTextValue });
  }

  function setTaskStatus(taskId, status, errorMessage) {
    if (!taskId) return;
    const patch = { status: normalizeTaskStatus(status) };
    if (typeof errorMessage === 'string') {
      patch.error_message = errorMessage;
    }
    upsertTask(taskId, patch);
  }

  function setTaskOutput(taskId, outputUrl) {
    if (!taskId || !outputUrl) return;
    upsertTask(taskId, { output_url: String(outputUrl) });
  }

  function createQueueTaskId() {
    const stamp = Date.now().toString(36);
    const suffix = Math.random().toString(36).slice(2, 8);
    return `queue_${stamp}_${suffix}`;
  }

  function enqueueTask(input) {
    const taskId = createQueueTaskId();
    return upsertTask(taskId, {
      status: 'queued',
      progress: 0,
      progress_text: tt('video.taskStatusQueued', '排队中'),
      output_url: '',
      error_message: '',
      queued_at: Date.now(),
    }, buildTaskSeed(input));
  }

  function applyTaskToForm(task) {
    if (!task) return;
    if (promptInput && typeof task.prompt === 'string') {
      promptInput.value = task.prompt;
    }
    const params = task.params || {};
    if (ratioSelect && params.aspect_ratio) {
      ratioSelect.value = String(params.aspect_ratio);
    }
    if (lengthSelect && params.video_length) {
      lengthSelect.value = String(params.video_length);
    }
    if (resolutionSelect && params.resolution_name) {
      resolutionSelect.value = String(params.resolution_name);
    }
    if (presetSelect && params.preset) {
      presetSelect.value = String(params.preset);
    }
    if (imageUrlInput) {
      imageUrlInput.value = task.image_url || '';
    }
    if (task.image_url && fileDataUrl) {
      clearFileSelection();
    }
    updateMeta();
  }

  function removeTask(taskId) {
    if (!taskId) return;
    const tasks = loadTaskCenter().filter(item => item.task_id !== taskId);
    saveTaskCenterData(tasks);
    renderTaskCenter();
  }

  function clearFinishedTasks() {
    const tasks = loadTaskCenter();
    const left = tasks.filter(item => {
      const status = normalizeTaskStatus(item.status);
      return status === 'running' || status === 'queued';
    });
    saveTaskCenterData(left);
    renderTaskCenter();
    toast(tt('video.taskCenterCleared', '已清理已完成任务'), 'success');
  }

  function renderTaskCenter() {
    if (!taskCenterList) return;
    const tasks = loadTaskCenter()
      .sort((a, b) => Number(b.updated_at || b.created_at || 0) - Number(a.updated_at || a.created_at || 0));
    const queuedTasks = getQueuedTasks(tasks);
    const runningCount = tasks.filter(item => normalizeTaskStatus(item.status) === 'running').length;
    const avgSeconds = estimateAverageTaskSeconds();
    const queuePosMap = new Map();
    queuedTasks.forEach((item, idx) => {
      queuePosMap.set(item.task_id, idx + 1);
    });
    taskCenterList.innerHTML = '';
    if (tasks.length === 0) {
      if (taskCenterEmpty) taskCenterEmpty.style.display = '';
      return;
    }
    if (taskCenterEmpty) taskCenterEmpty.style.display = 'none';

    tasks.forEach(task => {
      const status = normalizeTaskStatus(task.status);
      const item = document.createElement('div');
      item.className = `video-task-item status-${status}`;
      item.dataset.taskId = task.task_id;

      const head = document.createElement('div');
      head.className = 'video-task-head';
      const title = document.createElement('div');
      title.className = 'video-task-title';
      title.textContent = task.prompt || task.task_id;
      const statusTag = document.createElement('div');
      statusTag.className = 'video-task-status';
      statusTag.textContent = getStatusText(status);
      head.appendChild(title);
      head.appendChild(statusTag);

      const meta = document.createElement('div');
      meta.className = 'video-task-meta';
      const ratio = (task.params && task.params.aspect_ratio) || '-';
      const length = (task.params && task.params.video_length) || '-';
      const resolution = (task.params && task.params.resolution_name) || '-';
      const updatedAt = formatTaskTime(task.updated_at || task.created_at);
      meta.innerHTML = `<span>${ratio}</span><span>${length}s</span><span>${resolution}</span><span>${updatedAt}</span>`;

      const progressWrap = document.createElement('div');
      progressWrap.className = 'video-task-progress';
      const progressFillEl = document.createElement('div');
      progressFillEl.className = 'video-task-progress-fill';
      const progressValue = Math.max(0, Math.min(100, Number(task.progress) || 0));
      progressFillEl.style.width = `${progressValue}%`;
      progressWrap.appendChild(progressFillEl);

      const progressTextEl = document.createElement('div');
      progressTextEl.className = 'video-task-progress-text';
      if (status === 'queued') {
        const queuePos = queuePosMap.get(task.task_id) || 1;
        const etaSec = Math.max(0, ((queuePos - 1) + runningCount) * avgSeconds);
        progressTextEl.textContent = `${tt('video.queuePosition', `队列 #${queuePos}`, { pos: queuePos })} · ${tt('video.queueEta', `预计等待 ${formatEta(etaSec)}`, { eta: formatEta(etaSec) })}`;
      } else {
        progressTextEl.textContent = task.progress_text || `${Math.round(progressValue)}%`;
      }

      const actions = document.createElement('div');
      actions.className = 'video-task-actions';

      if (status === 'running') {
        const resumeBtn = document.createElement('button');
        resumeBtn.type = 'button';
        resumeBtn.className = 'geist-button-outline text-xs';
        resumeBtn.dataset.action = 'resume-task';
        resumeBtn.dataset.taskId = task.task_id;
        resumeBtn.textContent = tt('video.taskResume', '恢复');
        actions.appendChild(resumeBtn);
      } else if (status === 'queued') {
        const startNowBtn = document.createElement('button');
        startNowBtn.type = 'button';
        startNowBtn.className = 'geist-button-outline text-xs';
        startNowBtn.dataset.action = 'start-queued-task';
        startNowBtn.dataset.taskId = task.task_id;
        startNowBtn.textContent = tt('video.startNow', '立即开始');
        startNowBtn.disabled = isRunning;
        actions.appendChild(startNowBtn);
      } else {
        const retryBtn = document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.className = 'geist-button-outline text-xs';
        retryBtn.dataset.action = 'retry-task';
        retryBtn.dataset.taskId = task.task_id;
        retryBtn.textContent = tt('video.taskRetry', '重试');
        actions.appendChild(retryBtn);
      }

      if (task.output_url) {
        const openLink = document.createElement('a');
        openLink.className = 'geist-button-outline text-xs';
        openLink.target = '_blank';
        openLink.rel = 'noopener';
        openLink.href = task.output_url;
        openLink.textContent = tt('video.open', '打开');
        actions.appendChild(openLink);
      }

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'geist-button-outline text-xs';
      removeBtn.dataset.action = 'delete-task';
      removeBtn.dataset.taskId = task.task_id;
      removeBtn.textContent = status === 'queued' ? tt('common.cancel', '取消') : tt('common.delete', '删除');
      actions.appendChild(removeBtn);

      item.appendChild(head);
      item.appendChild(meta);
      item.appendChild(progressWrap);
      item.appendChild(progressTextEl);
      if (task.error_message) {
        const err = document.createElement('div');
        err.className = 'video-task-progress-text';
        err.textContent = task.error_message;
        item.appendChild(err);
      }
      item.appendChild(actions);
      taskCenterList.appendChild(item);
    });
  }

  async function resumeTask(task) {
    if (!task || !task.task_id) return;
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

    applyTaskToForm(task);
    const missingVolatileReference = !task.image_url && task.has_volatile_reference && !fileDataUrl;
    if (missingVolatileReference) {
      toast(t('video.taskNeedsReference') || '该任务原始参考图未持久化，请重新上传参考图后重试', 'warning');
      return;
    }

    isRunning = true;
    startBtn.disabled = true;
    resetOutput(false);
    initPreviewSlot();
    setStatus('connecting', t('video.taskResuming') || '恢复任务中...');
    currentTaskId = task.task_id;
    currentRunInput = buildRunInputFromTask(task);
    startAt = Date.now();
    setButtons(true);
    setIndeterminate(true);
    startElapsedTimer();
    setTaskStatus(task.task_id, 'running');
    attachStream(task.task_id, authHeader);
  }

  async function retryTask(task) {
    if (!task) return;
    applyTaskToForm(task);
    const missingVolatileReference = !task.image_url && task.has_volatile_reference && !fileDataUrl;
    if (missingVolatileReference) {
      toast(t('video.taskNeedsReference') || '该任务原始参考图未持久化，请重新上传参考图后重试', 'warning');
      return;
    }
    await startConnection();
  }

  async function startQueuedTask(task) {
    if (!task || !task.task_id) return;
    if (normalizeTaskStatus(task.status) !== 'queued') return;
    applyTaskToForm(task);
    const runInput = buildRunInputFromTask(task);
    const missingVolatileReference = !runInput.image_url && task.has_volatile_reference && !fileDataUrl;
    if (missingVolatileReference) {
      const message = t('video.taskNeedsReference') || '该任务原始参考图未持久化，请重新上传参考图后重试';
      toast(message, 'warning');
      setTaskStatus(task.task_id, 'error', message);
      return;
    }
    await startConnection({
      runInput,
      sourceTaskId: task.task_id,
    });
  }

  async function tryStartNextQueuedTask() {
    if (isRunning || queueDispatching) return;
    const next = getQueuedTasks()[0];
    if (!next) return;
    queueDispatching = true;
    try {
      await startQueuedTask(next);
    } finally {
      queueDispatching = false;
      if (!isRunning && getQueuedTasks().length > 0) {
        setTimeout(() => {
          tryStartNextQueuedTask();
        }, 0);
      }
    }
  }

  async function enqueueCurrentInput() {
    let runInput = null;
    try {
      runInput = collectCurrentRunInput();
    } catch (e) {
      return;
    }

    if (!String(runInput.prompt || '').trim()) {
      toast(t('common.enterPrompt'), 'error');
      return;
    }

    if (String(runInput.image_url || '').startsWith('data:')) {
      const authHeader = await ensureFunctionKey();
      if (authHeader === null) {
        toast(t('common.configurePublicKey'), 'error');
        window.location.href = '/login';
        return;
      }
      try {
        runInput = await prepareRunInputForTask(authHeader, runInput, { showStatus: false });
      } catch (e) {
        toast(tt('video.referenceUploadFailed', '参考图上传失败'), 'error');
        return;
      }
    }

    const task = enqueueTask(runInput);
    if (!task) return;
    toast(tt('video.queueAdded', '已加入队列'), 'success');
    if (!isRunning) {
      tryStartNextQueuedTask();
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

  function saveToHistory(runSnapshot) {
    if (!currentPreviewItem) return;
    const url = currentPreviewItem.dataset.url || '';
    const body = currentPreviewItem.querySelector('.video-item-body');
    const html = body ? body.innerHTML : '';
    const hasVideoHtml = /<video[\s>]/i.test(html);
    const useUrlContent = Boolean(url);
    const content = useUrlContent ? url : html;
    if (!content) return;
    const elapsed = startAt ? Date.now() - startAt : 0;
    const snapshot = runSnapshot || null;
    const promptText = snapshot ? String(snapshot.prompt || '').trim() : (promptInput ? promptInput.value.trim() : '');
    const history = loadHistory();
    history.unshift({
      prompt: promptText,
      content: content,
      type: useUrlContent ? 'url' : (hasVideoHtml ? 'html' : 'url'),
      timestamp: Date.now(),
      elapsed: elapsed,
      params: {
        aspect_ratio: snapshot ? String(snapshot.aspect_ratio || '3:2') : (ratioSelect ? ratioSelect.value : '3:2'),
        video_length: snapshot ? String(snapshot.video_length || '6') : (lengthSelect ? lengthSelect.value : '6'),
        resolution_name: snapshot ? String(snapshot.resolution_name || '480p') : (resolutionSelect ? resolutionSelect.value : '480p'),
        preset: snapshot ? String(snapshot.preset || 'normal') : (presetSelect ? presetSelect.value : 'normal'),
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
      if (authHeader === null) return;
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
    const hasVideoHtml = /<video[\s>]/i.test(content);
    const treatAsHtml = isHtml && hasVideoHtml;
    let videoUrl = '';
    if (treatAsHtml) {
      body.innerHTML = content;
      const videoEl = body.querySelector('video');
      if (videoEl) {
        videoEl.controls = true;
        videoEl.preload = 'metadata';
        const src = videoEl.querySelector('source');
        videoUrl = (src && src.getAttribute('src')) || videoEl.getAttribute('src') || '';
        const fallbackUrl = extractVideoUrlFromText(content);
        if (!videoUrl && fallbackUrl) {
          videoUrl = fallbackUrl;
        }
        const localUrl = resolveLocalVideoUrl(videoUrl || fallbackUrl);
        applyVideoSourceWithFallback(videoEl, localUrl, videoUrl || fallbackUrl);
      }
    } else {
      videoUrl = extractVideoUrlFromText(content);
      // Prefer local cache path for in-page playback, fallback to original URL.
      const localUrl = resolveLocalVideoUrl(videoUrl);
      body.innerHTML = '<video controls preload="metadata"><source src="' + localUrl + '" type="video/mp4"></video>';
      const videoEl = body.querySelector('video');
      if (videoEl) {
        applyVideoSourceWithFallback(videoEl, localUrl, videoUrl);
      }
    }
    updateItemLinks(slot, videoUrl || resolveLocalVideoUrl(content));
    videoStage.appendChild(slot);
    videoStage.classList.remove('hidden');
    if (videoEmpty) videoEmpty.classList.add('hidden');
  }

  function extractVideoUrlFromText(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';
    const md = text.match(/\[video\]\(([^)]+)\)/i);
    if (md && md[1]) return md[1].trim();
    const srcAttr = text.match(/<source[^>]*\ssrc=["']([^"']+)["']/i);
    if (srcAttr && srcAttr[1]) return srcAttr[1].trim();
    const videoAttr = text.match(/<video[^>]*\ssrc=["']([^"']+)["']/i);
    if (videoAttr && videoAttr[1]) return videoAttr[1].trim();
    const fileApi = text.match(/\/v1\/files\/video\/[^\s"'<>?#]+/i);
    if (fileApi && fileApi[0]) return fileApi[0].trim();
    const http = text.match(/https?:\/\/[^\s"'<>]+/i);
    if (http && http[0]) return http[0].trim();
    return text;
  }

  function resolveLocalVideoUrl(url) {
    const raw = extractVideoUrlFromText(url);
    if (!raw) return '';

    const safe = raw.trim();
    if (!safe) return '';

    // Already local file endpoint
    if (safe.startsWith('/v1/files/video/')) {
      return safe.split('#')[0].split('?')[0];
    }

    // Best-effort mapping from any mp4 path to local cache key
    try {
      const parsed = new URL(safe, window.location.origin);
      const path = (parsed.pathname || '').trim();
      if (path.startsWith('/v1/files/video/')) {
        return path;
      }
      if (/\.mp4$/i.test(path)) {
        const filename = path.replace(/^\/+/, '').replace(/\//g, '-');
        return `/v1/files/video/${filename}`;
      }
    } catch (e) {
      // ignore URL parse failures and continue with regex fallback
    }

    if (safe.startsWith('/') && /\.mp4$/i.test(safe.split('#')[0].split('?')[0])) {
      const pathOnly = safe.split('#')[0].split('?')[0];
      const filename = pathOnly.replace(/^\/+/, '').replace(/\//g, '-');
      return `/v1/files/video/${filename}`;
    }

    const match = safe.match(/([A-Za-z0-9_-]+-generated_video[^\s"'<>?#]*\.mp4)/i);
    if (match) return '/v1/files/video/' + match[1];
    return safe;
  }

  function applyVideoSourceWithFallback(videoEl, primaryUrl, fallbackUrl) {
    if (!videoEl) return;
    const source = videoEl.querySelector('source');
    const item = videoEl.closest('.video-item');
    const primary = String(primaryUrl || '').trim();
    const fallback = String(fallbackUrl || '').trim();
    const same = primary && fallback && primary === fallback;
    let switchedToFallback = false;

    const setSource = (url) => {
      if (!url) return;
      if (source) {
        source.setAttribute('src', url);
      } else {
        videoEl.setAttribute('src', url);
      }
      videoEl.load();
    };

    if (primary) {
      setSource(primary);
    } else if (fallback) {
      setSource(fallback);
      switchedToFallback = true;
    }

    videoEl.addEventListener('error', () => {
      if (!switchedToFallback && !same && fallback && primary) {
        switchedToFallback = true;
        setSource(fallback);
        return;
      }
      showOpenFallback(item, fallback || primary);
    });
  }

  function showOpenFallback(item, url) {
    if (!item) return;
    const openBtn = item.querySelector('.video-open');
    if (!openBtn) return;
    const safeUrl = String(url || '').trim();
    if (!safeUrl) return;
    openBtn.href = safeUrl;
    openBtn.classList.remove('hidden');
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

  if (taskCenterList) {
    taskCenterList.addEventListener('click', async (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const actionEl = target.closest('[data-action]');
      if (!actionEl) return;
      const action = actionEl.getAttribute('data-action') || '';
      const taskId = actionEl.getAttribute('data-task-id') || '';
      if (!taskId) return;
      const task = findTask(taskId);
      if (!task) return;

      if (action === 'resume-task') {
        await resumeTask(task);
        return;
      }
      if (action === 'retry-task') {
        await retryTask(task);
        return;
      }
      if (action === 'start-queued-task') {
        await startQueuedTask(task);
        return;
      }
      if (action === 'delete-task') {
        const wasQueued = normalizeTaskStatus(task.status) === 'queued';
        removeTask(taskId);
        if (wasQueued && !isRunning) {
          tryStartNextQueuedTask();
        }
      }
    });
  }

  if (clearTaskCenterBtn) {
    clearTaskCenterBtn.addEventListener('click', clearFinishedTasks);
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
        // Hidden by default; only show as fallback when inline playback fails.
        openBtn.classList.add('hidden');
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
      if (isRunning && currentTaskId) {
        setTaskOutput(currentTaskId, safeUrl);
      }
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
    cachedFileDataUrl = '';
    cachedReferenceUrl = '';
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

  async function uploadReferenceImage(authHeader, dataUrl) {
    const payload = String(dataUrl || '').trim();
    if (!payload) {
      throw new Error('missing_image_data');
    }
    if (cachedFileDataUrl && cachedReferenceUrl && cachedFileDataUrl === payload) {
      return cachedReferenceUrl;
    }

    const res = await fetch(REFERENCE_UPLOAD_ENDPOINT, {
      method: 'POST',
      headers: {
        ...buildAuthHeaders(authHeader),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ image_data: payload })
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Failed to upload reference image');
    }
    const data = await res.json();
    const url = String((data && data.url) || '').trim();
    if (!url) {
      throw new Error('Invalid upload response');
    }
    cachedFileDataUrl = payload;
    cachedReferenceUrl = url;
    return url;
  }

  async function prepareRunInputForTask(authHeader, input, options) {
    const showStatus = !(options && options.showStatus === false);
    const prepared = {
      ...(input || {}),
      image_url: String((input && input.image_url) || '').trim(),
    };
    if (!prepared.image_url.startsWith('data:')) {
      return prepared;
    }
    if (showStatus) {
      setStatus('connecting', tt('video.uploadingReference', '上传参考图中...'));
      if (progressText) {
        progressText.textContent = tt('video.uploadingReference', '上传参考图中...');
      }
    }
    const persistedUrl = await uploadReferenceImage(authHeader, prepared.image_url);
    prepared.image_url = persistedUrl;
    return prepared;
  }

  async function createVideoTask(authHeader, runInput) {
    const input = runInput || collectCurrentRunInput();
    const res = await fetch('/v1/function/video/start', {
      method: 'POST',
      headers: {
        ...buildAuthHeaders(authHeader),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: String(input.prompt || ''),
        image_url: input.image_url || null,
        reasoning_effort: String(input.reasoning_effort || DEFAULT_REASONING_EFFORT),
        aspect_ratio: String(input.aspect_ratio || '3:2'),
        video_length: Number(input.video_length || 6),
        resolution_name: String(input.resolution_name || '480p'),
        preset: String(input.preset || 'normal')
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
        if (currentTaskId) {
          setTaskProgress(currentTaskId, value, progressText.textContent);
        }
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

  function attachStream(taskId, authHeader) {
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
        const errMsg = String(payload.error || '');
        toast(errMsg, 'error');
        setStatus('error', t('common.generationFailed'));
        finishRun(true, errMsg);
        return;
      }
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
      finishRun(true, t('common.connectionError'));
    };
  }

  async function startConnection(options) {
    const runOptions = options || {};
    const sourceTaskId = String(runOptions.sourceTaskId || '');
    const providedInput = runOptions.runInput || null;
    const prompt = providedInput ? String(providedInput.prompt || '').trim() : (promptInput ? promptInput.value.trim() : '');
    if (!prompt) {
      toast(t('common.enterPrompt'), 'error');
      if (sourceTaskId) {
        setTaskStatus(sourceTaskId, 'error', t('common.enterPrompt'));
      }
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

    let runInput = null;
    try {
      runInput = providedInput ? { ...providedInput } : collectCurrentRunInput();
    } catch (e) {
      return;
    }

    isRunning = true;
    startBtn.disabled = true;
    currentRunInput = null;
    updateMeta();
    resetOutput(false);
    initPreviewSlot();
    setStatus('connecting', t('common.connecting'));

    try {
      runInput = await prepareRunInputForTask(authHeader, runInput);
    } catch (e) {
      setStatus('error', tt('video.referenceUploadFailed', '参考图上传失败'));
      toast(tt('video.referenceUploadFailed', '参考图上传失败'), 'error');
      removePendingSlot();
      setIndeterminate(false);
      startBtn.disabled = false;
      isRunning = false;
      currentRunInput = null;
      if (sourceTaskId) {
        setTaskStatus(sourceTaskId, 'error', tt('video.referenceUploadFailed', '参考图上传失败'));
      }
      return;
    }
    currentRunInput = runInput;

    let taskId = '';
    try {
      taskId = await createVideoTask(authHeader, runInput);
    } catch (e) {
      setStatus('error', t('common.createTaskFailed'));
      removePendingSlot();
      setIndeterminate(false);
      startBtn.disabled = false;
      isRunning = false;
      currentRunInput = null;
      if (sourceTaskId) {
        setTaskStatus(sourceTaskId, 'error', t('common.createTaskFailed'));
      }
      return;
    }

    if (sourceTaskId) {
      removeTask(sourceTaskId);
    }
    currentTaskId = taskId;
    setTaskRunning(taskId, currentRunInput);
    startAt = Date.now();
    setStatus('connected', t('common.generating'));
    setButtons(true);
    setIndeterminate(true);
    startElapsedTimer();
    attachStream(taskId, authHeader);
  }

  async function stopConnection() {
    const stoppedTaskId = currentTaskId;
    const authHeader = await ensureFunctionKey();
    if (authHeader !== null) {
      await stopVideoTask(currentTaskId, authHeader);
    }
    closeSource();
    isRunning = false;
    currentTaskId = '';
    currentRunInput = null;
    stopElapsedTimer();
    setButtons(false);
    setIndeterminate(false);
    removePendingSlot();
    if (stoppedTaskId) {
      setTaskStatus(stoppedTaskId, 'stopped');
    }
    setStatus('', t('common.notConnected'));
    tryStartNextQueuedTask();
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

  function finishRun(hasError, errorMessage) {
    if (!isRunning) return;
    const finishedTaskId = currentTaskId;
    const existingTask = finishedTaskId ? findTask(finishedTaskId) : null;
    closeSource();
    isRunning = false;
    setButtons(false);
    stopElapsedTimer();
    setIndeterminate(false);
    if (finishedTaskId) {
      setTaskProgress(
        finishedTaskId,
        lastProgress,
        progressText ? progressText.textContent : `${Math.round(lastProgress)}%`
      );
    }
    if (!hasError && !videoRendered && existingTask && existingTask.output_url) {
      renderVideoFromUrl(existingTask.output_url);
    }
    if (!hasError && !videoRendered) {
      // Stream finished but no video rendered — likely moderation rejection
      removePendingSlot();
      setStatus('error', t('common.generationFailed'));
      const raw = (contentBuffer || progressBuffer || '').trim();
      let moderationMsg = t('video.moderationRejected') || 'Video generation rejected';
      if (raw) {
        const msg = raw.length > 200 ? raw.substring(0, 200) + '...' : raw;
        if (progressText) progressText.textContent = msg;
        moderationMsg = msg;
      }
      toast(t('video.moderationRejected') || 'Video generation rejected', 'error');
      if (finishedTaskId) {
        setTaskStatus(finishedTaskId, 'error', moderationMsg);
      }
      currentTaskId = '';
      currentRunInput = null;
      tryStartNextQueuedTask();
      return;
    }
    if (hasError) {
      removePendingSlot();
      if (finishedTaskId) {
        setTaskStatus(finishedTaskId, 'error', String(errorMessage || t('common.generationFailed') || 'Generation failed'));
      }
    }
    if (!hasError) {
      setStatus('connected', t('common.done'));
      updateProgress(100);
      if (finishedTaskId) {
        setTaskProgress(finishedTaskId, 100, '100%');
        setTaskStatus(finishedTaskId, 'done', '');
      }
      // Save to history
      if (videoRendered && currentPreviewItem) {
        saveToHistory(currentRunInput);
      }
    }
    if (durationValue && startAt) {
      const seconds = Math.max(0, Math.round((Date.now() - startAt) / 1000));
      durationValue.textContent = t('video.elapsedTime', { sec: seconds });
    }
    currentTaskId = '';
    currentRunInput = null;
    tryStartNextQueuedTask();
  }

  if (startBtn) {
    startBtn.addEventListener('click', () => startConnection());
  }

  if (queueBtn) {
    queueBtn.addEventListener('click', () => {
      enqueueCurrentInput();
    });
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
          cachedFileDataUrl = '';
          cachedReferenceUrl = '';
        } else {
          fileDataUrl = '';
          cachedFileDataUrl = '';
          cachedReferenceUrl = '';
          toast(t('common.fileReadFailed'), 'error');
        }
      };
      reader.onerror = () => {
        fileDataUrl = '';
        cachedFileDataUrl = '';
        cachedReferenceUrl = '';
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
          cachedFileDataUrl = '';
          cachedReferenceUrl = '';
          toast(t('video.imagePasted') || 'Image pasted', 'success');
        }
      };
      reader.onerror = () => {
        cachedFileDataUrl = '';
        cachedReferenceUrl = '';
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

  async function tryResumeLatestTask() {
    if (isRunning) return;
    const task = loadTaskCenter()
      .filter(item => normalizeTaskStatus(item.status) === 'running')
      .sort((a, b) => Number(b.updated_at || b.created_at || 0) - Number(a.updated_at || a.created_at || 0))[0];
    if (!task) return;
    await resumeTask(task);
  }

  if (typeof I18n !== 'undefined' && I18n && typeof I18n.onReady === 'function') {
    I18n.onReady(() => {
      renderTaskCenter();
    });
  }

  async function initTaskBoot() {
    await tryResumeLatestTask();
    if (!isRunning) {
      await tryStartNextQueuedTask();
    }
  }

  updateMeta();
  renderHistory();
  renderTaskCenter();
  initTaskBoot();
})();
