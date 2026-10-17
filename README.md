# 🎵 AURA Music Player (Cross-Platform Suite)

Una suite moderna y completa de reproducción de música desarrollada para **Web**, **Desktop (Electron)** y **Móvil (Android / Capacitor)**, con sincronización, descargas locales y servidor backend Node.js.

---

## 🌟 Características Principales

- **Arquitectura Multiplataforma**:
  - 🌐 **Web**: Construida con Vite, HTML5, CSS3 moderno (Glassmorphism & Neumorphism) y JavaScript modular.
  - 🖥️ **Desktop**: Empaquetada con Electron Vite, soporte para Picture-in-Picture / Mini-reproductor y atajos globales.
  - 📱 **Android**: Compilada con Capacitor, integración con MediaSession para barra de notificaciones, control con botón atrás nativo, persistencia en sistema de archivos y modo offline.
  - 🚀 **Servidor**: API en Node.js / Express para búsquedas, stream de audio y sincronización.

- **Diseño & Experiencia de Usuario**:
  - 🎨 Interfaz estética y moderna con paletas neón/oscuras, animaciones suaves y microinteracciones.
  - 📜 **Marquee Inteligente**: Títulos largos con scroll horizontal continuo, pausa inicial de 5 segundos y desplazamiento secuencial sin cortes.
  - 📱 **Menú Contextual Móvil (⋮)**: Botón de 3 puntos en móvil con Action Sheet para maximizar el espacio del título.
  - 🔀 **Gestión de Cola**: Reordenamiento interactivo (*drag & drop* / arrastrar) exclusivo para la cola actual.
  - 📥 **Descargas Individuales y por Playlist**: Almacenamiento local de archivos MP3 para reproducción instantánea offline.
  - 📡 **Detección Online/Offline**: Indicador de conectividad en tiempo real con soporte de reproducción automática desde almacenamiento local si no hay red.
  - 🛡️ **Prevención de Cierre en Android**: Sistema de doble pulsación en botón atrás ("Presiona de nuevo para salir") para evitar salidas accidentales.

---

## 📁 Estructura del Proyecto

```
reproductor/
├── reproductor-web/        # Versión Web optimizada (Vite + Vanilla JS)
├── reproductor-desktop/    # Versión Desktop (Electron + Vite)
├── reproductor-android/    # Versión Android (Capacitor + Gradle)
├── server/                 # Servidor backend de audio y búsqueda (Node.js)
├── generate_icons.ps1      # Generador de íconos adaptativos para Android
└── README.md
```

---

## 🚀 Inicio Rápido

### 1. Servidor Backend
```bash
cd server
npm install
npm run dev
```

### 2. Versión Web
```bash
cd reproductor-web
npm install
npm run dev
```

### 3. Versión Desktop
```bash
cd reproductor-desktop
npm install
npm run dev
```

### 4. Versión Android
```bash
cd reproductor-android
npm install
npm run build
npx cap sync android
cd android
./gradlew assembleDebug
```
*El APK generado se ubica en `android/app/build/outputs/apk/debug/app-debug.apk`.*

---

## 🛠️ Tecnologías Utilizadas

- **Frontend**: HTML5, Vanilla CSS3 (Custom Properties, Glassmorphism, Web Animations API), JavaScript ESNext.
- **Desktop**: Electron, electron-vite.
- **Móvil**: Capacitor Core, @capacitor/filesystem, @capacitor/preferences, @capacitor/app, Android SDK (Java/Gradle).
- **Backend**: Node.js, Express, Axios, CORS.

---

## 📄 Licencia

Este proyecto está bajo la Licencia MIT.
