  const form = document.getElementById('signin-form');
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
      const result = await AuthApi.login(payload);
      // Milestone-1 demo only: a real client stores the access token in
      // memory and the refresh token httpOnly, never in localStorage.
      sessionStorage.setItem('accessToken', result.accessToken);
      sessionStorage.setItem('refreshToken', result.refreshToken);
      alertBox.textContent = `Signed in as ${result.user.fullName}.`;
      alertBox.className = 'alert success';
      alertBox.hidden = false;
      submitBtn.textContent = 'Signed in';
    } catch (err) {
      showError(err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign in';
    }
  });
