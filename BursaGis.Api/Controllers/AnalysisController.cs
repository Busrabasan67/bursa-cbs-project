using BursaGis.Api.DTOs;
using BursaGis.Api.Services;
using Microsoft.AspNetCore.Mvc;
using NetTopologySuite.Geometries;

namespace BursaGis.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AnalysisController : ControllerBase
{
    private readonly ISpatialAnalysisService _analysisService;

    public AnalysisController(ISpatialAnalysisService analysisService)
    {
        _analysisService = analysisService;
    }

    /// <summary>
    /// Analiz 1: Haritada tıklanan noktaya (lat, lng) en yakın N hastaneyi PostGIS KNN (<->)
    /// ve ST_Distance (geography - metre) kullanarak döner.
    /// Örn: GET /api/analysis/nearest-hospitals?lat=40.188&lng=29.061&count=5
    /// </summary>
    [HttpGet("nearest-hospitals")]
    public async Task<IActionResult> GetNearestHospitals(
        [FromQuery] double lat,
        [FromQuery] double lng,
        [FromQuery] int count = 5)
    {
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180)
            return BadRequest("Geçersiz koordinat değerleri (lat: -90..90, lng: -180..180).");

        if (count < 1 || count > 50)
            count = Math.Clamp(count, 1, 50);

        var nearestList = await _analysisService.GetNearestHospitalsAsync(lat, lng, count);

        var hospitalsGeoJson = new
        {
            type = "FeatureCollection",
            features = nearestList.Select(h => new
            {
                type = "Feature",
                id = h.Id,
                geometry = h.Geometry,
                properties = new
                {
                    id = h.Id,
                    rank = h.Rank,
                    name = h.Name,
                    district = h.District,
                    street = h.Street,
                    phone = h.Phone,
                    website = h.Website,
                    emergency = h.Emergency,
                    operatorName = h.OperatorName,
                    operatorType = h.OperatorType,
                    neighbourhood = h.Neighbourhood,
                    postcode = h.Postcode,
                    speciality = h.Speciality,
                    wheelchair = h.Wheelchair,
                    distanceMeters = h.DistanceMeters,
                    distanceFormatted = h.DistanceFormatted,
                    label = $"{h.Rank}. {h.Name} ({h.DistanceFormatted})"
                }
            })
        };

        var linesGeoJson = new
        {
            type = "FeatureCollection",
            features = nearestList.Select(h => new
            {
                type = "Feature",
                geometry = new LineString(new[]
                {
                    new Coordinate(lng, lat),
                    new Coordinate(h.Geometry.X, h.Geometry.Y)
                }) { SRID = 4326 },
                properties = new
                {
                    rank = h.Rank,
                    hospitalName = h.Name,
                    distanceMeters = h.DistanceMeters,
                    distanceFormatted = h.DistanceFormatted
                }
            })
        };

