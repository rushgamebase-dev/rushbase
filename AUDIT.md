# RUSH — Auditoria de Guerra: Backend + Mercados

Data: 2026-03-28 | Auditor: Claude Opus 4.6

Legenda: ✅ OK | ⚠️ Parcial | ❌ Nao existe | 💀 Vai dar merda

---

## 1. ESTRUTURA GERAL DO BACKEND

| Pergunta | Status | Realidade |
|----------|--------|-----------|
| Backend separado por dominio? | ❌ | Nao existe backend. API routes no Next.js (serverless), oracle e um script Python standalone. Tudo misturado. |
| Separacao API / regra de negocio / jobs / realtime / persistencia? | ❌ | Regra de negocio = contratos Solidity. Jobs = round_manager.py. Realtime = stream_server.py WS. Persistencia = Redis (chat/ledger) + blockchain. Nada conecta formalmente. |
| Codigo de mercado acoplado ao frontend? | ⚠️ | Logica de mercado ta nos contratos (bom). Mas stats, profile, ledger sao API routes dentro do Next.js — acoplado ao frontend deploy. |
| Regra critica so no client? | 💀 | **SIM.** O calculo de odds (overOdds/underOdds) e feito no `page.tsx:91-93`. Se o frontend bugar, usuario ve odds erradas. Deveria vir do contrato ou API. |
| Sistema depende de um unico processo pra tudo? | 💀 | **SIM.** O `round_manager_rush.py` e single-process. Se morrer, nao cria mercados, nao resolve, nao posta ledger. Tudo para. |
| Se um worker morrer, sistema inteiro morre? | 💀 | **SIM.** So tem 1 worker (round_manager). Sem supervisor, sem auto-restart, sem redundancia. |
| Config por ambiente? | ⚠️ | Env vars no Vercel (prod) + .env local. Mas nao tem .env.example, nao tem validacao. |
| Gestao segura de secrets? | ⚠️ | Vercel env vars encriptadas (bom). Mas PRIVATE_KEY ta em .env local em plaintext. Sem rotacao. |
| Healthcheck real? | ❌ | Nenhum. Nao tem /health, nao tem ping, nao tem nada. |
| Observabilidade (logs/metricas/tracing/alertas)? | 💀 | Logs = print/console.log. Zero metricas. Zero tracing. Zero alertas. Se o oracle morrer as 3h da manha, ninguem sabe. |
| Idempotencia nos pontos criticos? | 💀 | **NAO.** Se o ledger POST falhar e retryar, pode duplicar. Se resolveMarket for chamado 2x... o contrato previne (state check), mas o ledger nao. |

**Se reiniciar tudo agora:** O sistema volta consistente? **Parcialmente.** Os contratos on-chain sao a verdade (imutavel). Mas o Redis (chat, ledger, stats) pode ter dados parciais. Se o Redis limpar, stats zeram. Nao tem como reconstruir do blockchain automaticamente.

---

## 2. MODELAGEM DE MERCADO / RODADA

| Pergunta | Status | Realidade |
|----------|--------|-----------|
| O que e um mercado? | ✅ | Contrato PredictionMarket deployado pelo MarketFactory. Cada mercado = 1 contrato. |
| O que e uma rodada? | ⚠️ | round_manager incrementa `round_number` localmente. Nao persiste. Se reiniciar, volta pra 0. |
| Diferenca mercado/round/evento/resultado/estado? | ⚠️ | Mercado = contrato. Round = conceito do round_manager (nao persiste). Evento = nao existe como entidade. Resultado = actualCarCount no contrato. Estado = enum no contrato. |
| Estados explicitos? | ✅ | Contrato: OPEN(0), LOCKED(1), RESOLVED(2), CANCELLED(3). Enum clara. |
| Transicoes validadas? | ✅ | Contrato valida: so resolve se OPEN/LOCKED, so cancela se nao RESOLVED. |
| Da pra pular estado? | ✅ | Nao. resolveMarket auto-lock se ainda OPEN, entao OPEN→RESOLVED pula LOCKED mas e intencional. |
| Da pra resolver rodada aberta? | ✅ | Sim, resolveMarket faz auto-lock primeiro. Comportamento correto. |
| Da pra reabrir rodada fechada? | ✅ | Nao. Contrato nao tem funcao pra isso. |
| Da pra invalidar rodada resolvida? | ❌ | Nao. Uma vez RESOLVED, e final. Sem disputas no MVP (DisputeManager nao deployado). |
| Da pra resolver duas vezes? | ✅ | Nao. Contrato checa `state != RESOLVED` antes de resolver. |

