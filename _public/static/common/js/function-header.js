async function loadFunctionHeader() {
  const container = document.getElementById('app-header');
  if (!container) return;
  try {
    const res = await fetch('/static/common/html/function-header.html?v=1.6.2');
    if (!res.ok) return;
    container.innerHTML = await res.text();
    const logoutBtn = container.querySelector('#function-logout-btn');
    if (logoutBtn) {
      logoutBtn.classList.add('hidden');
      try {
        const verify = await fetch('/v1/function/verify', { method: 'GET' });
        if (verify.status === 401) {
          logoutBtn.classList.remove('hidden');
        }
      } catch (e) {
        // Ignore verification errors and keep it hidden
      }
    }
    if (window.I18n) {
      I18n.applyToDOM(container);
      var toggle = container.querySelector('#lang-toggle');
      if (toggle) toggle.textContent = I18n.getLang() === 'zh' ? 'EN' : '中';
    }
    const path = window.location.pathname;
    const links = container.querySelectorAll('a[data-nav]');
    links.forEach((link) => {
      const target = link.getAttribute('data-nav') || '';
      if (target && path.startsWith(target)) {
        link.classList.add('active');
      }
    });

    // Credits display for OAuth users
    if (typeof fetchCredits === 'function') {
      try {
        const data = await fetchCredits();
        if (data && data.credits_enabled) {
          const display = container.querySelector('#credits-display');
          const valueEl = container.querySelector('#credits-value');
          const checkinBtn = container.querySelector('#checkin-btn');
          if (display && valueEl) {
            valueEl.textContent = data.credits;
            display.classList.remove('hidden');
          }
          if (checkinBtn) {
            checkinBtn.classList.remove('hidden');
          }
        }
      } catch (e) {
        // Not an OAuth user or credits disabled, keep hidden
      }
    }
  } catch (e) {
    // Fail silently to avoid breaking page load
  }
}

// Refresh credits display
async function refreshCredits() {
  if (typeof fetchCredits !== 'function') return;
  const valueEl = document.getElementById('credits-value');
  const icon = document.getElementById('credits-refresh');
  if (icon) icon.style.animation = 'spin .6s linear';
  try {
    const data = await fetchCredits();
    if (data && valueEl) valueEl.textContent = data.credits;
  } catch (e) {}
  if (icon) setTimeout(() => icon.style.animation = '', 600);
}

// Global checkin handler called from nav button
async function handleCheckin() {
  if (typeof doCheckin !== 'function') return;
  const btn = document.getElementById('checkin-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '...';
  }
  try {
    const result = await doCheckin();
    if (!result) {
      if (typeof showToast === 'function') showToast('签到失败', 'error');
      return;
    }
    if (result.success) {
      if (typeof showToast === 'function') showToast('签到成功！', 'success');
      const valueEl = document.getElementById('credits-value');
      if (valueEl) valueEl.textContent = result.credits;
      if (btn) { btn.textContent = '已签到'; btn.disabled = true; }
    } else {
      if (typeof showToast === 'function') showToast(result.message || '今日已签到', 'info');
      if (btn) { btn.textContent = '已签到'; btn.disabled = true; }
    }
  } catch (e) {
    if (typeof showToast === 'function') showToast('签到失败', 'error');
  } finally {
    if (btn && !btn.disabled) {
      btn.textContent = '签到';
      btn.disabled = false;
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadFunctionHeader);
} else {
  loadFunctionHeader();
}
