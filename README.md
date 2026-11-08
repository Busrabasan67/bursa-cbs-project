
# Bursa Web Tabanlı CBS Uygulaması

Bu proje; PostgreSQL/PostGIS, .NET Core Web API ve MapLibre GL JS teknolojileri kullanılarak geliştirilmiş web tabanlı bir Coğrafi Bilgi Sistemi (CBS) uygulamasıdır. Bursa ili sınırları içerisindeki idari sınırlar (ilçeler) ile sağlık tesisleri (hastaneler) mekânsal analizlere ve harita üzerinde etkileşime uygun şekilde modellenmiştir.

---

## Hızlı Başlangıç & Port / Giriş Bilgileri

| Servis / Bileşen | URL / Bağlantı | Varsayılan Port | Kullanıcı / Şifre |
| :--- | :--- | :--- | :--- |
| **PostgreSQL + PostGIS** | `localhost:5432` (Veritabanı: `bursa_gis_db`) | `5432` | `postgres` / `password123` |
| **Backend REST API** | `http://localhost:5298/api` | `5298` | - |
| **Swagger UI (API Test)** | `http://localhost:5298/swagger` | `5298` | - |
| **Frontend Harita Arayüzü**| `frontend/index.html` (Live Server / statik) | `5500` / Dosya | - |

###  3 Adımda Projeyi Çalıştırma

Terminalde proje ana dizinindeyken sırasıyla şu adımları izleyin:

1. **Veritabanını Başlatın ve Verileri Yükleyin:**
   ```bash
   # PostGIS konteynerini arka planda başlatın
   docker compose up -d

   # Hazır veritabanı yedeğini (ilçeler, hastaneler, indeksler) içeri aktarın
   docker exec -i bursa_postgis psql -U postgres -d bursa_gis_db < bursa_gis_dump.sql
   ```

2. **Backend Web API'yi Başlatın:**
   ```bash
   cd BursaGis.Api
   dotnet run --urls "http://localhost:5298"
   ```
   *(API ayağa kalktığında `http://localhost:5298/swagger` adresinden servisleri inceleyebilirsiniz).*

3. **Frontend Harita Arayüzünü Açın:**
   * `frontend/index.html` dosyasını tarayıcınızda çift tıklayarak açabilir veya VS Code üzerinde **Live Server** eklentisiyle (`http://127.0.0.1:5500/frontend/index.html`) çalıştırabilirsiniz.

---

## 1. Veri Temini ve Hazırlık Süreci

Projede kullanılan konumsal veriler, açık lisanslı gerçek dünya verisi sağlayan **OpenStreetMap (OSM)** platformundan **Overpass Turbo** arayüzü kullanılarak temin edilmiştir.

