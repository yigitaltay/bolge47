# Bölge 47

Çevrim içi şehir kurma ve bölge ele geçirme oyunu. Oyuncular e-posta ve şifreyle hesap açar, kalıcı şehirlerini geliştirir, ordularını büyütür ve sezon haritasındaki bölgeler için diğer oyuncularla rekabet eder.

## Teknoloji

- Cloudflare Workers
- Cloudflare D1
- Statik HTML, CSS ve JavaScript
- PBKDF2 ile şifre özeti
- D1 üzerinde süreli, HttpOnly oturumlar

## Yerel çalıştırma

```bash
npm install
npm run db:local
npm run dev
```

Wrangler yerel adresi açıldığında kayıt olarak oynayabilirsin.

## Cloudflare kurulumu

1. Cloudflare hesabında oturum aç:

   ```bash
   npx wrangler login
   ```

2. D1 veritabanını oluştur:

   ```bash
   npx wrangler d1 create bolge47-db
   ```

3. Komutun döndürdüğü `database_id` değerini `wrangler.jsonc` içindeki `CHANGE_ME_AFTER_D1_CREATE` alanına yaz.

4. Uzak veritabanı şemasını uygula:

   ```bash
   npm run db:remote
   ```

5. Worker'ı yayınla:

   ```bash
   npm run deploy
   ```

## Oyun döngüsü

- Kaynak konvoyunu topla.
- Komuta merkezi, fabrika, reaktör ve finans merkezini yükselt.
- Çelik ve krediyle birlik eğit.
- Haritadan tarafsız veya rakip bölge seç.
- Kısa çatışmayı kazanarak sezon puanı ve bölge elde et.
- Kalıcı lig sıralamasında diğer şehirlerle yarış.

## Güvenlik notları

- Şifreler düz metin olarak tutulmaz; PBKDF2-SHA256 ile 210.000 tur kullanılarak özetlenir.
- Oturum anahtarları yalnızca hash olarak D1'da saklanır.
- Tarayıcı çerezi `HttpOnly`, `Secure` ve `SameSite=Lax` özelliklerine sahiptir.
- İlk sürümde e-posta doğrulama ve parola sıfırlama bulunmaz. Bunlar için ayrıca bir e-posta sağlayıcısı bağlanmalıdır.
