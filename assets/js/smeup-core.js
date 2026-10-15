/*
 * SMEUp Core integration layer — the ONLY file that talks to SMEUp Core Services.
 * Update it centrally; contact-form.js, livechat.js and demo-cta.js only call window.SMEUP.
 *
 * Config: window.SMEUP_SITE (assets/js/site-config.js, generated) — public values only:
 *   apiBaseUrl  SMEUp Core Messenger host, e.g. https://process.smess.cloud
 *   clientId    SMEUp client UUID (who receives the leads)
 *   siteId      website identifier (Rebuild demos: the job's project_slug)
 *   demo        true on Rebuild demo sites
 *
 * Endpoints (public, no credentials):
 *   POST {apiBaseUrl}/v1/messenger/send            leads: contact_form, demo_contract_request, demo_cooperation_request
 *   POST {apiBaseUrl}/v1/messenger/website_events  standard visitor events (EVENTS below)
 */
(function (window, document) {
  'use strict';

  var config = window.SMEUP_SITE || {};
  var EVENTS = [
    'website_viewed',
    'contact_form_opened',
    'contact_form_submitted',
    'contact_form_failed',
    'livechat_opened',
    'livechat_started',
    'livechat_message_sent',
    'lead_created',
    'demo_cta_clicked',
    'contract_booking_started',
    'cooperation_requested'
  ];
  var LEAD_TYPES = ['contact_form', 'demo_contract_request', 'demo_cooperation_request'];
  var REQUEST_TIMEOUT_MS = 15000;

  var isLocalPreview = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  var isConfigured = Boolean(config.apiBaseUrl && config.clientId && config.siteId);

  function storage(name) {
    try {
      return window[name];
    } catch (e) {
      return null;
    }
  }

  function randomId() {
    if (window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  var sessionId = (function () {
    var store = storage('sessionStorage');
    var key = 'smeup_session_id';
    try {
      var existing = store && store.getItem(key);
      if (existing) {
        return existing;
      }
      var created = randomId();
      if (store) {
        store.setItem(key, created);
      }
      return created;
    } catch (e) {
      return randomId();
    }
  })();

  function endpoint(path) {
    return String(config.apiBaseUrl).replace(/\/+$/, '') + path;
  }

  function cleanProperties(properties) {
    var clean = {};
    var count = 0;
    Object.keys(properties || {}).forEach(function (key) {
      var value = properties[key];
      if (count >= 20 || !/^[a-z][a-z0-9_]{0,39}$/.test(key)) {
        return;
      }
      if (value === null || typeof value === 'boolean' || typeof value === 'number') {
        clean[key] = value;
      } else if (typeof value === 'string') {
        clean[key] = value.slice(0, 500);
      } else {
        return;
      }
      count += 1;
    });
    return clean;
  }

  function emitLocal(name, detail) {
    try {
      window.dispatchEvent(new CustomEvent('smeup:' + name, { detail: detail }));
    } catch (e) {
      /* old browsers: no CustomEvent constructor */
    }
  }

  /**
   * Sends one standard event. Fire-and-forget: never throws, never blocks the page.
   * Every event is also dispatched locally as `smeup:event` (hook for GA/Pixel, debugging).
   */
  function track(event, properties) {
    if (EVENTS.indexOf(event) === -1) {
      if (window.console) {
        console.warn('[smeup] unknown event', event);
      }
      return;
    }

    var payload = {
      client_id: config.clientId,
      site_id: config.siteId,
      event: event,
      session_id: sessionId,
      page_url: window.location.href.slice(0, 2048),
      referrer: document.referrer ? document.referrer.slice(0, 2048) : null,
      occurred_at: new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00'),
      demo: Boolean(config.demo),
      properties: cleanProperties(properties)
    };

    emitLocal('event', payload);

    if (!isConfigured) {
      if (isLocalPreview && window.console) {
        console.info('[smeup] event (not sent, preview mode)', payload);
      }
      return;
    }

    var url = endpoint('/v1/messenger/website_events');
    var body = JSON.stringify(payload);

    // text/plain keeps it a "simple" CORS request: no preflight, works from sendBeacon on unload.
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))) {
        return;
      }
    } catch (e) {
      /* fall through to fetch */
    }

    if (window.fetch) {
      window.fetch(url, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        keepalive: true,
        headers: { 'Content-Type': 'text/plain' },
        body: body
      }).catch(function () {});
    }
  }

  /**
   * Creates a lead in SMEUp Core (Messenger). Resolves with the created message {id, ...}.
   * Rejects with Error whose `code` is one of: not_configured, network, timeout, http_<status>.
   */
  function submitLead(type, fields) {
    if (LEAD_TYPES.indexOf(type) === -1) {
      return Promise.reject(Object.assign(new Error('Unknown lead type'), { code: 'invalid_type' }));
    }

    if (!isConfigured) {
      if (isLocalPreview) {
        // Local preview without SMEUp config: simulate the round trip so states can be checked.
        if (window.console) {
          console.info('[smeup] lead (not sent, preview mode)', type, fields);
        }
        return new Promise(function (resolve, reject) {
          window.setTimeout(function () {
            if (/fail/i.test(fields.message || '')) {
              reject(Object.assign(new Error('Simulated failure'), { code: 'http_500' }));
            } else {
              resolve({ id: 'preview-' + randomId(), type: type });
            }
          }, 800);
        });
      }
      return Promise.reject(Object.assign(new Error('SMEUp is not configured'), { code: 'not_configured' }));
    }

    var payload = {
      client_id: config.clientId,
      site_id: config.siteId,
      type: type,
      from_name: fields.name,
      from_email: fields.email || null,
      from_phone_number: fields.phone || null,
      subject: fields.subject,
      message: fields.message
    };

    var controller = window.AbortController ? new AbortController() : null;
    var timer = controller ? window.setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS) : null;

    return window.fetch(endpoint('/v1/messenger/send'), {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      if (timer) {
        window.clearTimeout(timer);
      }
      if (!response.ok) {
        throw Object.assign(new Error('HTTP ' + response.status), { code: 'http_' + response.status });
      }
      return response.json().then(function (json) {
        return (json && json.data) || {};
      });
    }, function (error) {
      if (timer) {
        window.clearTimeout(timer);
      }
      var code = error && error.name === 'AbortError' ? 'timeout' : 'network';
      throw Object.assign(new Error(code), { code: code });
    });
  }

  function label(key, fallback) {
    return (config.labels && config.labels[key]) || fallback || key;
  }

  window.SMEUP = {
    config: config,
    EVENTS: EVENTS,
    sessionId: sessionId,
    isConfigured: isConfigured,
    track: track,
    submitLead: submitLead,
    label: label
  };

  if (!isConfigured && !isLocalPreview && window.console) {
    console.warn('[smeup] site-config.js is missing apiBaseUrl, clientId or siteId: leads and events are disabled.');
  }

  track('website_viewed', { title: document.title.slice(0, 200), path: window.location.pathname.slice(0, 200) });
})(window, document);