**Estados que faltam:** `draft`, `scheduled`, `resolving`, `errored`, `disputed` — nenhum existe. O contrato so tem 4 estados. "Resolving" e um periodo real (entre lock e resolve) mas nao e um estado on-chain.

**Se alguem perguntar "em que estado?":** O contrato responde sem ambiguidade (0-3). Mas nao tem timestamp de quando mudou de estado (exceto createdAt e resolvedAt).

---

## 3. FLUXO TEMPORAL

| Pergunta | Status | Realidade |
|----------|--------|-----------|
| Quem abre a rodada? | ✅ | round_manager via createMarket (oracle wallet). |
| Quem fecha? | ✅ | lockTime automatico (createdAt + roundDurationSecs). Contrato recusa bets apos lockTime. |
| Quem resolve? | ✅ | round_manager via resolveMarket (oracle wallet). |
| Manual, job, scheduler? | ⚠️ | round_manager e um script Python manual. Sem cron, sem supervisor, sem auto-restart. |
| Relogio oficial unico? | 💀 | **NAO.** lockTime usa block.timestamp (on-chain). Countdown do frontend usa Date.now() (client JS). Stream server usa time.time() (Python server). Tres relogios diferentes. |
| Timezone consistente? | ⚠️ | Tudo em UTC/Unix timestamps. Mas o frontend mostra hora local do usuario. |
| Drift entre servicos? | 💀 | **SIM.** block.timestamp pode divergir 1-15s do relogio da maquina. Frontend pode divergir mais. |
| Countdown bate com backend? | ⚠️ | Frontend calcula countdown a partir de lockTime (on-chain). Razoavel, mas nao perfeito — depende de quando o bloco foi minerado. |
| Se job atrasar 10s? | ⚠️ | Bets ja foram recusadas pelo contrato (lockTime passed). Mas o resolve atrasa, mostrando "RESOLVING" por mais tempo. Nao quebra, mas UX ruim. |
| Se round_manager cair? | 💀 | Mercado fica OPEN/LOCKED pra sempre. Ninguem resolve. Usuarios com bets ficam presos. So cancel manual salva. |
| Recovery de rounds orfaos? | ❌ | Nao existe. Se round_manager morrer no meio, o mercado fica pendurado pra sempre. |

**Se a rodada deveria fechar as 12:05:00 e o worker acorda as 12:05:07:** O lockTime on-chain ja fechou as 12:05:00 (block.timestamp). Ninguem mais aposta. O worker so demora 7s pra resolver. OK na pratica, mas sem garantia de timing.

---

## 4. CRIACAO DE MERCADO

| Pergunta | Status | Realidade |
|----------|--------|-----------|
| Quem pode criar? | ✅ | So o admin do MarketFactory (oracle wallet). |
| Validacao de input? | ⚠️ | Contrato valida ranges (min < max, labels nao vazias). Mas round_manager hardcoda tudo — sem validacao de camera/stream. |
| Da pra criar mercado sem regra de resolucao? | ❌ | Nao — resolucao e sempre "oracle chama resolveMarket(count)". Mas nao ta escrito em lugar nenhum qual fonte determina o count. |
| Da pra criar com janelas incoerentes? | ⚠️ | Contrato aceita qualquer duration > 0. round_manager usa 300s fixo. Sem validacao de "tempo minimo razoavel". |
| Da pra criar duplicados? | 💀 | **SIM.** Nada impede criar 2 mercados pro mesmo stream no mesmo periodo. round_manager nao checa. |
| Mercado pode ser editado depois de criado? | ✅ | Nao. Contrato e imutavel apos deploy. |

