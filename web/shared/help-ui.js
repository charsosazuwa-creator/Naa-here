/**
 * Shared "Help" searchable help center, used by BOTH
 * web/customer/app.js and web/provider/app.js. Each host app supplies
 * its own list of topics (see web/customer/help-content.js and
 * web/provider/help-content.js) and its own basePath for the article
 * links (customer: "#/help"; provider: tenant-scoped
 * "#/t/<tenantId>/help"), since routing shapes differ between the two
 * apps (see each app's parseRoute()).
 *
 * Deliberately self-contained (own escapeHtml, no dependency on the
 * host app's globals) so load order doesn't matter, same pattern as
 * web/shared/listing-ui.js and web/shared/dispute-ui.js.
 */
(function () {
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Plain-text version of an article's body, for search matching (its `body` is a small HTML string). */
  function textOf(html) {
    return String(html ?? '').replace(/<[^>]+>/g, ' ');
  }

  function searchableText(topic) {
    return [topic.title, topic.category, ...(topic.keywords ?? []), textOf(topic.body)]
      .join(' ')
      .toLowerCase();
  }

  function categoryOrder(topics) {
    const seen = [];
    topics.forEach((t) => {
      if (!seen.includes(t.category)) seen.push(t.category);
    });
    return seen;
  }

  function renderIndex(topics, basePath) {
    const categories = categoryOrder(topics);

    const body = `
      <h1 class="page-title">Help</h1>
      <div class="field help-search-field">
        <label for="help-search">Search help articles</label>
        <input id="help-search" type="search" placeholder="e.g. booking, messages, verification..." autocomplete="off" />
      </div>
      <p id="help-no-results" class="empty-state" hidden>No help articles match "<span id="help-no-results-query"></span>".</p>
      <div id="help-categories">
        ${categories
          .map(
            (category) => `
          <section class="help-category" data-help-category>
            <h2>${escapeHtml(category)}</h2>
            <ul class="help-list">
              ${topics
                .filter((t) => t.category === category)
                .map(
                  (t) => `
                <li data-help-item data-help-text="${escapeHtml(searchableText(t))}">
                  <a href="${basePath}/${encodeURIComponent(t.id)}">${escapeHtml(t.title)}</a>
                  ${t.summary ? `<p class="help-summary">${escapeHtml(t.summary)}</p>` : ''}
                </li>`,
                )
                .join('')}
            </ul>
          </section>`,
          )
          .join('')}
      </div>
    `;

    const after = () => {
      const input = document.getElementById('help-search');
      const noResults = document.getElementById('help-no-results');
      const noResultsQuery = document.getElementById('help-no-results-query');

      input.addEventListener('input', () => {
        const query = input.value.trim().toLowerCase();
        let anyVisible = false;

        document.querySelectorAll('[data-help-category]').forEach((section) => {
          let categoryHasMatch = false;
          section.querySelectorAll('[data-help-item]').forEach((item) => {
            const matches = !query || item.dataset.helpText.includes(query);
            item.hidden = !matches;
            if (matches) categoryHasMatch = true;
          });
          section.hidden = !categoryHasMatch;
          if (categoryHasMatch) anyVisible = true;
        });

        noResults.hidden = anyVisible || !query;
        noResultsQuery.textContent = input.value.trim();
      });

      input.focus();
    };

    return { title: 'Help', body, after };
  }

  function renderArticle(topics, basePath, articleId) {
    const topic = topics.find((t) => t.id === articleId);

    if (!topic) {
      const body = `
        <a class="back-link" href="${basePath}">&larr; Back to Help</a>
        <div class="alert error" role="alert">That help article couldn't be found.</div>
      `;
      return { title: 'Help', body };
    }

    const related = topics.filter((t) => t.category === topic.category && t.id !== topic.id);

    const body = `
      <a class="back-link" href="${basePath}">&larr; Back to Help</a>
      <div class="help-breadcrumb">${escapeHtml(topic.category)}</div>
      <h1 class="page-title">${escapeHtml(topic.title)}</h1>
      <div class="help-article-body">${topic.body}</div>
      ${
        related.length > 0
          ? `
        <h2 class="help-related-heading">More in ${escapeHtml(topic.category)}</h2>
        <ul class="help-list">
          ${related.map((t) => `<li><a href="${basePath}/${encodeURIComponent(t.id)}">${escapeHtml(t.title)}</a></li>`).join('')}
        </ul>`
          : ''
      }
    `;

    return { title: topic.title, body };
  }

  /**
   * `routeParams` is whatever the host app's router hands a view
   * function as its route segments beyond "help" itself; routeParams[0],
   * if present, is the article id.
   */
  function render(topics, routeParams, { basePath }) {
    const articleId = routeParams && routeParams[0];
    return articleId ? renderArticle(topics, basePath, articleId) : renderIndex(topics, basePath);
  }

  window.HelpUI = { render };
})();
