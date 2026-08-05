# CONTEXTO DEL PROYECTO IA-27 — Estalingrado Corp

## Qué es
IA-27 es una **asistente virtual de escritorio 100% local** para Windows (Electron + node-llama-cpp). Corre modelos **GGUF** locales, sin Ollama, sin servidor ni conexión. Detecta el hardware y recomienda el modelo óptimo. Es un proyecto de **Estalingrado Corp** (repo: `https://github.com/Estalingradocorp/agente-IA27-.git`, rama `main`).

**Ruta del proyecto:** `C:\Users\nicot\OneDrive\Desktop\Nueva carpeta\IA27` (carpeta en OneDrive — puede bloquear archivos al build).

## Arquitectura
```
src/main/index.js          Proceso principal Electron (ventanas, IPC)
src/main/ia27/index.js     IACore: orquesta todo (init, send, switchConversation, attach)
src/main/ia27/agent.js     Agent: orquesta chat + memoria + recorte de historial
src/main/ia27/bridge.js    WorkerBridge: puente main ⇄ worker (mensajes IPC)
src/main/ia27/worker.js    Motor aislado (utilityProcess) — crea sesión LlamaChatSession
src/main/ia27/engine.js    LLMEngine: carga modelo, contexto, sampling, perfiles
src/main/ia27/tools.js     Herramientas (function calling): sistema, archivos, web, empresa
src/main/ia27/documents.js Extracción de texto: PDF, DOCX, HTML, código, TXT
src/main/ia27/memory.js    Persistencia de conversaciones + encriptación AES-256-GCM
src/main/ia27/persona.js   Prompt de sistema + buildSystemPrompt(settings)
src/main/ia27/company.js   COMPANY_INFO: ficha oficial de Estalingrado Corp
src/main/ia27/{modelResolver,modelRecommender,hardware}.js
src/preload/index.js       API segura para el renderer (contextBridge)
src/renderer/              UI: index.html, renderer.js, styles.css, galaxy.js
scripts/                   smoke, build de vendor
```

**Flujo de un mensaje:** renderer → `api.sendMessage` → IPC `ia27:send` → `IACore.send` → `Agent.send` → `bridge.chat` → `worker.runChat` → `LlamaChatSession.promptWithMeta` (con `functions: handlers`). Los tokens vuelven por eventos `gen:token` / `gen:tool` / `gen:done`.

## Comandos
- `npm start` — desarrollo
- `npm run build:portable` / `build:installer` — genera `dist\IA-27-portable.exe` / Setup
- `npm run smoke` — prueba el motor sin ventana
- `npm run vendor` — bundle de UI (marked + highlight.js)
- **IMPORTANTE:** para recompilar hay que **cerrar la app IA-27** (el portable se auto-extrae a Temp y bloquea el exe; OneDrive también bloquea). Sin eso, el build se cuelga con "output file is locked for writing". El shell de OpenCode no es admin → no puede matar el proceso.