**Da pra criar mercado malformado?** Sim — se round_manager bugar o threshold (ex: threshold=0), cria mercado onde todo resultado cai em "Over 0". Sem validacao.

---

## 5. REGRAS DE RESOLUCAO

| Pergunta | Status | Realidade |
|----------|--------|-----------|
| Regra de resolucao armazenada? | ❌ | Nao. A regra e "oracle conta veiculos com YOLO e chama resolveMarket(count)". Nao ta escrita em nenhum contrato ou metadata. |
| Legivel pra humano? | ❌ | Nao. Usuario ve "RESOLVED" e o count, mas nao sabe de onde veio. |
| Tipo de resolucao? | ⚠️ | So automatica (oracle). Sem manual, sem hibrida. |
| Evidencia da resolucao? | 💀 | **NAO.** Nao grava frames, nao grava hash de video, nao grava nada. O count aparece on-chain mas sem prova. DataAttestation existe no codigo mas NAO esta deployado. |
| Payload do resultado? | ⚠️ | On-chain: actualCarCount + winningRangeIndex. Sem timestamp de quando contou, sem fonte, sem confianca. |
| Da pra auditar? | 💀 | **NAO.** Nao tem log, nao tem evidencia, nao tem replay. Se alguem contestar, a unica resposta e "confia". |
| Politica de void? | ⚠️ | Contrato tem cancelMarket() (refund total). Mas nao tem criterio definido de quando usar. |
| Politica de revisao? | ❌ | Nao existe. Uma vez resolvido, e final. |
| Politica pra dado inconclusivo? | ❌ | Nao existe. Se YOLO nao conseguir contar (stream caiu), round_manager cancela. Mas se contar errado, ninguem sabe. |

**Quando der briga:** Nao tem como provar nada. Sem frames salvos, sem hash, sem attestation. "Foi o YOLO que disse" e a unica defesa.

---

## 6. INGESTAO DE DADOS EXTERNOS

| Pergunta | Status | Realidade |
|----------|--------|-----------|
| Depende de fonte externa? | ✅ | YouTube Live / HLS streams via yt-dlp. |
| Fonte confiavel? | ⚠️ | YouTube e confiavel, mas stream pode cair, mudar URL, ter lag. |
| Timeout? | ⚠️ | yt-dlp tem timeout de 60s. OpenCV VideoCapture nao tem timeout explicito — pode travar. |
| Retry? | ⚠️ | yt-dlp tenta 3 comandos diferentes. Mas se todos falharem, stream_server morre. |
| Circuit breaker? | ❌ | Nao. |
| Cache? | ❌ | Nao. Cada round re-extrai a URL do YouTube do zero. |
| Rate limit? | ❌ | Nao controla rate de requests ao YouTube. |
| Fallback? | ❌ | Se stream cair, cancela mercado. Sem camera alternativa automatica. |
| Deduplicacao? | ❌ | Nao relevante (stream continuo). |
| Validacao de integridade? | ❌ | Nao. Se OpenCV ler frame corrompido, YOLO processa mesmo assim. |
| Tolerancia a payload quebrado? | ⚠️ | Se frame nao ler (ret=False), pula. Mas nao detecta frame congelado/repetido. |
| Fila entre ingestao e processamento? | ❌ | Nao. Sincrono — le frame, processa, envia, repete. |

**Se YouTube atrasar, repetir ou mandar lixo:** O sistema nao percebe frame congelado. Se a stream travar mostrando a mesma imagem, YOLO vai ficar contando os mesmos carros parados. Sem deteccao de stale frame.

