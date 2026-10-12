# Betting 🟢

Registro de apuestas deportivas (sustituye la hoja "Betting") con picks a Telegram (fútbol, baloncesto y tenis), CLV y cierre automáticos.
App web instalable (PWA): funciona sin conexión y sincroniza con la nube (Supabase, proyecto "Split Carlis", tablas `bt_`).

**Dirección:** https://carlosruizaliaga-glitch.github.io/betting/

## Instalar en el móvil
- **iPhone (Safari):** abre la dirección → botón Compartir → **Añadir a pantalla de inicio**.
- **Android (Chrome):** abre la dirección → menú ⋮ → **Instalar app**.
- La primera vez pide tu **código de acceso**. Sin él no se puede entrar ni pedir picks.

## Apuntar una apuesta
1. Botón verde **+**.
2. Escribe la **selección** y la **cuota**.
3. Toca un **nivel 1–10**: ves los € al momento (nivel × 1 % del disponible, como en la hoja).
4. **GUARDAR**. Casa, deporte, tipo, tipster y fecha ya vienen puestos.
- **Combinada:** **+ SELECCIÓN** y pon la cuota de cada una.
- **Desde un pick:** en **PICKS**, toca una casilla (1, X, 2 o Más/Menos). El partido y la cuota justa ya vienen puestos; solo pones la cuota de bet365 y el nivel.

## Cerrarla
- En **INICIO**, en la tarjeta pendiente: **GANADA · PERDIDA · NULA**.
- Para ½ ganada, ½ perdida o cash out: toca **···**.
- **Automático:** las apuestas hechas desde un pick se cierran solas con el marcador final (unas 2 h después del inicio) y te llega un aviso por Telegram. En la lista llevan "AUTO" y el marcador. Si algo no cuadra, ábrela y corrígela. Se activa o desactiva en AJUSTES → Cierre automático.

## Botón de picks
- **PICKS → ⚡ PICKS → TELEGRAM**: busca los partidos de las próximas 72 h en tus ligas, calcula la cuota justa (Pinnacle + Betfair, sin margen), compara 10 casas y te lo manda al bot. **BUSCAR** hace lo mismo sin enviar.
- **La lista:** una fila por partido, primero los de más valor (o por hora). Filtros por deporte, día y liga. Los partidos empezados no salen. **✓ APOSTADO** = ya tienes apuesta en ese partido. Toca el partido para ver casas y cuotas.
- **≥ X** (o **🎯 bet365 si ≥ X** en Telegram): la cuota mínima de bet365 para que haya valor (cuota justa + umbral).
- **↑3 / ↓2:** cuánto ha cambiado la probabilidad justa (en puntos) desde la primera búsqueda de ese partido.
- **SOLO ⭐** muestra/envía solo los partidos con valor; **TODOS**, todos.
- **Ligas:** AJUSTES → Escáner. ✓ = se busca; ⭐ = entra en el envío diario; **+ AÑADIR LIGA O DEPORTE** abre todas las competiciones.
- **Créditos (500 gratis al mes):** cada liga con partidos gasta 1 crédito (2 en fútbol con Más/Menos). Repetir antes de 30 min es gratis. El envío diario solo busca tus ligas ⭐ y solo ganador. Si vas a bajar del 10 %, la app pregunta antes.
- **Envío automático:** AJUSTES → Envío automático diario → ENCENDIDO y la hora.

## Leer el CLV
- **CLV = tu cuota / cuota justa de cierre de Pinnacle − 1.**
  - **Positivo:** cogiste mejor precio que el mercado final. Es la señal de que el sistema funciona, aunque pierdas esa apuesta.
- Se calcula solo en las apuestas **hechas desde un pick**: al empezar el partido se guarda la cuota de cierre (1 crédito por partido apostado).
- **ESTADÍSTICAS → CLV:** CLV medio, % de apuestas con CLV positivo y contador **X / 300**.
- **CLV medio acumulado:** el gráfico debería asentarse por encima de la línea amarilla (+1 %).
- **CLV según tu ventaja al apostar:** compara apostar con valor (cuota ≥ mínima) frente a hacerlo por debajo de la justa. Ahí se ve si compensa esperar a la cuota mínima.
- **CLV por liga y por mercado:** dónde funciona y dónde no.
- **Regla:** no confiar en el sistema hasta tener **CLV medio > +1 % con 300+ apuestas**.

## Nota
El plan gratuito de Supabase pausa el proyecto tras 1 semana sin uso. Si ocurre: supabase.com → proyecto Split Carlis → "Restore". La app sigue funcionando en el móvil y sube los cambios al reactivarlo.

## Técnico (para quien lo mantenga)
- **App:** JS sin compilar (`index.html`, `app.js`, `logic.js`, `store.js`, `sw.js`).
- **Edge Function:** `supabase/functions/bt-picks`, con los secretos `ODDS_API_KEY`, `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID`.
- **Tarea programada:** pg_cron `bt-cron` cada 5 min (cuota de cierre, CLV, cierre automático y envío diario).
- **Al publicar una versión:** subir a la vez `CACHE` en `sw.js` y `?v=` de los scripts en `index.html`.
- **Pruebas:** `node test/logic.test.js`, `node test/picks.test.mjs` y `node test/settle.test.mjs`. Prueba en el navegador sin tocar la nube: `node test/make-mock.mjs` y, en la consola, `await import('/test/mock-browser.js')`.
- **Copias de seguridad:** tabla `bt_backup` en Supabase y carpeta `backups/` (local, fuera de git).
