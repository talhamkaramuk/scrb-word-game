# Kelime Meydanı

Scrabble benzeri, tarayıcıdan oynanan ve yerel bir notebook üzerinde sunucu olarak çalışabilen çok oyunculu kelime oyunu prototipi.

## Çalıştırma

Node.js 20 veya üzeri gerekir. Ek npm bağımlılığı yoktur.

```powershell
npm start
```

Tarayıcıdan:

```text
http://localhost:3000
```

LAN için aynı ağdaki oyuncular notebook IP adresini kullanır:

```text
http://<notebook-ip>:3000
```

Online deneme için Cloudflare Quick Tunnel:

```powershell
cloudflared tunnel --url http://localhost:3000
```

Kalıcı online kullanımda ücretsiz Cloudflare hesabıyla named tunnel kullanmak daha doğru olur. Quick Tunnel geçici URL üretir ve uptime garantisi vermez.

## Arkadaşlarla Geçici Yayın

Kısa süreli oyun için yeterli akış:

```powershell
npm.cmd start
```

Ayrı bir terminalde:

```powershell
cloudflared tunnel --url http://localhost:3000
```

`trycloudflare.com` linkini yalnızca oynayacak arkadaşlarla paylaş. Oyun bitince iki terminali de kapat; link devre dışı kalır. Quick Tunnel ücretsizdir, hesap gerektirmez ve her başlatmada yeni geçici link üretir.

Windows shell `cloudflared` komutunu hemen görmezse kurulum yolundaki exe doğrudan çalıştırılabilir:

```powershell
& "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\cloudflared.exe" tunnel --url http://localhost:3000
```

## Oyun Durumu

- Sunucu yetkilidir; puan, sıra, raf, torba ve tahta sunucuda tutulur.
- WebSocket bağlantısı aynı origin üzerinde `/ws` yolundan kurulur.
- Maksimum oyuncu sayısı: 10.
- Tahta: 15x15 özel premium yerleşimli kelime tahtası.
- İlk hamle merkezden geçmelidir.
- Sonraki hamleler mevcut kelime ağına temas etmelidir.
- Sözlük modu varsayılan olarak sıkıdır; sunucu sözlükte olmayan kelimeleri reddeder.
- Oda sahibi oyun başlamadan oyun modunu seçebilir: Klasik, Hızlı 15 dk, Hızlı 30 dk veya Puan hedefi 250.
- Oda sahibi oyun başlamadan hamle süresini 60, 90 veya 120 saniye olarak seçebilir.
- Klasik mod torba/raf bitişi veya arka arkaya pas sınırıyla biter.
- Hızlı modlarda maç süresi dolunca oyun mevcut skorlarla biter.
- Puan hedefi modunda bir oyuncu 250 puana ulaşınca oyun biter.
- Hamle süresi dolarsa sunucu oyuncuyu otomatik pas geçmiş sayar ve sırayı ilerletir.
- Sırası gelen oyuncunun bağlantısı koparsa 15 saniye içinde geri dönmezse sunucu oyuncuyu otomatik pas geçmiş sayar.

Geçici esnek sözlük modu:

```powershell
$env:STRICT_DICTIONARY="0"; npm.cmd start
```

Sözlük dosyası:

```text
data/dictionary.tr.txt
```

Bu dosya kullanıcı tarafından oluşturulan Türkçe kelime listesini içerir. Sıkı mod açıkken dosya boşsa sunucu güvenli şekilde başlamaz.

Sözlük satırları iki formatı destekler:

```text
KELİME
word	source	license	minLength	flags
KELİME	local-user	user-provided	2	allowed
```

Düz satırlar geriye uyumludur ve `source=local-user`, `license=user-provided`, `minLength=2`, `flags=allowed` kabul edilir. TSV formatındaki `flags` alanı `allowed`, `proper_noun`, `abbreviation`, `archaic`, `slang` değerlerini `|` ile alabilir. Varsayılan oyun politikası özel isimleri ve kısaltmaları reddeder; arkaik veya argo kelimeler yalnızca `allowed` flag'iyle bilinçli olarak oynanabilir hale gelir. Türkçe çekimli formlar ayrı bir morfoloji motoruyla üretilmez; dosyada yer alan çekimli formlar kabul edilir.

## Arayüz ve Ses

- Son oynanan taşlar tahtada vurgulanır.
- Oyun ekranı üç bölüme ayrılır: ortada tahta, sol panelde oda/ayar/raf kontrolleri, sağ panelde skorboard ve geçmiş bulunur.
- Tahta orta bölümde pencerenin izin verdiği en büyük kare alanı kaplar.
- Taşlar raftan tahtaya tut-bırak ile yerleştirilebilir.
- Eldeki taşlar görsel olarak karıştırılabilir.
- Raf seçimi, taş yerleştirme, hamle gönderme ve hata durumlarında kısa WebAudio tonları çalar.
- Başarılı kelimelerde puana göre daha belirgin başarı sesi çalar.
- Ses düğmesi tarayıcıda saklanır; harici ses dosyası veya ek bağımlılık yoktur.
- Sistem hareket azaltma tercihi açıksa animasyonlar devre dışı kalır.

## Test

```powershell
npm test
```

Ek sözdizimi ve test kontrolü:

```powershell
npm run check
```

Release öncesi aynı kapıyı açık isimle çalıştırmak için:

```powershell
npm run check:release
```

Bu kontrol sunucu/paylaşılan/client dosyalarının sözdizimini, sözlük veri kontratını, unit testleri ve gerçek HTTP/WebSocket integration testlerini çalıştırır.

## Güvenlik ve Dağıtım Notları

- Oyun sunucusu istemciden gelen hamleleri yeniden doğrular.
- Raf bilgisi yalnızca ilgili oyuncuya gönderilir.
- Tarayıcı yeniden bağlanması için public oyuncu kimliği kullanılmaz; sunucu, sadece ilgili tarayıcıya verilen `sessionId` ve `reconnectToken` ikilisini kabul eder.
- Reconnect token düz metin olarak sunucuda saklanmaz; sunucuda yalnızca SHA-256 hash tutulur.
- Basit WebSocket hız limiti vardır.
- WebSocket upgrade ve frame parser katmanı sürüm/key doğrular, kısmi frame buffer'ını sınırlar ve hatalı frame'leri oyun mantığına ulaşmadan kapatır.
- Aktif oda sayısı, IP/subnet başına WebSocket bağlantısı ve IP başına oda oluşturma sayısı sunucu tarafında sınırlandırılır.
- Hiç başlamamış ve bağlantısı kalmamış odalar, başlamış odalardan daha kısa sürede temizlenir.
- Statik dosyalar güvenli kök dizinlerinden yayınlanır ve temel güvenlik başlıkları eklenir.
- Public internete açarken doğrudan router port yönlendirmesi yerine Cloudflare Tunnel önerilir.
