# Arquitectura de IA-27

IA-27 es una aplicación de escritorio **Electron** con el motor de inferencia
aislado en un proceso hijo. El modelo se carga directamente desde una carpeta
local (`ia27-data/models/`) en formato **GGUF**, **sin Ollama** y sin descargar
nada por sí sola. Al arrancar, la app **analiza el hardware** del equipo y
**recomienda el modelo más adecuado** según velocidad, consumo y calidad.

```
┌──────────────────────── Splash (Chromium) ──────────────────────────────┐
│  splash.html / splash.css / splash.js · ventana de arranque con logo,   │
│  barra de progreso y mensajes de estado mientras se prepara el modelo   │
└───────────────────────────────▲──────────────────────────────────────┘
                                 │ contextBridge (preload/splash.js)
┌──────────────────────── Renderer (Chromium) ─────────────────────────┐
│  index.html / styles.css / renderer.js / galaxy.js / vendor bundle    │
│  UI negro-azul, galaxia animada, historial, ajustes (selector modelo) │
└───────────────────────────────▲──────────────────────────────────────┘
                                 │ contextBridge (preload/index.js)
┌──────────────────────── Proceso principal (Electron) ─────────────────┐
│  index.js · splash + ventana + IPC                                    │
│  IACore (ia27/index.js)                                               │
│   ├─ hardware.js       → detecta RAM, CPU, GPU, VRAM, disco, CUDA     │
│   ├─ modelResolver.js  → escanea GGUF en models/ y lee sus metadatos  │
│   ├─ modelRecommender.js→ sugiere el modelo óptimo según hardware     │
│   ├─ MemoryStore        → conversaciones + config (userData)          │
│   ├─ Agent              → historial, intención de herramientas        │
│   └─ WorkerBridge       → comunicación con el motor                   │
└───────────────────────────────▲──────────────────────────────────────┘
                                 │ mensajes JSON (IPC)
┌──────────────────────── Proceso worker (utilityProcess) ──────────────┐
│  worker.js                                                             │
│   ├─ LLMEngine           → node-llama-cpp (carga GGUF directa)        │
│   ├─ LlamaChatSession    → chat con template (ChatML/Qwen, auto)      │
│   ├─ tools.js            → function calling del sistema               │
│   └─ KV cache persistente → reuso de contexto entre mensajes          │
└───────────────────────────────▲──────────────────────────────────────┘
                                 │
                  ia27-data\models\… (GGUF local del usuario)
```

## Decisiones clave

### Modelos GGUF locales (sin Ollama)
El usuario coloca uno o varios archivos `.gguf` en la carpeta `models/` de los
datos de la app. `modelResolver.js` escanea la carpeta, valida el magic `GGUF` y
lee los metadatos del bloque de cabecera (arquitectura, nº de parámetros,
contexto nativo y cuantización) para catalogar cada modelo.

### Detección de hardware y recomendación
En el arranque, `hardware.js` recoge:
- **RAM** total/libre (`os.totalmem`).
- **CPU** (modelo y nº de núcleos lógicos, `os.cpus`).
- **GPU** y **VRAM** (`Get-CimInstance Win32_VideoController`).
- **Espacio libre en disco** (`Win32_LogicalDisk`).
- **Aceleración CUDA** (presencia de `nvidia-smi`).

Con ese perfil, `modelRecommender.js` calcula un *tier* (minimal/básico/medio/
alto), filtra los modelos que caben en RAM y disco, y selecciona el más potente
que el equipo puede mover con fluidez. El resultado se marca como
*(Recomendado)* en Ajustes.

### Cambio de modelo sin tocar código
El modelo elegido se guarda en `config.json` como `modelTag` (o `modelPath`
para una ruta personal). En Ajustes hay un desplegable con todos los GGUF
detectados; cambiar y guardar reinicia la app con el nuevo modelo.

### Pantalla de carga
Una segunda ventana (sin marco) se abre antes que la principal. Recibe etapas
del core vía IPC (`ia27:splash`) y anima logo, barra de progreso y mensajes de
estado. La ventana principal solo se muestra cuando `IACore.init()` termina.

### Motor en proceso aislado
El modelo corre en un `utilityProcess` (Electron) o un `child_process.fork`
(Node para pruebas). La UI y el proceso principal nunca se bloquean durante la
carga o la inferencia. La comunicación es JSON por mensajes.

### Rendimiento en equipos modestos
En máquinas con CPU/RAM de gama limitada se recomiendan modelos pequeños y se
mitiga la latencia:
- **Persona y herramientas concisas** → menos tokens por prefill.
- **Reuso de KV cache** → el worker mantiene la sesión; cada mensaje nuevo solo
  evalúa el contenido nuevo.
- **Gating de herramientas por intención** → las definiciones de funciones solo
  se inyectan cuando el mensaje pide tareas del sistema.
- **Warm-up al arrancar** → precarga los pesos en memoria para acelerar la
  primera respuesta.
- **Modelos ajustados al hardware** → en equipos limitados se sugiere a la
  persona colocar GGUF pequeños (1.5B-3B) para una experiencia fluida.

### Function calling nativo
Las herramientas se declaran con `description` + `params` (JSON Schema) y un
`handler`. El wrapper de chat detecta la llamada, ejecuta el handler (con
consentimiento para comandos) y devuelve el resultado al modelo.

### Seguridad
- `contextIsolation: true`, `nodeIntegration: false`.
- Ejecutar comandos requiere **aprobación explícita** del operador
  (modal de confirmación) salvo que se active la opción de auto-aprobar.
- Sanitizado del HTML generado por el modelo antes de renderizarlo.

## Flujo de arranque

1. Electron abre la **splash** y crea la ventana principal (oculta).
2. `IACore.init()` emite etapas que la splash muestra:
   `hardware` → `scanning` → `selecting` → `loading` (progreso real del modelo) → `ready`.
3. Si no hay modelos en `models/`, se muestra un mensaje de error claro.
4. Al terminar, se muestra la ventana principal y se cierra la splash.

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