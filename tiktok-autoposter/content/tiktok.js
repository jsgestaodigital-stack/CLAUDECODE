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
  let clickedPublish = false;
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

  // Clique "humano": rola até o elemento, leva o mouse até ele em vários passos, para em cima
  // um instante, pressiona, solta e só então clica.
  async function click(el, { raw = false } = {}) {
    if (!raw) el = clickable(el);
    const r0 = el.getBoundingClientRect();
    if (r0.top < 60 || r0.bottom > innerHeight - 60) {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: HUMAN ? 'smooth' : 'auto' });
      await human(350, 700);
    }
    const r = el.getBoundingClientRect();
    const x = r.left + r.width * rnd(0.35, 0.65);
    const y = r.top + r.height * rnd(0.35, 0.65);
    logAct(`🖱 clicando em ${describe(el)}`);
    if (HUMAN) {
      const steps = Math.round(rnd(6, 14));
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        const ease = k * k * (3 - 2 * k);
        const mx = lastMouse.x + (x - lastMouse.x) * ease + rnd(-2, 2);
        const my = lastMouse.y + (y - lastMouse.y) * ease + rnd(-2, 2);
        const target = document.elementFromPoint(mx, my) || document.body;
        target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window, clientX: mx, clientY: my }));
        await sleep(rnd(12, 35));
      }
    }
    lastMouse = { x, y };
    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerover', { ...opts, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mouseover', opts));
    el.dispatchEvent(new PointerEvent('pointerenter', { ...opts, bubbles: false, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mouseenter', { ...opts, bubbles: false }));
    await human(120, 380);
    el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    await sleep(rnd(60, 160));
    el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
    await human(400, 900);
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

  async function writeCaption(caption) {
    const ed = await waitFor(findCaptionEditor, { timeout: 180000, what: 'campo de legenda' });
    logAct(`campo de legenda: ${describe(ed)} · texto atual: "${(ed.innerText || '').trim().slice(0, 80)}"`);
    await human(800, 1500);
    await click(ed);
    // seleciona o texto atual (o TikTok preenche com o nome do arquivo); a 1ª colagem substitui tudo
    selectAllIn(ed);
    await human(300, 700);
    if (!HUMAN) {
      logAct(`⌨ colando a legenda (${caption.length} caracteres)`);
      pasteText(ed, caption);
      await sleep(800);
    } else {
      // escreve em pedaços de 1 a 3 palavras, com pausas de quem está digitando
      logAct(`⌨ escrevendo a legenda em ritmo humano (${caption.length} caracteres)`);
      const parts = caption.match(/\n+|[^\s]+[ \t]*/g) || [caption];
      let i = 0;
      let first = true;
      while (i < parts.length) {
        const n = parts[i].startsWith('\n') ? 1 : Math.min(parts.length - i, Math.round(rnd(1, 3)));
        const chunk = parts.slice(i, i + n).join('');
        if (!first) caretToEnd(ed);
        pasteText(ed, chunk);
        first = false;
        i += n;
        await sleep(rnd(140, 420) * (chunk.includes('\n') ? 2.5 : 1));
        if (Math.random() < 0.08) await human(500, 1400); // pausa para "pensar"
      }
      await sleep(900);
    }
    const probe = norm(caption.split('\n')[0]).slice(0, 25);
    logAct(`legenda no campo: "${(ed.innerText || '').replace(/\s+/g, ' ').slice(0, 140)}"`);
    if (!editorText(ed).includes(probe)) throw new Error('a legenda não ficou no campo (o editor não aceitou o texto)');
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
    await click(search);
    await typeInto(search, query);
    await human(250, 600);
    logAct('⏎ Enter na busca');
    key(search, 'Enter', 'Enter', 13);
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
        await click(nameInput);
        await typeInto(nameInput, label.slice(0, 30));
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
      if (t.matches('input')) { t.focus(); t.click(); } else await click(t, { raw: true });
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
    disclose.scrollIntoView({ block: 'center', behavior: HUMAN ? 'smooth' : 'auto' });
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

  // ---------- publicar ----------
  async function publish() {
    const btn = await waitFor(() => { const b = findPostButton(); return b && !disabled(b) ? b : null; }, { timeout: 60000, what: 'botão Publicar habilitado' });
    await human(1200, 2500);
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
    throw new Error('cliquei em Publicar, mas não vi a confirmação de publicação');
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
    clickedPublish = false;
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
      await step('Escrevendo a legenda', () => writeCaption(job.caption));
      await step('Aguardando o envio terminar', () => waitUploadDone());
      await dismissPopups();
      if (job.linkProduct && (job.productId || job.productQuery)) await step('Vinculando o produto (carrinho)', () => linkProduct(job));
      if (job.brandedContent) await step('Marcando "Conteúdo de marca"', () => markBrandedContent());
      await dismissPopups();
      if (job.dryRun) {
        logAct('✅ teste concluído — nada foi publicado');
        report('job-result', { jobId: job.id, ok: true, step: 'Teste concluído (não publicado)', log: fmtLog(), linkedProduct });
        return;
      }
      await step('Publicando', () => publish());
      logAct('✅ publicado');
      report('job-result', { jobId: job.id, ok: true, step: 'Publicado', url: location.href, log: fmtLog(), linkedProduct });
    } catch (e) {
      if (aborted) return;
      logAct(`❌ ${e.message || e}`);
      report('job-result', { jobId: job.id, ok: false, error: e.message || String(e), step: currentStep, diag: diagnose(), log: fmtLog(), linkedProduct, clickedPublish, loggedOut: !clickedPublish && !pageError && isLoggedOut(), pageError: !!pageError, unavailable: !!e.unavailable });
    }
  }

  // Importação da vitrine: abre o formulário (com um vídeo da pasta, sem publicar) e lê todos os produtos.
  async function runSync(job) {
    JOB = job;
    L = job.labels || {};
    actLog = [];
    pendingLog = [];
    aborted = false;
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
