  const form = document.getElementById('signup-form');
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

    const fullName = form.fullName.value.trim();
    const email = form.email.value.trim();
    const phone = form.phone.value.trim();
    const password = form.password.value;

    if (!email && !phone) {
      showError('Enter an email or a phone number.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating account…';

    try {
      const payload = { fullName, password };
      if (email) payload.email = email;
      if (phone) payload.phone = phone;

      const result = await AuthApi.register(payload);
      const purpose = email ? 'email_verify' : 'phone_verify';
      const params = new URLSearchParams({ userId: result.userId, purpose });
      window.location.href = `verify.html?${params.toString()}`;
    } catch (err) {
      showError(err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create account';
    }
  });
