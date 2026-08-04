# Hoja de ruta — IA-27

Estado actual: **v1.0.0** — funcional y empaquetada para Windows.

## Pendientes priorizados

### 1. Soporte de múltiples modelos
- Seleccionar modelo en Ajustes (Qwen 2.5, y cualquier GGUF local detectado
  en el almacén de Ollama o con ruta propia).
- Resolución automática de modelos instalados (`deepseek-v4-flash`,
  `qwen-tools`, etc.) y elección por conversación.
- Validación de compatibilidad (tamaño de contexto, arquitectura, quantización).

### 2. Velocidad y rendimiento
- **GPU (CUDA)**: activar capas GPU para tarjetas modernas (la GTX 1050 Ti de
  4 GB actual no es compatible con los binarios CUDA recientes de llama.cpp).
- Hilos de CPU: afinar el valor óptimo (hoy configurable en Ajustes).
- **Prefill en segundo plano**: precalcular la persona + herramientas al
  arrancar para que el primer mensaje responda en segundos.
- Compactación de historial: resumir automáticamente conversaciones largas
  cuando el contexto esté cerca del límite.

### 3. Experiencia tipo tamagotchi
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

## Ideas futuras (evaluar)
- Modo agente con ejecución de tareas encadenadas.
- Voice (TTS/STT) local.
- Análisis de imágenes con modelos de visión locales.

---

*La licencia de IA-27 es propiedad exclusiva de **Estalingrado Corp**
([estalingradocorp.qzz.io](https://estalingradocorp.qzz.io/)).*
