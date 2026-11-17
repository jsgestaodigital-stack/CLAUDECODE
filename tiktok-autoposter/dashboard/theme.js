// Aplica o tema salvo antes de desenhar a página (escuro é o padrão).
(function () {
  let t = 'dark';
  try { t = localStorage.getItem('ttap-theme') || 'dark'; } catch (_) { /* sem armazenamento */ }
  document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark';
})();
