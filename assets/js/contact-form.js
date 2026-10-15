/*
 * Lead forms (contact form + demo CTA dialogs) → SMEUp Core via window.SMEUP.submitLead.
 * Markup: <form data-smeup-form="{lead type}" data-message-required="true|false"> with fields
 * name, email, phone, message, the hidden honeypot "website" and a [data-form-status] live region.
 * States on the form: data-state = idle | loading | success | error.
 */
(function (window, document) {
  'use strict';

  var SMEUP = window.SMEUP;
  if (!SMEUP) {
    return;
  }

  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var PHONE = /^\+?[0-9 ().-]{8,20}$/;
  var RESUBMIT_COOLDOWN_MS = 10000;

  var SUBJECT_KEYS = {
    contact_form: 'form_contact_subject',
    demo_contract_request: 'cta_contract_subject',
    demo_cooperation_request: 'cta_cooperation_subject'
  };

  function value(form, name) {
    var field = form.elements.namedItem(name);
    return field ? String(field.value || '').trim() : '';
  }

  function setState(form, state, message) {
    form.setAttribute('data-state', state);
    form.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');

    var status = form.querySelector('[data-form-status]');
    if (status) {
      status.textContent = message || '';
    }

    var button = form.querySelector('[type="submit"]');
    if (button) {
      button.disabled = state === 'loading' || state === 'success';
      button.textContent = state === 'loading' ? SMEUP.label('form_sending') : button.getAttribute('data-label');
    }
  }

  function markInvalid(form, names) {
    ['name', 'email', 'phone', 'message'].forEach(function (name) {
      var field = form.elements.namedItem(name);
      if (field) {
        field.setAttribute('aria-invalid', names.indexOf(name) === -1 ? 'false' : 'true');
      }
    });
    var first = names.length ? form.elements.namedItem(names[0]) : null;
    if (first && first.focus) {
      first.focus();
    }
  }

  function validate(form, fields) {
    var invalid = [];
    if (!fields.name) {
      invalid.push('name');
    }
    if (fields.email && !EMAIL.test(fields.email)) {
      invalid.push('email');
    }
    if (fields.phone && !PHONE.test(fields.phone)) {
      invalid.push('phone');
    }
    if (!fields.email && !fields.phone) {
      invalid.push('phone', 'email');
    }
    if (form.getAttribute('data-message-required') === 'true' && !fields.message) {
      invalid.push('message');
    }
    return invalid;
  }

  /**
   * Wires one lead form. options.onSuccess(lead, fields) runs after a confirmed submission.
   */
  function bindForm(form, options) {
    options = options || {};
    var type = form.getAttribute('data-smeup-form');
    var submitting = false;
    var lastSuccessAt = 0;

    setState(form, 'idle');

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      // Duplicate-submission guard: one request at a time, short cooldown after success.
      if (submitting || Date.now() - lastSuccessAt < RESUBMIT_COOLDOWN_MS) {
        return;
      }

      var fields = {
        name: value(form, 'name'),
        email: value(form, 'email'),
        phone: value(form, 'phone'),
        message: value(form, 'message')
      };

      // Honeypot filled → a bot: pretend success, send nothing.
      if (value(form, 'website')) {
        setState(form, 'success', SMEUP.label(type === 'contact_form' ? 'form_success' : 'cta_success'));
        return;
      }

      var invalid = validate(form, fields);
      if (invalid.length) {
        markInvalid(form, invalid);
        setState(form, 'error', SMEUP.label('form_invalid'));
        return;
      }
      markInvalid(form, []);

      fields.subject = SMEUP.label(SUBJECT_KEYS[type]) + (SMEUP.config.businessName ? ' – ' + SMEUP.config.businessName : '');
      if (!fields.message) {
        fields.message = '—';
      }

      if (type === 'contact_form') {
        SMEUP.track('contact_form_submitted', { form: type });
      }

      submitting = true;
      setState(form, 'loading', SMEUP.label('form_sending'));

      SMEUP.submitLead(type, fields).then(function (lead) {
        submitting = false;
        lastSuccessAt = Date.now();
        setState(form, 'success', SMEUP.label(type === 'contact_form' ? 'form_success' : 'cta_success'));
        form.reset();
        SMEUP.track('lead_created', { form: type, lead_id: lead && lead.id ? String(lead.id) : null });
        if (options.onSuccess) {
          options.onSuccess(lead, fields);
        }
        window.setTimeout(function () {
          if (form.getAttribute('data-state') === 'success') {
            var button = form.querySelector('[type="submit"]');
            if (button) {
              button.disabled = false;
            }
          }
        }, RESUBMIT_COOLDOWN_MS);
      }, function (error) {
        submitting = false;
        setState(form, 'error', SMEUP.label('form_error'));
        if (type === 'contact_form') {
          SMEUP.track('contact_form_failed', { form: type, reason: (error && error.code) || 'unknown' });
        }
        if (options.onError) {
          options.onError(error, fields);
        }
      });
    });
  }

  SMEUP.bindForm = bindForm;

  var contactForm = document.querySelector('form[data-smeup-form="contact_form"]');
  if (contactForm) {
    var opened = false;
    contactForm.addEventListener('focusin', function () {
      if (!opened) {
        opened = true;
        SMEUP.track('contact_form_opened', { form: 'contact_form' });
      }
    });
    bindForm(contactForm);
  }
})(window, document);
