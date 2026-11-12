# SmartRoute AI — Documentação Completa

Módulo de logística e roteirização com **otimização por IA**. O fluxo oficial parte da **importação do romaneio** (PDF): o sistema cria a rota e as paradas/pedidos automaticamente → IA organiza a sequência ideal → supervisor publica → entregador recebe no app.

---

## 1. Visão geral do fluxo

```text
Importar Romaneio (PDF) → parse + revisão das paradas
        │
        ▼
Commit da importação: cria/atualiza rota, PDVs (quando necessário) e pedidos/paradas
        │
        ▼
20h · Cron da IA otimiza a "Rota do Dia" para AMANHÃ (D+1):
      • respeita janela do PDV (manhã/tarde/noite/qualquer)
      • bloqueia pedidos em PDVs cujos dias permitidos não incluem essa data
      • gera sequência ótima (nearest-neighbor a partir da 1ª parada)
      • atribui motorista/veículo padrão da rota
        │
        ▼
Supervisor revisa (pode Reotimizar manual, trocar motorista, adicionar 2º entregador)
        │
        ▼
Supervisor "Publica" → rota fica disponível no app do entregador
        │
        ▼
Entregador executa: navegação · check-in · checklist do PDV · POD
```

**Papéis**

| Papel | O que faz |
|---|---|
| **Operador/Supervisor** | Importa o romaneio, revisa o reconhecimento de PDVs/paradas e confirma a importação. Cadastra rotas e PDVs (com regras), roda a IA manualmente quando quiser, troca/adiciona entregadores, publica ou reabre a rota do dia. |
| **Entregador** | Recebe no app apenas rotas **publicadas** em que ele é o motorista atribuído. |

> **Observação:** o lançamento manual de pedidos foi desabilitado no painel. A criação de pedidos/paradas ocorre pela importação do romaneio.

---

## 2. Cadastros essenciais

### 2.1 Rotas (menu **SmartRoute → Rotas Montadas**)

Uma "rota" é o **contêiner comercial** (ex.: "Rota Centro-SP", "Zona Leste"). Contém:
- **Código/Nome**
- **Motorista padrão** — usado pela IA quando ninguém foi atribuído manualmente
- **Veículo padrão**
- **Observações**

Não é necessário pré-cadastrar PDVs "fixos" na rota — o vendedor associa o PDV no momento do pedido. Se você quiser trabalhar com carteira fixa por rota, o cadastro `PDVs da rota` continua disponível.

### 2.2 PDVs / Clientes (menu **SmartRoute → PDVs**)

Cadastro-mãe do ponto de entrega. **Este é o lugar onde as regras vivem** — a IA lê tudo daqui na hora de organizar a rota.

Campos da seção **Regras de recebimento**:

| Campo | Efeito na IA |
|---|---|
| **Janela preferencial** (`manhã` / `tarde` / `noite` / `qualquer`) | Ordena as paradas: primeiro todos os PDVs de manhã, depois tarde, depois noite, depois `qualquer`. |
| **Dias permitidos** (checkboxes seg–dom) | Se um pedido for lançado para um dia fora desta lista, a IA **bloqueia** o pedido — ele não entra na sequência. |
| **Tempo de descarga (min)** | Usado no cálculo de ETA das paradas seguintes. |
| **Checklist do PDV** | Template de checklist executado quando o entregador chegar. `padrão` usa o template global da organização. |
| Janela horária início/fim | Referência operacional (não trava lançamento). |

### 2.3 Templates de checklist

Um PDV pode usar o template global (**padrão**) ou um checklist específico. O template contém itens do tipo `foto`, `ocr`, `assinatura`, `texto`, `número`, `sim/não`, `múltipla escolha` — o mesmo motor da versão anterior.

---

## 3. Lançamento de pedidos (vendedor)

Menu **SmartRoute → Pedidos → Novo pedido**.

1. Escolha a **Rota** (contêiner) — opcional. Sem rota, é pedido avulso e não entra na otimização automática.
2. Escolha o **PDV**.
3. Preencha a **Data de entrega**.
   - A tela mostra em tempo real se aquele PDV **aceita** entregas naquele dia da semana.
   - Se não aceitar, o pedido pode ser salvo, mas ficará marcado como **bloqueado** na otimização até você trocar a data.