* **Lisans:** [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/)
* **Kaynak:** [OpenStreetMap](https://www.openstreetmap.org/) via [Overpass Turbo](https://overpass-turbo.eu/)
* **Veri Formatı:** GeoJSON (WGS 84 / EPSG:4326)

---

### 1.1. İlçe Sınırları Verisi (Poligon Katmanı)

Bursa iline bağlı tüm idari ilçe sınırlarını çekmek için Overpass Turbo üzerinde idari sınır (`boundary=administrative`) ve ilçe düzeyini belirten `admin_level=6` etiketleri sorgulanmıştır.

**Kullanılan Overpass QL Sorgusu:**
```overpassql
[out:json][timeout:60];
// Bursa il sınırını alan olarak belirle
area["name"="Bursa"]["admin_level"="4"]->.bursa;

// Bursa içindeki ilçe (admin_level=6) sınırlarını çek
(
  relation["admin_level"="6"]["boundary"="administrative"](area.bursa);
);

out body;
>;
out skel qt;

```

* **Dışa Aktarma:** Overpass Turbo arayüzünden `Export -> GeoJSON` seçeneğiyle indirilmiş ve `bursa_ilceler.geojson` olarak adlandırılmıştır.
* **Geometri Türü:** `Polygon` / `MultiPolygon`
* **Toplam Kayıt Sayısı:** 34 poligon/geometri

---

### 1.2. Sağlık Tesisleri / Hastaneler Verisi (Nokta Katmanı)

Bursa ili genelindeki kamu ve özel tüm hastane konumlarını çekmek için `amenity=hospital` etiketi sorgulanmıştır.

**Kullanılan Overpass QL Sorgusu:**

```overpassql
[out:json][timeout:60];
// Bursa il sınırını alan olarak belirle
area["name"="Bursa"]["admin_level"="4"]->.bursa;

// Bursa sınırları içindeki hastaneleri çek
(
  node["amenity"="hospital"](area.bursa);
  way["amenity"="hospital"](area.bursa);
  relation["amenity"="hospital"](area.bursa);
);

out center;

```

* **Dışa Aktarma:** Overpass Turbo arayüzünden `Export -> GeoJSON` seçeneğiyle indirilmiş ve `bursa_hastaneler.geojson` olarak adlandırılmıştır.
* **Geometri Türü:** `Point`
* **Toplam Kayıt Sayısı:** 55 nokta

---

## 2. Altyapı ve Veritabanı Kurulumu

Veritabanı altyapısı, konumsal analiz kütüphaneleri (GDAL/OGR) hazır kurulu gelen Docker konteyneri üzerinden ayağa kaldırılmıştır.

### `docker-compose.yml`

```yaml
version: '3.8'

services:
  database:
    image: kartoza/postgis:16-3.4
    container_name: bursa_postgis
    environment:
      POSTGRES_DB: bursa_gis_db
      POSTGRES_USER: postgres
      POSTGRES_PASS: password123
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./:/data

volumes:
  pgdata:

```

### Konteyneri Başlatma

```bash
docker compose up -d

```

---

## 3. Veri Yükleme ve Veritabanı Kurulum Seçenekleri

Proje talimatlarında belirtilen veri aktarımı gereksinimi için repoda **iki alternatif yöntem** sunulmuştur:
* **Yöntem A (Önerilen - Hızlı Kurulum):** Hazır SQL Dump (`bursa_gis_dump.sql`) dosyasını tek komutla içe aktarmak.
* **Yöntem B (Ham Veriden İçe Aktarma):** GeoJSON dosyalarını CLI üzerinden standart `ogr2ogr` aracıyla PostGIS'e aktarmak.

---

### Yöntem A: Hazır SQL Dump ile Tek Komutta Kurulum (Önerilen)

Tüm ön işleme adımları (`ST_Union` ile ilçe birleştirme, hastanelerin ilçe eşleştirmeleri ve GiST indeksleri) yapılmış olan hazır `bursa_gis_dump.sql` dosyasını içe aktarmak en hızlı yöntemdir:

```bash
docker exec -i bursa_postgis psql -U postgres -d bursa_gis_db < bursa_gis_dump.sql
```

Bu işlem tek adımda veritabanı uzantısını (`postgis`), temizlenmiş 17 ilçe poligonunu, 54 hastane noktasını, `user_drawings` tablosunu ve GiST mekânsal indekslerini eksiksiz oluşturur.

---

### Yöntem B: Ham GeoJSON Verilerini `ogr2ogr` ile İçe Aktarma (Alternatif)

Eğer ham açık kaynak verilerden (`bursa_ilceler.geojson` ve `bursa_hastaneler.geojson`) sıfırdan tablo oluşturmak isterseniz, PostGIS Docker konteyneri içindeki standart `ogr2ogr` aracı kullanılır. Tüm geometriler **WGS 84 (EPSG:4326)** projeksiyon sistemine sabitlenir ve birincil anahtarlar (`ogc_fid`) atanır.

#### 3.1. İlçe Sınırlarının Aktarılması (Poligon Katmanı)

```bash
docker exec -it bursa_postgis ogr2ogr -f "PostgreSQL" \
  PG:"host=localhost user=postgres password=password123 dbname=bursa_gis_db" \
  "/data/bursa_ilceler.geojson" \
  -nln districts \
  -lco GEOMETRY_NAME=geom \
  -lco FID=ogc_fid \
  -a_srs EPSG:4326 \
  -overwrite
```

#### 3.2. Hastanelerin Aktarılması (Nokta Katmanı)

```bash
docker exec -it bursa_postgis ogr2ogr -f "PostgreSQL" \
  PG:"host=localhost user=postgres password=password123 dbname=bursa_gis_db" \
  "/data/bursa_hastaneler.geojson" \
  -nln hospitals \
  -lco GEOMETRY_NAME=geom \
  -lco FID=ogc_fid \
  -a_srs EPSG:4326 \
  -overwrite
```

#### 3.3. Kullanıcı Çizimleri Tablosunun Oluşturulması

Kullanıcının harita üzerinden çizeceği serbest geometrileri (nokta, çizgi, poligon) saklamak için `user_drawings` tablosu oluşturulur:

```bash
docker exec -it -e PGPASSWORD=password123 bursa_postgis psql -h localhost -U postgres -d bursa_gis_db -c "
CREATE TABLE IF NOT EXISTS user_drawings (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150),
    description TEXT,
    geom GEOMETRY(Geometry, 4326),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"
```

---

## 4. Mekânsal İndeksleme (GiST)

Mekânsal sorguların (kesişim, tampon bölge, en yakın komşu) performansını optimize etmek amacıyla tabloların hem `geometry` (`SRID 4326`) sütunları hem de metrik hesaplamalarda kullanılan `geography` dönüşüm ifadeleri üzerinde **GiST (Generalized Search Tree)** indeksleri tanımlanmıştır:

```bash
docker exec -it -e PGPASSWORD=password123 bursa_postgis psql -h localhost -U postgres -d bursa_gis_db -c "
CREATE INDEX IF NOT EXISTS idx_districts_geom ON districts USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_hospitals_geom ON hospitals USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_user_drawings_geom ON user_drawings USING GIST(geom);

CREATE INDEX IF NOT EXISTS idx_districts_geog ON districts USING GIST((geom::geography));
CREATE INDEX IF NOT EXISTS idx_hospitals_geog ON hospitals USING GIST((geom::geography));
CREATE INDEX IF NOT EXISTS idx_user_drawings_geog ON user_drawings USING GIST((geom::geography));
"
```

---

## 5. Veri Doğrulama

Veritabanındaki satır sayıları SQL sorgusu ile kontrol edilerek verilerin eksiksiz yüklendiği doğrulanmıştır:

```bash
docker exec -it -e PGPASSWORD=password123 bursa_postgis psql -h localhost -U postgres -d bursa_gis_db -c "
SELECT count(*) AS toplam_ilce FROM districts;
SELECT count(*) AS toplam_hastane FROM hospitals;
"

```

* **İlçe Sınırları (Ham Veri):** 34 adet poligon/çizgi parçası
* **Hastaneler (`hospitals`):** 55 adet nokta kaydı
* **Kullanıcı Çizimleri (`user_drawings`):** Geometri ve GiST indeks hazır

---

### 5.1. Mekânsal Birleştirme ve Veri Ön İşleme (`ST_Union`)

OpenStreetMap relation sorgularında ilçeler sınır parçaları (`way`) ile birlikte indiği için ham veride 34 adet geometri oluşmuştur. Bursa ilinin resmi **17 ilçesinin** net ve tekil olarak gösterilmesi amacıyla PostGIS'in güçlü mekânsal birleştirme fonksiyonu olan **`ST_Union`** kullanılmıştır:

* İsmi boş olan alt sınır parçaları elenmiştir (`WHERE name IS NOT NULL`).
* Aynı ada sahip poligon parçaları tek bir **`MultiPolygon`** geometrisi altında birleştirilmiştir (`GROUP BY name` ve `ST_Union`).
* Yeni temiz tablo için birincil anahtar ve **GiST indeksi** tanımlanmıştır.

```sql
CREATE TABLE districts_clean AS
SELECT 
    row_number() OVER () AS ogc_fid,
    name,
    '6' AS admin_level,
    ST_Multi(ST_Union(geom))::geometry(MultiPolygon, 4326) AS geom
FROM districts
WHERE name IS NOT NULL AND name != ''
GROUP BY name;

DROP TABLE districts;
ALTER TABLE districts_clean RENAME TO districts;
ALTER TABLE districts ADD PRIMARY KEY (ogc_fid);
CREATE INDEX idx_districts_geom ON districts USING GIST(geom);
```

Bu işlem sonucunda `districts` tablosu net olarak Bursa'nın **17 resmi ilçesine** indirgenmiş ve topolojik bütünlüğü sağlanmıştır.

---

### 5.2. Mekânsal Zenginleştirme ile İlçe Bilgilerinin Tamamlanması (`ST_Within`)

Açık kaynaklı OpenStreetMap verisinde hastanelerin konumsal koordinatları doğru olmasına rağmen, sözel adres alanlarındaki ilçe (`addr:district`) etiketlerinin büyük kısmının girilmediği tespit edilmiştir. 

Veri kalitesini ve öznitelik arama/filtreleme kabiliyetini artırmak için PostGIS'in **`ST_Within`** konumsal fonksiyonu kullanılarak her hastanenin içine düştüğü ilçe poligonu tespit edilmiş ve ilçe adı otomatik olarak atanmıştır:

```sql
UPDATE hospitals h
SET "addr:district" = d.name
FROM districts d
WHERE ST_Within(h.geom, d.geom)
  AND (h."addr:district" IS NULL OR h."addr:district" = '');
```

Bu işlem sayesinde tüm sağlık tesislerinin ilçe özniteliği %100 doğrulukla zenginleştirilmiştir.

---

### 5.3. Mükerrer (Duplicate) Kayıtların Temizlenmesi

OSM veri modelinde bazı sağlık tesislerinin hem parsel arazisi hem de üzerindeki ana binası ayrı ayrı etiketlendiğinden mükerrer kayıtlar oluşabilmektedir. Bu durum mekânsal mesafe kontrolü (`ST_Distance`) ile tespit edilmiştir:

```sql
-- Birbirine 100 metreden yakın ve aynı ada sahip kayıtların tespiti
SELECT h1.ogc_fid, h2.ogc_fid, h1.name, ST_Distance(h1.geom::geography, h2.geom::geography) AS mesafe_m
FROM hospitals h1
JOIN hospitals h2 ON h1.name = h2.name AND h1.ogc_fid < h2.ogc_fid
WHERE ST_Distance(h1.geom::geography, h2.geom::geography) < 100;

-- Bina olmayan mükerrer parsel kaydının silinmesi
DELETE FROM hospitals WHERE ogc_fid = 40;
```

Temizleme neticesinde Bursa genelinde **54 adet tekil ve doğrulanmış sağlık tesisi** elde edilmiştir.

---

## 6. Backend Kurulumu (.NET 9 Web API)

Backend uygulaması **.NET 9** mimarisinde Controller yapısı ve konumsal ORM kütüphaneleri kullanılarak geliştirilmiştir.

### 6.1. Projenin Oluşturulması

```bash
dotnet new webapi -n BursaGis.Api --use-controllers -f net9.0
cd BursaGis.Api
```

### 6.2. Konumsal (GIS) ve ORM Paketlerinin Yüklenmesi

PostgreSQL/PostGIS entegrasyonu ve GeoJSON desteği için aşağıdaki paketler projeye dahil edilmiştir:

```bash
# PostgreSQL için EF Core sağlayıcısı (.NET 9)
dotnet add package Npgsql.EntityFrameworkCore.PostgreSQL --version 9.*

# PostGIS coğrafi tipleri (Point, Polygon vb.) için NetTopologySuite entegrasyonu
dotnet add package Npgsql.EntityFrameworkCore.PostgreSQL.NetTopologySuite --version 9.*

# Geometrilerin standart GeoJSON formatında JSON serileştirilmesi için
dotnet add package NetTopologySuite.IO.GeoJSON4STJ

# API dokümantasyonu ve test arayüzü (Swagger/OpenAPI) için
dotnet add package Swashbuckle.AspNetCore
```

### 6.3. Veritabanı Modelleri (Entity Sınıfları)

PostGIS tablolarını C# nesnelerine eşlemek için NetTopologySuite geometri tiplerini kullanan modeller oluşturulmuştur:

* **`Hospital` (`Models/Hospital.cs`):** `ogc_fid`, `name`, `amenity`, `addr:district` vb. öznitelikler ile `Point` tipinde SRID 4326 geometri kolonu.
* **`District` (`Models/District.cs`):** İlçe sınırları için `ogc_fid`, `name`, `admin_level` ve `Geometry` (Polygon/MultiPolygon) kolonu.
* **`UserDrawing` (`Models/UserDrawing.cs`):** Kullanıcının harita üzerinden çizeceği serbest geometriler (nokta, çizgi, poligon) için `name`, `description` ve genel `Geometry` kolonu.

### 6.4. Veritabanı ve GeoJSON Yapılandırması (`Program.cs`)

* **Npgsql + NetTopologySuite:** `options.UseNpgsql(connectionString, o => o.UseNetTopologySuite())` ile EF Core üzerinde uzamsal sorgu yetenekleri etkinleştirilmiştir.
* **GeoJsonConverterFactory:** NetTopologySuite geometrilerinin standart GeoJSON formatında serileştirilmesi sağlanmıştır.
* **CORS:** Frontend harita arayüzünün API ile sorunsuz haberleşmesi için `AllowAll` politikası tanımlanmıştır.
* **Swagger UI:** API uçlarının test edilebilmesi için Swagger arayüzü entegre edilmiştir.

---

## 7. Katman ve Veri Servisleri (REST API)

Harita arayüzünün tüketebilmesi ve veri yönetimi için aşağıdaki RESTful endpoint'ler geliştirilmiştir:

### 7.1. İlçe Sınırları Servisi (`/api/districts`)
* **`GET /api/districts`**: Tüm ilçe sınırlarını standart **GeoJSON FeatureCollection** formatında döner.
* **`GET /api/districts/{id}`**: Belirli bir ilçenin öznitelik ve geometri detayını döner.

### 7.2. Sağlık Tesisleri / Hastane Servisi (`/api/hospitals`)
* **`GET /api/hospitals`**: Tüm hastaneleri **GeoJSON FeatureCollection** formatında döner.
  * **Öznitelik Arama / Filtreleme Desteği:** `search` (isim veya cadde), `district` (ilçe adı) ve `onlyEmergency` (acil servis durumu) sorgu parametreleri ile anlık filtreleme yapılabilir (Örn: `/api/hospitals?search=devlet&district=Nilüfer&onlyEmergency=true`).
  * **Büyük Veri Performans Önlemleri (BBOX & Sayfalama):**
    * **`bbox` (Bounding Box Filtrelemesi):** `bbox=minLng,minLat,maxLng,maxLat` parametresi gönderildiğinde NetTopologySuite `Envelope` oluşturularak PostGIS üzerinde **`ST_Intersects`** ve **`GiST` uzamsal indeksi (`idx_hospitals_geom`)** kullanılır; yalnızca harita kadrajına giren objeler sorgulanır.
    * **`page` ve `pageSize` (Sayfalama):** Veri boyutu büyüdüğünde tüm kayıtları tek seferde belleğe çekmemek için `Skip` / `Take` tabanlı sayfalama desteklenir ve yanıtta `totalCount` bilgisi dönülür.
* **`GET /api/hospitals/{id}`**: Tekil hastane detayını döner.
* **`PUT /api/hospitals/{id}`**: Hastanenin sözel bilgilerini (ad, ilçe, sokak, telefon, web sitesi, acil servis durumu vb.) günceller (`UpdateHospitalDto`).

### 7.3. Kullanıcı Çizimleri Servisi (`/api/userdrawings`)
Kullanıcının harita üzerinden çizeceği serbest geometrileri (nokta, çizgi, poligon) yönetmek için tam teşekküllü CRUD API:
* **`GET /api/userdrawings`**: Kayıtlı tüm kullanıcı çizimlerini oluşturulma tarihine göre sıralı şekilde **GeoJSON FeatureCollection** olarak döner.
* **`GET /api/userdrawings/{id}`**: Belirli bir çizimin detayını döner.
* **`POST /api/userdrawings`**: Yeni geometri kaydeder (`CreateUserDrawingDto`). Kayıt öncesinde **SRID 4326** ataması ve NetTopologySuite üzerinden **`Geometry.IsValid` topolojik geçerlilik doğrulaması** yapılır.
* **`PUT /api/userdrawings/{id}`**: Çizimin sözel bilgilerini (`name`, `description`) ve/veya geometrisini (`geometry`) topolojik doğrulama kontrolüyle günceller (`UpdateUserDrawingDto`).
* **`DELETE /api/userdrawings/{id}`**: Çizimi veritabanından kalıcı olarak siler.

---

## 8. Harita Ekranı ve Kullanıcı Arayüzü (MapLibre GL JS)

Frontend katmanı, herhangi bir ağır framework bağımlılığı olmadan doğrudan **HTML5, CSS3 (Modern Flexbox/Grid)** ve **Vanilla JavaScript + MapLibre GL JS v4** kullanılarak geliştirilmiştir (`frontend/`).

* **Çoklu Altlık Harita (Basemap) Desteği:** Kullanıcı tek tıkla **Açık Tema (Carto Positron)**, **Koyu Tema (Carto Dark Matter)** ve **Standart (Carto Voyager / OSM)** altlık haritaları arasında geçiş yapabilir. Altlık değişimlerinde (`style.load`, `styledata`, `idle` olayları üzerinden) tüm vektör kaynaklar, katman görünürlük durumları ve etiket renkleri otomatik olarak korunur.
* **Katman Yönetimi:** **İlçe Sınırları (Poligon)**, **Hastaneler (Nokta)** ve **Kullanıcı Çizimleri (Nokta/Çizgi/Poligon)** katmanları birbirinden bağımsız olarak açılıp kapatılabilir.
* **Öznitelik Üzerinden Arama ve Filtreleme:**
  * Hastane adı veya cadde/sokak adına göre anlık metin araması (`debounce` destekli),
  * 17 ilçeye göre açılır liste filtresi,
  * *"Sadece Acil Servisi Olanlar"* filtresi.
  * Filtreleme sonucunda harita otomatik olarak bulunan sonuçların sınırlarına (`fitBounds` / `flyTo`) odaklanır.
* **Etkileşimli Popup ve Öznitelik Gösterimi:** Harita üzerindeki veya sol listedeki bir objeye tıklandığında ilgili objenin öznitelik bilgileri ve yönetim aksiyonları doğrudan harita baloncuğu (Popup) içerisinde gösterilir.

---

## 9. Veri Yönetimi (CRUD & Harita Üzerinde Çizim Modülü)

Proje gereksinimlerinin 3. maddesi kapsamında hem mevcut verilerin sözel bilgilerinin düzenlenmesi hem de harita üzerinde yeni geometrilerin çizilip yönetilmesi uçtan uca gerçeklenmiştir:

### 9.1. Sözel Veri Güncelleme (Hastaneler & Çizimler)
* Harita üzerinde veya listede seçilen bir hastanenin **Ad, İlçe, Cadde/Sokak, Telefon, Web Sitesi ve Acil Servis** bilgileri düzenleme modalı üzerinden doğrulamalı (validation) olarak güncellenir (`PUT /api/hospitals/{id}`).
* Güncelleme sonrasında hem harita katmanı hem de açık olan Popup anlık olarak yenilenir.

### 9.2. Harita Üzerinde Etkileşimli Çizim Motoru (Point, Polyline, Polygon)
* Kullanıcı **Çizimlerim** sekmesindeki araçlarla harita üzerinde 3 farklı geometri tipinde çizim yapabilir:
  1. **Nokta (`Point`):** Tek tıklama ile noktasal konum ekleme.
  2. **Çizgi (`LineString` / Polyline):** Çoklu kırık noktalarla güzergâh/hat çizimi ve fare hareketiyle canlı önizleme.
  3. **Alan (`Polygon`):** Köşe noktalarıyla kapalı alan çizimi ve canlı alan dolgusu önizlemesi.
* Çizim esnasında harita üzerinde açılan kontrol çubuğu ile **Son Noktayı Geri Alma (Undo)**, **Çizimi Tamamlama** (veya çift tıklama) ve **İptal Etme** işlemleri desteklenir.
* Tamamlanan çizim için **Ad** ve **Açıklama** girilerek `POST /api/userdrawings` servisi üzerinden PostGIS `user_drawings` tablosuna kaydedilir.

### 9.3. Konumsal Düzenleme (Köşe Taşıma) ve Silme
* **Geometri Düzenleme (Taşı):** Kayıtlı bir nokta, çizgi veya poligon seçilip **"Taşı"** moduna alındığında, geometrinin tüm köşe noktalarında sürüklenebilir işaretçiler (`draggable vertex markers`) oluşturulur. Kullanıcı köşeleri harita üzerinde sürükleyerek şekli/konumu değiştirebilir ve `PUT /api/userdrawings/{id}` ile yeni geometriyi kaydedebilir.
* **Topolojik Doğruluk Kontrolü (Self-Intersection & OGC Validity):**
  * Poligon çizimi ve köşe taşıma işlemlerinde kenarların birbirini kesmesi (**kendi kendini kesen / kelebek poligon**) hem istemci tarafında doğru parçası kesişim algoritması (`segmentsIntersect`) ile hem de sunucu tarafında NetTopologySuite `Geometry.IsValid` kontrolü ile engellenmiştir. Böylece veritabanına yalnızca OGC standartlarına uygun, mekânsal analizlerde hatasız çalışacak geçerli geometrilerin kaydedilmesi garanti altına alınmıştır.

---

## 10. Geometrik Analiz Modülü ve Mimari Tasarım

Uygulamanın **Geometrik Analiz** modülü; **Katmanlı Mimari**, **Bilinçli SRID/Birim Kullanımı** ve **Veri Boyutu Büyüdüğünde Performans** mühendislik ilkelerine sıkı sıkıya bağlı kalınarak geliştirilmiştir.

### 10.1. Mimari ve Mühendislik İlkeleri
1. **Katmanlı Mimari (`Controller -> Service -> PostGIS`):**
   * Geometrik analiz sorguları doğrudan Controller içine yazılmamış; iş mantığı **`ISpatialAnalysisService`** arayüzü ve **`SpatialAnalysisService`** (`Services/SpatialAnalysisService.cs`) katmanına soyutlanmıştır.
   * **`AnalysisController`** (`Controllers/AnalysisController.cs`) yalnızca HTTP parametre doğrulaması yapmakta ve servis sonuçlarını haritanın doğrudan çizebileceği standart GeoJSON katmanlarına dönüştürmektedir.
2. **Bilinçli SRID (4326) ve Metrik Birim (`geography`) Kullanımı:**
   * Veritabanındaki geometriler web haritalama standardı olan **`EPSG:4326` (WGS 84 - Derece)** koordinat sisteminde tutulmaktadır.
   * `geometry` tipi üzerinde doğrudan yapılan mesafe/alan hesaplamaları **derece** döndürdüğü ve Bursa enleminde ($40^\circ\text{K}$) boylam/enlem derece uzunlukları farklı olduğu için, mesafe ve alan gerektiren tüm analizlerde PostGIS **`::geography`** dönüşümü (WGS 84 küresel elipsoid modeli) veya **`EPSG:5254` (TUREF / TM30)** projeksiyon doğrulaması kullanılmıştır.
3. **Performans ve Uzamsal İndeksleme (`GiST` Geometry & Geography İndeksleri):**
   * Tüm tablolarda hem düzlemsel `geometry` sorguları (`ST_Intersects`, `ST_Within`, `&&`) için **`idx_*_geom` GiST indeksleri**, hem de küresel `::geography` sorguları (`<->` KNN ve `ST_DWithin`) için **`idx_*_geog` fonksiyonel GiST indeksleri** (`USING GIST ((geom::geography))`) tanımlanmıştır. PostgreSQL `EXPLAIN` planlarıyla tüm analizlerin `Seq Scan` yerine `Index Scan` kullandığı doğrulanmıştır.

---

### 10.2. Analiz 1: En Yakın N Obje Analizi (`<->` KNN & `ST_Distance`)
* **Endpoint:** `GET /api/analysis/nearest-hospitals?lat={lat}&lng={lng}&count={N}`
* **Çalışma Prensibi:**
  * Kullanıcının harita üzerinde tıkladığı koordinata (`lat`, `lng`) en yakın $N$ adet sağlık tesisini bulur.
  * Sıralama aşamasında tüm tabloyu taramak yerine PostGIS'in uzamsal indeks destekli **KNN (K-Nearest Neighbors) `<->` operatörü** (`ORDER BY h.geom::geography <-> ST_SetSRID(ST_MakePoint(@lng, @lat), 4326)::geography LIMIT @count`) kullanılır.
  * Gerçek kuş uçuşu mesafe **`ST_Distance(geom::geography, point::geography)`** ile **metre** cinsinden hesaplanır.
  * Sonuçlar Türkiye resmi yerel projeksiyonu olan **`EPSG:5254` (TUREF / TM30)** düzlemsel mesafe hesabı ile çapraz doğrulanmış ve milimetrik/santimetrik düzeyde ($\pm 0.2\text{ m}$) örtüştüğü teyit edilmiştir.
* **Görselleştirme:** Harita üzerinde tıklanan nokta ile bulunan en yakın $N$ hastane arasında kesikli bağlantı çizgileri (*Spider Lines*), sıra numaralı vurgulu noktalar ve mesafe rozetli sonuç listesi gösterilir.

---

### 10.3. Analiz 2: Alan İçinde Kalanlar Analizi (`ST_Within` / `ST_Intersects` & `ST_Area`)
* **Endpoint'ler:**
  * `GET /api/analysis/in-polygon/district/{districtId}` *(Seçilen bir ilçe poligonu içindeki hastaneler)*
  * `GET /api/analysis/in-polygon/drawing/{drawingId}` *(Kullanıcının kaydettiği bir poligon çizimi içindeki hastaneler)*
  * `POST /api/analysis/in-polygon/custom` *(Harita üzerinde anlık çizilen serbest poligon içindeki hastaneler)*
* **Çalışma Prensibi:**
  * Kullanıcının **seçtiği** (17 ilçe sınırı veya kayıtlı kullanıcı poligonları) ya da harita üzerinde o an **serbestçe çizdiği** bir poligonun içinde kalan sağlık tesislerini tespit eder.
  * Serbest çizilen poligonlar hem istemci tarafında (`hasPolygonSelfIntersection`) hem de sunucu tarafında (`Geometry.IsValid` & `SRID = 4326`) topolojik doğrulamadan geçirilir.
  * Konumsal filtrelemede PostGIS'in **`ST_Within(h.geom, @poly)`** ve sınır üzerindeki noktaları da kaçırmamak adına **`ST_Intersects(h.geom, @poly)`** fonksiyonları birlikte kullanılır. Bu fonksiyonlar PostgreSQL sorgu planlayıcısında önce **`idx_hospitals_geom` GiST uzamsal indeksini (Bounding Box `&&`)** kullanarak aday noktaları süzer, ardından kesin poligon içi (*Exact Point-in-Polygon*) testini uygular.
  * Ayrıca analize konu olan poligonun gerçek metrik yüzölçümü **`ST_Area(poly::geography)`** ile $\text{m}^2$ ve $\text{km}^2$ cinsinden hesaplanarak analiz özetinde sunulur.
* **Görselleştirme:** Seçilen veya çizilen poligon harita üzerinde vurgu katmanı (`analysis-polygon-source`) ile çerçevelenir, poligon içine düşen hastaneler vurgulanır (`analysis-points-source`) ve sol panelde alanın yüzölçümü ($\text{km}^2$), toplam/acil hastane sayısı ve hastane listesi görüntülenir.

---

### 10.4. Analiz 3: Yakınlık / Tampon Bölge Analizi (`ST_Buffer` & `ST_DWithin`)
* **Endpoint'ler:**
  * `GET /api/analysis/buffer/point?lat={lat}&lng={lng}&radiusMeters={R}` *(Haritadan seçilen bir nokta etrafında $R$ metre yarıçaplı tampon bölge)*
  * `GET /api/analysis/buffer/drawing/{drawingId}?radiusMeters={R}` *(Kullanıcının kaydettiği bir Nokta, Çizgi/Güzergâh veya Alan/Poligon çizimi etrafında $R$ metre mesafeli tampon bölge)*
  * `GET /api/analysis/buffer/hospital/{hospitalId}?radiusMeters={R}` *(Mevcut bir sağlık tesisi/hastane objesi etrafında $R$ metre yarıçaplı tampon bölge)*
* **Çalışma Prensibi (Bilinçli SRID / Birim ve Performans):**
  * **Tampon Poligonun Üretilmesi (`ST_Buffer`):** `SRID 4326` (`geometry`) üzerinde doğrudan `ST_Buffer` çalıştırmak derece birimi kullandığı için Bursa enleminde ($40^\circ\text{K}$) elips/bozuk şekiller üretir. Bu hatayı önlemek amacıyla **`ST_Buffer(geom::geography, @radius)::geometry`** kullanılmış; tampon poligon Dünya elipsoidi üzerinde gerçek **metre** cinsinden hesaplanıp tekrar `SRID 4326` geometrisine dönüştürülmüştür.
  * **Tampon İçindeki Objelerin Bulunması (`ST_DWithin`):** Performans ve matematiksel kesinlik için poligon kesişimi yerine doğrudan **`ST_DWithin(h.geom::geography, target::geography, @radius)`** fonksiyonu kullanılmıştır. Bu fonksiyon **`idx_hospitals_geog` GiST uzamsal indeksini** kullanarak hedef geometrinin `@radius` kadar genişletilmiş zarfında hızlı arama yapar ve bulunan hastaneleri merkeze/hatta olan gerçek mesafelerine (`ST_Distance`) göre yakından uzağa sıralar.
* **Görselleştirme:** Oluşturulan dairesel (nokta için), koridor (çizgi için) veya genişletilmiş çevre (poligon için) tampon alan haritada mavi yarı saydam poligon olarak çizilir, içine düşen hastaneler vurgulanır ve mesafeleriyle birlikte listelenir.

---

### 10.5. Analiz 4: Metrik Ölçüm Analizi (`ST_Transform(geom, 5254)` & `ST_Length` / `ST_Area` / `ST_Perimeter`)
* **Endpoint'ler:**
  * `GET /api/analysis/measure/drawing/{drawingId}` *(Kayıtlı bir kullanıcı çizgisinin uzunluğunu veya poligonunun alan/çevre uzunluğunu ölçer)*
  * `GET /api/analysis/measure/district/{districtId}` *(Seçilen bir Bursa ilçesinin metrik yüzölçümünü ve çevre uzunluğunu ölçer)*
  * `POST /api/analysis/measure/custom` *(Harita üzerinde anlık çizilen çizgi veya poligonun metrik uzunluk/alan ölçümünü yapar)*
* **Çalışma Prensibi (Bilinçli Metrik SRID Seçimi - `EPSG:5254`):**
  * Seçilen veya çizilen objelerin uzunluk ve alan hesaplamalarında doğru metrik sonuç elde edebilmek amacıyla, `EPSG:4326` (coğrafi derece) formatındaki geometriler hesaplama öncesinde PostGIS **`ST_Transform(geom_4326, 5254)`** fonksiyonu ile **Türkiye Ulusal Referans Çerçevesi `TUREF / TM30 (EPSG:5254)`** koordinat sistemine dönüştürülmektedir.
  * **Neden `EPSG:5254` (TUREF / TM30) Seçildi?**
    * Web haritalarında kullanılan `EPSG:3857` (Web Mercator) projeksiyonu Bursa enleminde ($\sim 40.2^\circ\text{K}$) uzunlukları $\approx \%31$ ($\sec(40.2^\circ) \approx 1.31$), alanları ise $\approx \%71$ oranında hatalı (büyük) hesaplar.
    * Bursa ili ($28^\circ\text{D} - 30^\circ\text{D}$ boylam aralığı), Türkiye resmi haritacılık standardı olan 3 derecelik Gauss-Krüger Transverse Mercator dilimlerinden **dilim orta meridyeni $30^\circ\text{D}$ olan `TM30` (`EPSG:5254`)** bölgesinde yer alır. Bu projeksiyonun birimi doğrudan **metre (m)**'dir ve Bursa için distorsiyonsuz gerçek düzlemsel uzunluk (`ST_Length`), yüzölçümü (`ST_Area` -> $\text{m}^2, \text{hektar}, \text{km}^2$) ve çevre (`ST_Perimeter`) sonuçları üretir.
* **Kullanıcı Deneyimi:** Kullanıcılar **Analiz -> Ölçüm** sekmesinden kayıtlı çizimlerini veya ilçeleri seçerek, ya da **Mesafe Ölç** / **Alan Ölç** butonlarıyla harita üzerinde anlık çizim yaparak metrik ölçümleri görebilir; ayrıca harita üzerindeki herhangi bir çizime veya ilçeye tıkladıklarında açılan bilgi balonunda (popup) da ilgili objenin metrik uzunluk/alan bilgisi otomatik olarak gösterilir.

---

### 10.6. Analiz 5: Mekânsal Birleştirme ve Tematik (Choropleth) Harita (`LEFT JOIN ... ON ST_Intersects`)
* **Endpoint:** `GET /api/analysis/spatial-join/districts`
* **Çalışma Prensibi (Topolojik Mekânsal Birleştirme, Metrik Alan Yoğunluğu ve Performans):**
  * **Neden Metinsel Eşleştirme (`d.name = h.district`) Yerine Topolojik `ST_Intersects` Kullanıldı?**
    * CBS projelerinde öznitelik kolonlarındaki metin eşleştirmeleri (`addr:district`) yazım farkları, büyük/küçük harf uyumsuzlukları veya eksik adres verileri nedeniyle güvenilir değildir. Bunun yerine gerçek mekânsal topoloji ilişkisi olan **`LEFT JOIN hospitals h ON ST_Intersects(d.geom, h.geom)`** kullanılmıştır.
    * **`LEFT JOIN` Tercihi:** İçinde hiç hastane bulunmayan ilçelerin (ör. veri setinde 0 hastanesi olan *Kestel*) sonuç tablosundan ve tematik haritadan kaybolmaması, `0` değeriyle raporlanması için `INNER JOIN` yerine `LEFT JOIN` ve `COUNT(h.ogc_fid)` kullanılmıştır.
  * **Metrik Yüzölçümü ve Yoğunluk (`EPSG:5254`):** Her ilçenin yüzölçümü **`ST_Area(ST_Transform(d.geom, 5254)) / 1000000.0`** ile $\text{km}^2$ cinsinden hesaplanmış ve $100\text{ km}^2$ başına düşen hastane yoğunluğu (`hospitalsPer100SqKm`) üretilmiştir.
  * **Performans (`GiST` İndeks Kullanımı):** PostgreSQL sorgu planlayıcısı (`EXPLAIN`), `ST_Intersects(d.geom, h.geom)` birleştirmesini çalıştırırken **`idx_hospitals_geom` GiST uzamsal indeksini** (`Index Cond: (geom && d.geom)`) kullanarak `Nested Loop Left Join` gerçekleştirir.
* **Görselleştirme (Hem Tablo Hem Tematik / Choropleth Harita):**
  * **Tematik Harita (`analysis-choropleth-source`):** 17 ilçe poligonu, içlerine düşen hastane sayısına göre 5 kademeli renk skalasıyla (`0: #e2e8f0`, `1-2: #fde68a`, `3-5: #fb923c`, `6-9: #ef4444`, `10+: #991b1b`) harita üzerinde boyanır ve renk lejantı gösterilir.
  * **Sıralı Yoğunluk Tablosu:** Sol panelde 17 ilçe en yüksek hastane sayısından en düşüğe doğru sıralanır (1. Nilüfer: 15 hastane, 2. Osmangazi: 12 hastane, ..., 17. Kestel: 0 hastane). Tablodaki bir ilçeye veya haritadaki boyalı ilçe poligonuna tıklandığında o ilçeye odaklanılır ve detaylı yoğunluk özeti açılır.

---

## 11. Harici OGC/Raster Servisi Entegrasyonu

Harita üzerinde altlık veya tematik analiz amaçlı olarak yüksek çözünürlüklü **World Imagery BBOX Raster Servisi**, MapLibre GL JS arayüzüne harici raster katman olarak entegre edilmiştir.

### Öne Çıkan Özellikler ve Kullanım:
* **Dinamik BBOX Desteği:** MapLibre GL JS'in Web Mercator (`EPSG:3857`) dinamik sınırlayıcı kutu (`{bbox-epsg-3857}`) yeteneği kullanılarak, haritada gezinildikçe servis üzerinden anlık uydu/hava fotoğrafları çekilir.
* **Katman Hiyerarşisi:** Raster altlık, ilçe sınırları ve hastane vektör katmanlarının altına yerleştirilmiştir; böylece uydu görüntüsü açıkken bile vektör veriler ve analiz çizgileri net biçimde görülebilir.
* **Arayüzden Kontrol:** Sol paneldeki **WMS** butonu ile tek tıkla açılıp kapatılabilir. Temel altlık stili (Açık, Koyu, Standart) değiştiğinde katmanın açık/kapalı durumu korunur.
