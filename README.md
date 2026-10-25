# Axynera AI Proxy (axyproxy)

High-performance Serverless AI Proxy running on Vercel Edge Runtime with built-in API Key management, live health monitoring dashboard, and unified routing for Chat, Vision, Code, Image Generation, and Audio.

## ✨ Fitur Utama

- **Vercel Edge Runtime**: Latensi ultra-rendah dan deployment instan secara global.
- **Unified Endpoints**:
  - `POST /v1/chat/completions` (Chat & Vision)
  - `POST /v1/completions` (Completions)
  - `POST /v1/messages` (Messages API)
  - `GET /v1/models` (Daftar model yang tersedia)
  - `POST /v1/images/generations` (Text-to-Image Generation)
  - `POST /v1/audio/transcriptions` (Speech-to-Text)
  - `POST /v1/audio/speech` (Text-to-Speech)
  - `GET/POST /api/keys` (Manajemen API Key internal)
- **Monitoring Real-time (`index.html`)**: Status indikator live yang memantau ketersediaan API (hanya merah jika server down, kuning jika latensi tinggi, hijau jika lancar).
- **CORS Lengkap**: Kompatibel dengan semua web app, extensions, dan mobile apps.

---

## 🚀 Konfigurasi Environment Variables

Buka dashboard project di Vercel: **Settings -> Environment Variables**, lalu tambahkan:

| Variable | Wajib / Opsional | Keterangan |
| :--- | :--- | :--- |
| `NINEROUTER_KEY` | **Wajib** | API Key dari Nextura / upstream router (`sk-...`) |
| `NINEROUTER_URL` | Opsional | URL endpoint chat completions |
| `NINEROUTER_IMAGE_URL` | Opsional | URL endpoint image generation |
| `NINEROUTER_AUDIO_TRANSCRIPTIONS_URL` | Opsional | URL endpoint STT |
| `NINEROUTER_AUDIO_SPEECH_URL` | Opsional | URL endpoint TTS |

---

## 🤖 Daftar Model Default

| Model ID | Tipe | Deskripsi |
| :--- | :--- | :--- |
| `Axynity-M1` | Chat / Vision | Model primary super cepat & hemat untuk instruksi dan visual input |
| `Axynity-Xcode` | Coding / Pro | Model reasoning & coding tingkat lanjut |
| `Axynity-Image` | Gambar | Model generatif text-to-image beresolusi tinggi (Axynity Vision) |
| `Axynity-Audio` | Audio | Voice & Speech AI (Speech-to-Text & Text-to-Speech) |
