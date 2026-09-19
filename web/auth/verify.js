  const params = new URLSearchParams(window.location.search);
  const userId = params.get('userId');
  const purpose = params.get('purpose') || 'email_verify';

  const form = document.getElementById('verify-form');
  const alertBox = document.getElementById('alert');
  const submitBtn = document.getElementById('submit-btn');
  const resendLink = document.getElementById('resend-link');

  if (!userId) {
    document.getElementById('subtitle').textContent = 'Missing account reference — go back and sign up again.';
  }

  function showError(message) {
    alertBox.textContent = message;
    alertBox.className = 'alert error';
    alertBox.hidden = false;
  }
  function showSuccess(message) {
    alertBox.textContent = message;
    alertBox.className = 'alert success';
    alertBox.hidden = false;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    alertBox.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Verifying…';

    try {
      await AuthApi.verify({ userId, purpose, code: form.code.value.trim() });
      showSuccess('Verified! Redirecting to sign in…');
      setTimeout(() => (window.location.href = 'signin.html'), 1200);
    } catch (err) {
      showError(err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Verify';
    }
  });

  resendLink.addEventListener('click', async (event) => {
    event.preventDefault();
    alertBox.hidden = true;
    try {
      await AuthApi.resendVerification({ userId, purpose });
      showSuccess('A new code has been sent (check the API server log).');
    } catch (err) {
      showError(err.message);
    }
  });
