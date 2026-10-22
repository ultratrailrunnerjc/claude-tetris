---
name: clima
description: Consulta el estado del clima y la temperatura actual de Lima, Perú. Úsalo cuando el usuario pida el clima, la temperatura o el tiempo en Lima, o invoque /clima.
---

# Clima en Lima, Perú

Obtén el clima actual con `curl` a wttr.in (no requiere API key). La búsqueda web (WebSearch) devuelve artículos antiguos, así que no la uses para datos en tiempo real.

## Pasos

1. Ejecuta:

```bash
curl -s --max-time 10 "https://wttr.in/Lima,Peru?format=%C+%t+(sensación+%f)+humedad+%h+viento+%w&lang=es"
```

2. Responde en español, en una sola línea, con este formato:

   `Lima ahora: <estado>, <temperatura> (sensación <sensación>), humedad <humedad>, viento <viento> ([wttr.in](https://wttr.in/Lima,Peru)).`

## Detalle opcional

Si el usuario pide pronóstico de los próximos días, usa:

```bash
curl -s --max-time 10 "https://wttr.in/Lima,Peru?format=3&lang=es"   # resumen corto
curl -s --max-time 10 "https://wttr.in/Lima,Peru?0&lang=es"          # pronóstico de hoy en texto
```

## Errores

- Si `curl` falla, expira o devuelve vacío o HTML, díselo al usuario y no inventes datos.
- Si el usuario pide otra ciudad, sustituye `Lima,Peru` en la URL.
