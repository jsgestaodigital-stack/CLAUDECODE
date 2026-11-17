// Configurações padrão e textos usados para localizar elementos no TikTok Studio.
// Os textos são comparados em minúsculas, sem acentos e sem espaços extras.

export const UPLOAD_URL = 'https://www.tiktok.com/tiktokstudio/upload?from=webapp&lang=pt-BR';

export const DEFAULT_LABELS = {
  addLink: ['adicionar link', 'add link', 'adicionar produto', 'add product', 'adicionar produtos', 'add products'],
  productsOption: ['produtos', 'products', 'produto', 'product', 'tiktok shop'],
  next: ['proximo', 'avancar', 'next', 'continuar', 'continue'],
  add: ['adicionar', 'add', 'confirmar', 'confirm', 'salvar', 'save', 'concluir', 'done'],
  showMore: ['mostrar mais', 'show more', 'mais opcoes', 'more options', 'configuracoes avancadas', 'advanced settings', 'ver mais'],
  disclose: [
    'divulgar conteudo do video', 'divulgar conteudo da publicacao', 'divulgacao de conteudo',
    'divulgar conteudo', 'disclose video content', 'disclose post content', 'content disclosure',
  ],
  brandedContent: ['conteudo de marca', 'branded content'],
  post: ['publicar', 'post'],
  confirmPost: ['publicar agora', 'post now', 'publicar mesmo assim', 'post anyway', 'continuar', 'continue'],
  dismiss: ['entendi', 'got it', 'agora nao', 'not now', 'ok', 'fechar', 'close', 'pular', 'skip'],
  discardDraft: ['descartar', 'discard', 'nao, obrigado', 'no, thanks'],
  uploading: ['enviando', 'carregando', 'uploading', 'processando', 'processing'],
  uploaded: ['enviado', 'carregado', 'uploaded', 'upload concluido', 'upload complete'],
  success: [
    'video publicado', 'seu video foi publicado', 'publicacao concluida', 'your video has been uploaded',
    'video published', 'your video is being uploaded', 'gerenciar seus posts', 'manage your posts',
    'enviar outro video', 'upload another video', 'post publicado',
  ],
};

export const DEFAULT_SETTINGS = {
  intervalMinutes: 60,          // 5, 10, 15, 20, 30 ou 60
  jitterMinutes: 8,             // variação aleatória (+/-) para não postar sempre no mesmo minuto
  activeStartHour: 0,           // 0–23
  activeEndHour: 24,            // 1–24 (24 = até meia-noite)
  maxPerDay: 24,
  hashtagsCount: 5,
  videoOrder: 'name',           // 'name' | 'random'
  onExhausted: 'pause',         // 'pause' (produto para) | 'loop' (recomeça os vídeos do produto)
  brandedContent: true,         // marcar "Conteúdo de marca" (marca de terceiros)
  linkProduct: true,            // vincular produto do TikTok Shop
  foregroundTab: false,         // abrir a aba do TikTok em primeiro plano
  closeTabAfter: true,          // fechar a aba depois de postar
  maxRetries: 1,                // novas tentativas do mesmo vídeo em caso de falha
  pauseAfterFailures: 3,        // pausa tudo após N falhas seguidas
  uploadUrl: UPLOAD_URL,
  labels: DEFAULT_LABELS,
};
