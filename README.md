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

## Oyun Durumu

- Sunucu yetkilidir; puan, sıra, raf, torba ve tahta sunucuda tutulur.
- WebSocket bağlantısı aynı origin üzerinde `/ws` yolundan kurulur.
- Maksimum oyuncu sayısı: 10.
- Tahta: 15x15 özel premium yerleşimli kelime tahtası.
- İlk hamle merkezden geçmelidir.
- Sonraki hamleler mevcut kelime ağına temas etmelidir.
- Sözlük modu varsayılan olarak sıkıdır; sunucu sözlükte olmayan kelimeleri reddeder.
- Oda sahibi oyun başlamadan hedef kelime sayısını 50, 100, 150 veya 200+ olarak seçebilir.
- Oda sahibi oyun başlamadan hamle süresini 60, 90 veya 120 saniye olarak seçebilir.
- Süre dolarsa sunucu oyuncuyu otomatik pas geçmiş sayar ve sırayı ilerletir.

Geçici esnek sözlük modu:

```powershell
$env:STRICT_DICTIONARY="0"; npm.cmd start
```

Sözlük dosyası:

```text
data/dictionary.tr.txt
```

Bu dosya başlangıç listesi içerir. Üretim kalitesinde Türkçe oyun için lisansı uygun, daha büyük bir kelime listesiyle değiştirilmelidir. Sıkı mod açıkken dosya boşsa sunucu güvenli şekilde başlamaz.

## Arayüz ve Ses

- Son oynanan taşlar tahtada vurgulanır.
- Oyun ekranı görünmez iki bölüme ayrılır: sol bölüm tahtaya, sağ bölüm oyun arayüzüne ayrılır.
- Tahta sol bölümde pencerenin izin verdiği en büyük kare alanı kaplar.
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

## Güvenlik ve Dağıtım Notları

- Oyun sunucusu istemciden gelen hamleleri yeniden doğrular.
- Raf bilgisi yalnızca ilgili oyuncuya gönderilir.
- Basit WebSocket hız limiti vardır.
- Statik dosyalar güvenli kök dizinlerinden yayınlanır ve temel güvenlik başlıkları eklenir.
- Public internete açarken doğrudan router port yönlendirmesi yerine Cloudflare Tunnel önerilir.
