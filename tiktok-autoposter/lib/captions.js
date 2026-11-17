// Motor de legendas: monta textos de venda variados (gancho + benefício + chamada para o carrinho)
// e escolhe 5 hashtags do mesmo universo do produto, trocando só algumas a cada post.
//
// Regras:
// - O texto nunca repete um dos últimos 20 textos do mesmo produto, nem o mesmo gancho do post anterior.
// - Hashtags: 2 amplas (TikTok Shop / achadinhos) + 3 do nicho. Do post anterior para o próximo,
//   1 ou 2 hashtags mudam e as outras continuam — variação pequena e constante.
// - Frases escritas sem artigo antes do nome do produto ("esse/essa"), para servir a qualquer produto.

export const BROAD_HASHTAGS = [
  '#tiktokshop', '#achadinhos', '#tiktokmefezcomprar', '#achadostiktok', '#achadinhosdotiktok',
  '#fyp', '#viral', '#paravoce', '#promocao', '#oferta', '#comprasonline',
];

export const NICHES = {
  geral: {
    name: 'Geral / variados',
    tags: ['#utilidades', '#presente', '#ideiasdepresente', '#dicas', '#novidade', '#comprinhas', '#favoritos', '#custobeneficio', '#achados', '#dicasdecompras'],
    benefits: ['prático demais no dia a dia', 'qualidade que surpreende', 'preço que cabe no bolso', 'chega rapidinho', 'vale cada centavo', 'resolve de verdade'],
  },
  beleza: {
    name: 'Beleza e maquiagem',
    tags: ['#beleza', '#maquiagem', '#skincare', '#makeup', '#autocuidado', '#make', '#dicasdebeleza', '#cuidadoscomapele', '#belezanatural', '#rotinadeskincare'],
    benefits: ['deixa a pele com aspecto incrível', 'fácil de usar no dia a dia', 'resultado que dá pra ver', 'cabe na necessaire', 'acabamento lindo', 'perfeito pra rotina de autocuidado'],
  },
  cabelo: {
    name: 'Cabelo',
    tags: ['#cabelo', '#cabelos', '#cuidadoscomocabelo', '#cronogramacapilar', '#cabeloslindos', '#hair', '#penteado', '#cabelocacheado', '#escovasecadora', '#dicasdecabelo'],
    benefits: ['cabelo arrumado em poucos minutos', 'deixa os fios com brilho', 'fácil de usar sozinha em casa', 'economiza tempo de manhã', 'efeito de salão em casa', 'ajuda a controlar o frizz'],
  },
  casa: {
    name: 'Casa e organização',
    tags: ['#casa', '#decoracao', '#organizacao', '#casaorganizada', '#decor', '#lar', '#limpeza', '#dicasdecasa', '#utilidadesdomesticas', '#casanova'],
    benefits: ['deixa tudo mais organizado', 'economiza espaço', 'facilita a limpeza', 'deixa a casa mais bonita', 'prático demais no dia a dia', 'dura muito'],
  },
  cozinha: {
    name: 'Cozinha',
    tags: ['#cozinha', '#utensiliosdecozinha', '#cozinhaorganizada', '#receitas', '#dicasdecozinha', '#cozinhapratica', '#airfryer', '#comida', '#receitasfaceis', '#organizacaodecozinha'],
    benefits: ['agiliza o preparo das refeições', 'fácil de lavar', 'deixa a cozinha mais organizada', 'economiza tempo', 'muito resistente', 'facilita a vida de quem cozinha'],
  },
  eletronicos: {
    name: 'Eletrônicos e gadgets',
    tags: ['#tecnologia', '#eletronicos', '#gadgets', '#tech', '#acessorios', '#celular', '#fonedeouvido', '#smartwatch', '#setup', '#techtok'],
    benefits: ['bateria que dura muito', 'conecta rapidinho', 'som de qualidade', 'design bonito e moderno', 'muito fácil de usar', 'ótimo custo-benefício'],
  },
  moda: {
    name: 'Moda e roupas',
    tags: ['#moda', '#look', '#lookdodia', '#estilo', '#modafeminina', '#fashion', '#outfit', '#tendencia', '#modamasculina', '#provador'],
    benefits: ['caimento perfeito', 'tecido gostoso e confortável', 'combina com tudo', 'veste super bem', 'deixa o look mais estiloso', 'qualidade que surpreende'],
  },
  fitness: {
    name: 'Fitness e esporte',
    tags: ['#fitness', '#treino', '#academia', '#vidasaudavel', '#treinoemcasa', '#foco', '#bemestar', '#saude', '#motivacao', '#gym'],
    benefits: ['ajuda a manter o foco no treino', 'dá pra usar em casa', 'confortável e resistente', 'perfeito pra rotina de treino', 'fácil de levar pra academia', 'resultado que motiva'],
  },
  pet: {
    name: 'Pet',
    tags: ['#pet', '#cachorro', '#gato', '#petlovers', '#dog', '#cat', '#cachorros', '#petshop', '#amomeupet', '#gatos'],
    benefits: ['meu pet amou', 'fácil de limpar', 'deixa o pet mais confortável', 'resistente a mordidas', 'praticidade pra quem tem pet', 'diversão garantida pro pet'],
  },
  infantil: {
    name: 'Bebê e infantil',
    tags: ['#maternidade', '#bebe', '#maternidadereal', '#infantil', '#criancas', '#brinquedos', '#maedemenina', '#maedemenino', '#enxovaldebebe', '#dicasdemae'],
    benefits: ['facilita a rotina com as crianças', 'seguro e confortável', 'a criançada ama', 'prático pra levar a qualquer lugar', 'ajuda demais as mamães', 'qualidade que dá confiança'],
  },
  saude: {
    name: 'Saúde e bem-estar',
    tags: ['#saude', '#bemestar', '#autocuidado', '#qualidadedevida', '#saudavel', '#relaxamento', '#saudemental', '#rotina', '#cuidese', '#vidasaudavel'],
    benefits: ['ajuda a relaxar depois de um dia cansativo', 'fácil de encaixar na rotina', 'sensação de bem-estar na hora', 'prático e confortável', 'faz diferença no dia a dia', 'cuidado que você merece'],
  },
  auto: {
    name: 'Carro e moto',
    tags: ['#carro', '#carros', '#automotivo', '#acessoriosautomotivos', '#car', '#motorista', '#cuidadoscomocarro', '#moto', '#carrolimpo', '#dicasautomotivas'],
    benefits: ['deixa o carro mais organizado', 'instalação super fácil', 'mais conforto nas viagens', 'resistente e bem acabado', 'deixa o carro com cara de novo', 'prático pra quem dirige todo dia'],
  },
  acessorios: {
    name: 'Acessórios e bijuterias',
    tags: ['#acessorios', '#bijuterias', '#joias', '#relogio', '#bolsa', '#oculos', '#semijoias', '#estilo', '#presente', '#tendencia'],
    benefits: ['dá um up em qualquer look', 'acabamento lindo', 'presente perfeito', 'combina com tudo', 'parece muito mais caro', 'brilho que chama atenção'],
  },
};

