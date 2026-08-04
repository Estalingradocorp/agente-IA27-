# IA-27 — Asistente virtual local de Estalingrado Corp

> **Estalingrado Corp** · [estalingradocorp.qzz.io](https://estalingradocorp.qzz.io/)

IA-27 es una asistente virtual de escritorio **100 % local** para Windows,
inspirada en un tamagotchi y con experiencia de chatbot moderna. Corre con el
modelo **Qwen 2.5 (7B, Q4_K_M)** ya instalado en la máquina, **sin usar Ollama**
ni descargar otros modelos. Vive dentro de la computadora como una unidad de
Estalingrado Corp, con personalidad propia y consistente.

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
- **Ajustes**: temperatura, tokens máximos, ventana de contexto, hilos de CPU,
  capas GPU (opcional) y ruta del modelo.
- **Totalmente offline**: el modelo se carga directamente desde el almacén
  local (`~/.ollama/models`) sin servidor ni conexión.

---

## Requisitos

- Windows 10/11 (x64).
- Modelo **Qwen 2.5** instalado localmente en el almacén de Ollama
  (`C:\Users\<usuario>\.ollama\models\...`). IA-27 lo localiza automáticamente.
- ~6 GB de RAM libre y ~5 GB de espacio en disco para el modelo.

---

## Uso

### Versión lista para usar (sin terminal)
1. Descarga `IA-27-portable.exe` o ejecuta el instalador `IA-27-Setup-*.exe`.
2. Ábrela. En el primer arranque carga el modelo (4.36 GB); la barra inferior
   muestra el progreso.
3. Escribe a IA-27 y usa el botón 📎 para adjuntar documentos.

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
    index.js          # Proceso principal de Electron (ventana + IPC)
    ia27/
      modelResolver.js  # Localiza el GGUF de Qwen 2.5 sin Ollama
      engine.js         # Carga el modelo y crea contexto/sesión
      worker.js         # Motor aislado en proceso hijo (utilityProcess)
      bridge.js         # Puente de mensajes main ⇄ worker
      memory.js         # Persistencia de conversaciones y ajustes
      tools.js          # Herramientas del sistema (function calling)
      documents.js      # Extracción de texto (PDF, DOCX, código…)
      agent.js          # Orquestación de chat + herramientas + memoria
      persona.js        # Personalidad de IA-27 / Estalingrado Corp
  preload/index.js      # API segura para el renderer (contextBridge)
  renderer/             # UI: galaxia animada, chat, ajustes
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
