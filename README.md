# 🎾 iTag Score

Marcador deportivo en vivo controlado con **botones Bluetooth iTag** (inspirado en ScoreBot).
Un solo código React que funciona como **web/PWA**, **app Android** y **app iPhone** (Capacitor),
con usuarios, invitaciones y marcador sincronizado en tiempo real con **Supabase**.

## Funciones

| Acción | iTag | Pantalla |
|---|---|---|
| Sumar punto | 1 clic | Tocar tu mitad |
| Devolver el último punto | 2 clics rápidos | Doble toque |
| Borrar marcador (recuperable con deshacer) | Mantener presionado* / 3 clics | Mantener presionado |

\* Algunos iTag solo avisan al pulsar (no al soltar). En esos, “mantener” no se puede detectar y se usa **triple clic**.

### Botones compatibles

| Botón | Cómo se conecta | Dónde funciona |
|---|---|---|
| **iTag** y rastreadores “anti-pérdida” Bluetooth genéricos | 📡 → *Vincular* (desde la app) | Chrome Android/PC, Bluefy (iPhone), app nativa |
| **Botón selfie** (AB Shutter 3 y similares) | Emparejar en *Ajustes → Bluetooth*, luego 📡 → *Asignar* y pulsarlo | Botón “Android” (Enter): navegador y app. Botón “iOS” (subir volumen): solo app nativa |

- AirTag, Samsung SmartTag y Tile **no** se pueden usar porque sus marcas bloquean la conexión.
- Dos botones selfie en el mismo teléfono envían la misma tecla y no se distinguen: combina un selfie y un iTag,
  o que cada jugador conecte su botón en su propio teléfono.

- Registro rápido (nombre, usuario, correo, contraseña).
- Buscar jugadores registrados por nombre o `@usuario` e **invitarlos** (les llega al instante).
- También puedes jugar contra un **rival local sin cuenta**.
- Un iTag por jugador: **los dos en el mismo teléfono**, o **cada jugador vincula el suyo en su teléfono**. Los puntos se sincronizan en vivo.
- Modos: **Tenis/Pádel** (15-30-40, iguales, ventaja, tie-break a 6-6) o **por puntos** (a 11, 21…, gana por 2).
- Conteo de sets y juegos, indicador de saque 🎾, anuncio por voz 📢 en español, pantalla siempre encendida.
- **Finalizar partido** 🏁 → muestra al ganador y lo guarda en el historial.
- 📺 **TV**: duplica la pantalla del teléfono (Chromecast/Smart View en Android, AirPlay en iPhone) y pulsa ⛶. El diseño se adapta a teléfono, tablet y TV, en vertical u horizontal.

## Librerías

- [`@supabase/supabase-js`](https://github.com/supabase/supabase-js): autenticación, base de datos y tiempo real.
- [`@capacitor-community/bluetooth-le`](https://github.com/capacitor-community/bluetooth-le): una sola API de Bluetooth LE para Web Bluetooth, Android e iOS.
- [`@capacitor-community/volume-buttons`](https://github.com/capacitor-community/volume-buttons): lee el botón “iOS” de los selfie (subir volumen) en la app nativa.
- [Capacitor](https://capacitorjs.com): empaqueta la app web como app nativa de Android e iOS.
- APIs del navegador: Wake Lock, Fullscreen, Speech Synthesis y Web Audio.

Los iTag avisan cada pulsación con una notificación en el servicio `0xFFE0` y la característica `0xFFE1`.

## Login

- **Registro con correo**: nombre, usuario (se valida en vivo contra la base de datos), correo y contraseña con medidor de seguridad.
  Supabase Auth guarda el usuario en `auth.users` y un trigger crea su perfil en `public.profiles`.
- **Proveedores (Google, Apple, GitHub, Facebook, Microsoft…)**: los botones aparecen solos para cada
  proveedor que actives en Supabase. A esos usuarios se les crea un nombre de usuario automáticamente.
- **Recuperar contraseña**: el usuario escribe su correo y recibe un enlace (o código). Al validarlo, la app
  genera una **clave nueva** y la muestra 5 segundos en una ventana con botón para copiarla.
  La clave anterior no se puede mostrar porque Supabase solo guarda el hash.

## 1. Configurar Supabase (una sola vez)

1. **SQL Editor**: pega [`supabase/schema.sql`](supabase/schema.sql) y pulsa **Run**. Puedes volver a ejecutarlo sin perder datos.
2. **Authentication → Sign In / Providers → Email**: desactiva **Confirm email** si quieres que el registro sea instantáneo.
3. **Authentication → URL Configuration**:
   - Site URL: `https://cashlessmot2026.github.io/padel-marcador/`
   - Redirect URLs: añade esa misma URL y `http://localhost:5173/`
   (lo usan el enlace de recuperación y los proveedores).
4. *(Opcional, recuperar con código)* **Authentication → Emails → Reset Password**: añade `{{ .Token }}` a la
   plantilla para que el correo también incluya un código que se puede escribir en la app.
5. *(Opcional, proveedores)* **Authentication → Sign In / Providers**: activa Google, Apple, GitHub, etc., con
   su Client ID y Secret. Los botones aparecen solos en el login.

La URL y la anon key ya están en el código. Si quieres cambiarlas, copia `.env.example` a `.env`.
La anon key es pública por diseño; la seguridad la dan las políticas RLS del esquema.

## 2. Ejecutar en local

```bash
npm install
npm run dev          # abre http://localhost:5173
```

> Web Bluetooth requiere **HTTPS** (o `localhost`) y un navegador compatible: Chrome/Edge en Android,
> Windows, Mac o Linux. **Safari en iPhone no tiene Web Bluetooth**: usa la app nativa o el navegador **Bluefy**.

## 3. Publicar en GitHub Pages

```bash
git remote add origin https://github.com/TU_USUARIO/itag-score.git
git push -u origin main
```

En GitHub: **Settings → Pages → Source: GitHub Actions**. Cada `push` a `main` publica la web
(`.github/workflows/deploy.yml`) en `https://TU_USUARIO.github.io/itag-score/`.

## 4. Apps nativas

```bash
npm run build && npx cap sync
npx cap open android   # Android Studio → Run / Build APK
npx cap open ios       # Xcode (requiere Mac) → elige tu equipo de firma → Run
```

Los permisos de Bluetooth ya están configurados (`AndroidManifest.xml` e `Info.plist`).

## Estructura

```
src/App.jsx          ← toda la app: marcador, Bluetooth, Supabase y pantallas
src/App.css          ← estilos adaptables (teléfono, tablet, TV)
supabase/schema.sql  ← tablas, seguridad RLS y tiempo real
android/  ios/       ← proyectos nativos generados por Capacitor
```
