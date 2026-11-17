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
  let stepLog = [];
  let JOB = null;
  let linkedProduct = null;
  let clickedPublish = false;
  let aborted = false;
  let lastBeat = 0;

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
  }
  const human = (min = 350, max = 900) => sleep(min + Math.random() * (max - min));
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

  async function waitFor(fn, { timeout = 30000, interval = 400, what = 'elemento' } = {}) {
    const end = Date.now() + timeout;
    let last;
    while (Date.now() < end) {
      try { last = await fn(); } catch (_) { last = null; }
      if (last) return last;
      await sleep(interval);
    }
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

  // Elemento clicável para um texto: o próprio controle/botão, ou o único botão "vizinho" de um rótulo.
  function clickable(el) {
    if (!el) return el;
    if (el.matches(CONTROL) || el.matches('button, [role="button"], a')) return el;
    const own = el.closest(CLICKABLE);
    if (own && !isDialogRoot(own)) return own;
    let node = el.parentElement;
    for (let i = 0; i < 3 && node && !isDialogRoot(node); i++) {
      const btns = [...node.querySelectorAll('button, [role="button"]')].filter(visible);
      if (btns.length === 1) return btns[0];
      if (btns.length > 1) break;
      node = node.parentElement;
    }
    return el;
  }

  async function click(el) {
    el = clickable(el);
    el.scrollIntoView({ block: 'center', inline: 'center' });
    await human(200, 500);
    const r = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerover', opts));
    el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
    await human();
  }

  function setInputValue(input, value) {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    input.focus();
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
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
    stepLog.push(`${new Date().toLocaleTimeString('pt-BR')} • ${name}`);
    lastBeat = Date.now();
    report('job-progress', { jobId: JOB?.id, step: name });
    return fn();
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
      await click(btn);
      await sleep(600);
    }
  }

  async function uploadVideo(file) {
    const input = await waitFor(findFileInput, { timeout: 60000, what: 'campo de envio de vídeo' });
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

  async function writeCaption(caption) {
    const ed = await waitFor(findCaptionEditor, { timeout: 180000, what: 'campo de legenda' });
    await human(800, 1500);
    ed.focus();
    // limpa o texto atual (o TikTok preenche com o nome do arquivo)
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    await sleep(300);

    // 1ª tentativa: colar (o editor do TikTok aceita colar com quebras de linha)
    const dt = new DataTransfer();
    dt.setData('text/plain', caption);
    ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await sleep(800);

    const probe = norm(caption.split('\n')[0]).slice(0, 25);
    if (!editorText(ed).includes(probe)) {
      // 2ª tentativa: digitar linha a linha
      ed.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      const lines = caption.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]) document.execCommand('insertText', false, lines[i]);
        if (i < lines.length - 1) key(ed, 'Enter', 'Enter', 13);
        await sleep(120);
      }
      await sleep(600);
    }
    // fecha a lista de sugestões de hashtag, se abriu
    key(ed, 'Escape', 'Escape', 27);
    await sleep(300);
    if (!editorText(ed).includes(probe)) throw new Error('a legenda não ficou no campo');
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
  // Linha de um resultado: sobe a partir do controle até o bloco que contém só ele.
  function rowOf(ctrl, dlg) {
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

  function readResults(dlg) {
    if (!dlg || !dlg.isConnected) return null;
    const ctrls = [...dlg.querySelectorAll(CONTROL)].filter(shown);
    const rows = [];
    for (const c of ctrls) {
      const row = rowOf(c, dlg);
      // o mesmo produto pode ter um <input> escondido + um [role=radio] visível: conta uma vez só
      if (rows.some((r) => r.row === row || r.row.contains(row) || row.contains(r.row))) continue;
      const text = (row.innerText || '').trim().replace(/\s+/g, ' ');
      if (!text) continue;
      rows.push({ el: c, row, text, html: row.outerHTML.slice(0, 5000) });
    }
    return rows.length ? rows : null;
  }
  const signature = (rows) => (rows || []).map((r) => r.text).join('|');

  // Regras (palavras inteiras, números incluídos):
  // - ID: o número precisa aparecer no item (texto ou atributos). Se a busca pelo ID devolver
  //   um único item, diferente da lista que estava antes da busca, ele é aceito.
  // - Nome: a sequência de palavras da busca aparece no item; ou todas as palavras aparecem.
  // - Nenhum ou mais de um compatível → ERRO (não posta com produto errado).
  function matchProduct(rows, query, listChanged) {
    const q = tokens(query);
    const isId = /^\d{6,}$/.test(String(query).trim());
    const list = rows.slice(0, 5).map((r) => `"${r.text.slice(0, 60)}"`).join(', ');
    let m;
    if (isId) {
      const id = String(query).trim();
      m = rows.filter((r) => tokens(r.text).includes(id) || new RegExp(`(^|[^0-9])${id}([^0-9]|$)`).test(r.html));
      if (!m.length && rows.length === 1 && listChanged) m = rows;
    } else {
      const phrase = ` ${q.join(' ')} `;
      m = rows.filter((r) => ` ${tokens(r.text).join(' ')} `.includes(phrase));
      if (!m.length) m = rows.filter((r) => { const t = new Set(tokens(r.text)); return q.every((w) => t.has(w)); });
    }
    if (!m.length) throw new Error(`nenhum produto da busca corresponde a "${query}" — não vinculei nada para não errar o link. Resultados vistos: ${list}`);
    if (m.length > 1) {
      const exact = m.filter((r) => tokens(r.text).slice(0, q.length).join(' ') === q.join(' '));
      if (exact.length === 1) return exact[0];
      throw new Error(`a busca "${query}" encontrou ${m.length} produtos parecidos — use o ID do produto para garantir o link certo. Resultados: ${list}`);
    }
    return m[0];
  }

  async function linkProduct(query, label) {
    const addBtn = await waitFor(() => findByText(L.addLink)[0], { timeout: 20000, what: 'botão "Adicionar link"' });
    await click(addBtn);
    let dlg = await waitFor(topDialog, { timeout: 15000, what: 'janela de adicionar link' });
    await human(800, 1400);

    // Escolher o tipo "Produtos" (pode ser um seletor, uma aba ou já vir selecionado)
    const opt = findByText(L.productsOption, { within: dlg, exact: true })[0];
    if (opt) { await click(opt); await human(); }
    const next1 = findByText(L.next, { within: topDialog() || dlg, exact: true }).map(clickable).find((b) => !disabled(b));
    if (next1) { await click(next1); await human(1200, 2000); }

    dlg = await waitFor(topDialog, { timeout: 15000, what: 'janela de produtos' });
    const search = await waitFor(() => [...dlg.querySelectorAll('input[type="text"], input[type="search"], input:not([type])')].find(visible), { timeout: 20000, what: 'campo de busca de produto' });
    await human(800, 1500);
    const before = signature(readResults(topDialog()));
    setInputValue(search, query);
    await sleep(300);
    key(search, 'Enter', 'Enter', 13);

    // Espera a lista mudar (resultado da busca) e ficar estável
    let rows = null;
    let stable = 0;
    let prevSig = null;
    let listChanged = false;
    const end = Date.now() + 25000;
    while (Date.now() < end) {
      await sleep(700);
      const cur = readResults(topDialog());
      const sig = signature(cur);
      if (cur && sig !== before) listChanged = true;
      if (cur && sig === prevSig && (listChanged || Date.now() > end - 15000)) stable++; else stable = 0;
      prevSig = sig;
      rows = cur;
      if (rows && stable >= 2) break;
    }
    if (!rows) throw new Error(`a busca "${query}" não mostrou nenhum produto (confira se o produto está na sua vitrine de afiliado)`);
    const chosen = matchProduct(rows, query, listChanged);
    linkedProduct = chosen.text.slice(0, 160);
    stepLog.push(`✓ produto escolhido: ${linkedProduct}`);
    await click(chosen.el.matches('input') ? (chosen.el.closest('label') || chosen.el) : chosen.el);
    await human(800, 1400);
    if (!isOn(chosen.el)) { await click(chosen.el); await human(); }
    if (chosen.el.matches('input, [role="radio"], [role="checkbox"]') && !isOn(chosen.el)) throw new Error('não consegui selecionar o produto na lista');

    const listDlg = topDialog();
    const next2 = await waitFor(() => findByText(L.next.concat(L.add), { within: topDialog(), exact: true }).map(clickable).find((b) => !disabled(b)), { timeout: 15000, what: 'botão Próximo após escolher o produto' });
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
      await human(600, 1200);
      const nameInput = [...d3.querySelectorAll('input[maxlength], textarea[maxlength], input[type="text"], input:not([type])')].find((i) => visible(i) && i !== search);
      if (nameInput && label) { setInputValue(nameInput, label.slice(0, 30)); await human(); }
      const addFinal = await waitFor(() => findByText(L.add, { within: d3, exact: true }).map(clickable).find((b) => !disabled(b)), { timeout: 10000, what: 'botão Adicionar do produto' });
      await click(addFinal);
      await human(1500, 2500);
    }
    await waitFor(() => !dialogs().some((d) => /produto|product/.test(norm(d.innerText))), { timeout: 20000, what: 'fechamento da janela de produto' });

    // Confere o produto anexado fora do campo de legenda
    const ed = findCaptionEditor();
    const marks = [label, query].filter(Boolean);
    const appears = (m) => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        if (norm(n.nodeValue).includes(norm(m)) && !(ed && ed.contains(n)) && !n.parentElement?.closest('[role="dialog"], [aria-modal="true"]') && visible(n.parentElement)) return true;
      }
      return false;
    };
    const attached = await waitFor(() => marks.some(appears), { timeout: 8000, what: 'produto anexado' }).catch(() => false);
    stepLog.push(attached ? '✓ produto anexado aparece na página' : '⚠ não consegui ver o nome do produto anexado na página (confira o 1º post)');
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

  async function markBrandedContent() {
    let disclose = findByText(L.disclose)[0];
    if (!disclose) {
      const more = findByText(L.showMore)[0];
      if (more) { await click(more); await human(1000, 1600); }
      disclose = await waitFor(() => findByText(L.disclose)[0], { timeout: 10000, what: 'opção "Divulgar conteúdo do vídeo"' });
    }
    disclose.scrollIntoView({ block: 'center' });
    const toggle = controlNear(disclose);
    if (!toggle) throw new Error('não achei o botão liga/desliga de "Divulgar conteúdo do vídeo"');
    if (!isOn(toggle)) {
      await click(toggle);
      await human(1000, 1600);
      await dismissPopups();
    }
    if (!isOn(toggle)) throw new Error('"Divulgar conteúdo do vídeo" não ficou ligado');
    const branded = await waitFor(() => findByText(L.brandedContent)[0], { timeout: 10000, what: 'opção "Conteúdo de marca"' });
    const box = controlNear(branded);
    if (!box) throw new Error('não achei a caixa de "Conteúdo de marca"');
    if (!isOn(box)) await click(box);
    await human(1000, 1600);
    // Pode abrir um aviso sobre a política de conteúdo de marca — confirma
    const d = topDialog();
    if (d && /marca|brand/.test(norm(d.innerText))) {
      const ok = findByText(L.dismiss.concat(L.confirmPost), { within: d, exact: true })[0];
      if (ok) { await click(ok); await human(); }
    }
    if (!isOn(box)) throw new Error('"Conteúdo de marca" não ficou marcado');
    stepLog.push('✓ "Conteúdo de marca" marcado');
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

  async function runJob(job) {
    JOB = job;
    L = job.labels || {};
    stepLog = [];
    linkedProduct = null;
    clickedPublish = false;
    aborted = false;
    try {
      await step('Aguardando a página de upload', () => waitFor(findFileInput, { timeout: 60000, what: 'página de upload carregada (você está logado no TikTok?)' }));
      await dismissPopups();
      const file = await step('Lendo o vídeo da pasta', () => fetchVideo(job.path));
      await step('Enviando o vídeo', () => uploadVideo(file));
      await step('Escrevendo a legenda', () => writeCaption(job.caption));
      await step('Aguardando o envio terminar', () => waitUploadDone());
      await dismissPopups();
      if (job.productQuery) await step('Vinculando o produto (carrinho)', () => linkProduct(job.productQuery, job.productLabel));
      if (job.brandedContent) await step('Marcando "Conteúdo de marca"', () => markBrandedContent());
      await dismissPopups();
      if (job.dryRun) {
        report('job-result', { jobId: job.id, ok: true, step: 'Teste concluído (não publicado)', log: stepLog, linkedProduct });
        return;
      }
      await step('Publicando', () => publish());
      report('job-result', { jobId: job.id, ok: true, step: 'Publicado', url: location.href, log: stepLog, linkedProduct });
    } catch (e) {
      if (aborted) return;
      report('job-result', { jobId: job.id, ok: false, error: e.message || String(e), step: currentStep, diag: diagnose(), log: stepLog, linkedProduct, clickedPublish });
    }
  }

  if (window.__ttapExpose) window.__ttapDebug = { controlNear, findByText, readResults, matchProduct, topDialog, isOn, setLabels: (l) => { L = l; } };

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg?.type === 'run-job') {
      sendResponse({ accepted: true });
      if (!JOB || JOB.id !== msg.job.id) runJob(msg.job);
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
