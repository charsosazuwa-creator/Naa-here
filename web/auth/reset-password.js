  const form = document.getElementById('reset-form');
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
    submitBtn.textContent = 'Resetting…';

    const identifier = form.identifier.value.trim();
    const payload = {
      code: form.code.value.trim(),
      newPassword: form.newPassword.value,
    };
    if (identifier.includes('@')) payload.email = identifier;
    else payload.phone = identifier;

    try {
      await AuthApi.resetPassword(payload);
      alertBox.textContent = 'Password reset. Redirecting to sign in…';
      alertBox.className = 'alert success';
      alertBox.hidden = false;
      setTimeout(() => (window.location.href = 'signin.html'), 1200);
    } catch (err) {
      showError(err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Reset password';
    }
  });