4. Nº pedido, peso, volume, valor, prioridade, observações.
5. Salvar.

O pedido entra na fila da rota + data escolhidas. Enquanto a rota do dia estiver **aberta** ou **otimizada** (não publicada), o pedido pode ser editado ou removido normalmente.

---

## 4. Otimização com IA

A IA roda em dois momentos:

### 4.1 Automática (cron 20h America/Sao_Paulo)
Todo dia às 20h o job noturno pega **todas as rotas com pedidos para o dia seguinte (D+1)** e roda o otimizador. Não é preciso ação manual — quando o supervisor abrir a rota do dia de manhã, a sequência já vem pronta.

### 4.2 Manual (botão **Otimizar com IA**)
Em **SmartRoute → Rota do Dia**, escolha a rota + data e clique **Otimizar com IA**. Útil quando:
- Você lançou pedidos depois das 20h.
- Precisa refazer a sequência depois de mudar restrições do PDV.
- Quer testar cenários antes de publicar.

### 4.3 O que a IA faz
1. Lê todos os pedidos dessa rota + data.
2. Para cada pedido, checa se o dia da semana está nos **dias permitidos** do PDV. Se não estiver → marca como `bloqueado` (não entra na sequência).
3. Agrupa os pedidos elegíveis por **janela** (manhã → tarde → noite → qualquer).
4. Dentro de cada janela, aplica **nearest-neighbor** por coordenadas (lat/lng do PDV), começando pela primeira parada natural do grupo.
5. Grava `sequence = 1..N` em cada pedido.
6. Atribui o **motorista/veículo padrão da rota** se ainda não houver um definido para o dia.
7. Marca a rota do dia como `otimizada` e guarda `optimized_at`, `optimized_by`, `stops_summary`.

---

## 5. Rota do Dia (supervisor)

Menu **SmartRoute → Rota do Dia**.

### 5.1 Ciclo de vida do status

```text
aberta ─▶ otimizada ─▶ publicada ─▶ em_andamento ─▶ concluída
   ▲          │              │
   └──[reabrir]─────────[reabrir]
```

| Status | O que acontece |
|---|---|
| `aberta` | Aceita novos pedidos. Nenhuma sequência ainda. |
| `otimizada` | IA gerou a sequência. Ainda não foi enviada para o app. |
| `publicada` | Rota liberada no app do entregador (`status` dos pedidos → `em_rota`). |
| `em_andamento` | Entregador iniciou. |
| `concluída` | Todas as paradas finalizadas. |

### 5.2 Ações do supervisor
- **Otimizar / Reotimizar** — dispara a IA (ou refaz).
- **Atribuir/trocar entregadores** — pode escolher um ou vários (rota grande).
- **Publicar** — libera no app. Exige ao menos um entregador.
- **Reabrir** — volta para `aberta`, devolvendo pedidos para edição.

---

## 6. App do Entregador

Vê apenas rotas **publicadas** em que aparece como motorista.

Fluxo por parada (já existente, sem mudanças):
1. **Navegar** — abre Google/Waze/Apple Maps.
2. **Check-in** — GPS + Haversine valida chegada.
3. **Checklist** — executa o template configurado no PDV (ou o padrão).
4. **Finalizar** — POD: assinatura + foto + CPF/RG opcional.
5. **Ocorrência** — motivo, foto, segue.

Offline: check-ins, fotos e checklists ficam em fila local (`offline-db`) e sobem quando a conexão volta.

---

## 7. Torre de Controle, Replay e Relatórios

Sem mudanças em relação à versão anterior:
- **Monitoramento** — mapa em tempo real, filtros por rota, SLA em risco.
- **Replay** — reconstrói o percurso do dia.
- **Relatórios** — eficiência por entregador, aderência à sequência, ocorrências por PDV, sugestões de reordenação da rota fixa.

---

## 8. Modelo de dados (referência técnica)