---

## 7. PIPELINE DE RESOLUCAO

| Pergunta | Status | Realidade |
|----------|--------|-----------|
| Pipeline sincrono ou assincrono? | ⚠️ | Sincrono dentro do round_manager. Asyncio pra subprocess, mas resolucao e sequencial. |
| Fila? | ❌ | Nao. Um round por vez. |
| Estado "resolving"? | ❌ | Nao existe on-chain. E um periodo real mas nao um estado. |
| Timeout maximo por resolucao? | ✅ | TX_WAIT_TIMEOUT = 120s. Se tx nao minerar, timeout. |
| Retry seguro? | ⚠️ | 3 retries com backoff. Mas se 1o retry minera e 2o tambem tenta... contrato previne (state check), mas gasta gas duplo. |
| Lock por round? | ❌ | Nao. Se 2 instancias do round_manager rodarem, ambas tentam resolver. |
| Dois workers podem resolver ao mesmo tempo? | 💀 | **SIM em teoria.** Nao tem lock. Na pratica, so 1 round_manager roda. Mas se alguem rodar 2 por engano, cria mercados duplicados. O contrato previne double-resolve, mas nao double-create. |
| Job idempotente? | ❌ | Nao. Rodar round_manager 2x cria mercados duplicados. |
| Dedupe de evento? | ❌ | Nao. Ledger POST pode duplicar se retryar. |

**Se dois workers pegarem a mesma rodada:** O contrato impede double-resolve (bom). Mas double-create e possivel — 2 mercados pro mesmo periodo, confusao total no frontend.

---

## 8. PERSISTENCIA / BANCO DE DADOS

| Pergunta | Status | Realidade |
|----------|--------|-----------|
| Quais tabelas existem? | ⚠️ | Nao e banco relacional. Redis keys: chat:messages (list), chat:online (zset), ledger:markets (zset), ledger:market:{addr} (hash), stats (hash), profile:bets:{addr} (list), rounds:history (list). |
| Modelagem aguenta historico? | ⚠️ | Lists com trim (max 200 msgs, 100 rounds, 200 bets/user). Historico antigo e descartado. |
| Separacao estado atual vs eventos? | ❌ | Tudo junto. Nao tem event sourcing. |
| Trilha de auditoria? | ❌ | Nao existe. |
| Soft delete? | ❌ | Nao. |
| Unique constraint? | ❌ | Redis nao tem. Nada impede duplicatas no ledger. |
| Foreign key? | ❌ | Redis nao tem. Bets referenciam market por address (string), sem validacao. |
| Indices? | ⚠️ | Sorted sets por timestamp servem como indice. Mas nao tem busca por campo. |
| Versionamento otimista? | ❌ | Nao. |
| Migracao formal? | ❌ | Nao. Schema e implicito no codigo. |
| Backup? | ❌ | Nao. Se Redis perder dados, perdeu. |
| Restore testado? | ❌ | Nao. |

**Se o banco cair e voltar parcial:** Stats podem estar inconsistentes (incrementaram mas mercado nao gravou). Sem como detectar. A verdade oficial e a blockchain, mas nao tem como reconstruir o Redis a partir dela automaticamente.

---

## 9. API