const HOOKS = [
  'Para tudo e olha isso 👀',
  '{Achadinho|Achado} do dia ✨',
  'Eu não sabia que precisava disso até ver 😱',
  'Gente, que achado 😍',
  'Isso aqui tá {bombando|fazendo sucesso} no TikTok Shop 🔥',
  'Se você ainda não conhece, {anota aí|salva esse vídeo} 📌',
  '{Comprei|Testei} e não me arrependi 🙌',
  'O {queridinho|favorito} do momento 💖',
  'Quem {viu|conheceu}, quis na hora 😅',
  'Dica de ouro pra você 💡',
  'Testei e {aprovei|recomendo} ✅',
  'Melhor compra {do mês|que eu fiz} 🛍️',
  'Olha o que {chegou|acabou de chegar} 📦',
  'Não acredito que demorei tanto pra comprar 🤯',
  'Você {precisa|merece} conhecer isso 👇',
  'Esse vídeo é seu sinal pra comprar 😉',
  'Achado que vale {muito|cada centavo} 💸',
  '{Simples|Prático}, bonito e barato 😍',
  'Todo mundo tá {perguntando|pedindo} o link 👇',
  'Vício novo desbloqueado 🔓',
];

const PRODUCT_LINES = [
  '{produto}: {beneficio}.',
  '{produto} — {beneficio}.',
  'Com {produto} é assim: {beneficio}.',
  'O que eu mais amei em {produto}? {Beneficio}.',
  '{produto} {entrega|cumpre} o que promete: {beneficio}.',
  'Conheça {produto}: {beneficio} e {beneficio2}.',
  '{produto} virou {sucesso|tendência}: {beneficio}.',
  '{produto}: {beneficio} e {beneficio2}.',
];

