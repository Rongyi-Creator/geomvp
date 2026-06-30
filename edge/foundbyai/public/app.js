/* Found by AI — landing page controller.
 * Vanilla-JS port of the Claude Design DC prototype (sage palette only).
 * ponytail: single-page controller, no framework. Accent is fixed to sage
 * (the prototype's other palettes were design-tool props, never shipped). */
(function () {
  'use strict';

  var PAL = { accent: '#587B66', strong: '#456250', soft: '#EAF0EC', tint: '#F1F5F2', bright: '#86AD94' };
  var $ = function (s, r) { return (r || document).querySelector(s); };

  var form = $('#fbai-form');
  var input = $('#fbai-input');
  var feedback = $('#hero-feedback');
  var navEl = $('#nav');
  var heroEl = $('#hero');

  var state = { phase: 'idle', result: null, loadingStep: 0, showError: false, platform: '', waitDone: false, startDone: false, startEmail: '' };
  var timers = [];
  var autoRetried = false;
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }

  /* ---------- hover helper (inline styles win over CSS :hover) ---------- */
  function hover(el, on, off) {
    if (!el) return;
    el.addEventListener('mouseenter', function () { Object.assign(el.style, on); });
    el.addEventListener('mouseleave', function () { Object.assign(el.style, off); });
  }

  /* ---------- typewriter ---------- */
  var words = ['akupunktør', 'kiropraktor', 'psykolog', 'fysioterapeut'];
  var twIndex = 0, twEl = $('#tw-word');
  setInterval(function () {
    twIndex = (twIndex + 1) % words.length;
    if (twEl) twEl.textContent = words[twIndex];
  }, 2800);

  /* ---------- FAQ ---------- */
  var faqs = [
    { q: 'Ændrer I noget på min hjemmeside?', a: 'Nej. Vi tilføjer et usynligt datalag mellem din hjemmeside og internettet. Din hjemmeside ser ud og virker præcis som før for alle besøgende.' },
    { q: 'Hvad er et "AI-læsbart lag"?', a: 'Det er strukturerede data (JSON-LD) som fortæller ChatGPT, Perplexity og Google AI hvad din klinik hedder, hvor den ligger, hvad I tilbyder, og hvornår I har åbent — i et format de kan forstå.' },
    { q: 'Hvad sker der hvis jeg opsiger?', a: 'Dit AI-lag deaktiveres. Din hjemmeside vender tilbage til præcis den tilstand den var i før. Ingen data slettes uden din tilladelse.' },
    { q: 'Virker det med min hjemmeside?', a: 'Vi understøtter one.com, WordPress og de fleste standard hostingplatforme. Indtast din URL ovenfor for at tjekke kompatibilitet.' },
    { q: 'Garanterer I at ChatGPT anbefaler mig?', a: 'Vi optimerer din hjemmesides tekniske læsbarhed for AI-modeller — og giver dig dermed den bedst mulige chance for at blive anbefalet. Anbefalinger afhænger af mange faktorer, men uden dette lag er du med sikkerhed usynlig.' },
    { q: 'Hvem står bag Found by AI?', a: 'Vi er et lille team i København der specialiserer os i at gøre lokale virksomheder synlige i den nye generation af AI-drevet søgning.' }
  ];
  var faqOpen = null;
  function renderFaq() {
    var list = $('#faq-list'); if (!list) return;
    list.innerHTML = faqs.map(function (f, i) {
      var open = faqOpen === i;
      var icon = 'flex:0 0 auto; font-family:"Geist",sans-serif; font-weight:300; font-size:22px; line-height:1; color:' + (open ? PAL.accent : '#B0B0A6') + '; transition:transform .3s ease, color .2s; transform:rotate(' + (open ? '45deg' : '0deg') + ');';
      return '<div style="border-top:1px solid #E6E5DD;">' +
        '<button data-faq="' + i + '" style="width:100%; display:flex; align-items:center; justify-content:space-between; gap:20px; padding:22px 0; text-align:left; transition:color .2s ease;">' +
          '<span style="font-family:\'Geist\',sans-serif; font-weight:500; font-size:clamp(15px,1.8vw,17px); color:inherit; letter-spacing:-0.01em;">' + f.q + '</span>' +
          '<span style="' + icon + '">+</span>' +
        '</button>' +
        (open ? '<p style="margin:0; padding:0 36px 22px 0; font-size:15px; color:#5C5C54; line-height:1.6; animation:fbai-rise .3s ease both;">' + f.a + '</p>' : '') +
      '</div>';
    }).join('');
    list.querySelectorAll('[data-faq]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var i = parseInt(btn.getAttribute('data-faq'), 10);
        faqOpen = faqOpen === i ? null : i;
        renderFaq();
      });
      hover(btn, { color: PAL.strong }, { color: '' });
    });
  }
  renderFaq();

  /* ---------- chart SVG (verbatim from prototype) ---------- */
  function chart(stroke, area, dim, w, h) {
    var pad = 24;
    var pts = [[0, 10], [1, 14], [2, 19], [3, 25]];
    var maxY = 28;
    var x = function (i) { return pad + (i / 3) * (w - pad * 2); };
    var y = function (v) { return h - pad - (v / maxY) * (h - pad * 2); };
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1); }).join(' ');
    var fill = 'M' + x(0) + ' ' + y(0) + ' ' + pts.map(function (p) { return 'L' + x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1); }).join(' ') + ' L' + x(3) + ' ' + (h - pad) + ' L' + x(0) + ' ' + (h - pad) + ' Z';
    var dots = pts.map(function (p) { return '<circle cx="' + x(p[0]).toFixed(1) + '" cy="' + y(p[1]).toFixed(1) + '" r="3" fill="' + stroke + '"/>'; }).join('');
    var grid = [0, 1, 2].map(function (i) { return '<line x1="' + pad + '" y1="' + (pad + i * (h - pad * 2) / 2).toFixed(1) + '" x2="' + (w - pad) + '" y2="' + (pad + i * (h - pad * 2) / 2).toFixed(1) + '" stroke="' + dim + '" stroke-width="0.7"/>'; }).join('');
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" style="display:block;height:auto;" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' +
      grid + '<path d="' + fill + '" fill="' + area + '"/>' +
      '<path d="' + line + '" fill="none" stroke="' + stroke + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' + dots +
      '<text x="' + x(0) + '" y="' + (y(10) - 10).toFixed(1) + '" font-family="ui-monospace,monospace" font-size="12" font-weight="600" fill="' + stroke + '">10</text>' +
      '<text x="' + (x(3) - 2) + '" y="' + (y(25) - 10).toFixed(1) + '" font-family="ui-monospace,monospace" font-size="12" font-weight="600" fill="' + stroke + '" text-anchor="end">25</text></svg>';
  }
  var caseEl = $('#chart-case'); if (caseEl) caseEl.innerHTML = chart(PAL.strong, 'rgba(88,123,102,0.10)', '#ECEBE3', 300, 170);
  var dashEl = $('#chart-dash'); if (dashEl) dashEl.innerHTML = chart(PAL.bright, 'rgba(255,255,255,0.04)', '#252830', 280, 110);

  /* ---------- scroll reveal + count-up + bot bars ---------- */
  function countUp(el) {
    if (el._counted) return;
    el._counted = true;
    var target = parseFloat(el.dataset.countTo);
    if (target === 0) { el.textContent = '0'; return; }
    var suffix = el.dataset.countSuffix || '', prefix = el.dataset.countPrefix || '';
    var dur = 1300, start = performance.now();
    var ease = function (t) { return 1 - Math.pow(1 - t, 4); };
    var tick = function (now) {
      var p = Math.min((now - start) / dur, 1);
      el.textContent = prefix + Math.round(target * ease(p)) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  var obs = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.style.opacity = '1';
      e.target.style.transform = 'translateY(0)';
      e.target.querySelectorAll('[data-count-to]').forEach(countUp);
      e.target.querySelectorAll('[data-bar]').forEach(function (el) { el.style.width = el.dataset.bar + '%'; });
      obs.unobserve(e.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('[data-reveal]').forEach(function (el) { obs.observe(el); });

  /* ---------- nav scroll color ---------- */
  function onScroll() {
    if (!navEl || !heroEl) return;
    var yy = window.scrollY || 0, hh = heroEl.offsetHeight, dark = yy < hh - 80;
    if (dark) {
      navEl.style.color = '#E0DED8';
      navEl.style.background = yy > 20 ? 'rgba(10,13,16,0.6)' : 'rgba(10,13,16,0)';
      navEl.style.backdropFilter = yy > 20 ? 'saturate(180%) blur(14px)' : 'none';
      navEl.style.webkitBackdropFilter = yy > 20 ? 'saturate(180%) blur(14px)' : 'none';
      navEl.style.borderBottomColor = yy > 20 ? 'rgba(255,255,255,0.06)' : 'transparent';
    } else {
      navEl.style.color = '#1A1A17';
      navEl.style.background = 'rgba(250,250,248,0.85)';
      navEl.style.backdropFilter = 'saturate(180%) blur(14px)';
      navEl.style.webkitBackdropFilter = 'saturate(180%) blur(14px)';
      navEl.style.borderBottomColor = '#ECEBE3';
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- URL helpers ---------- */
  function normalize(raw) {
    var v = (raw || '').trim();
    if (!v) return '';
    v = v.replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    return v;
  }
  function isValid(raw) {
    var v = (raw || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    return v.length > 2 && v.indexOf('.') !== -1 && !/\s/.test(v);
  }
  // ponytail: client-side guess; used only if /api/check is unreachable.
  function derive(url) {
    var u = (url || '').toLowerCase();
    if (/wix|squarespace|webflow|shopify/.test(u)) return 'incompatible';
    if (/timeout/.test(u)) return 'timeout';
    if (/error|fejl/.test(u)) return 'system_error';
    if (/unreach|privat|404|localhost|\.local/.test(u)) return 'unreachable';
    return 'compatible';
  }
  function platformFallback(url, result) {
    var u = (url || '').toLowerCase();
    if (result === 'incompatible') {
      if (/squarespace/.test(u)) return 'Squarespace';
      if (/webflow/.test(u)) return 'Webflow';
      if (/shopify/.test(u)) return 'Shopify';
      return 'Wix';
    }
    return 'one.com';
  }

  /* ---------- loading step styles ---------- */
  function stepStyle(step) {
    var active = state.loadingStep >= step, current = state.loadingStep === step;
    return 'display:flex; align-items:center; gap:11px; font-size:14px; transition:opacity .4s, color .4s; opacity:' + (active ? '1' : '0.3') + '; color:' + (active ? '#1A1A17' : '#B8B8AE') + '; font-weight:' + (current ? '500' : '400') + ';';
  }
  function dotStyle(step) {
    var done = state.loadingStep > step, current = state.loadingStep === step;
    if (done) return 'flex:0 0 auto; width:14px; height:14px; border-radius:50%; background:var(--accent); display:inline-block;';
    if (current) return 'flex:0 0 auto; width:12px; height:12px; border-radius:50%; border:2px solid var(--accent); border-top-color:transparent; animation:fbai-spin .7s linear infinite; display:inline-block;';
    return 'flex:0 0 auto; width:14px; height:14px; border-radius:50%; border:2px solid #DCDBD3; display:inline-block;';
  }

  /* ---------- feedback rendering ---------- */
  function render() {
    var html = '';
    if (state.showError) {
      html = '<p style="pointer-events:none; font-size:13px; color:#E87C6E; margin:14px 0 0; animation:fbai-rise .3s ease both;">Indtast en gyldig URL, f.eks. dinhjemmeside.dk</p>';
    } else if (state.phase === 'idle') {
      html = '<p style="pointer-events:none; font-size:13px; color:rgba(255,255,255,0.35); margin:18px 0 0;">Ingen tilmelding. Resultatet er klar inden for få sekunder.</p>';
    } else if (state.phase === 'loading') {
      html = '<div style="max-width:460px; width:100%; margin:28px auto 0; padding:22px 24px; background:#fff; border:1px solid #E6E5DD; border-radius:14px; text-align:left; animation:fbai-rise .4s ease both;">' +
        '<div style="display:flex; flex-direction:column; gap:13px;">' +
          '<div style="' + stepStyle(1) + '"><span style="' + dotStyle(1) + '"></span>Henter din hjemmeside...</div>' +
          '<div style="' + stepStyle(2) + '"><span style="' + dotStyle(2) + '"></span>Tjekker AI-læsbarhed...</div>' +
          '<div style="' + stepStyle(3) + '"><span style="' + dotStyle(3) + '"></span>Analyserer platform...</div>' +
        '</div></div>';
    } else if (state.phase === 'result') {
      html = resultCard();
    }
    feedback.innerHTML = html;
    wireFeedback();
  }

  function resultCard() {
    var r = state.result, p = state.platform;
    if (r === 'compatible') {
      if (state.startDone) {
        return '<div style="max-width:460px; width:100%; margin:28px auto 0; padding:24px 26px; background:#fff; border:1.5px solid var(--accent); border-radius:14px; text-align:left; box-shadow:0 8px 30px -10px rgba(88,123,102,0.4); animation:fbai-rise .45s cubic-bezier(.2,.7,.2,1) both;">' +
          '<div style="display:flex; align-items:center; gap:9px; margin-bottom:8px;"><span style="display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:50%; background:var(--accent); color:#fff; font-size:13px;">✓</span><span style="font-family:\'Geist\',sans-serif; font-weight:600; font-size:15px;">Tjek din indbakke</span></div>' +
          '<p style="margin:0; font-size:14px; color:#46453E; line-height:1.5;">Vi har sendt et login-link til <strong>' + (state.startEmail || '') + '</strong>. Klik på linket for at fortsætte opsætningen.</p>' +
        '</div>';
      }
      return '<div style="max-width:460px; width:100%; margin:28px auto 0; padding:24px 26px; background:#fff; border:1.5px solid var(--accent); border-radius:14px; text-align:left; box-shadow:0 8px 30px -10px rgba(88,123,102,0.4); animation:fbai-rise .45s cubic-bezier(.2,.7,.2,1) both;">' +
        '<div style="display:flex; align-items:center; gap:9px; margin-bottom:12px;">' +
          '<span style="display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:50%; background:var(--accent); color:#fff; font-size:13px;">✓</span>' +
          '<span style="font-family:\'Geist\',sans-serif; font-weight:600; font-size:15px;">Klar til optimering</span>' +
        '</div>' +
        '<p style="margin:0 0 18px; font-size:14px; color:#46453E; line-height:1.5;"><strong style="color:#1A1A17;">0/5 AI-signaler fundet</strong> · Platform: ' + (p || 'one.com') + ' · Klar til optimering</p>' +
        '<form id="start-form" style="display:flex; flex-wrap:wrap; gap:8px; margin-top:4px;">' +
          '<input id="start-email" type="email" required placeholder="din@email.dk" style="flex:1 1 180px; min-width:0; padding:11px 14px; border:1px solid #DCDBD3; border-radius:10px; outline:none; font-size:14px; background:#FAFAF8;">' +
          '<button type="submit" style="flex:0 1 auto; padding:11px 18px; background:var(--accent); color:#fff; font-family:\'Geist\',sans-serif; font-weight:600; font-size:13px; border-radius:10px;">Send mig mit login →</button>' +
        '</form>' +
      '</div>';
    }
    if (r === 'incompatible') {
      var formOrDone = state.waitDone
        ? '<p style="margin:0; font-size:14px; color:var(--accent-strong); font-weight:500;">Tak — du er på ventelisten.</p>'
        : '<form id="wait-form" style="display:flex; flex-wrap:wrap; gap:8px;">' +
            '<input id="wait-email" type="email" required placeholder="Din e-mail" style="flex:1 1 180px; min-width:0; padding:11px 14px; border:1px solid #DCDBD3; border-radius:10px; outline:none; font-size:14px; background:#FAFAF8;">' +
            '<button type="submit" style="flex:0 1 auto; padding:11px 18px; background:#1A1A17; color:#fff; font-family:\'Geist\',sans-serif; font-weight:600; font-size:13px; border-radius:10px;">Tilmeld venteliste</button>' +
          '</form>';
      return '<div style="max-width:460px; width:100%; margin:28px auto 0; padding:24px 26px; background:#fff; border:1.5px solid #D98B3A; border-radius:14px; text-align:left; box-shadow:0 8px 30px -10px rgba(217,139,58,0.3); animation:fbai-rise .45s cubic-bezier(.2,.7,.2,1) both;">' +
        '<div style="display:flex; align-items:center; gap:9px; margin-bottom:10px;">' +
          '<span style="display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:50%; background:#D98B3A; color:#fff; font-size:14px;">!</span>' +
          '<span style="font-family:\'Geist\',sans-serif; font-weight:600; font-size:15px;">Ikke understøttet endnu</span>' +
        '</div>' +
        '<p style="margin:0 0 16px; font-size:14px; color:#46453E; line-height:1.5;">Din platform (' + (p || 'Wix') + ') understøttes ikke endnu. Vi arbejder på det.</p>' +
        formOrDone +
      '</div>';
    }
    if (r === 'timeout') {
      return '<div style="max-width:460px; width:100%; margin:28px auto 0; padding:24px 26px; background:rgba(255,255,255,0.95); border:1px solid rgba(255,255,255,0.2); border-radius:14px; text-align:left; animation:fbai-rise .45s cubic-bezier(.2,.7,.2,1) both;">' +
        '<p style="margin:0 0 14px; font-size:14px; color:#46453E; line-height:1.5;"><strong style="color:#1A1A17;">Det tog lidt længere end forventet.</strong> Prøv igen, eller kontakt os direkte.</p>' +
        '<div style="display:flex; flex-wrap:wrap; align-items:center; gap:14px;">' +
          '<button id="retry" style="padding:10px 18px; background:#1A1A17; color:#fff; font-family:\'Geist\',sans-serif; font-weight:600; font-size:13px; border-radius:10px;">Prøv igen</button>' +
          '<a href="mailto:hello@foundbyai.dk" style="font-size:13px; color:#5C5C54; text-decoration:none;">Skriv til hello@foundbyai.dk</a>' +
        '</div></div>';
    }
    if (r === 'unreachable') {
      return '<div style="max-width:460px; width:100%; margin:28px auto 0; padding:24px 26px; background:rgba(255,255,255,0.95); border:1px solid rgba(255,255,255,0.2); border-radius:14px; text-align:left; animation:fbai-rise .45s cubic-bezier(.2,.7,.2,1) both;">' +
        '<p style="margin:0 0 14px; font-size:14px; color:#46453E; line-height:1.5;"><strong style="color:#1A1A17;">Vi kunne ikke tilgå din hjemmeside.</strong> Er den offentlig tilgængelig?</p>' +
        '<a href="mailto:hello@foundbyai.dk" style="display:inline-block; padding:10px 18px; background:#1A1A17; color:#fff; font-family:\'Geist\',sans-serif; font-weight:600; font-size:13px; border-radius:10px; text-decoration:none;">Kontakt os</a>' +
      '</div>';
    }
    // system_error
    return '<div style="max-width:460px; width:100%; margin:28px auto 0; padding:24px 26px; background:rgba(255,255,255,0.95); border:1px solid rgba(255,255,255,0.2); border-radius:14px; text-align:left; animation:fbai-rise .45s cubic-bezier(.2,.7,.2,1) both;">' +
      '<p style="margin:0 0 14px; font-size:14px; color:#46453E; line-height:1.5;"><strong style="color:#1A1A17;">Noget gik galt på vores side.</strong> Prøv igen om lidt.</p>' +
      '<button id="retry" style="padding:10px 18px; background:#1A1A17; color:#fff; font-family:\'Geist\',sans-serif; font-weight:600; font-size:13px; border-radius:10px;">Prøv igen</button>' +
    '</div>';
  }

  function wireFeedback() {
    var sf = $('#start-form', feedback);
    if (sf) sf.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = ($('#start-email', feedback) || {}).value || '';
      state.startEmail = email;
      var url = normalize(input.value);
      fetch('/api/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: url, email: email }) });
      state.startDone = true; render();
    });
    var retry = $('#retry', feedback);
    if (retry) { hover(retry, { background: '#000' }, { background: '#1A1A17' }); retry.addEventListener('click', function () { var u = normalize(input.value); if (u) runCheck(u); }); }
    var wf = $('#wait-form', feedback);
    if (wf) wf.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = ($('#wait-email', feedback) || {}).value || '';
      var url = normalize(input.value);
      var plat = encodeURIComponent(state.platform || 'ukendt');
      fetch('/api/waitlist?platform=' + plat, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: url, email: email }) });
      state.waitDone = true; render();
    });
  }

  /* ---------- check flow ---------- */
  function setBorder(c) { if (form) form.style.borderColor = c; }

  function runCheck(url) {
    clearTimers();
    state.phase = 'loading'; state.result = null; state.loadingStep = 0; state.waitDone = false; state.startDone = false; state.startEmail = '';
    render();
    timers.push(setTimeout(function () { state.loadingStep = 1; render(); }, 250));
    timers.push(setTimeout(function () { state.loadingStep = 2; render(); }, 1000));
    timers.push(setTimeout(function () { state.loadingStep = 3; render(); }, 1750));

    // Real backend check; mock fallback keeps the page usable if API is down.
    var done = false;
    var finish = function (result, platform) {
      if (done) return; done = true;
      clearTimers();
      state.phase = 'result'; state.result = result; state.platform = platform;
      render();
      if (result === 'system_error' && !autoRetried) {
        autoRetried = true;
        timers.push(setTimeout(function () { runCheck(url); }, 3000));
      }
    };

    var minDelay = new Promise(function (res) { setTimeout(res, 2550); });
    var apiCall = fetch('/api/check?url=' + encodeURIComponent(url), { headers: { accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('bad status'); return r.json(); });

    Promise.allSettled([apiCall, minDelay]).then(function (res) {
      var a = res[0];
      if (a.status === 'fulfilled' && a.value && a.value.result) {
        finish(a.value.result, a.value.platform || platformFallback(url, a.value.result));
      } else {
        var r = derive(url);
        finish(r, platformFallback(url, r));
      }
    });
  }

  /* ---------- form wiring ---------- */
  if (input) {
    input.addEventListener('input', function () {
      if (state.showError) {
        state.showError = false;
        setBorder('rgba(255,255,255,0.15)');
        if (form) form.style.boxShadow = '0 0 40px rgba(88,123,102,0.08)';
        render();
      }
    });
    input.addEventListener('focus', function () {
      if (form && !state.showError) { form.style.boxShadow = '0 0 0 4px var(--accent-soft), 0 0 50px rgba(88,123,102,0.15)'; form.style.borderColor = 'var(--accent)'; }
    });
    input.addEventListener('blur', function () {
      if (form && !state.showError) { form.style.boxShadow = '0 0 40px rgba(88,123,102,0.08)'; form.style.borderColor = 'rgba(255,255,255,0.15)'; }
    });
  }
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var raw = input ? input.value : '';
      if (!isValid(raw)) {
        state.showError = true; state.phase = 'idle'; state.result = null;
        setBorder('#C0392B');
        form.style.boxShadow = '0 0 0 4px rgba(192,57,43,0.15)';
        render();
        return;
      }
      state.showError = false;
      setBorder('rgba(255,255,255,0.15)');
      var norm = normalize(raw);
      if (input) input.value = norm;
      autoRetried = false;
      runCheck(norm);
    });
  }

  /* ---------- static hovers ---------- */
  var login = $('a[href="/login"]'); hover(login, { opacity: '1' }, { opacity: '0.7' });
  var submitBtn = form && form.querySelector('button[type="submit"]'); hover(submitBtn, { background: PAL.strong }, { background: 'var(--accent)' });
  var pcta = $('#pricing-cta');
  if (pcta) {
    hover(pcta, { background: PAL.strong }, { background: 'var(--accent)' });
    pcta.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(function () { if (input) input.focus(); }, 500);
    });
  }
  document.querySelectorAll('footer a').forEach(function (a) { hover(a, { color: '#1A1A17' }, { color: '#5C5C54' }); });

  render();
})();