| Pergunta | Status | Realidade |
|----------|--------|-----------|
| Contrato claro? | ⚠️ | Endpoints existem mas sem docs, sem schema, sem tipos formais. |
| Documentacao? | ❌ | Zero. Nem comments nos endpoints. |
| Payloads consistentes? | ⚠️ | Mais ou menos. Chat retorna {messages: []}, stats retorna flat object. Sem padrao. |
| Status codes corretos? | ⚠️ | 200 pra sucesso, 400 pra bad input. Mas erros de Redis retornam 200 com dados vazios em vez de 500. |
| Validacao de schema? | ❌ | Nao. POST /api/chat/messages valida texto nao vazio, mas nao valida tipo. POST /api/ledger aceita qualquer JSON. |
| Paginacao? | ⚠️ | Ledger tem limit/offset. Outros nao. |
| Rate limit? | ❌ | Nenhum. Qualquer um pode spammar /api/chat/messages infinitamente. |
| Autenticacao? | 💀 | **SO X-API-KEY OPCIONAL** no ledger POST. Sem auth real. Qualquer um pode postar dados falsos no ledger se LEDGER_API_KEY nao estiver setado. |
| Autorizacao? | ❌ | Nao existe. Sem roles, sem RBAC. |
| Versionamento? | ❌ | Nao. /api/stats pode mudar shape sem aviso. |
| Endpoint admin separado? | ❌ | Nao. Tudo publico. |
| Risco de expor dado interno? | ⚠️ | Profile expoe todas as bets do usuario com amounts. Aceitavel pra blockchain (ja e publico), mas poderia ser abusado pra tracking. |

**Se outro time integrasse:** Teria que ler o codigo pra entender. Sem docs, sem tipos, sem exemplos.

---

## 10. REALTIME

| Pergunta | Status | Realidade |
|----------|--------|-----------|
| Polling, websocket ou SSE? | ⚠️ | Video: WebSocket (oracle). Dados de mercado: polling wagmi 5-10s. Chat: polling API 3s. Tres mecanismos diferentes. |
| Estado do round em tempo real? | ⚠️ | Polling 5s. Pode ter ate 5s de atraso. |
| Countdown sincroniza? | ⚠️ | Baseado em lockTime on-chain (block.timestamp). Razoavel mas nao perfeito. |
| Frontend pode ver dado velho? | 💀 | **SIM.** Polling com cache do Vercel pode servir dado stale. Chat polling 3s pode perder msgs. |
| Ordem garantida? | ❌ | Chat messages podem chegar fora de ordem (polling, nao WS). |
| Replay ao reconectar? | ⚠️ | Chat: sim (busca ultimas 100). Video: nao (perde frames perdidos). Market data: sim (re-fetches). |
| Heartbeat? | ✅ | Chat tem heartbeat 15s. Video WS tem ping/pong. |
| Deteccao de conexao morta? | ✅ | Video WS reconnect 10s. Chat polling continua. |
| Fallback pra polling? | ✅ | Market data ja e polling. Video cai pro YouTube embed. |

**O usuario ve o estado real?** Com ate 5s de atraso nos dados de mercado, 3s no chat, e tempo real no video (quando conectado). Aceitavel pra MVP.

---

## 11. CONSISTENCIA FRONTEND / BACKEND

| Pergunta | Status | Realidade |
|----------|--------|-----------|
| Frontend exibe mesmos estados? | ✅ | OPEN/LOCKED/RESOLVED/CANCELLED mapeados diretamente. |
| Estado so visual? | ⚠️ | "resolving" no frontend e um estado visual que nao existe on-chain. E derivado de "LOCKED + nao RESOLVED ainda". |
| Backend manda info suficiente? | ⚠️ | Sim pra mercado ativo. Nao pra historico (precisa do ledger API). |
| Frontend precisa adivinhar estado? | ⚠️ | "isWaiting" e derivado de "factory OK mas nenhum mercado ativo". Nao e um estado do backend. |
| Countdown depende so de JS local? | ⚠️ | Depende de lockTime (on-chain) + Date.now() (local). Se relogio do client estiver errado, countdown erra. |
| Resultado mostrado bate com armazenado? | ✅ | Le direto do contrato. |

**Interface representa a verdade?** Sim pra dados on-chain. Inventa pra stats (era tudo zero hardcoded, agora vem do Redis que pode estar desatualizado).

---

## 12. TRANSPARENCIA E AUDITABILIDADE