const CTAS = [
  'Link no carrinho laranja 🛒',
  'Toca no carrinho e garante já 🛒',
  'Corre no carrinho e confere 🛒',
  'Tá no carrinho aqui do vídeo 🛒',
  'Clica no carrinho 🛒 e confere o preço',
  'Garante pelo carrinho aqui do vídeo 🛒',
  'Carrinho laranja aqui embaixo 👇🛒',
  'Confere o preço no carrinho 🛒',
  'Compra segura pelo carrinho do TikTok Shop 🛒',
  'Pega o seu no carrinho 🛒',
  'Corre lá no carrinho 🏃🛒',
  'O link tá no carrinho, só tocar 🛒',
];

// Palpite do nicho a partir do nome do produto (usado ao importar a vitrine; dá para trocar depois).
const NICHE_WORDS = [
  ['cabelo', /\b(escova secadora|secador|chapinha|prancha|babyliss|cabelo|capilar|shampoo|condicionador|mascara capilar)/],
  ['beleza', /\b(maquiagem|batom|base|rimel|delineador|skincare|serum|hidratante|perfume|esmalte|unha|cilios|sobrancelha)/],
  ['cozinha', /\b(panela|frigideira|air ?fryer|cozinha|talher|faca|liquidificador|cafeteira|pote|marmita|garrafa|copo|caneca)/],
  ['casa', /\b(lencol|fronha|cama|edredom|cobertor|travesseiro|toalha|cortina|tapete|organizador|cabide|almofada|colcha|limpeza|vassoura|decor)/],
  ['eletronicos', /\b(fone|microfone|lapela|softbox|ring ?light|tripe|camera|celular|carregador|cabo|smartwatch|relogio inteligente|caixa de som|bluetooth|led|luz|projetor|teclado|mouse)/],
  ['moda', /\b(vestido|conjunto|blusa|camiseta|camisa|calca|saia|short|pantalona|jaqueta|casaco|biquini|maio|lingerie|pijama|tenis|sandalia|sapato|bota)/],
  ['acessorios', /\b(colar|brinco|anel|pulseira|bolsa|carteira|oculos|bone|chapeu|relogio)/],
  ['fitness', /\b(academia|treino|halter|elastico|yoga|whey|creatina|squeeze|fitness)/],
  ['pet', /\b(pet|cachorro|gato|coleira|racao|caminha pet|arranhador)/],
  ['infantil', /\b(bebe|infantil|crianca|brinquedo|mamadeira|fralda|chupeta)/],
  ['auto', /\b(carro|moto|automotivo|volante|retrovisor|pneu)/],
  ['saude', /\b(massageador|termometro|saude|bem estar|ortopedic|postura)/],
];
export function guessNiche(name) {
  const n = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  for (const [niche, re] of NICHE_WORDS) if (re.test(n)) return niche;
  return 'geral';
}

// Nome curto para legendas a partir do título longo da vitrine.
export function shortProductName(name, max = 48) {
  let s = String(name || '').replace(/\s+/g, ' ').trim();
  s = s.split(/\s[-–|]\s|,|\||\s\+\s?\d/)[0].trim() || s;
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ') > 20 ? cut.lastIndexOf(' ') : max).trim();
}

// ---------- utilidades ----------
export function spin(text, rand = Math.random) {
  let out = text;
  const re = /\{([^{}]*)\}/;
  let guard = 0;
  while (re.test(out) && guard++ < 500) {
    out = out.replace(re, (m, inner) => {
      if (!inner.includes('|')) return m.replace('{', '\u0000').replace('}', '\u0001');
      const opts = inner.split('|');
      return opts[Math.floor(rand() * opts.length)];
    });
  }
  return out.replace(/\u0000/g, '{').replace(/\u0001/g, '}');
}

