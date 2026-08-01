# Rythia

Rythia, tarayıcıda çalışan çevrim içi bir ritim oyunudur. Dört şeritli oynanış, canlı üretilen özgün elektronik müzikler, farklı zorluklar, klavye ve dokunmatik kontroller, hesap sistemi ve global skor tabloları içerir.

## Kontroller

- Şeritler: `D`, `F`, `J`, `K`
- Duraklat/devam: `Esc`
- Mobil: Ekranın altındaki dört şeride dokun

## Yerel geliştirme

```bash
npm install
npm run db:local
npm run dev
```

## Cloudflare

Git bağlantısında deploy komutu:

```bash
npx wrangler deploy && npx wrangler d1 migrations apply bolge47-db --remote
```

Worker, var olan D1 veritabanında gerekli tabloları güvenli biçimde kendisi de doğrular.

## Teknoloji

- Cloudflare Workers + Static Assets
- Cloudflare D1
- Web Audio API ile özgün prosedürel müzik
- Canvas tabanlı 60 FPS oyun alanı
- PBKDF2-SHA256 parola özeti ve HttpOnly oturum çerezi