| Pergunta | Status | Realidade |
|----------|--------|-----------|
| Cada rodada tem historico? | ⚠️ | So se o ledger POST funcionar. Senao, perdeu. |
| Timeline de eventos? | ❌ | Nao. Ledger grava snapshot final, nao eventos. |
| Log de criada/aberta/fechada/resolvida? | ❌ | So no stdout do round_manager (nao persiste). |
| Identificador de quem executou? | ⚠️ | Oracle wallet address ta no tx. Mas nao no ledger. |
| Evidencia anexada? | ❌ | Nenhuma. Sem frames, sem hash, sem nada. |
| Hash de evidencia? | ❌ | DataAttestation existe no codigo mas NAO ESTA DEPLOYADO. |
| Replay? | ❌ | Impossivel. Video nao e gravado. |
| Reconstruir o que aconteceu? | 💀 | **Parcialmente.** Blockchain tem txs. Mas sem video/frames, nao da pra provar o count. |

**Se contestarem 20 rodadas:** Pode mostrar os txs on-chain e os counts. Mas nao pode provar que o YOLO contou certo. Sem video gravado = sem evidencia.

---

## 13. ERROS E FALHAS

| Pergunta | Status | Realidade |
|----------|--------|-----------|
| Job falhar? | ⚠️ | round_manager loga e tenta de novo apos 30s. Mas se crashar de vez, ninguem sabe. |
| Banco atrasar? | ⚠️ | Redis timeout = silently ignored (try/catch retorna default). |
| API externa cair? | ⚠️ | YouTube cair = stream_server morre = mercado cancelado. OK. |
| Scheduler travar? | 💀 | Tudo trava. Sem watchdog, sem auto-restart. |
| WebSocket morrer? | ✅ | Frontend reconnect 10s. OK. |
| Clock desalinhar? | ⚠️ | Countdown pode ficar ~5s errado. Nao fatal. |
| Estado seguro em falha? | ⚠️ | Mercado fica OPEN/LOCKED (bets presas). Precisa cancel manual. |
| Dead-letter queue? | ❌ | Nao. |
| Retry infinito por engano? | ✅ | Nao. MAX_TX_RETRIES = 3. |
| Alerta? | ❌ | Nenhum. |
| Dashboard operacional? | ❌ | Nenhum. |

**Quando da merda:** O sistema falha silenciosamente. Mercados ficam pendurados. Ninguem e notificado. Precisa olhar manualmente.

---

## 14. SEGURANCA

| Pergunta | Status | Realidade |
|----------|--------|-----------|
| Autenticacao real? | ❌ | APIs publicas sem auth. Chat aceita qualquer address string. |
| RBAC? | ❌ | Nao. |
| Separacao user/admin/operator? | ❌ | On-chain: admin vs oracle vs user. Off-chain: nada. |
| Protecao contra replay? | ✅ | On-chain: nonce. Off-chain: nao. |
| Protecao contra spoof? | 💀 | **Chat permite spoofar qualquer wallet address.** Sem verificacao de assinatura. Alguem pode fingir ser outro usuario no chat. |
| Sanitizacao? | ⚠️ | Chat limita 200 chars. Mas nao escapa HTML (frontend usa React que escapa por default). |
| Rate limit? | 💀 | **NENHUM em nenhuma API.** Qualquer um pode DDoS o chat, o ledger, o stats. |
| Rotacao de secrets? | ❌ | Nao. PRIVATE_KEY nunca foi rotado. |

**3 jeitos mais faceis de baguncar:**
1. Spam infinito no /api/chat/messages (sem rate limit)
2. POST dados falsos no /api/ledger (sem auth se LEDGER_API_KEY nao setado)
3. Spoofar wallet address no chat (sem signature verification)

---

## 15. ADMIN / OPERACAO MANUAL

