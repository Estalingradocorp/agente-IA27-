# CONTEXTO DEL PROYECTO IA-27 — Estalingrado Corp

## Qué es
IA-27 es una **asistente virtual de escritorio 100% local** para Windows (Electron + node-llama-cpp). Corre modelos **GGUF** locales, sin Ollama, sin servidor ni conexión. Detecta el hardware y recomienda el modelo óptimo. Es un proyecto de **Estalingrado Corp** (repo: `https://github.com/Estalingradocorp/agente-IA27-.git`, rama `main`).

**Ruta del proyecto:** `C:\Users\nicot\OneDrive\Desktop\Nueva carpeta\IA27` (carpeta en OneDrive — puede bloquear archivos al build).

## Atenea Omega — modelo de IA propio de Estalingrado Corp
Estalingrado Corp está desarrollando **Atenea Omega**, un modelo de IA **propio y avanzado** que pronto será integrado a este proyecto como motor principal de IA-27. Forma parte de la evolución de la corporación hacia una inteligencia artificial propia, en línea con la filosofía *"La tecnología no es el fin, es el camino"*. Mientras tanto, IA-27 corre con modelos GGUF locales (Granite 3B, renombrado localmente como **Fabe27ib**, y Phi-3.5-mini). Repositorio del proyecto: https://github.com/Estalingradocorp/agente-IA27-

## Estado actual de modelos (jul-ago 2026)
- **Fabe27ib** (archivo `Fabe27ib.gguf`, ~1.9 GB) — modelo principal. Es **IBM Granite 3B** (`granite-3.0-3b-a800m-instruct-Q4_K_M`) **renombrado** para no exponer su nombre original. Responde en español y genera HTML/código completo. Corrida con GPU Vulkan (`gpuLayers 99`), contextSize 4096 (train del modelo), maxTokens 2048.
- **Phi-3.5-mini** (`Phi-3.5-mini-instruct-Q4_K_M.gguf`, ~2.2 GB) — disponible en Ajustes. Requiere contexto menor (su KV cache no entra en 4GB VRAM a 4096).
- **StarCoder2-3B probado y descartado**: repite el prompt y no completa HTML — inservible para este proyecto.
- **Qwen (0.5B/1.5B/3B/7B/Coder) eliminados** de la carpeta de modelos (~9 GB liberados) tras migrar a Fabe27ib.
- **Idioma**: `persona.js` fuerza español con instrucción concisa ("Responde siempre en español. Está prohibido responder en inglés.").
- **maxTokens**: subido a **2048** (default en `engine.js` y en `config.json`) y `clampMaxTokens` relajado (cap = 60% del contexto) para permitir generar HTML/textos largos completos.
- **Fix BOM**: `memory.js` (`getSettings` y `_read`) ahora tolera BOM UTF-8 del `config.json` (PowerShell 5.1 `Set-Content -Encoding UTF8` lo agrega y rompía `JSON.parse`, haciendo que la app ignorara el config y cayera al modelo recomendado).

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

**Config actual del usuario:** temperature 0.7, **maxTokens 2048**, **contextSize 4096**, gpuLayers 99, threads 0, mmap true, perfil potente, encriptar false, `autoApproveCommands false`, `buscarInternet true`, modelo `Fabe27ib.gguf`.

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

## Overhaul: conectividad + herramientas fiables (cambio grande, SIN commitear)
**Config corregida del usuario:** temperature 0.7, **maxTokens 2048** (era 40000, rompía presupuestos), contextSize 8192, buscarInternet true, modelo `Qwen2.5-3B-Instruct-Q4_K_M.gguf`.

