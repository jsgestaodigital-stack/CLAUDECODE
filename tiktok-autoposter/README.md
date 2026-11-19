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

1. Descompacte o zip numa pasta **fixa**, por exemplo `C:\AutoPoster`. Dentro dela deve estar o `manifest.json`.
2. No Chrome, abra `chrome://extensions` e ligue o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e escolha essa pasta.
4. Fixe o ícone da extensão na barra (ícone de quebra-cabeça → alfinete) e clique nele para abrir o painel.

## Atualizar para uma versão nova (sem perder nada)

1. Descompacte o zip novo **por cima da mesma pasta** (`C:\AutoPoster`), substituindo os arquivos.
2. Em `chrome://extensions`, clique em **↻ (recarregar)** no cartão do AutoPoster.

**Não remova** a extensão para instalar de novo: ao remover, o Chrome apaga os dados dela. Mesmo assim, nada se perde:
- a extensão tem **identidade fixa** (o `manifest.json` traz uma chave própria);
- ela grava uma **cópia de segurança automática** em `_autoposter-config.json`, dentro da sua pasta de vídeos. Ao escolher a pasta numa instalação nova, ela **recupera tudo sozinha**: produtos, diferenciais, nome no carrinho, pastas ligadas, vídeos já postados e configurações.

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

## Produtos: importe a sua vitrine

O produto precisa estar na sua **vitrine de afiliado** do TikTok Shop, que é a lista que aparece em *Adicionar link → Produtos → Seguinte*. A tela **Produtos** da extensão é o seu **catálogo**:

- **Importar da minha vitrine** (recomendado):
  - A extensão abre o TikTok Studio e carrega um vídeo da sua pasta, só para abrir o formulário.
  - Ela lê **todas as páginas** da vitrine: nome, **ID do produto**, preço, estoque e situação (Ativo/Indisponível).
  - Depois fecha **sem publicar nada**.
  - Os produtos entram no catálogo com nome curto e nicho de hashtags já sugeridos.
  - Importar de novo atualiza preço e situação **sem apagar** o que você configurou.
- **Adicionar manualmente:** informe o **ID do produto**, que fica na coluna *ID do produto* da vitrine (ou cole o link), e a **palavra para buscar** na vitrine (ex.: “lençol”).
- **Editar, Pausar, Testar e Remover** ficam no cartão de cada produto.
- Na tela **Vídeos → Pastas → produto**, escolha no seletor qual produto cada pasta usa. Um **vídeo específico** pode usar outro produto.
- **Produto Indisponível** (sem estoque): a extensão **não posta** com ele, mantém os vídeos na fila e avisa. Quando o estoque voltar, clique em **“Já voltou — reativar”** ou importe a vitrine de novo.

## Primeiro uso

O painel abre no tema escuro e mostra a **configuração passo a passo**:

1. **Escolher a pasta.** Quando o Chrome perguntar, permita e, se aparecer, escolha **“Permitir em todas as visitas”**.
2. **Cadastrar produtos.** Clique em **Importar da minha vitrine** (veja acima).
3. **Ligar pastas aos produtos** na tela **Vídeos**.
4. **Fazer um teste.** Faça login no TikTok Studio neste Chrome e clique em **Testar** no produto (ou em **Testar sem publicar** no topo).
   - A extensão preenche tudo e **não publica**; a aba fica aberta para você conferir.
   - O produto passa a mostrar **“Link conferido”** e qual item foi vinculado.
5. **Iniciar.** O primeiro post sai em cerca de 1 minuto.

**Deixe o Chrome aberto** e configure o Windows para **não suspender** (Configurações → Sistema → Energia → Suspensão: *Nunca*).

## Garantia do produto certo