| Pergunta | Status | Realidade |
|----------|--------|-----------|
| Painel admin? | ❌ | Nenhum. |
| Criar/abrir/fechar/resolver/voidar rodada? | ❌ | Tudo via CLI (cast, python). Sem UI. |
| Confirmacao de acoes perigosas? | ❌ | round_manager nao pede confirmacao. |
| Log de quem clicou? | ❌ | Nao existe. |
| Trava contra erro humano? | ❌ | Nenhuma. |
| Rollback operacional? | ❌ | Nao existe. |

**Operador as 3h da manha:** Pode rodar round_manager 2x por engano e criar mercados duplicados. Sem protecao.

---

## 16. PERFORMANCE E ESCALA

| Pergunta | Status | Realidade |
|----------|--------|-----------|
| Quantos mercados simultaneos? | ⚠️ | 1 por vez (round_manager e sequencial). Frontend so mostra o primeiro ativo. |
| Quantos usuarios simultaneos? | 💀 | **Sem limite no WS do stream_server.** 100 usuarios = 100 conexoes recebendo JPEG a 8fps. Vai saturar upstream. |
| Cache? | ❌ | Nao. Cada request ao Redis e individual. |
| Fila? | ❌ | Nao. |
| Gargalo num unico worker? | 💀 | **SIM.** Oracle = 1 maquina com GPU. Se cair, tudo cai. |
| Benchmark real? | ❌ | Nenhum. |

**Funciona porque ta bom ou porque quase ninguem usa?** Porque quase ninguem usa. 50 usuarios simultaneos no WS provavelmente derruba.

---

## 17. TESTES

| Pergunta | Status | Realidade |
|----------|--------|-----------|
| Testes unitarios? | ⚠️ | 155 testes nos contratos Solidity (Foundry). Zero testes no frontend/oracle/API. |
| Testes de integracao? | ❌ | Nenhum. |
| Testes de transicao de estado? | ✅ | Nos contratos Solidity sim. |
| Testes de concorrencia? | ❌ | Nenhum. |
| Testes de idempotencia? | ❌ | Nenhum. |
| Testes de falha? | ❌ | Nenhum. |
| Testes de reconnect realtime? | ❌ | Nenhum. |
| Testes de recovery apos crash? | ❌ | Nenhum. |

**Garantido por teste:** Contratos Solidity (logica de bet, resolve, claim, fees). **Garantido por fe:** Tudo o resto.

---

## 18. MERCADO FUNCIONANDO DIREITO

| Pergunta | Status | Realidade |
|----------|--------|-----------|
| Usuario entende o que esta sendo previsto? | ✅ | "How many vehicles in 5 min?" com Over/Under. Claro. |
| Backend sabe quando comeca e termina? | ✅ | createdAt + roundDurationSecs. |
| Trava o round no momento certo? | ✅ | lockTime on-chain. Imutavel. |
| Resultado sai uma vez so? | ✅ | Contrato impede double-resolve. |
| Resultado fica armazenado? | ✅ | On-chain (permanente). |
| Round pode ser auditado? | 💀 | **NAO de verdade.** Tx existe, count existe. Mas evidencia de video nao. |
| Consistencia lista/detalhe/historico? | ⚠️ | Se ledger POST falhar, historico fica incompleto. |
| Transparencia pra nao parecer arbitrario? | 💀 | **Insuficiente.** Usuario ve um numero. Nao ve o video que gerou, nao ve frames, nao ve confianca. |

**Se voce fosse usuario, confiaria?** Confiaria se visse o video ao vivo com os carros sendo marcados. Mas depois que o round acaba, nao tem como verificar. E um "trust me bro" pos-facto.

---

## CENARIOS DE DESASTRE

