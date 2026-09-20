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

      // Route into the right app's own sign-in page, per the account
      // type chosen back on signup.html (see signup-provider.js /
      // signup-customer.js) -- each app keeps its own signed-in
      // session, so verifying here doesn't sign anyone in anywhere.
      const pendingType = sessionStorage.getItem('pendingSignupType');
      const destination =
        pendingType === 'provider' ? '../provider/login.html'
        : pendingType === 'customer' ? '../customer/login.html'
        : 'signin.html';

      showSuccess('Verified! Redirecting to sign in…');
      setTimeout(() => (window.location.href = destination), 1200);
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
      showSuccess('A new code has been sent to your email or phone.');
    } catch (err) {
      showError(err.message);
    }
  });