## Datos (rutas)
- Modelos GGUF: `%APPDATA%\ia27\ia27-data\models\`
- Config: `%APPDATA%\ia27\ia27-data\config.json`
- Conversaciones: `%APPDATA%\ia27\ia27-data\conversaciones\`

**Config actual del usuario:** temperature 1, **maxTokens 40000**, **contextSize 8192**, gpuLayers 99, hilos auto, mmap true, perfil auto, encriptar false, `autoApproveCommands true`, `buscarInternet false`, modelo `Qwen2.5-3B-Instruct-Q4_K_M.gguf`.

## Trabajo ya commiteado (commit `df9ef84`)
1. **Fix `useTools`**: `bridge.chat()` no reenviaba `useTools` al worker → las tools "siempre activas" estaban rotas. Ahora `chat({... useTools})` lo pasa.
2. **`reset()` en bridge + `switchConversation`** ahora resetea la sesión del worker → el contexto ya no contamina entre conversaciones.
3. **Contexto ampliado**: default `contextSize 8192` (era 4096), `maxTokens 2048` (era 1024); perfiles ligero 4096 / equilibrado 8192 / potente 16384.
4. **Adjuntos tipo ChatGPT (multi-archivo)**: el botón 📎 ya **no auto-envía**. Los archivos quedan en **chips en espera** (`state.pendingAttachments`), se pueden quitar con ✕, y se leen/suben **solo al presionar Enviar junto con el prompt**. Input con `multiple`, drop de varios. En `IACore.send`, si `payload.files`, extrae texto con `extractText` y arma el mensaje `[Documentos adjuntos: ...]` + prompt. El render muestra tarjetas de docs + burbuja del prompt.
5. **Recorte de contexto**: `Agent._fitToContext(items)` recorta el historial viejo (conserva prompt de sistema + último mensaje) según presupuesto derivado de contextSize/maxTokens. En `IACore.send`, el texto de documentos se capea a `docBudgetChars`. Esto eliminó el error "⚠ The default context shift strategy did not return a history that fits the context size".
6. **Fix en Ajustes**: el botón **"Reiniciar ahora"** nunca se mostraba; ahora aparece al cambiar campos que requieren reinicio (`RESTART_FIELDS` = contexto, gpuLayers, threads, mmap, perfil, modelPath, modelTag, encriptar). `maxTokens` y `temperature` se aplican al instante.

## Trabajo nuevo SIN commitear (ya buildado en portable, sin subir a GitHub)
Archivos modificados/pendientes: `agent.js`, `bridge.js`, `persona.js`, `tools.js`, `worker.js`, `renderer/index.html`, `renderer.js` + **nuevo `src/main/ia27/company.js`**.

1. **Búsqueda en internet (opcional)**: checkbox en ⚙ Ajustes **"Permitir búsqueda en internet"** (`buscarInternet`, bool, default off, se aplica al instante). Tool `buscar_internet` en `tools.js`: usa **DuckDuckGo sin API key** (`api.duckduckgo.com` para respuesta directa; si no, scrape de `html.duckduckgo.com` con regex `result__a` / `result__snippet`). Timeout 10s con AbortController. Si está deshabilitada devuelve aviso. Verificado: HTTP 200 y parseo OK. El worker recibe settings frescos por mensaje (`bridge.chat` reenvía `settings`, `runChat` usa `msg.settings`).
2. **Info de Estalingrado Corp**: `company.js` con `COMPANY_INFO` (ficha oficial desde `estalingradocorp.qzz.io` y `estalingradocorp.github.io/EstalingradoCorp/`). Tool `info_empresa` que la devuelve. `persona.js` ahora exporta `buildSystemPrompt(settings)` que inyecta COMPANY_INFO + nota WEB según `buscarInternet`. `agent.js` usa `buildSystemPrompt` en vez del `SYSTEM_PROMPT` estático.

**Datos clave de Estalingrado Corp (ficha):** corporación de tecnología/ingeniería de datos, registrada en Argentina (REG: AR); sitio `estalingradocorp.qzz.io`; operación 24/7, 7+ plataformas. Ecosistema: Buscador Estalingrado, EC WebSend (transferencia), EC News (noticias), EC Download (descargas), EC-OS (OS webizado), Big Data/Intranet, Portal NOA, Demiurgo Box. Proyectos PRJ-101..106. Redes: YouTube @Estalingradocorp, Facebook estalingradocorp, X @estalingrado27, Telegram estalingradocorp. Filosofía: "La tecnología no es el fin, es el camino".

## Pendiente / a tener en cuenta
- **Push**: los cambios de web + empresa + Wikipedia/Archive + métricas ya están listos para subir a GitHub.
- **Bug resuelto — rutas alucinadas**: el modelo inventaba rutas (p. ej. `/internet/searches/` o rutas monstruosas en `corporate_documents/`). Ahora las tools de archivos devuelven mensajes amables y redirigen a `buscar_wikipedia` / `buscar_internet_archive` / `buscar_internet` cuando detectan una consulta web, en vez de lanzar `⚠ La carpeta no existe`.
- **Bug conocido (diferido por el usuario):** al pedir "escríbeme un HTML completo", el modelo "escribe cualquier cosa" — limitación del modelo. Con el salto a 3B se espera mejoría.
- **Modelo actual es Qwen2.5-3B-Instruct** (16 GB de RAM del equipo, ~1.8 GB GGUF). Mucho más capaz que el 0.5B original: mejor seguimiento de instrucciones y menos alucinaciones. Opcionalmente se puede subir a 7B.
- Para subir al repo: `git add` de los modificados + `company.js` + `docs/CONTEXTO.md`, commit en español estilo repo, `git push origin main`.

## Consejo de continuidad
La mejor forma de arrancar en la ventana nueva: `git status` + `git diff` para ver los cambios pendientes; leer `src/main/ia27/` (index.js, agent.js, bridge.js, worker.js, tools.js) y `src/renderer/renderer.js`. Los tests son `npm run smoke`. Verificar cambios dentro del exe buildado: `Select-String -Path dist\win-unpacked\resources\app.asar -Pattern '<marcador>' -SimpleMatch -Quiet`.
