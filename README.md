# Betting 🟢

Registro de apuestas deportivas (sustituye la hoja "Betting") con picks 1X2 a Telegram y CLV automático.
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
- **Desde un pick:** en **PICKS**, toca 1, X o 2. El partido y la cuota justa ya vienen puestos; solo pones la cuota de bet365 y el nivel.

## Cerrarla
- En **INICIO**, en la tarjeta pendiente: **GANADA · PERDIDA · NULA**.
- Para ½ ganada, ½ perdida o cash out: toca **···**.

## Botón de picks
- **PICKS → ⚡ PICKS 1X2 → TELEGRAM**: busca los partidos de las próximas 72 h en tus ligas, quita el margen de Pinnacle y te los manda al bot.
- **SOLO ⭐** envía solo los partidos con valor; **TODOS** los envía todos.
- **Créditos:** cada liga con partidos gasta 1 crédito (500 gratis al mes). Repetir antes de 30 min es gratis. Si vas a bajar del 10 %, la app pregunta antes.
- **🎯 bet365 si ≥ X:** es la cuota mínima de bet365 para que la apuesta tenga valor (cuota justa + umbral).
- **Envío automático:** AJUSTES → Envío automático diario → ENCENDIDO y la hora.

## Leer el CLV
- **CLV = tu cuota / cuota justa de cierre de Pinnacle − 1.**
  - **Positivo:** cogiste mejor precio que el mercado final. Es la señal de que el sistema funciona, aunque pierdas esa apuesta.
- Se calcula solo en las apuestas **hechas desde un pick**: al empezar el partido se guarda la cuota de cierre (1 crédito por partido apostado).
- **ESTADÍSTICAS → CLV:** CLV medio, % de apuestas con CLV positivo y contador **X / 300**.
- **Regla:** no confiar en el sistema hasta tener **CLV medio > +1 % con 300+ apuestas**.

## Nota
El plan gratuito de Supabase pausa el proyecto tras 1 semana sin uso. Si ocurre: supabase.com → proyecto Split Carlis → "Restore". La app sigue funcionando en el móvil y sube los cambios al reactivarlo.

## Técnico (para quien lo mantenga)
- **App:** JS sin compilar (`index.html`, `app.js`, `logic.js`, `store.js`, `sw.js`).
- **Edge Function:** `supabase/functions/bt-picks`, con los secretos `ODDS_API_KEY`, `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID`.
- **Tarea programada:** pg_cron `bt-cron` cada 5 min (cuota de cierre, CLV y envío diario).
- **Pruebas:** `node test/logic.test.js` y `node test/picks.test.mjs`.
