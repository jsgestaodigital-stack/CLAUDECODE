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
  fone-bluetooth-x\        ← uma subpasta por produto (o nome é livre)
    video-001.mp4
    video-002.mp4
    video-002.txt          ← (opcional) legenda própria para o video-002
  escova-secadora\
    a1.mp4
    a2.mp4
```

- Formatos aceitos: `.mp4`, `.mov`, `.webm`, `.m4v`.
- Para usar o **Google Drive**, instale o *Google Drive para computador* e escolha a pasta sincronizada (ex.: `G:\Meu Drive\Videos TikTok`). Os arquivos precisam estar disponíveis off-line (botão direito → *Disponibilizar off-line*).
- Vídeos novos colocados na pasta entram na fila automaticamente a cada post.

## Produtos: cadastre uma vez, use sempre

A tela **Produtos** é o seu **catálogo**:

- **Adicionar produto:** copie o link do produto no TikTok Shop (**Ctrl+C**) e cole no campo (**Ctrl+V**). Serve o link completo (`…/view/product/1729…`) ou o link curto de compartilhar (`vt.tiktok.com/…`).
  - A extensão mostra na hora o **ID** e tenta preencher o **nome** sozinha.
  - O resto é opcional: nicho das hashtags, benefícios, hashtags próprias e nome no carrinho (até 30 caracteres).
  - Uma **prévia de 3 posts seguidos** mostra como as legendas vão variar.
- **Editar, Pausar, Testar e Remover** ficam no cartão de cada produto. Colar o mesmo link duas vezes não duplica o produto.
- Na tela **Vídeos → Pastas → produto**, escolha no seletor qual produto do catálogo cada pasta usa. A opção **“＋ Novo produto (colar link)”** cria o produto e já liga a pasta a ele.
- Um **vídeo específico** pode usar outro produto: troque no seletor da linha do vídeo. *“Igual à pasta”* volta ao produto da pasta.
- Ao remover um produto, as pastas e vídeos que o usavam ficam **sem produto** e não são postados até você escolher outro.

## Primeiro uso

O painel abre no tema escuro e mostra a **configuração passo a passo**:

1. **Escolher a pasta.** Quando o Chrome perguntar, permita e, se aparecer, escolha **“Permitir em todas as visitas”**.
2. **Cadastrar produtos.** Cole os links (veja acima).
3. **Ligar pastas aos produtos** na tela **Vídeos**.
4. **Fazer um teste.** Faça login no TikTok Studio neste Chrome e clique em **Testar** no produto (ou em **Testar sem publicar** no topo).
   - A extensão preenche tudo e **não publica**; a aba fica aberta para você conferir.
   - O produto passa a mostrar **“Link conferido”** e qual item foi vinculado.
5. **Iniciar.** O primeiro post sai em cerca de 1 minuto.

**Deixe o Chrome aberto** e configure o Windows para **não suspender** (Configurações → Sistema → Energia → Suspensão: *Nunca*).

## Garantia do link certo

- Um vídeo **só entra na fila** se tiver um produto do catálogo com link.
- O **ID** vem do link que você colou; links curtos são abertos para descobrir o destino.
- Na tela *Adicionar link → Produtos* do TikTok Studio (onde o TikTok obriga a escolher o produto numa lista), a extensão faz tudo sozinha:
  1. cola o **link do produto** na busca;
  2. se não der, busca pelo **ID**;
  3. se não der, busca pelo **nome**.
- Ela só escolhe o item que tem **esse ID**. Pelo nome, só aceita um item cujo nome bate por palavras inteiras e que não mostre outro ID.
- O produto precisa estar na sua **vitrine de afiliado**.
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

## Para rodar 24 horas

- **Computador acordado:** enquanto está rodando, a extensão **impede o Windows de suspender**. A tela pode apagar normalmente.
- **TikTok deslogado:** se a sessão cair, a extensão **pausa**, avisa e mantém o vídeo na fila. Entre de novo e clique em *Iniciar*.
- **Avisos no celular (Telegram):** em Configurações → *Avisos no celular*, crie um bot no @BotFather, cole o token e clique em *Descobrir meu chat ID*. Você recebe falhas, pausas, posts para conferir e um **resumo diário** (opcionalmente, um aviso a cada post).
- **Chrome reiniciou?** Ao abrir o Chrome de novo, o AutoPoster continua de onde parou. Para abrir sozinho: Configurações do Chrome → *Ao iniciar* → *Continuar de onde parou*. Também coloque o Chrome para abrir com o Windows.
- **Pasta no Google Drive:** marque a pasta como *Disponível off-line* para os vídeos estarem no disco.
- **Backup:** em Ajuda → *Exportar backup* você guarda produtos, links e configurações num arquivo. *Importar backup* restaura tudo.

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
