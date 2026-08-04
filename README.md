# IA-27 — Asistente virtual local de Estalingrado Corp

> **Estalingrado Corp** · [estalingradocorp.qzz.io](https://estalingradocorp.qzz.io/)

IA-27 es una asistente virtual de escritorio **100 % local** para Windows,
inspirada en un tamagotchi y con experiencia de chatbot moderna. Corre con
modelos **GGUF** colocados localmente por el usuario, **sin usar Ollama** ni
descargar nada por sí sola. La aplicación **analiza el hardware del equipo**
(RAM, CPU, GPU, VRAM, disco y aceleración) y **recomienda el modelo más
adecuado**, equilibrando velocidad, consumo de recursos y calidad.

---

## Características

- **Conversación natural** con la personalidad de IA-27 (en español por defecto).
- **Asistencia con tareas del sistema** mediante herramientas locales:
  - Información del equipo (CPU, RAM, discos, hostname, tiempo encendido).
  - Listar, leer y buscar archivos.
  - Abrir archivos o carpetas.
  - Ejecutar comandos de Windows **con consentimiento explícito** del operador.
  - Notas persistentes en el cuaderno local.
- **Análisis de documentos**: TXT, Markdown, código, CSV, JSON, PDF y DOCX
  (por botón o arrastrando el archivo).
- **Ayuda de programación**: respuestas con Markdown y resaltado de código.
- **Memoria de conversaciones**: historial persistente con búsqueda lateral,
  nueva conversación, renombrar y eliminar.
- **Interfaz minimalista negro y azul** con una **galaxia animada** que
  *late* mientras IA-27 responde.
- **Pantalla de carga profesional** al iniciar (logo, barra de progreso y
  mensajes de estado) mientras se analiza el hardware y se carga el modelo.
- **Optimización automática**: detecta el hardware y sugiere el modelo GGUF con
  mejor relación velocidad/consumo/calidad, marcándolo como *(Recomendado)*.
- **Ajustes**: temperatura, tokens máximos, ventana de contexto, hilos de CPU,
  capas GPU (opcional), modelo a usar y ruta del modelo.
- **Cambio de modelo en Ajustes**: un desplegable con todos los GGUF detectados,
  sin necesidad de modificar el código.
- **Totalmente offline**: el modelo se carga desde una carpeta local
  (`ia27-data/models/`) sin servidor ni conexión.

---

## Requisitos

- Windows 10/11 (x64).
- Al menos **un modelo GGUF** colocado en la carpeta `ia27-data/models/` de la
  aplicación (ver "Instalación del modelo"). IA-27 escanea esa carpeta
  automáticamente al iniciar.
- Memoria RAM y GPU adecuadas al modelo elegido (la app recomienda uno apto
  para tu equipo). En equipos limitados usa modelos pequeños (p. ej. 1.5B/3B)
  para una experiencia fluida.

---

## Instalación del modelo

1. Localiza la carpeta de datos de IA-27:
   - Versión instalada: `C:\Users\<tu usuario>\AppData\Roaming\ia27\ia27-data\models\`
   - Modo desarrollo: una carpeta `ia27-data/models/` junto a la app.
2. Copia **un archivo `.gguf`** (o varios) dentro de esa carpeta `models/`.
   Puedes descargarlo de Hugging Face. Recomendamos los cuantizados `Q4_K_M`
   de [bartowski](https://huggingface.co/bartowski) para mejor equilibrio
   calidad/rendimiento.
3. Al abrir IA-27, la aplicación escanea la carpeta, detecta el hardware y
   recomienda el modelo más adecuado. Puedes cambiarlo en **⚙ Ajustes**.

### Modelos recomendados

Según tu hardware, IA-27 te sugerirá automáticamente el modelo óptimo. Estas
son las mejores opciones GGUF (`Q4_K_M`) por tramo de RAM:

| RAM equipo | Parámetros máx. | Modelo recomendado | Tamaño | Español |
|---|---|---|---|---|
| 4-7 GB | ~1.6 B | `Qwen2.5-1.5B-Instruct-Q4_K_M` | ~1.1 GB | Bueno |
| 8-15 GB | ~4 B | `Qwen2.5-3B-Instruct-Q4_K_M` | ~1.8 GB | Excelente |
| 16-31 GB | ~8 B | `Qwen2.5-7B-Instruct-Q4_K_M` | ~4.2 GB | Excelente |
| 32 GB+ | ~20 B | `Qwen2.5-14B-Instruct-Q4_K_M` | ~8.3 GB | Excelente |

**Descarga manual con `curl` (ejemplo para Qwen2.5-3B):**
```powershell
curl -L -o "%APPDATA%\ia27\ia27-data\models\Qwen2.5-3B-Instruct-Q4_K_M.gguf" `
  "https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf"
```

> No descargues nada con Ollama: IA-27 lee directamente los archivos GGUF que
> coloques en `models/`. Todos los modelos corren **100 % offline** en CPU;
> si tenés GPU NVIDIA, podés activar capas GPU en ⚙ Ajustes para acelerar.

### Aceleración por GPU (Vulkan)

IA-27 usa la **GPU por Vulkan** cuando activás las capas GPU en ⚙ Ajustes
(`gpuLayers > 0`). No requiere instalar CUDA ni compilar nada: los binarios
Vulkan vienen incluidos en la app. En una GTX 1050 Ti, por ejemplo, un modelo
Qwen 1.5B pasa de ~3 a **~30 tokens/s**.

- Detecta automáticamente **Vulkan → CUDA → CPU** en ese orden.
- Si el modelo no cabe en la VRAM, vuelve a CPU automáticamente sin romper.
- Verificá el consumo de VRAM con `nvidia-smi` para confirmar que la GPU se usa.

---

## Uso

### Versión lista para usar (sin terminal)

Descarga la última versión desde [Releases](https://github.com/Estalingradocorp/agente-IA27-/releases/latest):

- **`IA-27-portable.exe`** — versión portable, sin instalación (incluye aceleración por GPU Vulkan).
- **`IA-27-Setup-*.exe`** — instalador para Windows.

1. Coloca al menos un archivo `.gguf` en `ia27-data/models/`.
2. Ábrela. Verás la pantalla de carga mientras se analiza el hardware y se
   selecciona el modelo. Luego escribe a IA-27 y usa el botón 📎 para adjuntar
   documentos.

### Desde el código (desarrollo)
```powershell
npm install
npm run vendor      # construye el bundle de UI (marked + highlight.js)
npm start           # abre la app en modo desarrollo
```

### Pruebas rápidas
```powershell
npm run smoke       # prueba el motor y el modelo sin abrir la ventana
npm run build:portable   # genera dist\IA-27-portable.exe
npm run build:installer  # genera dist\IA-27-Setup-<versión>.exe
```

---

## Estructura del proyecto

```
src/
  main/
    index.js          # Proceso principal de Electron (ventanas + IPC)
    ia27/
      hardware.js       # Detecta RAM, CPU, GPU, VRAM, disco y aceleración
      modelResolver.js  # Escanea GGUF en ia27-data/models/ y lee sus metadatos
      modelRecommender.js # Sugiere el modelo óptimo según el hardware
      engine.js         # Carga el modelo y crea contexto/sesión
      worker.js         # Motor aislado en proceso hijo (utilityProcess)
      bridge.js         # Puente de mensajes main ⇄ worker
      memory.js         # Persistencia de conversaciones y ajustes
      tools.js          # Herramientas del sistema (function calling)
      documents.js      # Extracción de texto (PDF, DOCX, código…)
      agent.js          # Orquestación de chat + herramientas + memoria
      persona.js        # Personalidad de IA-27 / Estalingrado Corp
  preload/
    index.js            # API segura para el renderer (contextBridge)
    splash.js           # API para la pantalla de carga
  renderer/             # UI: galaxia animada, chat, ajustes, splash
scripts/                # smoke, build de vendor e icono
assets/                 # Icono de la aplicación
```

---

## Documentación

- [Arquitectura](docs/ARQUITECTURA.md)
- [Hoja de ruta y pendientes](docs/ROADMAP.md)

---

## Licencia

**Derechos Reservados © 2026 Estalingrado Corp. Todos los derechos reservados.**
Software propietario. Consulta el archivo [LICENSE](LICENSE) para los términos
completos y la solicitud de licencias comerciales.

Para más información: [estalingradocorp.qzz.io](https://estalingradocorp.qzz.io/)
