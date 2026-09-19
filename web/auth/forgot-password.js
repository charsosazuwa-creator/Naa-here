  const form = document.getElementById('forgot-form');
  const alertBox = document.getElementById('alert');
  const submitBtn = document.getElementById('submit-btn');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    const identifier = form.identifier.value.trim();
    const payload = identifier.includes('@') ? { email: identifier } : { phone: identifier };

    try {
      const result = await AuthApi.forgotPassword(payload);
      alertBox.textContent = result.message;
      alertBox.className = 'alert success';
      alertBox.hidden = false;
    } catch (err) {
      alertBox.textContent = err.message;
      alertBox.className = 'alert error';
      alertBox.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send reset code';
    }
  });
