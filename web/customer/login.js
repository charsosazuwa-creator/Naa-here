  if (isSignedIn()) {
    window.location.href = 'index.html';
  }

  function nextUrl() {
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next');
    return next ? `index.html${next}` : 'index.html';
  }

  const form = document.getElementById('login-form');
  const alertBox = document.getElementById('alert');
  const submitBtn = document.getElementById('submit-btn');

  function showError(message) {
    alertBox.textContent = message;
    alertBox.className = 'alert error';
    alertBox.hidden = false;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    alertBox.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';

    const identifier = form.identifier.value.trim();
    const payload = { password: form.password.value };
    if (identifier.includes('@')) payload.email = identifier;
    else payload.phone = identifier;

    try {
      const result = await Api.login(payload);
      setSession({ accessToken: result.accessToken, refreshToken: result.refreshToken, user: result.user });
      window.location.href = nextUrl();
    } catch (err) {
      showError(err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign in';
    }
  });