export function parseTemplates(text) {
  return String(text || '').split(/\n\s*-{3,}\s*\n/).map((s) => s.trim()).filter(Boolean);
}

export function parseHashtags(text) {
  const tags = String(text || '')
    .split(/[\s,;]+/)
    .map((t) => t.trim().replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, ''))
    .filter(Boolean)
    .map((t) => '#' + t.toLowerCase());
  return [...new Set(tags)];
}

export function parseLines(text) {
  return String(text || '').split('\n').map((s) => s.trim().replace(/^[-•*]\s*/, '').replace(/\.$/, '')).filter(Boolean);
}

const pick = (arr, rand) => arr[Math.floor(rand() * arr.length)];

function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// só baixa a 1ª letra de palavras comuns ("Bateria" → "bateria"), não de siglas/marcas ("LED", "R$", "iPhone")
const lowerFirst = (s) => (s && /^\p{Lu}\p{Ll}/u.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const upperFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function tidy(s) {
  return s
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([.,!?:])/g, '$1')
    .replace(/\.\./g, '.')
    .replace(/([.!?]) (\p{Ll})/gu, (m, p, c) => `${p} ${c.toUpperCase()}`)
    .trim();
}

// ---------- hashtags ----------
export function hashtagPools(product) {
  const niche = NICHES[product.niche] || NICHES.geral;
  const custom = parseHashtags(product.hashtags);
  const nichePool = [...new Set(custom.length >= 3 ? custom : [...custom, ...niche.tags])];
  const broad = BROAD_HASHTAGS.filter((t) => !nichePool.includes(t));
  return { nichePool, broad };
}

// Escolhe `count` hashtags. Com `last` (as do post anterior), mantém a maioria e troca 1 ou 2.
export function pickHashtags(product, count = 5, last = [], rand = Math.random) {
  count = Math.max(0, Math.min(10, Number(count) || 0));
  if (!count) return [];
  const { nichePool, broad } = hashtagPools(product);
  const all = new Set([...nichePool, ...broad]);
  const nBroad = count >= 4 ? 2 : count >= 2 ? 1 : 0;
  const isBroad = (t) => broad.includes(t);

  const prev = (last || []).filter((t) => all.has(t));
  let chosen;
  if (prev.length === count) {
    const changes = Math.min(count, rand() < 0.5 ? 1 : 2);
    const keep = shuffle(prev, rand).slice(0, count - changes);
    chosen = [...keep];
    const need = () => (chosen.filter(isBroad).length < nBroad ? 'broad' : 'niche');
    while (chosen.length < count) {
      const kind = need();
      const pool = (kind === 'broad' ? broad : nichePool).filter((t) => !chosen.includes(t) && !prev.includes(t));
      const fallback = [...all].filter((t) => !chosen.includes(t) && !prev.includes(t));
      const options = pool.length ? pool : fallback.length ? fallback : [...all].filter((t) => !chosen.includes(t));
      if (!options.length) break;
      chosen.push(pick(options, rand));
    }
  } else {
    chosen = [...shuffle(nichePool, rand).slice(0, count - nBroad), ...shuffle(broad, rand).slice(0, nBroad)];
    for (const t of shuffle([...all], rand)) if (chosen.length < count && !chosen.includes(t)) chosen.push(t);
  }
  // nicho primeiro, amplas no fim
  return [...chosen.filter((t) => !isBroad(t)), ...chosen.filter(isBroad)];
}

// ---------- texto ----------
function benefitsFor(product, rand) {
  const own = parseLines(product.benefits);
  const niche = (NICHES[product.niche] || NICHES.geral).benefits;
  return (own.length ? own : niche).map((b) => spin(b, rand));
}

const stripAccents = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Substitui {produto}, {beneficio}, {beneficio2} (com ou sem acento, maiúscula ou minúscula).
// Placeholders desconhecidos são removidos. Usa funções na troca para "$" do texto não virar código.
function fill(text, vars) {
  return text
    .replace(/\{([^{}|]*)\}/g, (m, raw) => {
      const keyName = stripAccents(raw.trim()).toLowerCase();
      if (!(keyName in vars)) return '';
      const val = vars[keyName];
      return /^\p{Lu}/u.test(raw.trim()) ? upperFirst(val) : val;
    })
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').replace(/\s+([.,!?:])/g, '$1').trim()).join('\n')
    .trim();
}

