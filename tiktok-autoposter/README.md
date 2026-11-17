# AutoPoster TikTok Shop

Extensão do Chrome que posta seus vídeos de afiliado no **TikTok Studio** automaticamente, um por vez, no intervalo que você escolher (5, 10, 15, 20, 30 ou 60 minutos). Em cada post ela:

1. envia o vídeo da sua pasta;
2. escreve uma **legenda diferente** (mesma mensagem, palavras variadas) com cerca de **5 hashtags** sorteadas;
3. **vincula o produto** do TikTok Shop (carrinho laranja);
4. liga **Divulgar conteúdo do vídeo → Conteúdo de marca** (marca de terceiros);
5. publica e confere se deu certo.

Tudo acontece no seu próprio Chrome, já logado, como se fosse você clicando. Não usa a API do TikTok.

---

## Instalação (Windows)

1. Baixe esta pasta `tiktok-autoposter` para o computador (por exemplo `C:\AutoPoster\tiktok-autoposter`).
2. No Chrome, abra `chrome://extensions`.
3. Ligue o **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e escolha a pasta `tiktok-autoposter`.
5. Fixe o ícone da extensão na barra (ícone de quebra-cabeça → alfinete) e clique nele para abrir o painel.

> Para atualizar depois: substitua os arquivos da pasta e clique em ↻ (recarregar) no cartão da extensão em `chrome://extensions`.

## Organização dos vídeos

```
Videos TikTok\
  fone-bluetooth-x\        ← cada subpasta é um produto
    video-001.mp4
    video-002.mp4
    video-002.txt          ← (opcional) legenda própria para o video-002
  escova-secadora\
    a1.mp4
    a2.mp4
```

- Formatos aceitos: `.mp4`, `.mov`, `.webm`, `.m4v`.
- Para usar o **Google Drive**, instale o *Google Drive para computador* e escolha a pasta sincronizada (ex.: `G:\Meu Drive\Videos TikTok`). Os arquivos precisam estar disponíveis offline (botão direito → *Disponibilizar off-line*).
- Vídeos novos colocados na pasta entram na fila automaticamente a cada post.

## Primeiro uso

O painel abre no tema escuro e mostra uma **configuração em 4 passos**:

1. **Escolher a pasta.** Quando o Chrome perguntar, permita e, se aparecer, escolha **“Permitir em todas as visitas”**.
2. **Configurar os links.** Em **Produtos → Configurar link**:
   - **ID ou nome exato do produto:** o que a extensão digita na busca de **Adicionar link → Produtos** do TikTok Studio. Use o **ID do produto**, que é o jeito mais seguro.
   - **Nome no link do produto:** o texto do carrinho (até 30 caracteres).
   - **Nicho:** define as hashtags (beleza, cabelo, casa, cozinha, eletrônicos, moda, fitness, pet, infantil, saúde, carro, acessórios ou geral).
   - **Benefícios (opcional):** um por linha. Entram nas legendas.
   - Uma **prévia de 3 posts seguidos** mostra como as legendas e hashtags vão variar.
3. **Fazer um teste.** Faça login no TikTok Studio neste Chrome e clique em **Testar** no produto (ou em **Testar sem publicar** no topo). A extensão preenche tudo e **não publica**; a aba fica aberta para você conferir. O produto passa a mostrar **“Link conferido”** e qual item foi vinculado.
4. **Iniciar.** O primeiro post sai em cerca de 1 minuto.

**Deixe o Chrome aberto** e configure o Windows para **não suspender** (Configurações → Sistema → Energia → Suspensão: *Nunca*).

## Garantia do link certo

- Um produto **só entra na fila depois que o link dele for configurado**. Sem isso, a extensão recusa postar o produto.
- Na busca do TikTok Studio, a extensão **só escolhe o resultado que corresponde** ao ID (o número precisa aparecer no item) ou ao nome (palavras inteiras).
- Se **nada corresponder** ou houver **mais de um produto parecido**, ela **não publica** e avisa no Histórico, com a lista do que apareceu na tela.
- Cada post registra no Histórico **qual produto foi vinculado**.

## Legendas e hashtags

