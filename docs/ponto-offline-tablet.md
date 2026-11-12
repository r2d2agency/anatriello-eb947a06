# Plano: Ponto Offline-First no Tablet (rápido mesmo com internet ruim)

## Objetivo
O tablet tem internet lenta. A ideia: **usar o modo offline como caminho principal** — câmera, modelos, base de rostos e registro funcionam 100% local; a rede serve só para sincronizar em segundo plano. Assim a batida é rápida mesmo online.

## Diagnóstico do que já existe

- `src/lib/facial-recognition.ts` — modelos baixados do jsDelivr (`cdn.jsdelivr.net/...face-api/model`) a cada `loadFaceModels()` na primeira vez; sem cache local garantido → câmera demora ~20s na primeira batida.
- `src/lib/kiosk-cache.ts` — base de enrollments em IndexedDB (`kiosk_ponto`, stores `enrollments` + `meta`), TTL 30 min. Já é offline-first no `loadEnrollments()` (`RHRelogioPonto.tsx:354`), com fallback para cache expirado.
- `src/lib/kiosk-offline-queue.ts` — fila `punch_queue` no **mesmo banco `kiosk_ponto` DB_VERSION 1**, mas o `openDb()` dele **só cria `punch_queue`** no `onupgradeneeded`, enquanto o `openDb()` do `kiosk-cache.ts` **só cria `enrollments` + `meta`**. Como os dois abrem o mesmo banco/versão com schemas diferentes, **quem abrir primeiro vence**: o outro store pode não existir → `save`/`get` falham silenciosamente (os `catch {}` engolem o erro). **Esse é o principal suspeito de "offline não funciona".**
- `src/pages/KioskLogin.tsx:39-45` — já pré-carrega modelos + enrollments no login, mas com `await` sequencial que trava a navegação se a rede estiver lenta.
- `RHRelogioPonto.tsx:638` — o registro offline só acontece se `navigator.onLine === false`. Com internet lenta (mas "online"), ele tenta o POST, trava no upload do `selfie_url` (base64 JPEG ~100-300KB) e a tela fica "girando".
- `syncOfflineQueue()` (`RHRelogioPonto.tsx:580`) — sincroniza no mount e no evento `online`, sem retry agendado nem contador visível.
- PWA: `vite-plugin-pwa` com `registerType: autoUpdate` + `cleanupOutdatedCaches`, `version.json` via `NetworkOnly`. Modelos do jsDelivr **não entram no precache** → primeira abertura sempre baixa ~15-30MB.

## Etapas

### 1. Unificar o IndexedDB (bug crítico — fazer primeiro)
- Criar **um único `openDb()`** (ex.: `src/lib/kiosk-db.ts`) que cria os 3 stores: `enrollments`, `meta`, `punch_queue`.
- Subir `DB_VERSION` para `2` para forçar o `onupgradeneeded` nos tablets já instalados.
- Fazer `kiosk-cache.ts` e `kiosk-offline-queue.ts` usarem esse módulo. Sem isso, cache e fila continuam se sabotando.
- Teste: no tablet, login → DevTools → Application → IndexedDB → `kiosk_ponto` deve ter os 3 stores com dados.

### 2. Registro offline-first com timeout (o ganho de velocidade)
- No `confirmPunch()`, inverter a lógica atual:
  1. Compara o rosto **sempre contra a base local** (já acontece).
  2. Dispara o POST com **timeout curto (ex.: 6-8s)** em paralelo.
  3. Se resolver a tempo → sucesso online normal.
  4. Se estourar o timeout ou falhar → `enqueuePunch()` + tela de sucesso "registrado, sincronizando" + tenta sincronizar depois.
- Reduzir o peso do upload: comprimir o `selfie_url` (ex.: JPEG 0.6, largura máx 480px) antes de enviar/enfileirar.
- Resultado: com internet lenta, a batida não trava mais — o colaborador sai andando e o tablet sincroniza sozinho.

### 3. Modelos face-api rápidos (acabar com os ~20s de câmera)
- Pré-carregar no login **sem bloquear**: `Promise.allSettled([loadFaceModels(), fetch enrollments])` em background após `navigate("/kiosk")`, com indicador "preparando offline…" que não trava.
- Cachear os pesos: colocar as URLs do jsDelivr no `workbox.runtimeCaching` do `vite.config.ts` com estratégia `CacheFirst` + `expiration` longa, para a segunda abertura ser instantânea.
- Warmup da câmera: manter `streamRef` vivo entre batidas (já existe reaproveitamento parcial) + abrir com constraints leves (640x480) e só subir resolução se necessário.

### 4. Sincronização confiável da fila
- `syncOfflineQueue()`: retry com backoff (ex.: 5s → 30s → 2min), `incrementPunchAttempt`, e limite de tentativas antes de marcar erro visível.
- Sincronizar também em intervalo (ex.: a cada 60s) e ao voltar para `idle`/`matricula`, não só no evento `online`.
- Mostrar contador na UI: "⏳ N ponto(s) pendente(s)" no topo quando `queue.length > 0`.

### 5. Sinais visíveis no tablet (para diagnosticar "fica girando")
- Manter os logs `[kiosk]` já adicionados no `runDetection` e estender: `camera.open start/ok`, `models load start/ok (Xms)`, `enrollments cache hit/miss (N itens, Yms)`, `punch POST ok/timeout → fila`.
- Esses logs vão para o sistema de logs remoto (como o 403 que você já capturou) ou pelo menos `console`, para sabermos em qual etapa o tablet lento para.

### 6. Validação no tablet
1. Login com internet → confirmar IndexedDB com 3 stores + enrollments salvos.
2. Desligar Wi-Fi → bater ponto → deve mostrar sucesso offline em segundos.
3. Religar Wi-Fi → fila deve zerar sozinha (toast "Ponto sincronizado").
4. Com internet lenta (throttle): batida deve cair no timeout e ir para a fila, sem travar a UI.

## Ordem de execução sugerida
1. Etapa 1 (DB unificado) — sem ela nada do resto é confiável.
2. Etapa 2 (POST com timeout + fila) — o ganho percebido imediato.
3. Etapa 3 (modelos + warmup) — acaba com a lentidão da câmera.
4. Etapas 4-5 (sync + logs) — confiabilidade e diagnóstico.
5. Etapa 6 (validação em campo).

## Arquivos envolvidos
- `src/lib/kiosk-db.ts` (novo — openDb único, version 2)
- `src/lib/kiosk-cache.ts` (usar db único)
- `src/lib/kiosk-offline-queue.ts` (usar db único)
- `src/lib/facial-recognition.ts` (nada ou compressão do selfie)
- `src/pages/RHRelogioPonto.tsx` (`confirmPunch` com timeout, contador pendente, logs)
- `src/pages/KioskLogin.tsx` (preload não-bloqueante)
- `vite.config.ts` (CacheFirst para os pesos do jsDelivr)