function varsFor(product, rand) {
  const name = (product.displayName || product.folder || '').trim();
  const benefits = shuffle(benefitsFor(product, rand), rand);
  const b1 = lowerFirst(benefits[0] || 'vale muito a pena');
  const b2 = lowerFirst(benefits[1] || benefits[0] || 'chega rapidinho');
  return { produto: name, beneficio: b1, beneficio2: b2 };
}

function composeBody(product, rand) {
  const vars = varsFor(product, rand);
  const hook = spin(pick(HOOKS, rand), rand);
  const line = fill(spin(pick(PRODUCT_LINES, rand), rand), vars);
  const cta = spin(pick(CTAS, rand), rand);
  const layout = rand();
  const body = layout < 0.5 ? `${hook}\n${line}\n${cta}` : layout < 0.8 ? `${hook} ${line}\n${cta}` : `${hook}\n${line} ${cta}`;
  return { body: body.split('\n').map(tidy).join('\n'), hook };
}

function fromTemplate(product, template, rand) {
  return { body: fill(spin(template, rand), varsFor(product, rand)), hook: null };
}

// Hashtags de verdade já presentes no texto (# seguido de letra; "#1" não conta).
export function existingHashtags(text) {
  return [...String(text).matchAll(/(?:^|\s)(#\p{L}[\p{L}\p{N}_]*)/gu)].map((m) => m[1].toLowerCase());
}

// Gera a legenda completa. `memory` = { recent: [textos anteriores], lastHook, lastHashtags }
// - Texto de um .txt do vídeo: usado como está; se já tiver hashtags, nenhuma é acrescentada.
// - Texto gerado ou de modelo: completa até N hashtags (sem repetir as que já estão no texto).
export function generateCaption(product, settings = {}, { sidecarText, memory = {}, rand = Math.random } = {}) {
  const count = Math.max(0, Math.min(10, Number(settings.hashtagsCount ?? 5)));
  const recent = new Set(memory.recent || []);

  let best;
  if (sidecarText && sidecarText.trim()) {
    best = fromTemplate(product, sidecarText.trim(), rand);
    if (existingHashtags(best.body).length) return { text: best.body.slice(0, 2200), body: best.body, hashtags: [], hook: null };
  } else {
    const templates = parseTemplates(product.captions);
    for (let attempt = 0; attempt < 25; attempt++) {
      const r = templates.length ? fromTemplate(product, pick(templates, rand), rand) : composeBody(product, rand);
      best = r;
      const sameHook = r.hook && r.hook === memory.lastHook;
      if (!recent.has(r.body) && !sameHook) break;
    }
  }
  const have = existingHashtags(best.body);
  const missing = Math.max(0, count - have.length);
  const picked = missing ? pickHashtags(product, count, memory.lastHashtags, rand) : [];
  const add = picked.filter((t) => !have.includes(t)).slice(0, missing);
  return { text: join(best.body, add), body: best.body, hashtags: picked, hook: best.hook };
}

function join(body, tags) {
  return (tags.length ? `${body}\n\n${tags.join(' ')}` : body).slice(0, 2200);
}

// Atualiza a "memória" do produto depois de um post publicado.
export function rememberCaption(product, result) {
  const recent = [result.body, ...(product.recentCaptions || [])].slice(0, 20);
  return {
    recentCaptions: recent,
    lastHook: result.hook || product.lastHook || null,
    lastHashtags: result.hashtags?.length ? result.hashtags : product.lastHashtags || [],
    lastCaption: result.text,
  };
}

// Simula N posts seguidos (para a pré-visualização no painel).
export function previewSeries(product, settings, n = 3, rand = Math.random) {
  const out = [];
  let p = { ...product };
  for (let i = 0; i < n; i++) {
    const r = generateCaption(p, settings, {
      memory: { recent: p.recentCaptions, lastHook: p.lastHook, lastHashtags: p.lastHashtags }, rand,
    });
    out.push(r);
    p = { ...p, ...rememberCaption(p, r) };
  }
  return out;
}