- Cada legenda junta **gancho + benefício do produto + chamada para o carrinho**, a partir de 20 ganchos, 8 frases de produto e 12 chamadas.
- O texto **nunca repete** um dos últimos 20 do mesmo produto, nem o mesmo gancho do post anterior.
- **5 hashtags por post:** 3 do nicho e 2 amplas (#tiktokshop, #achadinhos, #tiktokmefezcomprar…). De um post para o outro **1 ou 2 mudam** e as outras continuam: variação pequena e constante.
- **Hashtags próprias:** com 3 ou mais no produto, elas substituem as do nicho.
- **Modelos próprios (avançado):** separe os modelos com uma linha `---`. Use `{opção 1|opção 2}` para variar, e `{produto}`, `{beneficio}` e `{beneficio2}` para inserir o nome e os benefícios.
- **Legenda fixa de um vídeo:** crie um `.txt` com o mesmo nome do vídeo. Se o texto já tiver hashtags, nenhuma é acrescentada.

## Regras de agendamento

- Intervalo configurável (5, 10, 15, 20, 30 ou 60 min) com **variação aleatória** (padrão ±8 min).
- **Faixa de horário** e **limite diário** configuráveis.
- **Rodízio de produtos:** nunca posta o mesmo produto duas vezes seguidas (quando há mais de um).
- Cada vídeo é postado **uma única vez**. Quando os vídeos de um produto acabam, ele para; ou recomeça, se você escolher essa opção.
- **Falhas:** a extensão tenta de novo em 3 minutos. Depois de 3 falhas seguidas, **pausa tudo** e mostra uma notificação.
- **Sem post duplicado:** se ela clicou em *Publicar* e não viu a confirmação, o vídeo fica como **“Verificar no TikTok”** e **não é repetido**. Confira em *Meus posts* e marque **“Saiu, marcar publicado”** ou **“Voltar para a fila”**.
- **Cancelar** ou **tempo esgotado** (35 min, ou 6 min sem resposta da página) fecham a aba do TikTok na hora, para nada ser publicado depois.
- A pasta é **lida de novo antes de cada post**: vídeos novos entram na fila sozinhos.
- Funciona com a aba do TikTok em **segundo plano**. As esperas são feitas pela extensão, para o Chrome não atrasá-las.

## Se o TikTok mudar a tela

O TikTok muda o layout de vez em quando. A extensão encontra os botões **pelo texto** (por exemplo “Adicionar link”, “Próximo”, “Conteúdo de marca”, “Publicar”). Se algo parar de funcionar:

1. Veja no **Histórico** em qual etapa falhou. Em *Detalhes técnicos* aparecem os botões que a extensão viu na tela.
2. Em **Configurações → Avançado**, acrescente o novo texto do botão na lista correspondente (minúsculo, sem acento) e salve.
3. Em **Ajuda → Ler página do TikTok Studio**, você vê o que a extensão enxerga na página de upload aberta.

## Avisos importantes

- Postar com frequência alta pode fazer o TikTok reduzir o alcance ou restringir a conta. Automatizar publicações também pode contrariar os termos de uso do TikTok. Use por sua conta e risco; intervalos maiores são mais seguros.
- A extensão só lê a pasta que você escolher e só atua em `www.tiktok.com`. Nada é enviado para outros servidores.

## Para desenvolvedores

```bash
npm test        # 21 testes de agendamento, fila e legendas (Node 18+)
npm run e2e     # teste ponta a ponta com Playwright: carrega a extensão, clica no painel e posta
                # contra uma simulação local do TikTok Studio (capturas em test/shots/)
```

Estrutura:

| Arquivo | Função |
|---|---|
| `background.js` | Agendador (alarmes do Chrome), fila, histórico e abertura do TikTok Studio |
| `content/tiktok.js` | Executa os passos dentro da página de upload |
| `offscreen.js` | Lê os vídeos da pasta local e os entrega em pedaços para a página |
| `lib/scheduler.js` | Regras de horário, rodízio e fila (funções puras, testadas) |
| `lib/captions.js` | Legendas, nichos e hashtags (funções puras, testadas) |
| `lib/fsaccess.js` | Acesso à pasta escolhida (File System Access API) |
| `dashboard/` | Painel |
