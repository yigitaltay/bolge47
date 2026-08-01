# Rythia

Rythia, tarayıcıda çalışan çevrim içi bir fare hedefleme ritim oyunudur. Hedefler müziğe göre serbest oyun alanının farklı noktalarında belirir; oyuncu kapanan halkaya doğru zamanda ulaşır. Canlı üretilen özgün elektronik müzikler, farklı zorluklar, masaüstü ve mobil kontroller, hesap sistemi ve global skor tabloları içerir.

## Kontroller

- Masaüstü: Fareyi kapanan hedef halkasına götür
- Duraklat/devam: `Esc`
- Mobil: Oyun alanındaki hedefe dokun veya parmağını sürükle

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
