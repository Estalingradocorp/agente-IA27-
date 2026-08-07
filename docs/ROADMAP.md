# Hoja de ruta — IA-27

Estado actual: **v1.1.0** — funcional y empaquetada para Windows, con
optimización dinámica del modelo y pantalla de carga.

## Hecho en esta iteración

### Optimización del modelo de IA
- **Detección automática de hardware** (`hardware.js`): RAM, CPU, GPU, VRAM,
  espacio en disco y aceleración CUDA mediante `Get-CimInstance`.
- **Recomendación inteligente** (`modelRecommender.js`): calcula el *tier* del
  equipo y sugiere el modelo GGUF con mejor relación
  velocidad/consumo/calidad, marcado como *(Recomendado)* en Ajustes.
- **Modelos locales GGUF** (`modelResolver.js`): escanea `ia27-data/models/`,
  lee los metadatos GGUF (arquitectura, parámetros, contexto, cuantización) y
  hace una selección automática. Sin Ollama.
- **Cambio de modelo en Ajustes**: desplegable con los GGUF detectados; el
  modelo se persiste en `config.json` como `modelTag`/`modelPath`.
- Durante el desarrollo se priorizan modelos pequeños y rápidos.

### Pantalla de carga
- Ventana *splash* con la identidad de IA-27, barra de progreso y mensajes de
  estado ("Analizando hardware…", "Escaneando modelos…", "Seleccionando el
  modelo óptimo…", "Cargando modelo…").
- La ventana principal solo se muestra cuando el core está listo.
- Si no hay modelos, se muestra un mensaje claro en lugar de quedarse congelada.

## Pendientes priorizados

### 1. Soporte de más arquitecturas
- Validación de compatibilidad por conversación y migración en caliente.
- Descarga guiada de GGUF recomendados desde la propia app.

### 2. Velocidad y rendimiento
- **Prefill en segundo plano**: precalcular la persona + herramientas al
  arrancar para que el primer mensaje responda en segundos.
- Compactación de historial: resumir automáticamente conversaciones largas
  cuando el contexto esté cerca del límite.
- **maxTokens 2048** y `clampMaxTokens` relajado (60 % del contexto) para
  permitir generar HTML y textos largos completos.
- Modelo activo: **Fabe27ib** (Granite 3B Q4_K_M) con GPU Vulkan; Phi-3.5-mini
  disponible como alternativa.

### 3. Atenea Omega — modelo propio
- **Atenea Omega**: modelo de IA **propio y avanzado** de Estalingrado Corp.
  - Integración como **motor principal** de IA-27, reemplazando los GGUF locales.
  - Fase actual: desarrollo del modelo en paralelo (repo del proyecto:
    https://github.com/Estalingradocorp/agente-IA27-).
  - Objetivo: capacidad de razonamiento y generación de código superior, en
    español, con menor latencia que los modelos locales actuales.

### 4. Experiencia tipo tamagotchi
- Estados de ánimo de IA-27 (energía, humor) y frases reactivas.
- Recordatorios y alarma del sistema.
- Notificaciones del sistema desde IA-27.

### 4. Tareas del sistema (ampliación)
- Gestión de archivos (copiar, mover, renombrar, eliminar con confirmación).
- Control de ventanas y aplicaciones.
- Búsqueda rápida en documentos indexados.
- Integración con el portapapeles.

### 5. Memoria a largo plazo
- Resumen automático de conversaciones antiguas.
- Hechos del usuario que IA-27 recuerde entre sesiones.

### 6. Robustez y distribución
- Firmado de código y eliminación de advertencias de SmartScreen.
- Actualizador automático.
- Soporte de idiomas adicionales.
- Tests automatizados del motor y de la UI.

### 7. Seguridad y fiabilidad (recientes)
- Streaming incremental de tokens con retención (no se muestran los JSON de
  tool-calls) para que las respuestas largas se vean en tiempo real.
- Fix BOM UTF-8 en `memory.js`: el `config.json` escrito por PowerShell 5.1 con
  `Set-Content -Encoding UTF8` ya no rompe `JSON.parse`.
- Instrucción de idioma forzada en español en `persona.js`.

## Ideas futuras (evaluar)
- Modo agente con ejecución de tareas encadenadas.
- Voice (TTS/STT) local.
- Análisis de imágenes con modelos de visión locales.

---

*La licencia de IA-27 es propiedad exclusiva de **Estalingrado Corp**
([estalingradocorp.qzz.io](https://estalingradocorp.qzz.io/)).*
