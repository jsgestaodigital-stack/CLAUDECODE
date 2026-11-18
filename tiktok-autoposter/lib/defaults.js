// Configurações padrão e textos usados para localizar elementos no TikTok Studio.
// Os textos são comparados em minúsculas, sem acentos e sem espaços extras.

export const UPLOAD_URL = 'https://www.tiktok.com/tiktokstudio/upload?from=webapp&lang=pt-BR';

export const DEFAULT_LABELS = {
  addLink: ['adicionar link', 'add link', 'adicionar produto', 'add product', 'adicionar produtos', 'add products'],
  productsOption: ['produtos', 'products', 'produto', 'product', 'tiktok shop'],
  next: ['seguinte', 'proximo', 'avancar', 'next', 'continuar', 'continue'],
  cancel: ['cancelar', 'cancel'],
  noResults: ['nenhum resultado', 'sem resultados', 'nenhum produto', 'no results', 'no products', 'nao encontrado', 'not found', 'sem dados', 'no data'],
  add: ['adicionar', 'add', 'confirmar', 'confirm', 'salvar', 'save', 'concluir', 'done'],
  showMore: ['mostrar mais', 'show more', 'mais opcoes', 'more options', 'configuracoes avancadas', 'advanced settings', 'ver mais'],
  disclose: [
    'divulga o conteudo da publicacao', 'divulga o conteudo', 'divulgar o conteudo da publicacao', 'divulgar conteudo do video', 'divulgar conteudo da publicacao', 'divulgacao de conteudo',
    'divulgar conteudo', 'disclose video content', 'disclose post content', 'content disclosure',
  ],
  brandedContent: ['conteudo de marca', 'branded content'],
  post: ['publicar', 'post'],
  confirmPost: ['publicar agora', 'post now', 'publicar mesmo assim', 'post anyway', 'continuar', 'continue'],
  dismiss: ['entendi', 'got it', 'agora nao', 'not now', 'ok', 'fechar', 'close', 'pular', 'skip'],
  discardDraft: ['eliminar', 'descartar', 'excluir', 'discard', 'delete', 'nao, obrigado', 'no, thanks'],
  // faixa "Um vídeo que estavas a editar não foi guardado. Continuar a editar?"
  draftBanner: ['nao foi guardado', 'nao foi salvo', 'continuar a editar', 'continuar editando', 'continue editing', 'was not saved', "wasn't saved"],
  uploading: ['enviando', 'carregando', 'uploading', 'processando', 'processing'],
  uploaded: ['enviado', 'carregado', 'uploaded', 'upload concluido', 'upload complete'],
  // mensagens da tela de erro do TikTok (a extensão para e registra quando uma delas aparece)
  pageError: [
    'algo deu errado', 'ocorreu um erro', 'ops, algo', 'something went wrong', 'an error occurred', 'oops, something',
    'erro de rede', 'network error', 'falha no upload', 'falha ao enviar', 'upload failed', 'nao foi possivel enviar',
    "couldn't upload", 'tente novamente mais tarde', 'please try again later', 'atualize a pagina', 'refresh the page',
  ],
  success: [
    'video publicado', 'seu video foi publicado', 'publicacao concluida', 'your video has been uploaded',
    'video published', 'your video is being uploaded', 'gerenciar seus posts', 'manage your posts',
    'enviar outro video', 'upload another video', 'post publicado',
  ],
};

// Junta os textos padrão com os salvos pelo usuário (os novos padrões nunca somem por causa
// de uma configuração antiga salva).
export function mergeLabels(saved) {
  const out = {};
  for (const k of new Set([...Object.keys(DEFAULT_LABELS), ...Object.keys(saved || {})])) {
    const own = Array.isArray(saved?.[k]) ? saved[k] : [];
    out[k] = [...new Set([...(DEFAULT_LABELS[k] || []), ...own].map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
  }
  return out;
}

export const DEFAULT_SETTINGS = {
  intervalMinutes: 60,          // 5, 10, 15, 20, 30 ou 60
  jitterMinutes: 8,             // variação aleatória (+/-) para não postar sempre no mesmo minuto
  activeStartHour: 0,           // 0–23
  activeEndHour: 24,            // 1–24 (24 = até meia-noite)
  maxPerDay: 24,
  hashtagsCount: 5,
  videoOrder: 'smart',          // 'smart' (alterna gancho/corpo/CTA pelo nome G#C#A#) | 'name' | 'random'
  onExhausted: 'pause',         // 'pause' (produto para) | 'loop' (recomeça os vídeos do produto)
  brandedContent: true,         // marcar "Conteúdo de marca" (marca de terceiros)
  linkProduct: true,            // vincular produto do TikTok Shop
  foregroundTab: true,         // abrir a aba do TikTok em primeiro plano
  closeTabAfter: true,          // fechar a aba depois de postar
  speed: 'human',               // 'human' (devagar, como uma pessoa) | 'normal'
  maxRetries: 1,                // novas tentativas do mesmo vídeo em caso de falha
  pauseAfterFailures: 3,        // pausa tudo após N falhas seguidas
  keepAwake: true,
  keepScreenOn: true,           // manter a tela ligada enquanto roda (evita o Windows "adormecer" rede/Chrome)              // impedir o computador de suspender enquanto estiver rodando
  telegramEnabled: false,       // avisos no celular pelo Telegram
  telegramToken: '',
  telegramChatId: '',
  telegramEachPost: false,      // avisar a cada post publicado
  telegramSummary: true,        // resumo diário
  telegramSummaryHour: 22,
  uploadUrl: UPLOAD_URL,
  labels: DEFAULT_LABELS,
};
