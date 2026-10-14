/** CLOUD MEDIA account on the general sign-in page (an external file: the API's Content-Security-Policy blocks inline scripts). */
(function () {
  if (new URLSearchParams(location.search).get('signedout')) {
    var a = document.getElementById('alert');
    a.textContent = "You've been signed out of Naa here and your CLOUD MEDIA account.";
    a.className = 'alert success';
    a.hidden = false;
  }
  window.NaaSSO.upgradeAuthPage(document.getElementById('oauth-buttons'), function () { return { role: 'customer' }; })
    .then(function (on) { if (on) document.getElementById('provider-link').hidden = false; });
})();