```text
smartroute_routes            — contêiner comercial
  ├─ default_driver_id
  ├─ default_vehicle_id
  └─ owner_user_id           — vendedor responsável (opcional)

smartroute_pdvs              — cadastro + REGRAS
  ├─ delivery_window         — manha | tarde | noite | qualquer
  ├─ allowed_weekdays        — int[] 0=Dom..6=Sab
  ├─ service_time_min        — tempo de descarga
  └─ checklist_template_id   — FK para smartroute_pdv_checklists (opcional)

smartroute_pdv_checklists    — templates (globais ou por PDV)
  ├─ pdv_id (nullable)
  ├─ is_default              — usa quando o PDV não tem checklist próprio
  └─ items (jsonb)

smartroute_orders            — solicitação de entrega
  ├─ route_id, delivery_date, pdv_id
  ├─ pdv_window              — herdado do PDV, sobrescrivível
  └─ sequence                — preenchido pela IA

smartroute_route_days        — instância diária
  ├─ status                  — aberta | otimizada | publicada | em_andamento | concluida
  ├─ driver_ids[]            — 1..N entregadores
  ├─ vehicle_id
  ├─ optimized_at, optimized_by
  ├─ stops_summary (jsonb)   — { stops, blocked, weekday }
  └─ published_at
```

**Regra de ordenação da sequência (implementada em `optimizeRouteDay`):**
```
window_rank(pdv_window) ASC → nearest-neighbor Haversine
onde window_rank: manha=1, tarde=2, noite=3, qualquer=4
```

---

## 9. Endpoints principais

### PDVs (com regras)
- `GET/POST/PUT/DELETE /api/smartroute/pdvs`

### Templates de checklist
- `GET/POST/PUT/DELETE /api/smartroute/pdv-checklists`

### Rota do dia + IA
- `GET /api/smartroute/routes/:id/day?date=YYYY-MM-DD` — retorna (ou cria) a instância.
- `POST /api/smartroute/routes/:id/day/:date/optimize` — roda a IA para essa rota+data.
- `POST /api/smartroute/routes/:id/day/:date/publish` — publica no app.
- `POST /api/smartroute/routes/:id/day/:date/drivers` — troca/adiciona entregadores.
- `POST /api/smartroute/routes/:id/day/:date/reopen` — reabre.

### Cron
- `runNightlyOptimizer()` — registrado em `backend/src/index.js` em `0 20 * * *` (America/Sao_Paulo). Percorre todas as orgs e todas as rotas com pedidos para D+1.

### Pedidos
- `POST /api/smartroute/orders` — `route_id + delivery_date + pdv_id + …`
- `PUT /api/smartroute/orders/:id`

### App do entregador
- `GET /api/smartroute/driver/routes` — dias com o motorista atribuído e status em (`publicada`, `em_andamento`).

---

## 10. Perguntas frequentes

**Preciso pré-cadastrar PDVs em cada rota?**
Não. Basta ter o cadastro do PDV. No romaneio, o sistema tenta reconhecer/conectar o PDV pelo código ou nome; PDVs novos podem ser criados a partir dos dados da importação.

**E se precisar incluir uma entrega depois que a IA das 20h já rodou?**
Importe/ajuste o romaneio correspondente e peça ao supervisor para clicar **Reotimizar** na Rota do Dia — leva alguns segundos.

**PDV recebe só nas segundas e quartas. E se o romaneio trouxer entrega para uma terça?**
O pedido/parada é registrado, mas a IA o marca como **bloqueado** para aquela data (não entra na sequência do dia), respeitando os dias permitidos do PDV.

**Um entregador pode fazer duas rotas no mesmo dia?**
Sim — basta estar na lista `driver_ids` das duas rotas do dia. Ambas aparecem no app.

**Uma rota pode ter dois entregadores?**
Sim. O supervisor adiciona o segundo motorista antes de publicar (útil em dias de volume alto).

**Como funciona a auditoria?**
Toda ação (otimizar, publicar, reabrir, trocar entregador, importação/ajustes da rota) registra usuário, timestamp e (quando disponível) IP. Disponível em **Monitoramento → Replay**.

---

_Última atualização: fluxo baseado em importação de romaneio (módulo de lançamento manual de pedidos desabilitado)._
