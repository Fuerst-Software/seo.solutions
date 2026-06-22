/**
 * seo.solutions Embed Script
 * Loads AI-generated content for all data-seo-zone elements on the page.
 * This script is served by the backend and injected into external websites.
 */
(function () {
  'use strict';

  var API_KEY = '__API_KEY__';
  var API_BASE = 'https://api.seo.solutions';
  var RETRY_DELAY = 2000;
  var MAX_RETRIES = 3;

  function getEndpoint() {
    return API_BASE + '/v1/content/' + API_KEY;
  }

  function fetchZones(retries) {
    retries = retries || 0;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', getEndpoint(), true);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          applyZones(data.zones || {});
        } catch (e) {
          console.warn('[seo.solutions] Invalid response:', e);
        }
      } else if (retries < MAX_RETRIES) {
        setTimeout(function () { fetchZones(retries + 1); }, RETRY_DELAY);
      }
    };
    xhr.send();
  }

  function applyZones(zones) {
    var elements = document.querySelectorAll('[data-seo-zone]');
    elements.forEach(function (el) {
      var zoneId = el.getAttribute('data-seo-zone');
      var zone = zones[zoneId];
      if (!zone || !zone.content) return;

      switch (zone.type) {
        case 'headline':
        case 'text':
          el.textContent = zone.content;
          break;
        case 'meta':
          el.setAttribute('content', zone.content);
          break;
        case 'alt':
          el.setAttribute('alt', zone.content);
          break;
        case 'title':
          document.title = zone.content;
          break;
        default:
          el.textContent = zone.content;
      }

      el.setAttribute('data-seo-updated', new Date().toISOString());
    });

    // Update <title> tag if a title zone exists in the document head
    var titleMeta = document.querySelector('meta[data-seo-zone]');
    if (titleMeta) {
      var titleZoneId = titleMeta.getAttribute('data-seo-zone');
      if (zones[titleZoneId]) {
        titleMeta.setAttribute('content', zones[titleZoneId].content);
      }
    }
  }

  // Start after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fetchZones);
  } else {
    fetchZones();
  }
})();
