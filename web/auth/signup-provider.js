  const form = document.getElementById('signup-form');
  const alertBox = document.getElementById('alert');
  const submitBtn = document.getElementById('submit-btn');

  function showError(message) {
    alertBox.textContent = message;
    alertBox.className = 'alert error';
    alertBox.hidden = false;
  }

  // Business categories are an open, shared, growing list rather than
  // a fixed few options -- this datalist lets someone pick an
  // existing one or just type a new one. Unauthenticated at this
  // point (no account yet), so the list endpoint has to be public.
  AuthApi.listBusinessCategories()
    .then((categories) => {
      const datalist = document.getElementById('businessCategoryOptions');
      datalist.innerHTML = categories.map((c) => `<option value="${c.name}"></option>`).join('');
    })
    .catch(() => {
      // Non-fatal: the field still works as a plain free-text input.
    });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    alertBox.hidden = true;

    const fullName = form.fullName.value.trim();
    const email = form.email.value.trim();
    const phone = form.phone.value.trim();
    const password = form.password.value;
    const confirmPassword = form.confirmPassword.value;
    const businessName = form.businessName.value.trim();
    const businessType = form.businessType.value;
    const businessCategory = form.businessCategory.value.trim();
    const businessCountry = form.businessCountry.value;

    if (!email && !phone) {
      showError('Enter an email or a phone number.');
      return;
    }
    if (!businessName || !businessType || !businessCategory || !businessCountry) {
      showError('Business name, type, category and country are required.');
      return;
    }
    if (!form.terms.checked) {
      showError('You must agree to the Terms and Conditions to continue.');
      return;
    }
    if (password !== confirmPassword) {
      showError('Passwords do not match.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating account…';

    try {
      const payload = { fullName, password };
      if (email) payload.email = email;
      if (phone) payload.phone = phone;

      const result = await AuthApi.register(payload);

      // The account isn't signed in yet (still unverified), so the
      // business itself can't be created via POST /tenants until
      // after verify + first sign-in. Stash it here; provider/login.js
      // picks it up and calls Api.createTenant() right after a
      // successful first sign-in, then clears both keys either way.
      sessionStorage.setItem('pendingSignupType', 'provider');
      sessionStorage.setItem(
        'pendingBusiness',
        JSON.stringify({ name: businessName, businessType, categoryName: businessCategory, countryCode: businessCountry }),
      );

      const purpose = email ? 'email_verify' : 'phone_verify';
      const params = new URLSearchParams({ userId: result.userId, purpose });
      window.location.href = `verify.html?${params.toString()}`;
    } catch (err) {
      showError(err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create account';
    }
  });

  renderOAuthButtons('oauth-buttons', () => {
    alertBox.hidden = true;
    const businessName = form.businessName.value.trim();
    const businessType = form.businessType.value;
    const businessCategory = form.businessCategory.value.trim();
    const businessCountry = form.businessCountry.value;

    if (!businessName || !businessType || !businessCategory || !businessCountry) {
      showError('Business name, type, category and country are required.');
      return null;
    }
    if (!form.terms.checked) {
      showError('You must agree to the Terms and Conditions to continue.');
      return null;
    }
    return {
      role: 'provider',
      business: { name: businessName, businessType, categoryName: businessCategory, countryCode: businessCountry },
    };
  });
