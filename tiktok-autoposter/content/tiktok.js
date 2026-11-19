// Roda dentro da página de upload do TikTok Studio e faz a postagem passo a passo,
// como uma pessoa faria: envia o vídeo, escreve a legenda, vincula o produto,
// marca "Conteúdo de marca" e publica.
(() => {
  if (window.__ttapLoaded) return;
  window.__ttapLoaded = true;

  const CHUNK = 4 * 1024 * 1024;
  const CONTROL = 'input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"], [role="switch"]';
  let L = {}; // textos (labels) usados para encontrar os elementos
  let currentStep = '';
  let JOB = null;
  let linkedProduct = null;
  let writtenCaption = null;
  let clickedPublish = false;
  let scheduledAt = null;
  let aborted = false;
  let lastBeat = 0;
  let SPEED = 2.2;            // multiplicador das esperas ("humano" = mais devagar)
  let HUMAN = true;
  let actLog = [];            // registro detalhado de cada ação
  let pendingLog = [];
  let flushTimer = null;
  let baselineErrors = [];    // mensagens de erro que já estavam na página antes de começar
  let pageError = null;       // mensagem de erro do TikTok detectada na tela
  let lastMouse = { x: 40 + Math.random() * 200, y: 40 + Math.random() * 120 };

  // ---------- registro (log) ----------
  function describe(el) {
    if (!el || !el.tagName) return String(el);
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    const e2e = el.getAttribute('data-e2e');
    const aria = el.getAttribute('aria-label');
    const txt = (el.innerText || el.value || el.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 50);
    return `<${tag}${role ? ` role=${role}` : ''}${e2e ? ` data-e2e=${e2e}` : ''}${aria ? ` aria="${aria.slice(0, 40)}"` : ''}>${txt ? ` "${txt}"` : ''}`;
  }
  function logAct(m) {
    const e = { t: Date.now(), s: currentStep, m: String(m).slice(0, 400) };
    actLog.push(e);
    if (actLog.length > 500) actLog.shift();
    pendingLog.push(e);
    if (!flushTimer) flushTimer = setTimeout(flushLog, 1500);
  }
  function flushLog() {
    clearTimeout(flushTimer);
    flushTimer = null;
    if (!pendingLog.length || !JOB) return;
    const entries = pendingLog;
    pendingLog = [];
    report('job-log', { jobId: JOB.id, entries });
  }
  const fmtLog = () => actLog.map((e) => `${new Date(e.t).toLocaleTimeString('pt-BR')} [${e.s || '-'}] ${e.m}`);

  // ---------- detector da tela de erro do TikTok ----------
  function errorPhrases() {
    const body = norm(document.body?.innerText || '');
    return (L.pageError || []).map(norm).filter((w) => w && body.includes(w));
  }
  function checkPageError() {
    if (pageError || !JOB) return;
    const now = errorPhrases().filter((w) => !baselineErrors.includes(w));
    if (!now.length) return;
    const body = (document.body?.innerText || '').replace(/\s+/g, ' ');
    const i = norm(body).indexOf(now[0]);
    const text = body.slice(Math.max(0, i - 120), i + 220).trim();
    const last = actLog.filter((e) => !/^⏳|^✓ achei/.test(e.m)).slice(-1)[0];
    pageError = { text, after: last ? last.m : '(início)' };
    logAct(`🛑 O TikTok mostrou um erro na tela: "${text}"`);
    flushLog();
  }

  // ---------- utilidades ----------
  // Com a aba em segundo plano, o Chrome atrasa os timers da página (até 1x por minuto).
  // Nesse caso a espera é feita pelo service worker da extensão, que não sofre esse atraso.
  async function sleep(ms) {
    if (aborted) throw new Error('postagem cancelada');
    if (JOB && Date.now() - lastBeat > 45000) {
      lastBeat = Date.now();
      report('job-progress', { jobId: JOB.id, step: currentStep, beat: true });
    }
    if (document.hidden) {
      try {
        await chrome.runtime.sendMessage({ type: 'sleep', ms });
      } catch (_) {
        await new Promise((r) => setTimeout(r, ms));
      }
    } else {
      await new Promise((r) => setTimeout(r, ms));
    }
    if (aborted) throw new Error('postagem cancelada');
    checkPageError();
    if (pageError) throw Object.assign(new Error(`o TikTok mostrou um erro na tela ("${pageError.text.slice(0, 160)}") logo depois de: ${pageError.after}`), { pageError: true });
  }
  // esperas "humanas": mais longas no modo humano
  const human = (min = 350, max = 900) => sleep((min + Math.random() * (max - min)) * SPEED);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const norm = (s) => String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();
  const tokens = (s) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) !== 0;
  }
  const shown = (el) => visible(el) || visible(el.closest('label')) || visible(el.parentElement);

  function disabled(el) {
    if (!el) return true;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return true;
    if (el.getAttribute('data-disabled') === 'true') return true;
    return /\bdisabled\b/i.test(el.className?.baseVal ?? el.className ?? '');
  }

  async function waitFor(fn, { timeout = 30000, interval = 400, what = 'elemento', quiet = false } = {}) {
    const start = Date.now();
    const end = start + timeout;
    let last;
    let logged = false;
    while (Date.now() < end) {
      try { last = await fn(); } catch (e) { if (e?.pageError) throw e; last = null; }
      if (last) {
        if (logged && !quiet) logAct(`✓ achei ${what} (${((Date.now() - start) / 1000).toFixed(1)}s)`);
        return last;
      }
      if (!logged && !quiet) { logAct(`⏳ esperando ${what}…`); logged = true; }
      await sleep(interval);
    }
    if (!quiet) logAct(`✗ não apareceu: ${what} (esperei ${Math.round(timeout / 1000)}s)`);
    throw new Error(`Não encontrei: ${what} (esperei ${Math.round(timeout / 1000)}s)`);
  }

  const CLICKABLE = 'button, [role="button"], a, label, [role="tab"], [role="option"], [role="menuitem"], [role="radio"], [role="checkbox"], [role="switch"], [tabindex]:not([tabindex="-1"])';
  const isDialogRoot = (el) => el.matches('[role="dialog"], [aria-modal="true"]') || el === document.body || el === document.documentElement;

  // Procura elementos visíveis cujo texto corresponde a um dos rótulos.
  // exact: texto igual; senão aceita "começa com".
  function findByText(labels, { exact = false, within = null } = {}) {
    const wanted = (labels || []).map(norm).filter(Boolean);
    if (!wanted.length) return [];
    const scope = within || document.body;
    if (!scope) return [];
    const hits = [];
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    const matches = (t) => wanted.some((w) => (exact ? t === w : t === w || t.startsWith(w)));
    let n;
    while ((n = walker.nextNode())) {
      if (!n.nodeValue.trim()) continue; // ignora espaços entre tags (senão o contêiner inteiro "casa" com o texto)
      const el = n.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const t = norm(el.innerText || el.textContent);
      if (!t || t.length > 80) continue;
      if (matches(t) && visible(el)) hits.push(el);
    }
    scope.querySelectorAll('[aria-label], [title]').forEach((el) => {
      const t = norm(el.getAttribute('aria-label') || el.getAttribute('title'));
      if (t && matches(t) && visible(el)) hits.push(el);
    });
    // prioriza: dentro de um botão de verdade > texto exato > elemento menor
    const isBtn = (e) => (e.closest('button, [role="button"], a, [role="option"], [role="tab"], [role="menuitem"]') ? 0 : 1);
    const isExact = (e) => (wanted.includes(norm(e.innerText || e.getAttribute('aria-label'))) ? 0 : 1);
    const size = (e) => e.getElementsByTagName('*').length;
    return hits.sort((a, b) => isBtn(a) - isBtn(b) || isExact(a) - isExact(b) || (a.innerText || '').length - (b.innerText || '').length || size(a) - size(b));
  }

  // Elemento a clicar para um texto: o próprio controle/botão; senão o próprio texto (ou o bloco
  // dele que tem cursor de "mãozinha"). Nunca um botão vizinho — no TikTok, "Mostrar mais" é um
  // texto clicável ao lado do seletor "Quem pode ver", e clicar no vizinho abria o seletor errado.
  function clickable(el) {
    if (!el) return el;
    if (el.matches(CONTROL) || el.matches('button, [role="button"], a')) return el;
    const own = el.closest(CLICKABLE);
    if (own && !isDialogRoot(own)) return own;
    let node = el;
    let best = null;
    for (let i = 0; i < 4 && node && !isDialogRoot(node); i++) {
      if (getComputedStyle(node).cursor === 'pointer') best = node;
      else if (best) break;
      node = node.parentElement;
    }
    return best || el;
  }

  // ---------- mouse e teclado de verdade ----------
  // Os cliques, a rolagem e a digitação passam pelo próprio Chrome (protocolo de automação):
  // para o TikTok são eventos "confiáveis", iguais aos de uma pessoa. Se o Chrome recusar
  // (ex.: Ferramentas do desenvolvedor abertas na aba), cai no clique simulado e registra.
  let trustedOk = true;

  // Caminho do mouse em curva suave, com pequenos tremores, da posição atual até (x, y).
  function mousePath(x, y) {
    const pts = [];
    if (!HUMAN) return pts;
    const steps = Math.round(rnd(8, 18));
    const cx = (lastMouse.x + x) / 2 + rnd(-80, 80);
    const cy = (lastMouse.y + y) / 2 + rnd(-60, 60);
    for (let i = 1; i < steps; i++) {
      const k = i / steps;
      const e = k * k * (3 - 2 * k);
      const px = (1 - e) * (1 - e) * lastMouse.x + 2 * (1 - e) * e * cx + e * e * x;
      const py = (1 - e) * (1 - e) * lastMouse.y + 2 * (1 - e) * e * cy + e * e * y;
      pts.push({ x: Math.max(1, Math.min(innerWidth - 2, px + rnd(-1.5, 1.5))), y: Math.max(1, Math.min(innerHeight - 2, py + rnd(-1.5, 1.5))), w: rnd(10, 32) });
    }
    return pts;
  }

  const hiddenish = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width < 3 || r.height < 3 || Number(st.opacity) === 0 || st.visibility === 'hidden';
  };

  // Ponto dentro do elemento que realmente recebe o clique (nada cobrindo por cima).
  function hitPoint(el) {
    let t = el;
    // <input> sem área (escondido) de interruptor/caixa: mira a parte visível em volta.
    // Um <input> transparente mas com tamanho continua clicável: mira nele mesmo.
    const noArea = (e) => { const r = e.getBoundingClientRect(); return r.width < 3 || r.height < 3 || getComputedStyle(e).visibility === 'hidden'; };
    for (let i = 0; i < 3 && t.parentElement && noArea(t); i++) t = t.parentElement;
    const r = t.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    const lab = el.closest('label');
    const okHit = (h) => h && (t.contains(h) || h.contains(el) || el.contains(h) || (lab && lab.contains(h))
      || (hiddenish(el) && t.contains(h)));
    for (let i = 0; i < 8; i++) {
      const fx = i === 0 ? rnd(0.4, 0.6) : rnd(0.2, 0.8);
      const fy = i === 0 ? rnd(0.4, 0.6) : rnd(0.25, 0.75);
      const x = Math.min(innerWidth - 3, Math.max(2, r.left + r.width * fx));
      const y = Math.min(innerHeight - 3, Math.max(2, r.top + r.height * fy));
      if (okHit(document.elementFromPoint(x, y))) return { x, y };
    }
    return null;
  }

  // Calibração: com zoom do Chrome ou escala do Windows, a coordenada que o Chrome recebe pode
  // não ser a mesma que a página usa. Move o mouse para um ponto conhecido e mede onde ele chegou.
  let scale = null;
  async function calibrate() {
    if (scale) return scale;
    const x = Math.round(innerWidth * 0.5);
    const y = Math.round(innerHeight * 0.4);
    for (const guess of [1, 1]) {
      let got = null;
      const on = (e) => { if (e.isTrusted) got = { x: e.clientX, y: e.clientY }; };
      window.addEventListener('mousemove', on, true);
      try {
        await chrome.runtime.sendMessage({ type: 'cdp-mouse', points: [], x: (x - 7) * guess, y: (y - 5) * guess, wheel: { deltas: [] } });
        await chrome.runtime.sendMessage({ type: 'cdp-mouse', points: [], x: x * guess, y: y * guess, wheel: { deltas: [] } });
      } catch (_) { /* sem resposta */ }
      const end = Date.now() + 1500;
      while (!got && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
      window.removeEventListener('mousemove', on, true);
      if (got && got.x > 0 && got.y > 0) {
        const sx = got.x / x;
        const sy = got.y / y;
        scale = { x: Math.abs(sx - 1) < 0.02 ? 1 : sx, y: Math.abs(sy - 1) < 0.02 ? 1 : sy };
        logAct(`mouse do Chrome calibrado: escala ${scale.x.toFixed(3)} × ${scale.y.toFixed(3)} (janela ${innerWidth}x${innerHeight}, zoom/escala ${devicePixelRatio})`);
        return scale;
      }
    }
    logAct('⚠ não consegui calibrar o mouse do Chrome (sem resposta) — usando escala 1');
    scale = { x: 1, y: 1 };
    return scale;
  }
  // Converte coordenadas da página para as que o Chrome espera.
  function toDevice(msg) {
    const c = (p) => ({ ...p, x: p.x / scale.x, y: p.y / scale.y });
    return { ...msg, ...c({ x: msg.x, y: msg.y }), points: (msg.points || []).map(c) };
  }

  async function trusted(msg) {
    if (!trustedOk) return false;
    try {
      if (msg.type === 'cdp-mouse') { await calibrate(); msg = toDevice(msg); }
      const r = await chrome.runtime.sendMessage(msg);
      if (r?.ok) return true;
      logAct(`⚠ mouse/teclado do Chrome indisponível (${r?.error || 'sem resposta'}) — usando clique simulado`);
    } catch (e) {
      logAct(`⚠ mouse/teclado do Chrome indisponível (${e.message}) — usando clique simulado`);
    }
    trustedOk = false;
    return false;
  }

  // Rola a página com a rodinha do mouse (de verdade) até o elemento ficar visível.
  function scroller(el) {
    for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const st = getComputedStyle(n);
      if (/(auto|scroll)/.test(st.overflowY) && n.scrollHeight > n.clientHeight + 4) return n;
    }
    return null;
  }
  async function bringIntoView(el) {
    const inView = () => { const r = el.getBoundingClientRect(); return r.top >= 70 && r.bottom <= innerHeight - 50; };
    if (inView()) return;
    if (HUMAN && trustedOk) {
      for (let i = 0; i < 14 && !inView(); i++) {
        const sc = scroller(el);
        const box = sc ? sc.getBoundingClientRect() : { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
        const px = Math.min(innerWidth - 20, Math.max(20, box.left + (box.right - box.left) * rnd(0.3, 0.7)));
        const py = Math.min(innerHeight - 20, Math.max(20, Math.max(0, box.top) + (Math.min(innerHeight, box.bottom) - Math.max(0, box.top)) * rnd(0.35, 0.65)));
        const under = document.elementFromPoint(px, py);
        if (!under || (sc ? !sc.contains(under) : scroller(under))) break; // a rodinha rolaria outra coisa
        const r = el.getBoundingClientRect();
        const dist = r.top + r.height / 2 - innerHeight / 2;
        const total = Math.max(-900, Math.min(900, dist));
        const n = Math.max(1, Math.round(Math.abs(total) / 110));
        const deltas = Array.from({ length: n }, () => Math.round((total / n) * rnd(0.85, 1.15)));
        const before = r.top;
        if (!(await trusted({ type: 'cdp-mouse', points: mousePath(px, py), x: px, y: py, wheel: { deltas } }))) break;
        lastMouse = { x: px, y: py };
        await sleep(rnd(250, 500));
        if (Math.abs(el.getBoundingClientRect().top - before) < 2) break; // não rolou
      }
    }
    if (!inView()) {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: HUMAN ? 'smooth' : 'auto' });
      await human(350, 700);
    }
  }

  // Clique "humano": rola até o elemento, leva o mouse até ele em curva, para em cima um instante,
  // pressiona e solta — com o mouse do Chrome. Sem ele, usa eventos simulados.
  async function click(el, { raw = false } = {}) {
    if (!raw) el = clickable(el);
    await bringIntoView(el);
    // elemento sem área nenhuma (e que não é um <input> de rótulo): ninguém conseguiria clicar nele
    // com o mouse — usa o clique simulado direto nele em vez de clicar no bloco em volta
    const r0 = el.getBoundingClientRect();
    const pt = (r0.width < 1 || r0.height < 1) && !el.matches('input') && !el.closest('label') ? null : hitPoint(el);
    logAct(`🖱 clicando em ${describe(el)}${pt ? '' : ' (coberto/sem área visível: clique simulado)'}`);
    if (pt && trustedOk) {
      // confere onde o clique de verdade caiu
      let hit = null;
      const on = (e) => { if (e.isTrusted && !hit) hit = e.target; };
      window.addEventListener('pointerdown', on, true);
      window.addEventListener('mousedown', on, true);
      const ok = await trusted({ type: 'cdp-mouse', points: mousePath(pt.x, pt.y), x: pt.x, y: pt.y, hover: HUMAN ? rnd(140, 420) * (SPEED / 2.2) : 60, hold: rnd(60, 150) });
      await new Promise((r) => setTimeout(r, 60));
      window.removeEventListener('pointerdown', on, true);
      window.removeEventListener('mousedown', on, true);
      if (ok) {
        lastMouse = pt;
        const lab = el.closest('label');
        const right = hit && (el.contains(hit) || (hiddenish(el) && hit.contains(el)) || (lab && lab.contains(hit)) || (hit.closest && clickable(hit) === el));
        if (right) {
          await human(400, 900);
          return;
        }
        logAct(`⚠ o clique de verdade caiu em ${hit ? describe(hit) : 'lugar nenhum'} em vez do alvo — recalibrando e usando clique simulado`);
        scale = null;
      }
    }
    syntheticClick(el);
    await human(400, 900);
  }

  function syntheticClick(el) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
  }

  // Digitação de verdade num campo comum (busca, nome do produto): clica, Ctrl+A, apaga e digita
  // aos poucos. Confere o valor no final; se não bater, preenche do jeito antigo.
  async function typeTrusted(input, value) {
    value = String(value);
    logAct(`⌨ digitando "${value.slice(0, 60)}" em ${describe(input)}`);
    await click(input);
    const acts = [{ key: 'selectAll', wait: rnd(120, 300) }, { key: 'backspace', wait: rnd(200, 450) }];
    const parts = HUMAN ? value.match(/.{1,2}/gsu) || [] : [value];
    for (const p of parts) acts.push({ text: p, wait: HUMAN ? rnd(70, 220) : 20 });
    if (trustedOk && (await trusted({ type: 'cdp-type', actions: acts }))) {
      await human(200, 500);
      if (input.value === value) return;
      logAct(`⚠ o campo ficou "${String(input.value).slice(0, 60)}" — corrigindo`);
    }
    await typeInto(input, value);
  }
  async function pressEnter(el) {
    if (trustedOk && (await trusted({ type: 'cdp-type', actions: [{ key: 'enter', wait: 100 }] }))) return;
    key(el, 'Enter', 'Enter', 13);
  }

  function setInputValue(input, value) {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    input.focus();
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // Digita num campo comum (busca, nome do produto) letra por letra no modo humano.
  async function typeInto(input, value) {
    logAct(`⌨ digitando "${String(value).slice(0, 60)}" em ${describe(input)}`);
    if (!HUMAN) { setInputValue(input, value); return; }
    input.focus();
    setInputValue(input, '');
    let cur = '';
    for (const ch of String(value)) {
      cur += ch;
      setInputValue(input, cur);
      await sleep(rnd(45, 140));
    }
    await human(200, 500);
  }

  function key(el, k, code = k, keyCode = 0) {
    for (const type of ['keydown', 'keypress', 'keyup']) {
      el.dispatchEvent(new KeyboardEvent(type, { key: k, code, keyCode, which: keyCode, bubbles: true, cancelable: true }));
    }
  }

  // Janelas (modais) visíveis — só as mais externas, preferindo as marcadas como diálogo.
  function dialogs() {
    const strong = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].filter(visible);
    const weak = strong.length ? [] : [...document.querySelectorAll('[class*="Modal"], [class*="modal"], [class*="Dialog"], [class*="Drawer"], [class*="drawer"]')].filter(visible);
    const all = strong.length ? strong : weak;
    return all.filter((d) => !all.some((o) => o !== d && o.contains(d)));
  }
  const topDialog = () => {
    const d = dialogs();
    return d.length ? d[d.length - 1] : null;
  };

  function report(type, data) {
    try { chrome.runtime.sendMessage({ type, ...data }).catch(() => {}); } catch (_) { /* extensão recarregada */ }
  }

  async function step(name, fn) {
    currentStep = name;
    logAct(`▶ ${name}`);
    lastBeat = Date.now();
    report('job-progress', { jobId: JOB?.id, step: name });
    flushLog();
    if (HUMAN) await human(700, 1600); // pausa entre etapas, como quem confere a tela
    const t0 = Date.now();
    const out = await fn();
    logAct(`■ fim de "${name}" (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    return out;
  }

  // ---------- diagnóstico ----------
  function diagnose() {
    const texts = (els) => [...new Set(els.filter(visible).map((e) => (e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ')).filter(Boolean))];
    return {
      url: location.href,
      step: currentStep,
      hidden: document.hidden,
      buttons: texts([...document.querySelectorAll('button, [role="button"]')]).slice(0, 80),
      switches: [...document.querySelectorAll('[role="switch"], input[type="checkbox"]')].filter(shown).length,
      inputs: [...document.querySelectorAll('input, textarea')].filter(visible).map((i) => `${i.type || 'text'}:${i.placeholder || i.name || ''}`).slice(0, 30),
      fileInputs: document.querySelectorAll('input[type="file"]').length,
      editors: [...document.querySelectorAll('[contenteditable="true"]')].filter(visible).length,
      dialogs: dialogs().map((d) => (d.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 400)).slice(0, 4),
      pageError: pageError || null,
      pageText: (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n').slice(0, 5000),
      viewport: `${innerWidth}x${innerHeight}`,
      userAgent: navigator.userAgent,
    };
  }

  // ---------- leitura do vídeo (vem da extensão em pedaços) ----------
  async function fetchVideo(path) {
    const meta = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'file-meta', path });
    if (!meta?.ok) throw new Error(meta?.error || 'não consegui ler o vídeo da pasta');
    if (!meta.size) throw new Error('o arquivo de vídeo está vazio (0 bytes) — se estiver no Google Drive, deixe-o disponível off-line');
    const parts = [];
    for (let offset = 0; offset < meta.size; offset += CHUNK) {
      if (aborted) throw new Error('postagem cancelada');
      const r = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'read-chunk', path, offset, length: CHUNK });
      if (!r?.ok) throw new Error(r?.error || 'falha ao ler parte do vídeo');
      const bin = atob(r.b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      parts.push(bytes);
    }
    const file = new File(parts, meta.name, { type: meta.type, lastModified: meta.lastModified });
    if (file.size !== meta.size) throw new Error(`o vídeo foi lido incompleto (${file.size} de ${meta.size} bytes)`);
    return file;
  }

  // ---------- etapas ----------
  function findFileInput() {
    return document.querySelector('input[type="file"][accept*="video"]') || document.querySelector('input[type="file"]');
  }

  async function dismissPopups() {
    for (let i = 0; i < 3; i++) {
      const d = topDialog();
      if (!d) return;
      const txt = norm(d.innerText);
      // não fecha diálogos de produto/link/divulgação que nós mesmos abrimos
      if (/produto|product|link|divulg|disclos|marca|brand/.test(txt)) return;
      const draft = findByText(L.discardDraft, { within: d, exact: true })[0];
      const btn = draft || findByText(L.dismiss, { within: d, exact: true })[0];
      if (!btn) return;
      logAct(`fechando aviso do TikTok: "${(d.innerText || '').replace(/\s+/g, ' ').slice(0, 120)}"`);
      await click(btn);
      await sleep(600);
    }
  }

  // Faixa de rascunho antigo ("…não foi guardado. Continuar a editar?" Eliminar | Continuar):
  // elimina o rascunho para começar do zero.
  async function discardOldDraft() {
    // procura o texto do aviso em qualquer parte da frase
    const wanted = (L.draftBanner || []).map(norm).filter(Boolean);
    let hint = null;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const t = norm(n.nodeValue);
      if (t && wanted.some((x) => t.includes(x)) && visible(n.parentElement) && !n.parentElement.closest('button, [role="button"]')) { hint = n.parentElement; break; }
    }
    if (!hint) return;
    let node = hint.parentElement;
    for (let i = 0; i < 5 && node && node !== document.body; i++) {
      const btn = findByText(L.discardDraft, { within: node, exact: true }).map(clickable).find((b) => b.matches('button, [role="button"]'));
      if (btn) {
        logAct(`rascunho antigo encontrado ("${(hint.innerText || '').trim().slice(0, 90)}") → clicando em "${(btn.innerText || '').trim()}"`);
        await click(btn);
        await human(800, 1400);
        // pode abrir uma confirmação
        const d = topDialog();
        if (d) {
          const ok = findByText(L.discardDraft, { within: d, exact: true }).map(clickable).find((b) => b.matches('button, [role="button"]'));
          if (ok) await click(ok);
        }
        return;
      }
      node = node.parentElement;
    }
    logAct('⚠ vi o aviso de rascunho antigo, mas não achei o botão para eliminar');
  }

  async function uploadVideo(file) {
    const input = await waitFor(findFileInput, { timeout: 60000, what: 'campo de envio de vídeo' });
    logAct(`📤 enviando ${file.name} (${(file.size / 1e6).toFixed(1)} MB, ${file.type}) para ${describe(input)}`);
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findCaptionEditor() {
    const sels = ['.public-DraftEditor-content[contenteditable="true"]', '[data-e2e="caption_container"] [contenteditable="true"]', '.caption-editor [contenteditable="true"]', '[contenteditable="true"][role="combobox"]', '[contenteditable="true"]'];
    for (const s of sels) {
      const el = [...document.querySelectorAll(s)].find(visible);
      if (el) return el;
    }
    return null;
  }

  const editorText = (ed) => norm(ed.innerText);

  // Seleciona todo o texto do editor sem alterar a página (só a seleção).
  function selectAllIn(ed) {
    ed.focus();
    const sel = getSelection();
    const range = document.createRange();
    range.selectNodeContents(ed);
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }
  function caretToEnd(ed) {
    ed.focus();
    const sel = getSelection();
    const range = document.createRange();
    range.selectNodeContents(ed);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }
  // "Cola" um texto no editor: o editor do TikTok (Draft.js) trata a colagem por conta própria,
  // sem a extensão mexer no conteúdo da página por fora (isso é o que pode travar a página).
  function pasteText(ed, text) {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }

  // Confere a legenda: tem o começo e o fim do texto, e NÃO tem mais o nome do arquivo.
  function captionOk(ed, caption, original) {
    const t = norm(ed.innerText);
    const first = norm(caption.split('\n')[0]).slice(0, 25);
    const lastWord = norm(caption.trim().split(/\s+/).pop()).slice(0, 20);
    const orig = norm(original);
    const leftover = orig && orig.length > 3 && !norm(caption).includes(orig) && t.includes(orig);
    return t.includes(first) && t.includes(lastWord) && !leftover;
  }

  // Seleciona todo o texto do campo do jeito do teclado (Ctrl+A dentro do campo).
  function selectAllKeyboard(ed) {
    ed.focus();
    caretToEnd(ed);
    document.execCommand('selectAll', false, null);
    document.dispatchEvent(new Event('selectionchange'));
  }

  // Pedaços de 1 a 3 palavras (quebras de linha separadas), para digitar em ritmo humano.
  function chunksOf(text) {
    if (!HUMAN) return [text];
    const parts = text.match(/\n|[^\s]+[ \t]*/g) || [text];
    const out = [];
    for (let i = 0; i < parts.length;) {
      const n = parts[i] === '\n' ? 1 : Math.min(parts.length - i, Math.round(rnd(1, 3)));
      out.push(parts.slice(i, i + n).join(''));
      i += n;
    }
    return out;
  }

  // Estratégias para escrever no editor do TikTok, da mais "teclado de verdade" para a menos.
  // Monta a digitação: Ctrl+A e Backspace (apaga o nome do arquivo), depois o texto em pedaços,
  // com Enter nas quebras de linha e pausas de quem está digitando.
  function typingActions(caption) {
    const acts = [{ key: 'selectAll', wait: rnd(250, 500) }, { key: 'backspace', wait: rnd(400, 800) }];
    caption.replace(/\r/g, '').split('\n').forEach((line, i) => {
      if (i > 0) acts.push({ key: 'enter', wait: HUMAN ? rnd(300, 700) : 60 });
      if (!line) return;
      for (const chunk of chunksOf(line)) {
        acts.push({ text: chunk, wait: HUMAN ? rnd(140, 420) : 30 });
        if (HUMAN && Math.random() < 0.08) acts.push({ text: '', wait: rnd(700, 1600) });
      }
    });
    acts.push({ text: ' ', wait: 300 }); // espaço final fecha a lista de sugestões de hashtag
    return acts;
  }

  async function writeCaption(caption) {
    const ed = await waitFor(findCaptionEditor, { timeout: 180000, what: 'campo de legenda' });
    const original = (ed.innerText || '').trim();
    logAct(`campo de legenda: ${describe(ed)} · texto atual: "${original.slice(0, 80)}"`);
    await human(800, 1500);
    // a aba precisa estar visível para as teclas de comando (Ctrl+A, Backspace, Enter) funcionarem
    if (document.hidden) {
      logAct('aba em segundo plano: trazendo a aba do TikTok para a frente');
      await chrome.runtime.sendMessage({ type: 'focus-tab' }).catch(() => {});
      await sleep(800);
    }
    await click(ed);
    await human(300, 700);
    caretToEnd(ed);
    logAct(`aba visível: ${!document.hidden}`);
    logAct(`⌨ digitando a legenda com o teclado do Chrome (${caption.length} caracteres${HUMAN ? ', em ritmo humano' : ''}): Ctrl+A, Backspace e o texto`);
    const r = await chrome.runtime.sendMessage({ type: 'cdp-type', actions: typingActions(caption) });
    if (!r?.ok) throw new Error(r?.error || 'não consegui digitar a legenda');
    await sleep(1200);
    const ok = captionOk(ed, caption, original);
    logAct(`legenda no campo: "${(ed.innerText || '').replace(/\s+/g, ' ').slice(0, 160)}" → ${ok ? '✓ certa' : '✗ não ficou certa'}`);
    if (!ok) throw new Error(`a legenda não ficou certa no campo (ficou: "${(ed.innerText || '').replace(/\s+/g, ' ').slice(0, 100)}"). Não publiquei para não sair com a descrição errada.`);
    writtenCaption = { caption, original };
  }

  // Antes de publicar, confere de novo que a legenda continua certa no campo.
  function checkCaptionBeforePublish() {
    if (!writtenCaption) return;
    const ed = findCaptionEditor();
    if (!ed) return;
    if (!captionOk(ed, writtenCaption.caption, writtenCaption.original)) {
      throw new Error(`a legenda mudou antes de publicar (o campo está: "${(ed.innerText || '').replace(/\s+/g, ' ').slice(0, 100)}"). Não publiquei.`);
    }
    logAct('✓ legenda conferida antes de publicar');
  }

  function findPostButton() {
    const byAttr = [...document.querySelectorAll('[data-e2e="post_video_button"], button[data-e2e*="post"]')].find(visible);
    if (byAttr) return byAttr;
    const hits = findByText(L.post, { exact: true }).map(clickable).filter((b) => b.matches('button, [role="button"]') && !b.closest('[role="dialog"], [aria-modal="true"]'));
    // o botão de publicar costuma ser o último na página
    return hits.length ? hits[hits.length - 1] : null;
  }

  async function waitUploadDone() {
    await sleep(3000);
    await waitFor(() => {
      const body = norm(document.body.innerText);
      const uploading = L.uploading.some((w) => body.includes(norm(w))) && !L.uploaded.some((w) => body.includes(norm(w)));
      const percent = [...document.querySelectorAll('span, div')].some((e) => e.childElementCount === 0 && /^\d{1,2}(\.\d+)?%$/.test((e.textContent || '').trim()) && visible(e));
      const btn = findPostButton();
      return btn && !disabled(btn) && !uploading && !percent;
    }, { timeout: 15 * 60000, interval: 1500, what: 'fim do envio do vídeo (botão Publicar liberado)' });
    await human(1500, 3000);
  }

  // ---------- produto (carrinho laranja) ----------
  // Linha de um resultado: a linha da tabela (tr / role=row / li) que contém o controle;
  // senão sobe a partir do controle até o bloco que contém só ele.
  function rowOf(ctrl, dlg) {
    const tr = ctrl.closest('tr, [role="row"], li');
    if (tr && dlg.contains(tr) && tr.querySelectorAll('input[type="radio"], input[type="checkbox"]').length <= 1) return tr;
    let node = ctrl.closest('label') || ctrl;
    let row = node;
    for (let i = 0; i < 6 && node && node !== dlg; i++) {
      const n = [...node.querySelectorAll(CONTROL)].filter((c) => !c.contains(ctrl) && !ctrl.contains(c) && c !== ctrl);
      if (n.length) break; // passou a conter outro produto
      row = node;
      if ((node.innerText || '').trim().length > 25) break;
      node = node.parentElement;
    }
    return row;
  }

  // Lê os dados de uma linha da vitrine: nome, ID, preço, estoque e situação.
  function parseRow(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    const id = (t.match(/(?:^|\D)(\d{12,25})(?!\d)/) || [])[1] || null;
    const name = (id ? t.slice(0, t.indexOf(id)) : t).trim().replace(/[\s|·-]+$/, '');
    const price = (t.match(/R\$\s?[\d.]+,\d{2}/) || [])[0] || null;
    const after = price ? t.slice(t.indexOf(price) + price.length) : '';
    const stock = (after.match(/^\s*(\d[\d.]*)/) || [])[1] || null;
    const nt = norm(t);
    const status = /indisponivel|unavailable|esgotad|sold out|out of stock|inativ|inactive/.test(nt) ? 'indisponivel' : /\bativo\b|\bactive\b|disponivel/.test(nt) ? 'ativo' : null;
    return { id, name, price, stock: stock ? Number(stock.replace(/\./g, '')) : null, status };
  }

  function readResults(dlg) {
    if (!dlg || !dlg.isConnected) return null;
    const ctrls = [...dlg.querySelectorAll('input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]')].filter(shown);
    const rows = [];
    for (const c of ctrls) {
      const row = rowOf(c, dlg);
      // o mesmo produto pode ter um <input> escondido + um [role=radio] visível: conta uma vez só
      if (rows.some((r) => r.row === row || r.row.contains(row) || row.contains(r.row))) continue;
      const text = (row.innerText || '').trim().replace(/\s+/g, ' ');
      if (!text) continue;
      const info = parseRow(text);
      const blocked = disabled(c) || c.matches(':disabled') || !!c.querySelector?.('input:disabled');
      rows.push({ el: c, row, text, html: row.outerHTML.slice(0, 5000), ...info, blocked });
    }
    return rows.length ? rows : null;
  }
  const signature = (rows) => (rows || []).map((r) => r.text).join('|');
  const showsIds = (rows) => (rows || []).some((r) => r.id);
  const emptyState = (dlg) => !!dlg && (L.noResults || []).some((w) => norm(dlg.innerText).includes(norm(w)));

  const hasId = (r, id) => r.id === id || tokens(r.text).includes(id) || new RegExp(`(^|[^0-9])${id}([^0-9]|$)`).test(r.html);

  // Escolhe o item certo da lista. Regras:
  // - Se o ID do produto aparece num item (a vitrine mostra a coluna "ID do produto") → esse item.
  // - Se a lista mostra IDs e nenhum é o do produto → recusa (nunca escolhe outro produto).
  // - Sem ID cadastrado: busca pelo nome; a sequência de palavras aparece no item (ou todas as palavras);
  //   nenhum ou mais de um compatível → ERRO.
  function matchProduct(rows, attempt, productId, listChanged) {
    const list = rows.slice(0, 5).map((r) => `"${r.text.slice(0, 70)}"`).join(', ') || 'nenhum';
    if (productId) {
      const byId = rows.filter((r) => hasId(r, productId));
      if (byId.length) return byId[0];
      if (showsIds(rows)) throw new Error(`busca ${attempt.kind === 'id' ? 'pelo ID' : `por "${attempt.q}"`}: o ID ${productId} não está entre os resultados (${list})`);
      if (attempt.kind === 'id') {
        if (rows.length === 1 && listChanged) return rows[0];
        throw new Error(`busca pelo ID ${attempt.q}: ${rows.length ? `${rows.length} resultados sem o ID visível (${list})` : 'nenhum resultado'}`);
      }
    }
    const q = tokens(attempt.q);
    const phrase = ` ${q.join(' ')} `;
    let m = rows.filter((r) => ` ${tokens(r.name || r.text).join(' ')} `.includes(phrase));
    if (!m.length) m = rows.filter((r) => { const t = new Set(tokens(r.name || r.text)); return q.every((w) => t.has(w)); });
    if (m.length > 1) {
      const exact = m.filter((r) => tokens(r.name || r.text).slice(0, q.length).join(' ') === q.join(' '));
      if (exact.length === 1) m = exact;
    }
    if (!m.length) throw new Error(`busca por "${attempt.q}": nenhum produto corresponde. Resultados vistos: ${list}`);
    if (m.length > 1) throw new Error(`busca por "${attempt.q}": ${m.length} produtos parecidos — importe a vitrine ou informe o ID do produto para garantir o certo. Resultados: ${list}`);
    return m[0];
  }

  // Digita a busca e espera a lista mudar e ficar estável (ou a mensagem "nenhum resultado").
  async function searchProducts(search, query) {
    const before = signature(readResults(topDialog()));
    await typeTrusted(search, query);
    await human(250, 600);
    logAct('⏎ Enter na busca');
    await pressEnter(search);
    let rows = null;
    let stable = 0;
    let prevSig = null;
    let listChanged = false;
    const t0 = Date.now();
    const end = t0 + 25000;
    while (Date.now() < end) {
      await sleep(700);
      const dlg = topDialog();
      const cur = readResults(dlg);
      const sig = signature(cur);
      if (sig !== before) listChanged = true;
      if (!cur && emptyState(dlg) && Date.now() - t0 > 2000) { logAct(`busca "${query}": nenhum resultado`); return { rows: [], listChanged: true }; }
      if (cur && sig === prevSig && (listChanged || Date.now() > end - 15000)) stable++; else stable = 0;
      prevSig = sig;
      rows = cur;
      if (rows && stable >= 2) break;
    }
    logAct(`busca "${query}": ${rows ? rows.length : 0} resultado(s)${rows ? ' — ' + rows.map((r) => `${(r.name || '').slice(0, 30)} [${r.id || 'sem ID'}${r.status === 'indisponivel' ? ', indisponível' : ''}]`).join('; ') : ''}`);
    return { rows: rows || [], listChanged };
  }

  // Botão "+ Adicionar" da seção "Adicionar link" do formulário.
  function findAddLinkButton() {
    const isAdd = (b) => /^\+?\s*(adicionar|add)$/.test(norm(b.innerText || b.getAttribute('aria-label')));
    const label = findByText(L.addLink).find((el) => !el.closest('button, [role="button"]'));
    if (label) {
      let node = label.parentElement;
      for (let i = 0; i < 5 && node && node !== document.body; i++) {
        const bs = [...node.querySelectorAll('button, [role="button"]')].filter((b) => visible(b) && isAdd(b));
        if (bs.length) return bs[0];
        node = node.parentElement;
      }
    }
    const direct = findByText(L.addLink).map(clickable).find((b) => b && b.matches && b.matches('button, [role="button"]'));
    if (direct) return direct;
    const any = [...document.querySelectorAll('button, [role="button"]')].filter((b) => visible(b) && isAdd(b) && !b.closest('[role="dialog"], [aria-modal="true"]'));
    return any.length === 1 ? any[0] : null;
  }

  // Abre "+ Adicionar" → Tipo de link: Produtos → Seguinte → vitrine. Devolve a janela e o campo de busca.
  async function openShowcase() {
    const addBtn = await waitFor(findAddLinkButton, { timeout: 30000, what: 'botão "+ Adicionar" da seção "Adicionar link"' });
    await click(addBtn);
    const dlg = await waitFor(topDialog, { timeout: 15000, what: 'janela "Adicionar link"' });
    await human(800, 1400);
    // "Tipo de link": normalmente já vem "Produtos". Se o menu abriu, escolhe "Produtos" para fechá-lo.
    const openOption = [...dlg.querySelectorAll('[role="option"], [role="menuitem"], li')].find((o) => visible(o) && L.productsOption.some((w) => norm(o.innerText).startsWith(norm(w))));
    if (openOption) { logAct('menu "Tipo de link" aberto: escolhendo Produtos'); await click(openOption); }
    else if (!L.productsOption.some((w) => norm(dlg.innerText).includes(norm(w)))) {
      const trigger = dlg.querySelector('[role="combobox"], [aria-haspopup], select, [class*="select"], [class*="Select"]');
      if (trigger) {
        await click(trigger);
        const opt = await waitFor(() => [...document.querySelectorAll('[role="option"], [role="menuitem"], li')].find((o) => visible(o) && L.productsOption.some((w) => norm(o.innerText).startsWith(norm(w)))), { timeout: 8000, what: 'opção "Produtos"' });
        await click(opt);
      }
    }
    const next1 = await waitFor(() => findByText(L.next, { within: topDialog() || dlg, exact: true }).map(clickable).find((b) => b.matches('button, [role="button"]') && !disabled(b)), { timeout: 10000, what: 'botão "Seguinte" (tipo de link)' });
    await click(next1);
    const sdlg = await waitFor(() => {
      const d = topDialog();
      return d && [...d.querySelectorAll('input[type="text"], input[type="search"], input:not([type])')].some(visible) ? d : null;
    }, { timeout: 20000, what: 'vitrine de produtos ("Adicionar links dos produtos")' });
    const search = [...sdlg.querySelectorAll('input[type="text"], input[type="search"], input:not([type])')].find(visible);
    await waitFor(() => readResults(topDialog()) || emptyState(topDialog()), { timeout: 25000, what: 'lista de produtos da vitrine' });
    await human(600, 1200);
    return { dlg: sdlg, search };
  }

  // Botão de próxima página da paginação da vitrine.
  function nextPageButton(dlg) {
    if (!dlg) return null;
    const byAria = [...dlg.querySelectorAll('[aria-label], [title]')].find((e) => visible(e)
      && /(next page|proxima pagina|pagina seguinte|proxima|^next$)/.test(norm(e.getAttribute('aria-label') || e.getAttribute('title'))));
    if (byAria) return clickable(byAria);
    const pag = [...dlg.querySelectorAll('[class*="agination"], [class*="pager"], [class*="Pager"], nav')].filter(visible).pop();
    if (!pag) return null;
    const items = [...pag.querySelectorAll('button, [role="button"], li, a')].filter(visible);
    const last = items[items.length - 1];
    if (last && /^(›|>|»|)$/.test((last.innerText || '').trim())) return clickable(last);
    return null;
  }

  // Percorre as páginas da vitrine. `onPage(rows)` devolve algo para parar.
  async function walkPages(onPage, maxPages = 40) {
    for (let p = 1; p <= maxPages; p++) {
      const rows = readResults(topDialog()) || [];
      const hit = onPage(rows, p);
      if (hit) return hit;
      const nb = nextPageButton(topDialog());
      if (!nb || disabled(nb) || nb.matches(':disabled')) { logAct(`fim da vitrine (página ${p})`); return null; }
      const sig = signature(rows);
      await click(nb);
      await waitFor(() => signature(readResults(topDialog())) !== sig, { timeout: 12000, what: `página ${p + 1} da vitrine` }).catch(() => {});
      await human(300, 700);
    }
    return null;
  }

  async function linkProduct(job) {
    const label = job.productLabel;
    const { search } = await openShowcase();

    // 1º busca pelo ID; depois pelo nome; por último folheia a vitrine procurando o ID
    const attempts = [];
    if (job.productId) attempts.push({ q: job.productId, kind: 'id' });
    if (job.productQuery) attempts.push({ q: job.productQuery, kind: 'name' });
    let chosen = null;
    const errors = [];
    for (const a of attempts) {
      const { rows, listChanged } = await searchProducts(search, a.q);
      try {
        chosen = matchProduct(rows, a, job.productId, listChanged);
        logAct(`✓ produto encontrado ${a.kind === 'id' ? 'pela busca do ID' : `buscando "${a.q}"`}`);
        break;
      } catch (e) {
        errors.push(e.message);
        logAct('• ' + e.message);
      }
    }
    if (!chosen && job.productId) {
      logAct(`procurando o ID ${job.productId} página por página na vitrine`);
      await searchProducts(search, '');
      chosen = await walkPages((rows) => rows.find((r) => hasId(r, job.productId)));
      if (chosen) logAct('✓ produto encontrado folheando a vitrine');
      else errors.push(`o ID ${job.productId} não está em nenhuma página da vitrine`);
    }
    if (!chosen) throw new Error(`não vinculei nenhum produto para não errar o link — ${errors.join(' | ')}. Confira se o produto está na sua vitrine de afiliado.`);
    linkedProduct = `${chosen.name || chosen.text.slice(0, 120)}${chosen.id ? ` (ID ${chosen.id})` : ''}`;
    logAct(`✓ produto escolhido: ${linkedProduct}${chosen.price ? ` · ${chosen.price}` : ''}${chosen.status ? ` · ${chosen.status}` : ''}`);
    if (chosen.status === 'indisponivel' || chosen.blocked) {
      throw Object.assign(new Error(`o produto "${(chosen.name || '').slice(0, 60)}" está Indisponível na sua vitrine (sem estoque) — não postei para o vídeo não sair sem carrinho`), { unavailable: true });
    }
    await click(chosen.el.matches('input') ? (chosen.el.closest('label') || chosen.el) : chosen.el);
    await human(800, 1400);
    if (!isOn(chosen.el)) { await click(chosen.el); await human(); }
    if (chosen.el.matches('input, [role="radio"], [role="checkbox"]') && !isOn(chosen.el)) throw new Error('não consegui selecionar o produto na lista');

    const listDlg = topDialog();
    const next2 = await waitFor(() => findByText(L.next.concat(L.add), { within: topDialog(), exact: true }).map(clickable).find((b) => b.matches('button, [role="button"]') && !disabled(b)), { timeout: 15000, what: 'botão "Seguinte" após escolher o produto' });
    await click(next2);

    // Tela do nome do produto (até 30 caracteres) + Adicionar — ou a janela já fechou
    const d3 = await waitFor(() => {
      const d = topDialog();
      if (!d) return 'closed';
      const nameInput = [...d.querySelectorAll('input[maxlength], textarea[maxlength]')].find((i) => visible(i) && i !== search);
      if (nameInput) return d;
      if (d !== listDlg && !d.contains(search)) return d;
      return null;
    }, { timeout: 15000, what: 'tela do nome do produto' });
    if (d3 !== 'closed') {
      logAct(`tela do nome do produto: "${(d3.innerText || '').replace(/\s+/g, ' ').slice(0, 160)}"`);
      await human(600, 1200);
      const nameInput = [...d3.querySelectorAll('input[maxlength], textarea[maxlength], input[type="text"], input:not([type])')].find((i) => visible(i) && i !== search);
      const suggested = nameInput ? nameInput.value : '';
      if (nameInput && label && label.trim() && label.trim() !== suggested.trim()) {
        logAct(`nome no carrinho: "${label.slice(0, 30)}" (o TikTok sugeriu "${suggested}")`);
        await typeTrusted(nameInput, label.slice(0, 30));
      } else {
        logAct(`nome no carrinho: mantendo o sugerido pelo TikTok "${suggested}"`);
      }
      const addFinal = await waitFor(() => findByText(L.add, { within: d3, exact: true }).map(clickable).find((b) => b.matches('button, [role="button"]') && !disabled(b)), { timeout: 10000, what: 'botão "Adicionar" do produto' });
      await click(addFinal);
      await human(1500, 2500);
    }
    await waitFor(() => !dialogs().some((d) => /produto|product/.test(norm(d.innerText))), { timeout: 20000, what: 'fechamento da janela de produto' });

    // Confere o produto anexado fora do campo de legenda
    const ed = findCaptionEditor();
    const marks = [label, job.productQuery, job.productId].filter(Boolean);
    const appears = (m) => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        if (norm(n.nodeValue).includes(norm(m)) && !(ed && ed.contains(n)) && !n.parentElement?.closest('[role="dialog"], [aria-modal="true"]') && visible(n.parentElement)) return true;
      }
      return false;
    };
    const attached = await waitFor(() => marks.some(appears), { timeout: 8000, what: 'produto anexado', quiet: true }).catch(() => false);
    logAct(attached ? '✓ produto anexado aparece na página' : '⚠ não consegui ver o nome do produto anexado na página (confira o 1º post)');
  }

  // Lê toda a vitrine (todas as páginas) e fecha a janela sem escolher nada.
  async function readShowcase() {
    await openShowcase();
    const items = new Map();
    await walkPages((rows, p) => {
      let n = 0;
      for (const r of rows) if (r.id && !items.has(r.id)) { items.set(r.id, { id: r.id, name: r.name, price: r.price, stock: r.stock, status: r.blocked ? 'indisponivel' : (r.status || 'ativo') }); n++; }
      logAct(`página ${p} da vitrine: ${rows.length} produto(s), ${n} novo(s)`);
      reportProgress(`Lendo sua vitrine… ${items.size} produtos`);
      return null;
    });
    for (let i = 0; i < 3; i++) {
      const d = topDialog();
      if (!d) break;
      const cancel = findByText(L.cancel, { within: d, exact: true }).map(clickable).find((b) => b.matches('button, [role="button"]'));
      if (!cancel) break;
      await click(cancel);
      await human(500, 900);
    }
    return [...items.values()];
  }
  function reportProgress(text) {
    report('job-progress', { jobId: JOB?.id, step: text });
  }

  // ---------- conteúdo de marca ----------
  function isOn(el) {
    if (!el) return false;
    if (el.matches('input[type="checkbox"], input[type="radio"]')) return el.checked;
    const aria = el.getAttribute('aria-checked') ?? el.getAttribute('aria-pressed');
    if (aria != null) return aria === 'true';
    const inner = el.querySelector?.('input[type="checkbox"], input[type="radio"]');
    if (inner) return inner.checked;
    return /\b(checked|active|on|is-checked)\b/i.test(String(el.className));
  }

  // Interruptor/caixa ligado a um texto: sobe até o primeiro bloco que contém exatamente um controle.
  function controlNear(textEl) {
    const lab = textEl.closest('label');
    if (lab) {
      const c = lab.querySelector(CONTROL) || (lab.htmlFor && document.getElementById(lab.htmlFor));
      if (c) return c;
    }
    let node = textEl;
    for (let i = 0; i < 6 && node && !isDialogRoot(node); i++) {
      const cs = [...node.querySelectorAll(`${CONTROL}, [aria-checked]`)].filter((c) => !cs0(c));
      if (cs.length === 1) return cs[0];
      if (cs.length > 1) {
        // input escondido + switch visível do mesmo controle contam como um
        const outer = cs.filter((c) => !cs.some((o) => o !== c && o.contains(c)));
        if (outer.length === 1) return outer[0];
        return null;
      }
      node = node.parentElement;
    }
    return null;
  }
  const cs0 = (c) => c.matches('input[type="file"]');

  // Estado real de um interruptor/caixa: o <input> interno manda; depois aria-checked; depois a classe.
  function controlState(ctrl) {
    if (!ctrl) return false;
    const all = [ctrl, ...ctrl.querySelectorAll('input[type="checkbox"], input[type="radio"], [role="switch"], [role="checkbox"], [aria-checked]')];
    const input = all.find((c) => c.matches('input'));
    if (input) return input.checked;
    for (const c of all) {
      const a = c.getAttribute('aria-checked') ?? c.getAttribute('aria-pressed');
      if (a != null) return a === 'true';
    }
    return all.some((c) => /(^|[\s_-])(checked|is-checked|active|on)(\b|$)/i.test(String(c.className?.baseVal ?? c.className ?? '')));
  }

  // Liga um interruptor/caixa de verdade: tenta o <input> interno, o elemento com papel de
  // interruptor, a moldura, o bloco em volta e por fim o próprio texto — conferindo após cada clique.
  async function ensureChecked(ctrl, textEl, what) {
    if (controlState(ctrl)) { logAct(`✓ ${what} já estava ligado`); return; }
    logAct(`controle de ${what}: ${(ctrl.parentElement || ctrl).outerHTML.replace(/\s+/g, ' ').slice(0, 500)}`);
    const inner = ctrl.matches('input') ? ctrl : ctrl.querySelector('input[type="checkbox"], input[type="radio"]');
    const roleEl = ctrl.matches('[role="switch"], [role="checkbox"]') ? ctrl : ctrl.querySelector('[role="switch"], [role="checkbox"]');
    const tries = [...new Set([inner, roleEl, ctrl, ctrl.closest('label'), ctrl.parentElement, textEl].filter(Boolean))];
    for (const t of tries) {
      logAct(`tentando ligar ${what}: ${describe(t)}`);
      await click(t, { raw: true });
      await human(700, 1200);
      if (controlState(ctrl)) { logAct(`✓ ${what} ligado`); return; }
    }
    // último recurso: clique simulado direto no <input>
    if (inner) {
      logAct(`tentando ligar ${what}: clique simulado no <input>`);
      inner.focus();
      inner.click();
      await human(700, 1200);
      if (controlState(ctrl)) { logAct(`✓ ${what} ligado`); return; }
    }
    throw new Error(`${what} não ficou ligado (tentei ${tries.length} formas de clicar)`);
  }

  async function markBrandedContent() {
    let disclose = findByText(L.disclose)[0];
    if (!disclose) {
      const more = findByText(L.showMore, { exact: true })[0] || findByText(L.showMore)[0];
      if (more) {
        logAct(`abrindo "${(more.innerText || '').trim()}"`);
        await click(more);
        await human(1000, 1600);
      }
      disclose = await waitFor(() => findByText(L.disclose)[0], { timeout: 10000, what: 'opção "Divulgar conteúdo do vídeo"' });
    }
    await bringIntoView(disclose);
    await human(500, 900);
    const toggle = controlNear(disclose);
    if (!toggle) throw new Error('não achei o botão liga/desliga de "Divulga o conteúdo da publicação"');
    await ensureChecked(toggle, disclose, '"Divulga o conteúdo da publicação"');
    await human(600, 1000);
    await dismissPopups();
    const branded = await waitFor(() => findByText(L.brandedContent)[0], { timeout: 10000, what: 'opção "Conteúdo de marca"' });
    const box = controlNear(branded);
    if (!box) throw new Error('não achei a caixa de "Conteúdo de marca"');
    await ensureChecked(box, branded, '"Conteúdo de marca"');
    await human(800, 1400);
    // Pode abrir um aviso sobre a política de conteúdo de marca — confirma
    const d = topDialog();
    if (d && /marca|brand/.test(norm(d.innerText))) {
      const ok = findByText(L.dismiss.concat(L.confirmPost), { within: d, exact: true })[0];
      if (ok) { await click(ok); await human(); }
    }
    if (!controlState(box)) throw new Error('"Conteúdo de marca" não ficou marcado');
    if (!controlState(toggle)) throw new Error('"Divulga o conteúdo da publicação" desligou sozinho');
    logAct('✓ "Conteúdo de marca" marcado');
  }

  // ---------- agendar ("Quando publicar: Agendar" + data + hora) ----------
  const MONTHS = [
    ['jan', 'janeiro', 'january'], ['fev', 'fevereiro', 'feb', 'february'], ['mar', 'marco', 'march'], ['abr', 'abril', 'apr', 'april'],
    ['mai', 'maio', 'may'], ['jun', 'junho', 'june'], ['jul', 'julho', 'july'], ['ago', 'agosto', 'aug', 'august'],
    ['set', 'setembro', 'sep', 'sept', 'september'], ['out', 'outubro', 'oct', 'october'], ['nov', 'novembro', 'november'], ['dez', 'dezembro', 'dec', 'december'],
  ];
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtAt = (d) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  function monthIn(text) {
    const words = tokens(text);
    for (let i = 0; i < MONTHS.length; i++) if (words.some((w) => MONTHS[i].includes(w))) return i;
    return -1;
  }
  const leafs = (root = document.body) => [...root.querySelectorAll('*')].filter((e) => !e.children.length && visible(e));
  const numText = (e) => { const t = (e.textContent || '').trim(); return /^\d{1,2}$/.test(t) ? Number(t) : null; };

  // Campo de hora ("14:25") e de data ("19 de nov de …") que aparecem depois de escolher "Agendar".
  function scheduleFields() {
    const outside = (e) => !e.closest('[role="dialog"], [aria-modal="true"], [contenteditable="true"], video, [class*="layer"], [class*="Player"], [class*="player"]');
    const all = leafs();
    const date = all.find((e) => /^\d{1,2}\s+(de\s+)?[a-zç]{3}/i.test((e.textContent || '').trim()) && monthIn(e.textContent) >= 0 && outside(e));
    if (!date) return null;
    // a hora é o campo "HH:MM" mais perto da data (o player do vídeo também mostra "00:15")
    const d = date.getBoundingClientRect();
    const time = all.filter((e) => /^\d{1,2}:\d{2}$/.test((e.textContent || '').trim()) && outside(e))
      .map((e) => { const r = e.getBoundingClientRect(); return { e, dist: Math.abs(r.top - d.top) * 3 + Math.abs(r.left - d.left) }; })
      .sort((a, b) => a.dist - b.dist)[0]?.e;
    return time ? { time, date } : null;
  }
  const fieldBox = (el) => el.closest('input, [role="combobox"], [aria-haspopup], button, [tabindex]:not([tabindex="-1"])') || clickable(el);
  function readField(el) {
    const box = fieldBox(el);
    const raw = ((box.matches('input') ? box.value : box.innerText) || el.textContent || '').replace(/\s+/g, ' ').trim();
    const tm = raw.match(/\b(\d{1,2}):(\d{2})\b/);
    if (tm && /^\D{0,3}\d{1,2}:\d{2}\D{0,3}$/.test(raw)) return `${pad2(tm[1])}:${tm[2]}`; // campo de hora ("18:05 ⌄" → "18:05")
    return raw.replace(/[⌄˅▾▼]/g, '').trim();
  }

  // Liga o "Agendar" e confirma o aviso "Permitir que o teu vídeo seja guardado…".
  async function chooseScheduleMode() {
    const radioText = () => findByText(L.scheduleOption, { exact: true })
      .filter((e) => !e.closest('button, [role="button"]') || e.closest('label, [role="radio"]'))
      .find((e) => { const c = controlNear(e); return c && (c.matches('input[type="radio"], [role="radio"]') || c.querySelector?.('input[type="radio"]')); });
    const label = await waitFor(radioText, { timeout: 20000, what: 'opção "Agendar" em "Quando publicar"' });
    const radio = controlNear(label);
    if (!controlState(radio)) {
      await click(label);
      await human(700, 1300);
    }
    // aviso de permissão (aparece na 1ª vez)
    const dlg = await waitFor(() => {
      const d = topDialog();
      if (d && findByText(L.allowSchedule, { within: d, exact: true }).length) return d;
      return scheduleFields() ? 'none' : null;
    }, { timeout: 12000, what: 'aviso "Permitir" ou campos de data e hora' });
    if (dlg !== 'none') {
      logAct(`aviso do TikTok: "${(dlg.innerText || '').replace(/\s+/g, ' ').slice(0, 160)}" → Permitir`);
      const ok = findByText(L.allowSchedule, { within: dlg, exact: true }).map(clickable).find((b) => !disabled(b));
      await click(ok);
      await human(800, 1400);
    }
    if (!controlState(radio)) {
      await click(label);
      await human(700, 1200);
    }
    if (!controlState(radio)) throw new Error('não consegui ligar a opção "Agendar"');
    return waitFor(scheduleFields, { timeout: 15000, what: 'campos de data e hora do agendamento' });
  }

  // Elementos novos (números) que apareceram depois de abrir um seletor.
  function newNumberLeafs(before) {
    return leafs().filter((e) => numText(e) != null && !before.has(e) && !e.closest('[data-e2e="caption_container"]'));
  }
  async function closePicker() {
    const head = findByText(L.whenToPost)[0];
    if (head) await click(head, { raw: true });
    else await pressEnter(document.body);
    await human(400, 800);
  }

  async function pickDate(fields, target) {
    const want = target.getDate();
    const wantMonth = target.getMonth();
    const cur = readField(fields.date);
    const curDay = Number((cur.match(/^\D*(\d{1,2})/) || [])[1]);
    const curMonth = monthIn(cur);
    if (curDay === want && (curMonth < 0 || curMonth === wantMonth)) { logAct(`data já certa: "${cur}"`); return; }
    const before = new Set(leafs().filter((e) => numText(e) != null));
    await click(fieldBox(fields.date));
    await human(600, 1100);
    for (let flip = 0; flip < 3; flip++) {
      const cells = await waitFor(() => { const c = newNumberLeafs(before).filter((e) => numText(e) <= 31); return c.length >= 20 ? c : null; }, { timeout: 8000, what: 'calendário' });
      // células do mês mostrado: a sequência que começa no primeiro "1"
      const first = cells.findIndex((e) => numText(e) === 1);
      const run = [];
      for (const c of cells.slice(first)) { if (numText(c) === run.length + 1) run.push(c); else if (run.length > 27) break; }
      // descobre o mês mostrado pelo título do calendário
      let root = cells[0];
      for (let i = 0; i < 6 && root.parentElement && !(cells.every((c) => root.contains(c))); i++) root = root.parentElement;
      for (let i = 0; i < 3 && root.parentElement && monthIn(root.innerText) < 0; i++) root = root.parentElement;
      const shown = monthIn((root.innerText || '').split('\n').slice(0, 4).join(' '));
      logAct(`calendário aberto (mês ${shown >= 0 ? MONTHS[shown][1] : '?'}, ${run.length} dias)`);
      if (shown >= 0 && shown !== wantMonth) {
        const btns = [...root.querySelectorAll('button, [role="button"], [class*="arrow"], [class*="Arrow"], [class*="next"], [class*="Next"], svg')]
          .map((b) => clickable(b.closest('button, [role="button"]') || b)).filter((b) => visible(b) && !numText(b) && !(b.innerText || '').trim());
        const next = btns.find((b) => /next|proxim|seguinte|right/i.test(`${b.getAttribute('aria-label') || ''} ${b.className?.baseVal ?? b.className}`)) || btns.sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left)[0];
        if (!next) throw new Error('não achei a seta para o próximo mês no calendário');
        logAct('calendário: indo para o próximo mês');
        await click(next, { raw: true });
        await human(500, 900);
        continue;
      }
      const cell = run[want - 1];
      if (!cell) throw new Error(`não achei o dia ${want} no calendário`);
      if (disabled(cell) || disabled(cell.parentElement) || /disabled/i.test(String(cell.parentElement?.className))) throw new Error(`o dia ${want} está bloqueado no calendário do TikTok`);
      await click(cell);
      await human(600, 1000);
      break;
    }
    if (newNumberLeafs(before).length >= 20) await closePicker();
    const now = readField(scheduleFields()?.date || fields.date);
    const d = Number((now.match(/^\D*(\d{1,2})/) || [])[1]);
    const m = monthIn(now);
    logAct(`data no campo: "${now}"`);
    if (d !== want || (m >= 0 && m !== wantMonth)) throw new Error(`a data não ficou certa (queria ${pad2(want)}/${pad2(wantMonth + 1)}, ficou "${now}")`);
  }

  // Seletor de hora: duas colunas que rolam (horas e minutos de 5 em 5).
  async function pickTime(fields, target) {
    const want = `${pad2(target.getHours())}:${pad2(target.getMinutes())}`;
    const norm5 = (t) => t.replace(/^(\d):/, '0$1:');
    if (norm5(readField(fields.time)) === want) { logAct(`hora já certa: ${want}`); return; }
    for (let attempt = 1; attempt <= 2; attempt++) {
      const before = new Set(leafs().filter((e) => numText(e) != null));
      const box = fieldBox(scheduleFields()?.time || fields.time);
      await click(box);
      await human(600, 1000);
      const cols = await waitFor(() => {
        const items = [...document.querySelectorAll('*')].filter((e) => !e.children.length && numText(e) != null && !before.has(e) && e.isConnected && e.getBoundingClientRect().width > 0);
        const groups = new Map();
        for (const it of items) { const k = it.closest('ul, ol, [role="listbox"]') || scroller(it) || it.parentElement; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
        const g = [...groups.entries()].filter(([, v]) => v.length >= 4);
        if (g.length < 2) return null;
        const minutes = g.find(([, v]) => v.some((e) => numText(e) > 23)) || [...g].sort((a, b) => b[0].getBoundingClientRect().left - a[0].getBoundingClientRect().left)[0];
        const hours = g.filter((x) => x !== minutes).sort((a, b) => a[0].getBoundingClientRect().left - b[0].getBoundingClientRect().left)[0];
        return hours && minutes ? { hours, minutes } : null;
      }, { timeout: 8000, what: 'lista de horas e minutos' });
      for (const [name, [col], value] of [['hora', cols.hours, target.getHours()], ['minuto', cols.minutes, target.getMinutes()]]) {
        let item = null;
        for (let i = 0; i < 30 && !item; i++) {
          item = [...col.querySelectorAll('*')].find((e) => !e.children.length && numText(e) === value);
          if (item) break;
          // lista virtual: rola a coluna até o número aparecer
          const vals = [...col.querySelectorAll('*')].map(numText).filter((n) => n != null);
          const sc = scroller(col.firstElementChild || col) || col;
          sc.scrollTop += (vals.length && value < Math.min(...vals) ? -1 : 1) * 120;
          await sleep(150);
        }
        if (!item) throw new Error(`não achei ${name} ${pad2(value)} no seletor de hora`);
        if (disabled(item) || disabled(item.parentElement)) throw new Error(`${name} ${pad2(value)} está bloqueado no seletor (horário muito próximo?)`);
        const sc = scroller(item);
        if (sc) {
          const r = item.getBoundingClientRect();
          const b = sc.getBoundingClientRect();
          if (r.top < b.top || r.bottom > b.bottom) { item.scrollIntoView({ block: 'center', behavior: HUMAN ? 'smooth' : 'auto' }); await human(300, 600); }
        }
        logAct(`seletor de hora: ${name} ${pad2(value)}`);
        await click(item, { raw: true });
        await human(500, 900);
      }
      if (newNumberLeafs(before).length >= 8) await closePicker();
      const got = norm5(readField(scheduleFields()?.time || fields.time));
      logAct(`hora no campo: "${got}"`);
      if (got === want) return;
      if (attempt === 2) throw new Error(`a hora não ficou certa (queria ${want}, ficou "${got}")`);
    }
  }

  async function setSchedule(job) {
    // o TikTok exige pelo menos 15 min de antecedência: se o formulário demorou, empurra o horário
    let at = Number(job.scheduleAt);
    const min = Math.ceil((Date.now() + 20 * 60000) / 300000) * 300000;
    if (at < min) { logAct(`o horário ${fmtAt(new Date(at))} ficou perto demais → ${fmtAt(new Date(min))}`); at = min; }
    const target = new Date(at);
    logAct(`🗓 agendando para ${fmtAt(target)}`);
    const fields = await chooseScheduleMode();
    logAct(`campos: data "${readField(fields.date)}" · hora "${readField(fields.time)}"`);
    await pickDate(fields, target);
    await human(500, 900);
    await pickTime(scheduleFields() || fields, target);
    scheduledAt = at;
    logAct(`✓ agendamento preenchido: ${fmtAt(target)}`);
  }

  // ---------- publicar ----------
  async function publish() {
    const btn = await waitFor(() => { const b = findPostButton(); return b && !disabled(b) ? b : null; }, { timeout: 60000, what: 'botão Publicar habilitado' });
    await human(1200, 2500);
    if (JOB?.scheduleAt) {
      const t = norm(btn.innerText);
      logAct(`botão final: "${(btn.innerText || '').trim()}"`);
      if (t && !L.scheduleOption.some((w) => t.includes(norm(w)))) throw new Error(`o botão final diz "${(btn.innerText || '').trim()}" e não "Agendar" — não cliquei para não publicar na hora errada`);
      const f = scheduleFields();
      if (f && scheduledAt) {
        const want = `${pad2(new Date(scheduledAt).getHours())}:${pad2(new Date(scheduledAt).getMinutes())}`;
        const got = readField(f.time).replace(/^(\d):/, '0$1:');
        if (got !== want) throw new Error(`a hora mudou antes de agendar (queria ${want}, está "${got}")`);
      }
    }
    const beforeText = norm(document.body.innerText);
    const beforePath = location.pathname;
    clickedPublish = true;
    await click(btn);
    // Confirmações que podem aparecer depois de clicar em Publicar
    const end = Date.now() + 150000;
    while (Date.now() < end) {
      await sleep(1500);
      if (isSuccess(beforeText, beforePath)) return;
      const d = topDialog();
      if (d) {
        const c = findByText(L.confirmPost, { within: d, exact: true }).map(clickable).find((b) => !disabled(b));
        if (c) { await click(c); continue; }
      }
    }
    throw new Error(`cliquei em ${JOB?.scheduleAt ? 'Agendar' : 'Publicar'}, mas não vi a confirmação`);
  }

  // Sucesso = a página foi para "Meus posts", ou apareceu uma mensagem de sucesso que não existia antes do clique.
  function isSuccess(beforeText, beforePath) {
    if (location.pathname !== beforePath && /\/tiktokstudio\/content|\/creator-center\/content/.test(location.pathname)) return true;
    const body = norm(document.body.innerText);
    return L.success.some((w) => { const n = norm(w); return body.includes(n) && !beforeText.includes(n); });
  }

  // Página de login no lugar do TikTok Studio = sessão caiu.
  function isLoggedOut() {
    if (/\/login|\/signup/i.test(location.pathname)) return true;
    if (findFileInput() || findCaptionEditor()) return false;
    const body = norm(document.body?.innerText);
    return /(entrar no tiktok|fazer login|faca login|log in to tiktok|sign up for tiktok|usar telefone \/ e-mail|use phone \/ email)/.test(body);
  }

  async function runJob(job) {
    JOB = job;
    L = job.labels || {};
    actLog = [];
    pendingLog = [];
    linkedProduct = null;
    writtenCaption = null;
    clickedPublish = false;
    scheduledAt = null;
    trustedOk = true;
    scale = null;
    aborted = false;
    pageError = null;
    HUMAN = job.speed !== 'normal';
    SPEED = HUMAN ? 2.2 : 1;
    logAct(`início: ${job.dryRun ? 'TESTE (não publica)' : 'POSTAGEM'} · vídeo ${job.path} · produto "${job.productName}" · modo ${HUMAN ? 'humano' : 'normal'} · ${location.href}`);
    try {
      baselineErrors = errorPhrases();
      if (baselineErrors.length) logAct(`(textos de erro já presentes antes de começar, ignorados: ${baselineErrors.join(', ')})`);
      await step('Aguardando a página de upload', () => waitFor(findFileInput, { timeout: 60000, what: 'página de upload carregada (você está logado no TikTok?)' }));
      await dismissPopups();
      await discardOldDraft();
      const file = await step('Lendo o vídeo da pasta', () => fetchVideo(job.path));
      await step('Enviando o vídeo', () => uploadVideo(file));
      // A legenda só depois do envio terminar: ao concluir o envio, o TikTok redefine a descrição
      // interna para o nome do arquivo (a tela continua mostrando o texto digitado antes).
      await step('Aguardando o envio terminar', () => waitUploadDone());
      await human(1500, 2500);
      await step('Escrevendo a legenda', () => writeCaption(job.caption));
      await dismissPopups();
      if (job.linkProduct && (job.productId || job.productQuery)) await step('Vinculando o produto (carrinho)', () => linkProduct(job));
      if (job.brandedContent) await step('Marcando "Conteúdo de marca"', () => markBrandedContent());
      await dismissPopups();
      if (job.scheduleAt) await step('Escolhendo data e hora (Agendar)', () => setSchedule(job));
      if (job.dryRun) {
        logAct(`✅ teste concluído — nada foi ${job.scheduleAt ? 'agendado' : 'publicado'}`);
        report('job-result', { jobId: job.id, ok: true, step: 'Teste concluído (não publicado)', log: fmtLog(), linkedProduct, scheduledAt });
        return;
      }
      checkCaptionBeforePublish();
      await step(job.scheduleAt ? 'Agendando' : 'Publicando', () => publish());
      logAct(job.scheduleAt ? `✅ agendado para ${fmtAt(new Date(scheduledAt))}` : '✅ publicado');
      report('job-result', { jobId: job.id, ok: true, step: job.scheduleAt ? 'Agendado' : 'Publicado', url: location.href, log: fmtLog(), linkedProduct, scheduledAt });
    } catch (e) {
      if (aborted) return;
      logAct(`❌ ${e.message || e}`);
      report('job-result', { jobId: job.id, ok: false, error: e.message || String(e), step: currentStep, diag: diagnose(), log: fmtLog(), linkedProduct, clickedPublish, scheduledAt, loggedOut: !clickedPublish && !pageError && isLoggedOut(), pageError: !!pageError, unavailable: !!e.unavailable });
    }
  }

  // Importação da vitrine: abre o formulário (com um vídeo da pasta, sem publicar) e lê todos os produtos.
  async function runSync(job) {
    JOB = job;
    L = job.labels || {};
    actLog = [];
    pendingLog = [];
    aborted = false;
    trustedOk = true;
    scale = null;
    pageError = null;
    HUMAN = job.speed !== 'normal';
    SPEED = HUMAN ? 1.6 : 1;
    logAct(`início: IMPORTAR VITRINE · usando o vídeo ${job.path} só para abrir o formulário (nada é publicado)`);
    try {
      baselineErrors = errorPhrases();
      await step('Aguardando a página de upload', () => waitFor(findFileInput, { timeout: 60000, what: 'página de upload carregada (você está logado no TikTok?)' }));
      await dismissPopups();
      await discardOldDraft();
      const file = await step('Lendo o vídeo da pasta', () => fetchVideo(job.path));
      await step('Enviando o vídeo', () => uploadVideo(file));
      await dismissPopups();
      const items = await step('Lendo sua vitrine', () => readShowcase());
      logAct(`✅ ${items.length} produtos lidos da vitrine`);
      report('sync-result', { jobId: job.id, ok: true, items, log: fmtLog() });
    } catch (e) {
      if (aborted) return;
      logAct(`❌ ${e.message || e}`);
      report('sync-result', { jobId: job.id, ok: false, error: e.message || String(e), step: currentStep, diag: diagnose(), log: fmtLog(), loggedOut: !pageError && isLoggedOut() });
    }
  }

  if (window.__ttapExpose) window.__ttapDebug = { controlNear, findByText, readResults, matchProduct, topDialog, isOn, parseRow, nextPageButton, findAddLinkButton, setLabels: (l) => { L = l; } };

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg?.type === 'run-job') {
      sendResponse({ accepted: true });
      if (!JOB || JOB.id !== msg.job.id) runJob(msg.job);
      return false;
    }
    if (msg?.type === 'run-sync') {
      sendResponse({ accepted: true });
      if (!JOB || JOB.id !== msg.job.id) runSync(msg.job);
      return false;
    }
    if (msg?.type === 'abort-job') {
      aborted = true;
      sendResponse({ ok: true });
      return false;
    }
    if (msg?.type === 'inspect') {
      sendResponse(diagnose());
      return false;
    }
    return false;
  });
})();