- Um vídeo **só entra na fila** se tiver um produto do catálogo com ID (ou palavra de busca).
- No TikTok Studio, a extensão faz o mesmo caminho que você:
  1. clica em **+ Adicionar**, confere que o **Tipo de link** é *Produtos* e clica em **Seguinte**;
  2. busca o produto na vitrine pelo **ID** e, se não achar, pela **palavra de busca**;
  3. escolhe **somente a linha cujo “ID do produto” é o certo**. Se a busca não trouxer o produto, ela **folheia as páginas da vitrine** procurando o ID;
  4. clica em **Seguinte**, confere o **Nome do produto** (até 30 caracteres) e clica em **Adicionar**.
- Se nada corresponder ou houver dúvida, ela **não publica** e registra o que viu na tela.
- Antes de enviar o vídeo, ela clica em **Eliminar** no aviso de rascunho antigo (“…não foi guardado. Continuar a editar?”).
- Em **Mostrar mais**, ela liga **“Divulga o conteúdo da publicação”** e marca **“Conteúdo de marca”** (marca de terceiros), nunca “A tua marca”.

## Legendas e hashtags

- Cada legenda junta **gancho + benefício do produto + chamada para o carrinho**, a partir de 20 ganchos, 8 frases de produto e 12 chamadas.
- O texto **nunca repete** um dos últimos 20 do mesmo produto, nem o mesmo gancho do post anterior.
- **5 hashtags por post:** 3 do nicho e 2 amplas (#tiktokshop, #achadinhos, #tiktokmefezcomprar…). De um post para o outro **1 ou 2 mudam** e as outras continuam: variação pequena e constante.
- **Hashtags próprias:** com 3 ou mais no produto, elas substituem as do nicho.
- **Modelos próprios (avançado):** separe os modelos com uma linha `---`. Use `{opção 1|opção 2}` para variar, e `{produto}`, `{beneficio}` e `{beneficio2}` para inserir o nome e os benefícios.
- **Legenda fixa de um vídeo:** crie um `.txt` com o mesmo nome do vídeo. Se o texto já tiver hashtags, nenhuma é acrescentada.

## Modo agendamento (padrão desde a versão 2.0)

A extensão **não abre mais o TikTok Studio a cada post**. Ela trabalha em **sessões**:

1. Nos **horários das sessões** (padrão: 09:00, 14:00 e 20:00, cada uma começando de 0 a 20 min depois, ao acaso), ela abre o TikTok Studio.
2. Na sessão, se não houver nada agendado pela frente, o 1º vídeo é publicado na hora. Depois envia um vídeo por vez **na mesma aba**, com legenda, produto e “Conteúdo de marca”, escolhe **Quando publicar → Agendar**, a **data** e a **hora**, e clica em **Agendar**. Entre um vídeo e outro, faz uma pausa de 2 a 5 min.
3. Ela agenda até cobrir o período até a próxima sessão (com folga de 1h30), respeitando o **máximo de vídeos por sessão**.
4. Quem publica na hora certa são os **servidores do TikTok**. Entre as sessões, o seu computador não faz nada e pode até estar desligado.

**Resultado:** o TikTok Studio é aberto **3 vezes por dia**, em vez de 15 a 24.

**Regras dos horários de publicação:**
- Seguem o intervalo que você digita (por exemplo, 60 min), com a **variação aleatória**.
- São arredondados para **múltiplos de 5 min**, porque o seletor de hora do TikTok só tem esses minutos.
- Sempre ficam pelo menos **20 min no futuro**, o mínimo do TikTok.
- Respeitam a **faixa de horário** e o **limite por dia**, contado pelo dia em que o vídeo vai ao ar.

**Em Configurações:**
- Escolha os horários das sessões e o máximo de vídeos por sessão.
- A tela mostra quantos vídeos cada sessão vai agendar e **avisa se vai faltar post** até a próxima sessão.

**Botões e telas:**
- **Agendar agora** abre uma sessão na hora.
- Na tela **Vídeos**, os agendados aparecem como **“Agendado”**, com o horário em que vão ao ar.
- Depois desse horário, viram **“Publicado”**.

**Pausar não cancela** o que já está agendado no TikTok. Para cancelar, apague em **TikTok Studio → Publicações**.

O modo antigo continua disponível em **Configurações → Como publicar → Publicar na hora**.

## Mouse e teclado de verdade (2.0)

Todos os **cliques, rolagens e digitação** são feitos pelo próprio Chrome. Para o site, são eventos idênticos aos de uma pessoa.
- O mouse se move em curva até o botão, para em cima e clica.
- A página rola com a rodinha.
- Os campos são digitados tecla por tecla.

Enquanto a extensão trabalha na aba, o Chrome mostra a faixa **“AutoPoster começou a depurar este navegador”**. Não feche essa faixa durante uma sessão.

Se as **Ferramentas do desenvolvedor (F12)** estiverem abertas na aba, o Chrome não deixa usar o mouse de verdade. Nesse caso a extensão usa o clique simulado e registra isso no log.

## Regras gerais

- **Rodízio de produtos:** nunca posta o mesmo produto duas vezes seguidas (quando há mais de um).
- Cada vídeo é postado **uma única vez**. Quando os vídeos de um produto acabam, ele para; ou recomeça, se você escolher essa opção.
- **Falhas:** a extensão tenta de novo em 3 minutos. Depois de 3 falhas seguidas, **pausa tudo** e mostra uma notificação.
- **Sem post duplicado:** se ela clicou em *Publicar* ou *Agendar* e não viu a confirmação, o vídeo fica como **“Verificar no TikTok”** e **não é repetido**. Confira no TikTok Studio e marque **“Saiu, marcar publicado”** ou **“Voltar para a fila”**.
- **Cancelar** ou **tempo esgotado** (35 min, ou 6 min sem resposta da página) fecham a aba do TikTok na hora, para nada ser publicado depois.
- A pasta é **lida de novo antes de cada post**: vídeos novos entram na fila sozinhos.

## Para rodar 24 horas

- **Computador acordado:** enquanto está rodando, a extensão **impede o Windows de suspender**. A tela pode apagar normalmente.
- **TikTok deslogado:** se a sessão cair, a extensão **pausa**, avisa e mantém o vídeo na fila. Entre de novo e clique em *Iniciar*.
- **Avisos no celular (Telegram):** em Configurações → *Avisos no celular*, crie um bot no @BotFather, cole o token e clique em *Descobrir meu chat ID*. Você recebe falhas, pausas, posts para conferir e um **resumo diário** (opcionalmente, um aviso a cada post).
- **Chrome reiniciou?** Ao abrir o Chrome de novo, o AutoPoster continua de onde parou. Para abrir sozinho: Configurações do Chrome → *Ao iniciar* → *Continuar de onde parou*. Também coloque o Chrome para abrir com o Windows.
- **Pasta no Google Drive:** marque a pasta como *Disponível off-line* para os vídeos estarem no disco.
- **Backup:** em Ajuda → *Exportar backup* você guarda produtos, links e configurações num arquivo. *Importar backup* restaura tudo.

## Registro de erros (para suporte)

- Cada postagem e cada teste guarda um **registro completo**:
  - todas as etapas e cada clique, com o botão exato e o horário;
  - o que foi digitado e quanto tempo cada espera levou;
  - quando há erro, uma **captura da tela do TikTok** e o **texto da página** naquele momento.
- Se a **tela de erro do TikTok** aparecer (o "robozinho"), a extensão **para na hora**, registra a mensagem e diz **qual foi a última ação antes do erro**.
- Para ver: **Histórico → Ver registro**. Use **Baixar relatório** e mande o arquivo `.json` para o suporte; ele inclui a imagem. **Copiar relatório** copia só o texto.

## Velocidade (modo humano)

Em **Configurações → Publicação → Velocidade**, o padrão é **Humana**:
- o mouse de verdade vai até o botão em curva e para em cima antes de clicar;
- a legenda é escrita aos poucos, de 1 a 3 palavras por vez;
- a busca do produto e o nome no carrinho são digitados aos poucos, com o teclado do Chrome;
- há pausas entre as etapas.

Cada post leva alguns minutos a mais. Se quiser, troque para **Normal**, que é mais rápido.

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