1. **CAUSA RAIZ del "no busca en internet"**: `persona.js` decía al modelo *"eres un sistema local, sin conexión automática a internet"* → el modelo respondía "no tengo conexión" en lugar de usar sus tools. Reescrito: el modelo ahora sabe que **tiene internet real vía sus herramientas** y se le prohíbe responder de memoria o decir que no tiene conexión.
2. **Fix del cuelgue tras usar una tool**: el **function calling nativo de node-llama-cpp 3.19 (`functions` en `promptWithMeta`) se colgaba** después del primer tool call (CPU al 100%, sin tokens) con Qwen2.5 (tanto 3B como 7B). Se reemplazó en `worker.js` por un **bucle de herramientas controlado**: el prompt le pide al modelo responder SOLO con `{"name":"tool","arguments":{...}}`, el worker lo parsea (`extractToolCall`), ejecuta el handler, y hace una segunda generación para la respuesta final. Fiabilidad verificada.
3. **Persona + catálogo**: `persona.js` ahora incluye el **catálogo completo de herramientas con el formato de llamada exacto** (JSON en una línea) y la GUÍA DE RUTEO estricta (clima→consultar_clima, noticias→noticias, etc.).
4. **Búsqueda web robusta** (`tools.js`): `webSearch` con reintentos (`fetchWithRetry`) y 3 fuentes (DDG API → html.duckduckgo.com → lite.duckduckgo.com). `checkInternet()` nuevo export (chequeo de conectividad).
5. **Indicador de conexión en la UI**: `worker.js` verifica internet al iniciar (`checkAndReportNet`) y lo reporta; `IACore` lo agrega a `getStatus().net` (worker + main); la sidebar muestra **● internet en línea / ○ sin conexión**.
6. **Config defensiva**: `clampMaxTokens()` en `engine.js` (cap = contextSize/3) aplicado en `agent.js` (sampling + fitToContext) y en el presupuesto de documentos de `IACore.send` (antes con maxTokens 40000 los docs se truncaban a ~4200 chars). Temperatura efectiva ≤ 0.8 para fiabilidad.
7. **Documentos**: `documents.js` MAX_TEXT 6000→12000 y mensaje claro para PDF escaneados (sin OCR).
8. **Modelo 7B descargado** (`Qwen2.5-7B-Instruct.Q4_K_M.gguf`, 4.7GB de mradermacher, single-file) pero **NO es el default**: esta PC (GTX 1050 Ti 4GB + i3-10100F) no lo corre en GPU y en CPU genera ~1 tok/s (inviable). El **3B (1.8GB, entra en 4GB VRAM) es el default** y funciona rápido con el bucle controlado. El 7B queda disponible en la carpeta por si se usa en mejor hardware.
- **Bug resuelto — rutas alucinadas**: el modelo inventaba rutas (p. ej. `/internet/searches/` o rutas monstruosas en `corporate_documents/`). Ahora las tools de archivos devuelven mensajes amables y redirigen a `buscar_wikipedia` / `buscar_internet_archive` / `buscar_internet` cuando detectan una consulta web, en vez de lanzar `⚠ La carpeta no existe`.
- **Bug conocido (diferido por el usuario):** al pedir "escríbeme un HTML completo", el modelo "escribe cualquier cosa" — limitación del modelo. Con el salto a 3B se espera mejoría.
- **Modelo actual es Qwen2.5-3B-Instruct** (16 GB de RAM del equipo, ~1.8 GB GGUF). Mucho más capaz que el 0.5B original: mejor seguimiento de instrucciones y menos alucinaciones. Opcionalmente se puede subir a 7B.
- Para subir al repo: `git add` de los modificados + `company.js` + `docs/CONTEXTO.md`, commit en español estilo repo, `git push origin main`.

## Plan final — verificación completada y rebuild
1. **`extractToolCall` duplicado eliminado** en `worker.js` (había dos definiciones; quedó la robusta que busca `{"name":` con parseo balanceado de llaves).
2. **`tools.js`: errores que distinguen "sin internet" de "servicio caído"**. Nuevos `webErrorKind()` / `describeWebError()` (clasifica `AbortError`→timeout, `ENOTFOUND/EAI_AGAIN/ECONNREFUSED/fetch failed`→sin internet, HTTP≥400→servicio caído) aplicados a `webSearch`, `readPage`, `newsHeadlines`, `webWeather`, `worldTime`, `currencyRates`, `countryInfo`, `webSearchWikipedia`, `webSearchInternetArchive`. Timeouts 12s→15-20s y `fetchWithRetry` con 3 intentos en todas.
3. **Prueba real superada** (node directo, modelo 3B):
   - Herramientas con eventos `running→done`: clima Buenos Aires (9.4 °C real), hora Tokio, USD→ARS, noticias, info país, búsqueda web (DuckDuckGo), Wikipedia. **7/7**.
   - Bucle completo de chat: "¿Qué tiempo hace en Londres?" → el modelo emitió `{"name":"consultar_clima","arguments":{"ciudad":"Londres"}}`, se ejecutó y respondió con datos reales (~23 s en CPU).
   - `checkInternet()` online desde worker y main; UI con indicador **● internet en línea**.
   - `clampMaxTokens` verificado: 2048→2048, 40000→2730 (cap = contexto/3).
4. **Rebuild**: `npm run build:portable` OK (app cerrada) → `dist\IA-27-portable.exe` (142 MB, firmado).
5. **Pendiente de push**: todo lo de esta etapa (web + empresa + datos en vivo + conectividad + fix worker/tools) sigue SIN commitear. Para subir: `git add` de los modificados + `company.js` + `docs/CONTEXTO.md`, commit en español estilo repo, `git push origin main`.

## Consejo de continuidad
La mejor forma de arrancar en la ventana nueva: `git status` + `git diff` para ver los cambios pendientes; leer `src/main/ia27/` (index.js, agent.js, bridge.js, worker.js, tools.js) y `src/renderer/renderer.js`. Los tests son `npm run smoke`. Verificar cambios dentro del exe buildado: `Select-String -Path dist\win-unpacked\resources\app.asar -Pattern '<marcador>' -SimpleMatch -Quiet`.
