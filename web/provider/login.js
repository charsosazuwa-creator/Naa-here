  if (isSignedIn()) {
    window.location.href = 'index.html';
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

      // First sign-in after registering as a Service Provider (see
      // ../auth/signup-provider.js): the business couldn't be created
      // at registration time (no auth token yet), so it was stashed
      // here instead -- create it now that we have one. Cleared
      // either way so a later, unrelated sign-in never retries it.
      const pendingBusinessRaw = sessionStorage.getItem('pendingBusiness');
      if (pendingBusinessRaw) {
        sessionStorage.removeItem('pendingBusiness');
        sessionStorage.removeItem('pendingSignupType');
        try {
          const business = JSON.parse(pendingBusinessRaw);
          const tenant = await Api.createTenant(business);
          window.location.href = `index.html#/t/${tenant.id}/overview`;
          return;
        } catch (businessErr) {
          // Account creation still succeeded -- land on "Your
          // businesses" where the same details can be resubmitted via
          // the normal Create business form (AC17: don't block sign-in
          // on this failure, and don't hide it either).
          window.location.href = 'index.html';
          window.alert(
            `Signed in, but your business couldn't be created automatically (${businessErr.message}). Use "Create a new business" below to try again.`,
          );
          return;
        }
      }

      window.location.href = 'index.html';
    } catch (err) {
      showError(err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign in';
    }
  });