| Cenario | O que acontece | Severidade |
|---------|---------------|------------|
| Rodada fechar e nao resolver | Mercado fica LOCKED pra sempre. Bets presas. Precisa cancel manual. | 💀 |
| Resolver com dado errado | YOLO contou errado. Resolveu. Irreversivel. Sem disputa. | 💀 |
| Resolver duas vezes | Contrato impede. OK. | ✅ |
| Abrir duas vezes | 2 round_managers = 2 mercados. Frontend mostra so 1. Confusao. | 💀 |
| Ficar em "resolving" eternamente | Se resolve tx falhar 3x, mercado fica LOCKED. Precisa cancel manual. | 💀 |
| WS mostrar uma coisa e API outra | Possivel — WS mostra count ao vivo, API mostra polling atrasado 5s. | ⚠️ |
| Scheduler perder 3 minutos | Bets ja fechadas (lockTime). Resolve com 3min de atraso. OK mas UX ruim. | ⚠️ |
| Fonte externa mandar dado corrigido | Nao existe mecanismo. Resultado e final. | ❌ |
| Banco gravar parcialmente | Stats incrementam mas ledger nao grava. Inconsistencia. | 💀 |
| Admin errar manualmente | Sem admin panel, sem confirmacao. Roda script errado = desastre. | 💀 |
| Sistema reiniciar no meio da janela | Mercado fica pendurado. Sem recovery automatica. | 💀 |
| Contestacao em massa | Sem mecanismo de disputa. Sem evidencia. Sem recurso. | 💀 |
| Evidencia sumir | Nunca existiu. Video nao e gravado. | 💀 |

---

## ONDE ESTA A VERDADE DE CADA ROUND

| Pergunta | Resposta |
|----------|----------|
| Onde esta a verdade oficial? | **On-chain:** PredictionMarket.actualCarCount + state |
| Quem decide? | Oracle wallet (unica, centralizada) |
| Com base em que? | YOLO count (sem evidencia persistida) |
| Onde fica registrado? | Blockchain (tx) + Redis ledger (se POST nao falhar) |
| Como impedir duplicidade? | Contrato impede double-resolve. Mas nada impede double-create. |
| Como reconstruir depois? | Blockchain txs (parcial). Video nao existe. |
| Frontend mentindo por acidente? | Possivel — polling atrasado, countdown desync, stats desatualizados |

---

## CHECKLIST OPERACIONAL MINIMO — STATUS

| Requisito | Status |
|-----------|--------|
| Maquina de estados explicita | ✅ On-chain (4 estados) |
| Trilha de auditoria por round | ❌ Nao existe |
| Jobs idempotentes | ❌ Nao |
| Lock por resolucao | ✅ On-chain (state check) |
| Politica de void | ⚠️ cancelMarket existe mas sem criterio |
| Historico de eventos | ❌ So snapshot, nao eventos |
| Healthchecks reais | ❌ Nao existe |
| Logs estruturados | ❌ print/console.log |
| Painel admin com confirmacao | ❌ Nao existe |
| Testes de transicao de estado | ✅ Solidity tests |
| Recovery de rounds orfaos | ❌ Nao existe |
| Consistencia API e realtime | ⚠️ Parcial |

**Score: 3/12 OK, 2/12 parcial, 7/12 nao existe.**

---

## TOP 10 PRIORIDADES PRA PRODUCAO REAL

1. **Watchdog/supervisor pro round_manager** — se morrer, reinicia automaticamente
2. **Rate limit nas APIs** — sem isso, qualquer um derruba o chat/ledger
3. **Recovery de rounds orfaos** — script que detecta mercados OPEN/LOCKED sem round_manager e cancela
4. **Gravar frames/evidence** — salvar screenshots do YOLO pra cada round (S3/R2)
5. **Healthcheck endpoint** — /api/health que checa Redis + ultimo round + oracle status
6. **Auth no chat** — verificar assinatura da wallet, nao aceitar address string crua
7. **Lock contra double-create** — round_manager checa se ja tem mercado ativo antes de criar
8. **Alertas** — Telegram/Discord bot que avisa quando oracle cai
9. **Ledger sync from chain** — endpoint que reconstroi ledger a partir de eventos on-chain
10. **Admin panel basico** — ver rounds, cancelar mercados, ver status do oracle
