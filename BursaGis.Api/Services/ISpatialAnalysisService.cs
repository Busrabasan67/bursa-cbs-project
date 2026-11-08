using BursaGis.Api.DTOs;
using NetTopologySuite.Geometries;

namespace BursaGis.Api.Services;

public interface ISpatialAnalysisService
{
    /// <summary>
    /// Analiz 1: Verilen koordinata (SRID 4326) en yakın N hastaneyi PostGIS KNN (<->) operatörü
    /// ve geography tabanlı gerçek metrik mesafe (ST_Distance) ile bulur.
    /// </summary>
    Task<List<NearestHospitalResultDto>> GetNearestHospitalsAsync(double lat, double lng, int count);

    /// <summary>
    /// Analiz 2A: Seçilen bir ilçe poligonunun içinde kalan hastaneleri (ST_Within / ST_Intersects)
    /// ve ilçenin gerçek metrik yüzölçümünü (ST_Area geography) döner.
    /// </summary>
    Task<PolygonAnalysisResultDto?> GetHospitalsInDistrictAsync(int districtId);

    /// <summary>
    /// Analiz 2B: Kullanıcının daha önce kaydettiği bir poligon çiziminin içinde kalan hastaneleri döner.
    /// </summary>
    Task<PolygonAnalysisResultDto?> GetHospitalsInUserDrawingAsync(int drawingId);

    /// <summary>
    /// Analiz 2C: Kullanıcının harita üzerinde anlık çizdiği serbest poligonun içinde kalan hastaneleri döner.
    /// </summary>
    Task<PolygonAnalysisResultDto> GetHospitalsInCustomPolygonAsync(Geometry polygon, string? name = null);

    /// <summary>
    /// Analiz 3A: Haritada tıklanan bir nokta etrafında verilen yarıçapta (metre) tampon alan (ST_Buffer)
    /// oluşturur ve içinde kalan hastaneleri (ST_DWithin) mesafeleriyle birlikte döner.
    /// </summary>
    Task<BufferAnalysisResultDto> GetHospitalsInPointBufferAsync(double lat, double lng, double radiusMeters);

    /// <summary>
    /// Analiz 3B: Seçilen bir kullanıcı çizimi (Nokta, Çizgi veya Poligon) etrafında verilen mesafede (metre)
    /// tampon bölge (ST_Buffer) oluşturur ve içinde kalan hastaneleri (ST_DWithin) döner.
    /// </summary>
    Task<BufferAnalysisResultDto?> GetHospitalsInDrawingBufferAsync(int drawingId, double radiusMeters);

    /// <summary>
    /// Analiz 3C: Seçilen bir hastane objesi etrafında verilen mesafede (metre)
    /// tampon bölge (ST_Buffer) oluşturur ve bu bölgedeki hastaneleri (ST_DWithin) döner.
    /// </summary>
    Task<BufferAnalysisResultDto?> GetHospitalsInHospitalBufferAsync(int hospitalId, double radiusMeters);

    /// <summary>
    /// Analiz 4A: Kayıtlı bir kullanıcı çiziminin (Çizgi veya Poligon) uzunluk/alan/çevre değerlerini
    /// uygun metrik SRID (EPSG:5254 - TUREF / TM30) kullanarak hesaplar.
    /// </summary>
    Task<MeasurementResultDto?> MeasureUserDrawingAsync(int drawingId);

    /// <summary>
    /// Analiz 4B: Seçilen bir ilçenin yüzölçümü ve çevre uzunluğunu uygun metrik SRID (EPSG:5254) ile hesaplar.
    /// </summary>
    Task<MeasurementResultDto?> MeasureDistrictAsync(int districtId);

    /// <summary>
    /// Analiz 4C: Harita üzerinde anlık çizilen bir çizgi veya poligonun metrik ölçümünü (EPSG:5254) hesaplar.
    /// </summary>
    Task<MeasurementResultDto> MeasureCustomGeometryAsync(Geometry geometry, string? name = null);

    /// <summary>
    /// Analiz 5: Mekânsal Birleştirme (Spatial Join - LEFT JOIN ... ON ST_Intersects) ile
    /// her ilçe poligonu içine düşen hastane sayısını, acil servis sayısını ve metrik alan yoğunluğunu (EPSG:5254)
    /// hesaplayarak hem tablo hem de tematik (choropleth) harita verisi üretir.
    /// </summary>
    Task<SpatialJoinSummaryResultDto> GetDistrictHospitalSpatialJoinAsync();
}