        return Ok(new
        {
            origin = new { lat, lng },
            count = nearestList.Count,
            results = nearestList,
            hospitalsGeoJson,
            linesGeoJson
        });
    }

    /// <summary>
    /// Analiz 2A: Seçilen bir ilçenin (poligonun) sınırları içinde kalan hastaneleri
    /// PostGIS ST_Within / ST_Intersects ve ST_Area(geography) kullanarak döner.
    /// Örn: GET /api/analysis/in-polygon/district/13
    /// </summary>
    [HttpGet("in-polygon/district/{districtId:int}")]
    public async Task<IActionResult> GetHospitalsInDistrict(int districtId)
    {
        var result = await _analysisService.GetHospitalsInDistrictAsync(districtId);
        if (result == null)
            return NotFound("Seçilen ilçe bulunamadı.");

        return Ok(FormatPolygonAnalysisResponse(result));
    }

    /// <summary>
    /// Analiz 2B: Kullanıcının daha önce çizip kaydettiği bir poligonun içinde kalan hastaneleri döner.
    /// Örn: GET /api/analysis/in-polygon/drawing/5
    /// </summary>
    [HttpGet("in-polygon/drawing/{drawingId:int}")]
    public async Task<IActionResult> GetHospitalsInUserDrawing(int drawingId)
    {
        var result = await _analysisService.GetHospitalsInUserDrawingAsync(drawingId);
        if (result == null)
            return NotFound("Seçilen poligon çizimi bulunamadı veya geometri tipi Poligon değil.");

        return Ok(FormatPolygonAnalysisResponse(result));
    }

    /// <summary>
    /// Analiz 2C: Kullanıcının harita üzerinde anlık çizdiği özel bir poligonun içinde kalan hastaneleri döner.
    /// POST /api/analysis/in-polygon/custom
    /// </summary>
    [HttpPost("in-polygon/custom")]
    public async Task<IActionResult> GetHospitalsInCustomPolygon([FromBody] CustomPolygonAnalysisRequestDto request)
    {
        if (request == null || request.Geometry == null)
            return BadRequest("Poligon geometrisi gönderilmelidir.");

        if (request.Geometry is not Polygon && request.Geometry is not MultiPolygon)
            return BadRequest("Alan analizi için yalnızca Polygon veya MultiPolygon geometrisi kabul edilir.");

        if (!request.Geometry.IsValid)
            return BadRequest("Topolojik olarak geçersiz poligon! Poligon kenarları kendi kendini kesemez (Self-Intersection).");

        var result = await _analysisService.GetHospitalsInCustomPolygonAsync(request.Geometry, request.Name);
        return Ok(FormatPolygonAnalysisResponse(result));
    }

    /// <summary>
    /// Analiz 3A: Haritada tıklanan bir nokta (lat, lng) etrafında verilen yarıçapta (metre)
    /// tampon alan (ST_Buffer geography) oluşturur ve içinde kalan hastaneleri (ST_DWithin) döner.
    /// Örn: GET /api/analysis/buffer/point?lat=40.188&lng=29.061&radiusMeters=1000
    /// </summary>
    [HttpGet("buffer/point")]
    public async Task<IActionResult> GetHospitalsInPointBuffer(
        [FromQuery] double lat,
        [FromQuery] double lng,
        [FromQuery] double radiusMeters = 1000)
    {
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180)
            return BadRequest("Geçersiz koordinat değerleri.");

        radiusMeters = Math.Clamp(radiusMeters, 50, 50000);

        var result = await _analysisService.GetHospitalsInPointBufferAsync(lat, lng, radiusMeters);
        return Ok(FormatBufferAnalysisResponse(result));
    }

    /// <summary>
    /// Analiz 3B: Kayıtlı bir kullanıcı çizimi (Point, LineString veya Polygon) etrafında verilen mesafede (metre)
    /// tampon alan (ST_Buffer geography) oluşturur ve içinde kalan hastaneleri (ST_DWithin) döner.
    /// Örn: GET /api/analysis/buffer/drawing/2?radiusMeters=500
    /// </summary>
    [HttpGet("buffer/drawing/{drawingId:int}")]
    public async Task<IActionResult> GetHospitalsInDrawingBuffer(
        int drawingId,
        [FromQuery] double radiusMeters = 1000)
    {
        radiusMeters = Math.Clamp(radiusMeters, 50, 50000);

        var result = await _analysisService.GetHospitalsInDrawingBufferAsync(drawingId, radiusMeters);
        if (result == null)
            return NotFound("Seçilen çizim bulunamadı.");

        return Ok(FormatBufferAnalysisResponse(result));
    }

    /// <summary>
    /// Analiz 3C: Seçilen bir hastane objesi etrafında verilen mesafede (metre)
    /// tampon alan (ST_Buffer geography) oluşturur ve içinde kalan hastaneleri (ST_DWithin) döner.
    /// Örn: GET /api/analysis/buffer/hospital/12?radiusMeters=1500
    /// </summary>
    [HttpGet("buffer/hospital/{hospitalId:int}")]
    public async Task<IActionResult> GetHospitalsInHospitalBuffer(
        int hospitalId,
        [FromQuery] double radiusMeters = 1000)
    {
        radiusMeters = Math.Clamp(radiusMeters, 50, 50000);

        var result = await _analysisService.GetHospitalsInHospitalBufferAsync(hospitalId, radiusMeters);
        if (result == null)
            return NotFound("Seçilen hastane bulunamadı.");

        return Ok(FormatBufferAnalysisResponse(result));
    }

    /// <summary>
    /// Analiz 4A: Kayıtlı bir kullanıcı çiziminin (Çizgi veya Poligon) metrik uzunluk/alan/çevre değerlerini
    /// uygun metrik SRID (EPSG:5254 - TUREF / TM30) kullanarak döner.
    /// Örn: GET /api/analysis/measure/drawing/3
    /// </summary>
    [HttpGet("measure/drawing/{drawingId:int}")]
    public async Task<IActionResult> MeasureUserDrawing(int drawingId)
    {
        var result = await _analysisService.MeasureUserDrawingAsync(drawingId);
        if (result == null)
            return NotFound("Seçilen çizim bulunamadı.");

        return Ok(FormatMeasurementResponse(result));
    }

    /// <summary>
    /// Analiz 4B: Seçilen bir ilçenin metrik yüzölçümü ve çevre uzunluğunu (EPSG:5254) döner.
    /// Örn: GET /api/analysis/measure/district/1
    /// </summary>
    [HttpGet("measure/district/{districtId:int}")]
    public async Task<IActionResult> MeasureDistrict(int districtId)
    {
        var result = await _analysisService.MeasureDistrictAsync(districtId);
        if (result == null)
            return NotFound("Seçilen ilçe bulunamadı.");

        return Ok(FormatMeasurementResponse(result));
    }

    /// <summary>
    /// Analiz 4C: Harita üzerinde anlık çizilen bir çizgi veya poligonun metrik ölçümünü (EPSG:5254) döner.
    /// POST /api/analysis/measure/custom
    /// </summary>
    [HttpPost("measure/custom")]
    public async Task<IActionResult> MeasureCustomGeometry([FromBody] CustomMeasurementRequestDto request)
    {
        if (request == null || request.Geometry == null)
            return BadRequest("Ölçülecek geometri gönderilmelidir.");

        if (!request.Geometry.IsValid)
            return BadRequest("Topolojik olarak geçersiz geometri! Poligon kenarları kendi kendini kesemez.");

        var result = await _analysisService.MeasureCustomGeometryAsync(request.Geometry, request.Name);
        return Ok(FormatMeasurementResponse(result));
    }

    /// <summary>
    /// Analiz 5: Mekânsal Birleştirme (Spatial Join - LEFT JOIN ... ON ST_Intersects) ile
    /// her ilçe poligonu içine düşen hastane sayısını hesaplar; hem tablo verisi hem de
    /// tematik (choropleth) harita GeoJSON FeatureCollection döner.
    /// Örn: GET /api/analysis/spatial-join/districts
    /// </summary>
    [HttpGet("spatial-join/districts")]
    public async Task<IActionResult> GetDistrictHospitalSpatialJoin()
    {
        var result = await _analysisService.GetDistrictHospitalSpatialJoinAsync();

        var choroplethGeoJson = new
        {
            type = "FeatureCollection",
            features = result.Districts.Select(d => new
            {
                type = "Feature",
                id = d.DistrictId,
                geometry = d.Geometry,
                properties = new
                {
                    id = d.DistrictId,
                    rank = d.Rank,
                    name = d.DistrictName,
                    hospitalCount = d.HospitalCount,
                    emergencyCount = d.EmergencyHospitalCount,
                    areaSqKm = d.AreaSquareKilometers,
                    hospitalsPer100SqKm = d.HospitalsPer100SqKm,
                    densityCategory = d.DensityCategory,
                    fillColor = d.FillColor
                }
            })
        };

        return Ok(new
        {
            totalDistrictsCount = result.TotalDistrictsCount,
            totalHospitalsJoined = result.TotalHospitalsJoined,
            totalEmergencyHospitalsJoined = result.TotalEmergencyHospitalsJoined,
            maxHospitalsInDistrict = result.MaxHospitalsInDistrict,
            results = result.Districts.Select(d => new
            {
                d.Rank,
                d.DistrictId,
                d.DistrictName,
                d.HospitalCount,
                d.EmergencyHospitalCount,
                d.AreaSquareKilometers,
                d.HospitalsPer100SqKm,
                d.DensityCategory,
                d.FillColor
            }),
            choroplethGeoJson
        });
    }

    private static object FormatMeasurementResponse(MeasurementResultDto result)
    {
        var isPolygon = result.GeometryType.Contains("Polygon", StringComparison.OrdinalIgnoreCase);

        var featureGeoJson = new
        {
            type = "FeatureCollection",
            features = new[]
            {
                new
                {
                    type = "Feature",
                    geometry = result.Geometry,
                    properties = new
                    {
                        name = result.Name,
                        geometryType = result.GeometryType,
                        metricSrid = result.MetricSrid,
                        metricSridName = result.MetricSridName,
                        distanceFormatted = isPolygon ? result.AreaFormatted : result.LengthFormatted
                    }
                }
            }
        };

        return new
        {
            name = result.Name,
            sourceType = result.SourceType,
            geometryType = result.GeometryType,
            sourceSrid = result.SourceSrid,
            metricSrid = result.MetricSrid,
            metricSridName = result.MetricSridName,
            lengthMeters = result.LengthMeters,
            lengthKilometers = result.LengthKilometers,
            lengthFormatted = result.LengthFormatted,
            areaSquareMeters = result.AreaSquareMeters,
            areaHectares = result.AreaHectares,
            areaSquareKilometers = result.AreaSquareKilometers,
            areaFormatted = result.AreaFormatted,
            perimeterMeters = result.PerimeterMeters,
            perimeterFormatted = result.PerimeterFormatted,
            geographyLengthOrArea = result.GeographyLengthOrArea,
            vertexCount = result.VertexCount,
            featureGeoJson
        };
    }

    private static object FormatPolygonAnalysisResponse(PolygonAnalysisResultDto result)
    {
        var polygonGeoJson = new
        {
            type = "FeatureCollection",
            features = new[]
            {
                new
                {
                    type = "Feature",
                    geometry = result.PolygonGeometry,
                    properties = new
                    {
                        name = result.PolygonName,
                        sourceType = result.SourceType,
                        areaFormatted = result.AreaFormatted,
                        hospitalCount = result.TotalHospitalsCount
                    }
                }
            }
        };

        var hospitalsGeoJson = new
        {
            type = "FeatureCollection",
            features = result.Hospitals.Select(h => new
            {
                type = "Feature",
                id = h.Id,
                geometry = h.Geometry,
                properties = new
                {
                    id = h.Id,
                    rank = h.Rank,
                    name = h.Name,
                    district = h.District,
                    street = h.Street,
                    phone = h.Phone,
                    website = h.Website,
                    emergency = h.Emergency,
                    operatorName = h.OperatorName,
                    operatorType = h.OperatorType,
                    neighbourhood = h.Neighbourhood,
                    postcode = h.Postcode,
                    speciality = h.Speciality,
                    wheelchair = h.Wheelchair,
                    isStrictlyWithin = h.IsStrictlyWithin
                }
            })
        };

        return new
        {
            polygonName = result.PolygonName,
            sourceType = result.SourceType,
            areaSquareMeters = result.AreaSquareMeters,
            areaSquareKilometers = result.AreaSquareKilometers,
            areaFormatted = result.AreaFormatted,
            count = result.TotalHospitalsCount,
            emergencyCount = result.EmergencyHospitalsCount,
            results = result.Hospitals,
            polygonGeoJson,
            hospitalsGeoJson
        };
    }

    private static object FormatBufferAnalysisResponse(BufferAnalysisResultDto result)
    {
        var bufferPolygonGeoJson = new
        {
            type = "FeatureCollection",
            features = new[]
            {
                new
                {
                    type = "Feature",
                    geometry = result.BufferPolygonGeometry,
                    properties = new
                    {
                        name = result.SourceName,
                        radiusMeters = result.RadiusMeters,
                        areaFormatted = result.BufferAreaFormatted,
                        hospitalCount = result.TotalHospitalsCount
                    }
                }
            }
        };

        var hospitalsGeoJson = new
        {
            type = "FeatureCollection",
            features = result.Hospitals.Select(h => new
            {
                type = "Feature",
                id = h.Id,
                geometry = h.Geometry,
                properties = new
                {
                    id = h.Id,
                    rank = h.Rank,
                    name = h.Name,
                    district = h.District,
                    street = h.Street,
                    phone = h.Phone,
                    website = h.Website,
                    emergency = h.Emergency,
                    operatorName = h.OperatorName,
                    operatorType = h.OperatorType,
                    neighbourhood = h.Neighbourhood,
                    postcode = h.Postcode,
                    speciality = h.Speciality,
                    wheelchair = h.Wheelchair,
                    distanceMeters = h.DistanceMeters,
                    distanceFormatted = h.DistanceFormatted
                }
            })
        };

        return new
        {
            sourceName = result.SourceName,
            sourceType = result.SourceType,
            radiusMeters = result.RadiusMeters,
            areaFormatted = result.BufferAreaFormatted,
            count = result.TotalHospitalsCount,
            emergencyCount = result.EmergencyHospitalsCount,
            results = result.Hospitals,
            polygonGeoJson = bufferPolygonGeoJson,
            hospitalsGeoJson
        };
    }
}

