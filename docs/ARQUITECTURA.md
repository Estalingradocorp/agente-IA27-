# Arquitectura de IA-27

IA-27 es una aplicación de escritorio **Electron** con el motor de inferencia
aislado en un proceso hijo. El modelo se carga directamente desde el almacén
local de Ollama (formato GGUF) **sin ejecutar el servidor de Ollama**.

```
┌──────────────────────── Renderer (Chromium) ─────────────────────────┐
│  index.html / styles.css / renderer.js / galaxy.js / vendor bundle    │
│  UI negro-azul, galaxia animada, historial, ajustes                   │
└───────────────────────────────▲──────────────────────────────────────┘
                                 │ contextBridge (preload)
┌──────────────────────── Proceso principal (Electron) ─────────────────┐
│  index.js · ventana + IPC                                             │
│  IACore (ia27/index.js)                                               │
│   ├─ MemoryStore        → conversaciones + config (userData)          │
│   ├─ Agent              → historial, intención de herramientas        │
│   └─ WorkerBridge       → comunicación con el motor                   │
└───────────────────────────────▲──────────────────────────────────────┘
                                 │ mensajes JSON (IPC)
┌──────────────────────── Proceso worker (utilityProcess) ──────────────┐
│  worker.js                                                             │
│   ├─ LLMEngine           → node-llama-cpp (carga GGUF directa)        │
│   ├─ LlamaChatSession    → chat con template ChatML/Qwen              │
│   ├─ tools.js            → function calling del sistema               │
│   └─ KV cache persistente → reuso de contexto entre mensajes          │
└───────────────────────────────▲──────────────────────────────────────┘
                                 │
                    C:\Users\<usuario>\.ollama\models\blobs\… (GGUF)
```

## Decisiones clave

### Modelo sin Ollama
El manifiesto de Ollama (`models/manifests/registry.ollama.ai/library/qwen2.5/*`)
indica el digest de la capa `application/vnd.ollama.image.model`; con él se
localiza el blob GGUF en `models/blobs/sha256-…`. `modelResolver.js` valida el
magic `GGUF` y devuelve la ruta. Así se reutiliza el modelo ya descargado sin
depender del servidor ni descargar nada nuevo.

### Motor en proceso aislado
El modelo corre en un `utilityProcess` (Electron) o un `child_process.fork`
(Node para pruebas). La UI y el proceso principal nunca se bloquean durante la
carga o la inferencia. La comunicación es JSON por mensajes.

### Rendimiento en equipos modestos
En máquinas con CPU de gama baja la prefill de un 7B Q4 es costosa. Se mitigó:
- **Persona y herramientas concisas** → menos tokens por prefill.
- **Reuso de KV cache** → el worker mantiene la sesión; cada mensaje nuevo solo
  evalúa el contenido nuevo (los mensajes siguientes pasan de ~minutos a ~15-30 s).
- **Gating de herramientas por intención** → las definiciones de funciones solo
  se inyectan cuando el mensaje pide tareas del sistema.
- **Warm-up al arrancar** → precarga los pesos en memoria para acelerar la
  primera respuesta.

### Function calling nativo
Las herramientas se declaran con `description` + `params` (JSON Schema) y un
`handler`. El wrapper de chat detecta la llamada, ejecuta el handler (con
consentimiento para comandos) y devuelve el resultado al modelo.

### Seguridad
- `contextIsolation: true`, `nodeIntegration: false`.
- Ejecutar comandos requiere **aprobación explícita** del operador
  (modal de confirmación) salvo que se active la opción de auto-aprobar.
- Sanitizado del HTML generado por el modelo antes de renderizarlo.

## Flujo de un mensaje

1. El renderer envía el texto por IPC → `Agent.send`.
2. El agente persiste el mensaje del usuario y decide si hace falta inyectar
   herramientas (por intención).
3. `WorkerBridge.chat` reenvía el historial al worker.
4. El worker reutiliza la KV cache si el historial es prefijo del estado
   actual; si no, reconstruye la sesión.
5. `LlamaChatSession.promptWithMeta` genera; los tokens viajan al renderer en
   tiempo real (eventos `gen:token`) y la galaxia pulsa con cada token.
6. Al terminar, se persiste la respuesta y se refresca el historial.
