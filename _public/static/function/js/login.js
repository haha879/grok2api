const functionKeyInput = document.getElementById('function-key-input');
if (functionKeyInput) {
  functionKeyInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') login();
  });
}

async function requestFunctionLogin(key) {
  const headers = key ? { 'Authorization': `Bearer ${key}` } : {};
  const res = await fetch('/v1/function/verify', {
    method: 'GET',
    headers
  });
  return res.ok;
}

async function login() {
  const input = (functionKeyInput ? functionKeyInput.value : '').trim();
  try {
    const ok = await requestFunctionLogin(input);
    if (ok) {
      await storeFunctionKey(input);
      window.location.href = '/chat';
    } else {
      showToast(t('common.invalidKey'), 'error');
    }
  } catch (e) {
    showToast(t('common.connectionFailed'), 'error');
  }
}

function loginWithLinuxDo() {
  window.location.href = '/v1/function/oauth/linuxdo/login';
}

(async () => {
  // Handle OAuth callback token
  const params = new URLSearchParams(window.location.search);
  const oauthToken = params.get('oauth_token');
  if (oauthToken) {
    try {
      const ok = await requestFunctionLogin(oauthToken);
      if (ok) {
        await storeFunctionKey(oauthToken);
        window.history.replaceState({}, '', '/login');
        window.location.href = '/chat';
        return;
      } else {
        showToast(t('common.oauthFailed') || 'OAuth login failed', 'error');
        window.history.replaceState({}, '', '/login');
      }
    } catch (e) {
      showToast(t('common.oauthFailed') || 'OAuth verification failed', 'error');
      window.history.replaceState({}, '', '/login');
    }
  }

  // Check OAuth config and show/hide button
  try {
    const res = await fetch('/v1/function/oauth/config');
    if (res.ok) {
      const data = await res.json();
      if (data.linuxdo_enabled) {
        const section = document.getElementById('oauth-section');
        if (section) section.classList.remove('hidden');
      }
    }
  } catch (e) { /* ignore */ }

  // Auto-login with stored key
  try {
    const stored = await getStoredFunctionKey();
    if (stored) {
      const ok = await requestFunctionLogin(stored);
      if (ok) {
        window.location.href = '/chat';
        return;
      }
      clearStoredFunctionKey();
    }

    const ok = await requestFunctionLogin('');
    if (ok) {
      window.location.href = '/chat';
    }
  } catch (e) {
    return;
  }
})();
