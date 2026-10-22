// Unity Dispatch — site behaviour. No dependencies; loaded with `defer`.
// Handles entrance animations, smooth in-page navigation, the mobile menu,
// the back-to-top button, the contact form and the chat widget.
(() => {
  'use strict';

  const root = document.documentElement;
  const isPhone = window.matchMedia('(max-width: 767.98px)');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const CONTACT_ENDPOINT = '/api/contact';
  const FALLBACK_EMAIL = 'info@unitydispatch.net';

  /* ---------- entrance animations: play once when an element enters the viewport ---------- */
  function initReveal() {
    const items = document.querySelectorAll('.fade, .fade-d, .fade-m, .float-d');
    if (!('IntersectionObserver' in window) || reduceMotion.matches) {
      items.forEach((el) => el.classList.add('is-in'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    });
    items.forEach((el) => io.observe(el));
  }

  /* ---------- smooth scrolling ---------- */
  let cancelScroll = null;

  function animateScroll(to) {
    if (cancelScroll) cancelScroll();
    const from = window.scrollY;
    const distance = to - from;
    if (!distance) return;
    if (reduceMotion.matches) {
      window.scrollTo(0, to);
      return;
    }
    const duration = Math.min(1600, 1000 + Math.abs(distance) * 0.25);
    const start = performance.now();
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
    let frame;
    const stop = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchstart', stop);
      cancelScroll = null;
    };
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      window.scrollTo(0, from + distance * ease(t));
      if (t < 1) frame = requestAnimationFrame(step);
      else stop();
    };
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchstart', stop, { passive: true });
    cancelScroll = stop;
    frame = requestAnimationFrame(step);
  }

  function scrollTargetY(el) {
    const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
    const y = el.getBoundingClientRect().top + window.scrollY - margin;
    return Math.max(0, Math.min(y, root.scrollHeight - window.innerHeight));
  }

  // Nav links carry data-nav (target id) and optionally data-nav-mobile, because
  // the original sends "About Us" to a different section on phones.
  function navTarget(link) {
    const id = (isPhone.matches && link.dataset.navMobile) || link.dataset.nav;
    return id && document.getElementById(id);
  }

  function initNav() {
    const onHome = document.body.classList.contains('page-home');
    document.addEventListener('click', (event) => {
      const link = event.target.closest('a[data-nav]');
      if (!link || !onHome || event.defaultPrevented) return;
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = navTarget(link);
      if (!target) return;
      event.preventDefault();
      closeMenu(false);
      // Like the original, scroll without adding a #fragment to the address bar.
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
      animateScroll(scrollTargetY(target));
    });

    // Arriving from another page via /#section: honour the phone-specific target.
    if (onHome && location.hash) {
      const link = document.querySelector(`a[data-nav="${CSS.escape(location.hash.slice(1))}"]`);
      const target = link && navTarget(link);
      if (target) {
        window.addEventListener('load', () => window.scrollTo(0, scrollTargetY(target)), { once: true });
      }
    }
  }

  /* ---------- mobile menu ---------- */
  const toggle = document.querySelector('.menu-toggle');
  const menu = document.getElementById('mobile-menu');
  let menuTimer;

  function openMenu() {
    clearTimeout(menuTimer);
    menu.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => menu.classList.add('is-open')));
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Close site navigation');
    root.classList.add('menu-open');
  }

  function closeMenu(returnFocus = true) {
    if (!toggle || toggle.getAttribute('aria-expanded') !== 'true') return;
    menu.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open site navigation');
    root.classList.remove('menu-open');
    menuTimer = setTimeout(() => { menu.hidden = true; }, reduceMotion.matches ? 0 : 500);
    if (returnFocus) toggle.focus();
  }

  function initMenu() {
    if (!toggle || !menu) return;
    toggle.addEventListener('click', () => {
      if (toggle.getAttribute('aria-expanded') === 'true') closeMenu();
      else openMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeMenu();
    });
    isPhone.addEventListener('change', () => closeMenu(false));
  }

  /* ---------- back to top (phones) ---------- */
  function initBackToTop() {
    const button = document.querySelector('.back-to-top');
    if (!button) return;
    const update = () => { button.hidden = window.scrollY < window.innerHeight * 0.5; };
    window.addEventListener('scroll', update, { passive: true });
    update();
    button.addEventListener('click', () => {
      animateScroll(0);
      document.getElementById('main').focus({ preventScroll: true });
    });
  }

  /* ---------- contact form ---------- */
  // ISO 3166 code + international dialling code.
  const COUNTRIES = 'AD376,AE971,AF93,AG1,AI1,AL355,AM374,AO244,AQ672,AR54,AS1684,AT43,AU61,AW297,AX358,AZ994,BA387,BB1246,BD880,BE32,BF226,BG359,BH973,BI257,BJ229,BL590,BM1,BN673,BO591,BQ599,BR55,BS1,BT975,BV47,BW267,BY375,BZ501,CA1,CC61,CD243,CF236,CG242,CH41,CI225,CK682,CL56,CM237,CN86,CO57,CR506,CU53,CV238,CW599,CX61,CY357,CZ420,DE49,DJ253,DK45,DM1,DO1,DZ213,EC593,EE372,EG20,EH212,ER291,ES34,ET251,FI358,FJ679,FK500,FM691,FO298,FR33,GA241,GB44,GD1,GE995,GF594,GG44,GH233,GI350,GL299,GM220,GN224,GP590,GQ240,GR30,GS500,GT502,GU1,GW245,GY592,HK852,HM672,HN504,HR385,HT509,HU36,ID62,IE353,IL972,IM44,IN91,IO246,IQ964,IR98,IS354,IT39,JE44,JM1876,JO962,JP81,KE254,KG996,KH855,KI686,KM269,KN1,KP850,KR82,KW965,KY1,KZ7,LA856,LB961,LC1,LI423,LK94,LR231,LS266,LT370,LU352,LV371,LY218,MA212,MC377,MD373,ME382,MF590,MG261,MH692,MK389,ML223,MM95,MN976,MO853,MP1670,MQ596,MR222,MS1,MT356,MU230,MV960,MW265,MX52,MY60,MZ258,NA264,NC687,NE227,NF672,NG234,NI505,NL31,NO47,NP977,NR674,NU683,NZ64,OM968,PA507,PE51,PF689,PG675,PH63,PK92,PL48,PM508,PN64,PR1,PS970,PT351,PW680,PY595,QA974,RE262,RO40,RS381,RU7,RW250,SA966,SB677,SC248,SD249,SE46,SG65,SH290,SI386,SJ47,SK421,SL232,SM378,SN221,SO252,SR597,SS211,ST239,SV503,SX1721,SY963,SZ268,TC1,TD235,TF262,TG228,TH66,TJ992,TK690,TL670,TM993,TN216,TO676,TR90,TT1868,TV688,TW886,TZ255,UA380,UG256,UM1,US1,UY598,UZ998,VA39,VC1,VE58,VG1,VI1,VN84,VU678,WF681,WS685,XK383,YE967,YT262,ZA27,ZM260,ZW263';

  const ERROR_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor"/><path d="M8 4.75v4.5M8 10.75v.5" stroke="currentColor" stroke-linecap="round"/></svg>';
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function countries() {
    const names = 'DisplayNames' in Intl ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
    return COUNTRIES.split(',')
      .map((entry) => {
        const code = entry.slice(0, 2);
        let name = code;
        try { name = (names && names.of(code)) || code; } catch { /* unknown region */ }
        return { code, dial: entry.slice(2), name };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const flagEmoji = (code) => String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0)));

  function initCountrySelect(form) {
    const select = form.querySelector('.country__select');
    if (!select) return;
    const flag = form.querySelector('.country__flag');
    const globe = flag.innerHTML;
    const list = countries();
    for (const c of list) select.add(new Option(`${c.name} +${c.dial}`, c.code));
    const sync = () => {
      const c = list.find((x) => x.code === select.value);
      if (c) flag.textContent = flagEmoji(c.code);
      else flag.innerHTML = globe;
      select.dataset.dial = c ? c.dial : '';
    };
    select.addEventListener('change', sync);
    form.addEventListener('reset', () => setTimeout(sync));
  }

  function clearError(field) {
    field.classList.remove('is-invalid');
    const input = field.querySelector('input');
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
    const msg = field.querySelector('.field__error');
    if (msg) msg.remove();
  }

  function showError(field, message) {
    clearError(field);
    const input = field.querySelector('input');
    const msg = document.createElement('p');
    msg.className = 'field__error';
    msg.id = `${input.id}-error`;
    msg.innerHTML = `${ERROR_ICON}<span></span>`;
    msg.querySelector('span').textContent = message;
    field.append(msg);
    field.classList.add('is-invalid');
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', msg.id);
  }

  // Mirrors the original form: on submit, the first problem is reported and focused.
  function validate(form) {
    for (const field of form.querySelectorAll('.field')) clearError(field);
    for (const field of form.querySelectorAll('.field')) {
      const input = field.querySelector('input');
      const value = input.value.trim();
      let message = '';
      if (input.required && !value) message = field.dataset.error;
      else if (input.type === 'email' && value && !EMAIL_RE.test(value)) message = field.dataset.errorFormat;
      else if (input.type === 'tel' && value && !/^[0-9 ()+.-]{4,}$/.test(value)) message = field.dataset.errorFormat;
      if (message) {
        showError(field, message);
        input.focus();
        return false;
      }
    }
    return true;
  }

  async function postContact(payload) {
    const response = await fetch(CONTACT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }

  function initContactForm() {
    const form = document.querySelector('.contact-form');
    if (!form) return;
    const status = form.querySelector('.form-status');
    const submit = form.querySelector('[type="submit"]');
    let statusTimer;
    initCountrySelect(form);

    form.addEventListener('input', (event) => {
      const field = event.target.closest('.field');
      if (field && field.classList.contains('is-invalid')) clearError(field);
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearTimeout(statusTimer);
      status.textContent = '';
      status.classList.remove('is-error');
      if (!validate(form)) return;

      const data = Object.fromEntries(new FormData(form));
      const select = form.querySelector('.country__select');
      const payload = {
        source: 'contact-form',
        page: location.pathname,
        firstName: data.firstName.trim(),
        lastName: (data.lastName || '').trim(),
        email: data.email.trim(),
        phone: data.phone ? `${select && select.dataset.dial ? `+${select.dataset.dial} ` : ''}${data.phone.trim()}` : '',
        company: (data.company || '').trim(),
        message: data.message.trim(),
        website: data.website || '',
      };

      submit.setAttribute('aria-busy', 'true');
      submit.disabled = true;
      try {
        await postContact(payload);
        form.reset();
        status.textContent = form.dataset.success;
        statusTimer = setTimeout(() => { status.textContent = ''; }, 8000);
      } catch {
        status.classList.add('is-error');
        status.innerHTML = `Sorry, your message could not be sent. Please email <a href="mailto:${FALLBACK_EMAIL}">${FALLBACK_EMAIL}</a>.`;
      } finally {
        submit.removeAttribute('aria-busy');
        submit.disabled = false;
      }
    });
  }

  /* ---------- chat widget ---------- */
  function initChat() {
    const chat = document.querySelector('[data-chat]');
    if (!chat) return;
    const launcher = chat.querySelector('.chat__launcher');
    const panel = chat.querySelector('.chat__panel');
    const log = chat.querySelector('.chat__log');
    const compose = chat.querySelector('.chat__compose');
    const textarea = compose.querySelector('textarea');
    const details = chat.querySelector('.chat__details');
    const STORE = 'ud-chat';

    let state = { messages: [], contact: null, pending: [] };
    try { state = { ...state, ...JSON.parse(sessionStorage.getItem(STORE) || '{}') }; } catch { /* storage unavailable */ }
    const save = () => { try { sessionStorage.setItem(STORE, JSON.stringify(state)); } catch { /* ignore */ } };

    const render = (msg) => {
      const el = document.createElement('p');
      el.className = `chat__msg chat__msg--${msg.from}`;
      el.textContent = msg.text;
      log.append(el);
      log.scrollTop = log.scrollHeight;
    };
    const say = (from, text) => { const msg = { from, text }; state.messages.push(msg); save(); render(msg); };
    state.messages.forEach(render);

    const open = () => {
      panel.hidden = false;
      launcher.hidden = true;
      launcher.setAttribute('aria-expanded', 'true');
      details.hidden = !(state.pending.length && !state.contact);
      textarea.focus();
    };
    const close = () => {
      panel.hidden = true;
      launcher.hidden = false;
      launcher.setAttribute('aria-expanded', 'false');
      launcher.focus();
    };
    launcher.addEventListener('click', open);
    chat.querySelector('.chat__close').addEventListener('click', close);
    panel.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });

    const send = async () => {
      const text = state.pending.join('\n');
      try {
        await postContact({ source: 'chat', page: location.pathname, name: state.contact.name, email: state.contact.email, message: text });
        state.pending = [];
        save();
        say('them', 'Thanks! We received your message and will get back to you soon.');
      } catch {
        say('them', `Sorry, your message could not be sent. Please email ${FALLBACK_EMAIL}.`);
      }
    };

    const autosize = () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 96)}px`;
    };
    textarea.addEventListener('input', autosize);
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        compose.requestSubmit();
      }
    });

    compose.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = textarea.value.trim();
      if (!text) return;
      textarea.value = '';
      autosize();
      say('me', text);
      state.pending.push(text);
      save();
      if (state.contact) {
        send();
      } else if (details.hidden) {
        details.hidden = false;
        details.querySelector('input[name="name"]').focus();
      }
    });

    details.addEventListener('submit', (event) => {
      event.preventDefault();
      const email = details.elements.email.value.trim();
      if (!EMAIL_RE.test(email)) {
        details.elements.email.setAttribute('aria-invalid', 'true');
        details.elements.email.focus();
        return;
      }
      details.elements.email.removeAttribute('aria-invalid');
      state.contact = { name: details.elements.name.value.trim(), email };
      save();
      details.hidden = true;
      send();
      textarea.focus();
    });
  }

  initReveal();
  initNav();
  initMenu();
  initBackToTop();
  initContactForm();
  initChat();
})();
