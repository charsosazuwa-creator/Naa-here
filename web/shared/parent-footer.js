/*
 * "Naa here is a CLOUD MEDIA LTD company" line, added to the bottom of every page that loads this script.
 * Change PARENT_URL once cloudmedialtd.com points at the Cloud Media portal.
 */
(function () {
  var PARENT_URL = "https://cloudmedia-portal.onrender.com";
  function add() {
    if (document.querySelector(".parent-line")) return;
    var f = document.createElement("footer");
    f.className = "parent-line";
    var lead = document.createTextNode("Naa here is a ");
    var co = document.createElement("a");
    co.href = PARENT_URL + "/about"; co.textContent = "CLOUD MEDIA LTD"; co.target = "_blank"; co.rel = "noopener";
    var mid = document.createTextNode(" company · ");
    var apps = document.createElement("a");
    apps.href = PARENT_URL + "/apps"; apps.textContent = "Our apps"; apps.target = "_blank"; apps.rel = "noopener";
    var copy = document.createTextNode(" · © " + new Date().getFullYear() + " CLOUD MEDIA LTD");
    f.append(lead, co, mid, apps, copy);
    document.body.appendChild(f);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add); else add();
})();
