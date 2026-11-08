using System.Data;
using BursaGis.Api.Data;
using BursaGis.Api.DTOs;
using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using NetTopologySuite.IO;
using Npgsql;

namespace BursaGis.Api.Services;

public class SpatialAnalysisService : ISpatialAnalysisService
{
    private readonly AppDbContext _context;

    public SpatialAnalysisService(AppDbContext context)
    {
        _context = context;
    }

    public async Task<List<NearestHospitalResultDto>> GetNearestHospitalsAsync(double lat, double lng, int count)
    {
        var results = new List<NearestHospitalResultDto>();

        const string sql = @"
            SELECT 
                h.ogc_fid AS id,
                COALESCE(h.name, 'İsimsiz Sağlık Tesisi') AS name,
                h.""addr:district"" AS district,
                h.""addr:street"" AS street,
                h.phone,
                h.website,
                h.emergency,
                ST_X(h.geom) AS hosp_lng,
                ST_Y(h.geom) AS hosp_lat,
                ST_Distance(
                    h.geom::geography,
                    ST_SetSRID(ST_MakePoint(@lng, @lat), 4326)::geography
                ) AS distance_meters,
                h.operator,
                h.""operator:type"",
                h.""addr:neighbourhood"",
                h.""addr:postcode"",
                h.""healthcare:speciality"",
                h.wheelchair
            FROM hospitals h
            WHERE h.geom IS NOT NULL
            ORDER BY h.geom::geography <-> ST_SetSRID(ST_MakePoint(@lng, @lat), 4326)::geography
            LIMIT @count;";

        var conn = _context.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
        {
            await conn.OpenAsync();
        }

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.Add(new NpgsqlParameter("@lng", lng));
        cmd.Parameters.Add(new NpgsqlParameter("@lat", lat));
        cmd.Parameters.Add(new NpgsqlParameter("@count", count));

        await using var reader = await cmd.ExecuteReaderAsync();
        int rank = 1;
        while (await reader.ReadAsync())
        {
            var id = reader.GetInt32(0);
            var name = reader.GetString(1);
            var district = reader.IsDBNull(2) ? null : reader.GetString(2);
            var street = reader.IsDBNull(3) ? null : reader.GetString(3);
            var phone = reader.IsDBNull(4) ? null : reader.GetString(4);
            var website = reader.IsDBNull(5) ? null : reader.GetString(5);
            var emergency = reader.IsDBNull(6) ? null : reader.GetString(6);
            var hospLng = reader.GetDouble(7);
            var hospLat = reader.GetDouble(8);
            var distanceMeters = Math.Round(reader.GetDouble(9), 1);
            var operatorName = reader.IsDBNull(10) ? null : reader.GetString(10);
            var operatorType = reader.IsDBNull(11) ? null : reader.GetString(11);
            var neighbourhood = reader.IsDBNull(12) ? null : reader.GetString(12);
            var postcode = reader.IsDBNull(13) ? null : reader.GetString(13);
            var speciality = reader.IsDBNull(14) ? null : reader.GetString(14);
            var wheelchair = reader.IsDBNull(15) ? null : reader.GetString(15);

            var distanceFormatted = distanceMeters >= 1000
                ? $"{(distanceMeters / 1000.0):F2} km"
                : $"{Math.Round(distanceMeters)} m";

            results.Add(new NearestHospitalResultDto
            {
                Rank = rank++,
                Id = id,
                Name = name,
                District = district,
                Street = street,
                Phone = phone,
                Website = website,
                Emergency = emergency,
                OperatorName = operatorName,
                OperatorType = operatorType,
                Neighbourhood = neighbourhood,
                Postcode = postcode,
                Speciality = speciality,
                Wheelchair = wheelchair,
                DistanceMeters = distanceMeters,
                DistanceFormatted = distanceFormatted,
                Geometry = new Point(hospLng, hospLat) { SRID = 4326 }
            });
        }

        return results;
    }

    public async Task<PolygonAnalysisResultDto?> GetHospitalsInDistrictAsync(int districtId)
    {
        var district = await _context.Districts
            .AsNoTracking()
            .FirstOrDefaultAsync(d => d.Id == districtId);

        if (district == null || district.Geom == null)
            return null;

        return await ExecutePolygonAnalysisAsync(
            district.Geom,
            $"{district.Name ?? "Bursa"} İlçesi",
            "district");
    }

    public async Task<PolygonAnalysisResultDto?> GetHospitalsInUserDrawingAsync(int drawingId)
    {
        var drawing = await _context.UserDrawings
            .AsNoTracking()
            .FirstOrDefaultAsync(d => d.Id == drawingId);

        if (drawing == null || drawing.Geom == null)
            return null;

        if (drawing.Geom is not Polygon && drawing.Geom is not MultiPolygon)
            return null;

        return await ExecutePolygonAnalysisAsync(
            drawing.Geom,
            drawing.Name ?? "Kayıtlı Alan",
            "drawing");
    }

    public async Task<PolygonAnalysisResultDto> GetHospitalsInCustomPolygonAsync(Geometry polygon, string? name = null)
    {
        polygon.SRID = 4326;
        return await ExecutePolygonAnalysisAsync(
            polygon,
            string.IsNullOrWhiteSpace(name) ? "Çizilen Özel Alan" : name.Trim(),
            "custom");
    }

    public async Task<BufferAnalysisResultDto> GetHospitalsInPointBufferAsync(double lat, double lng, double radiusMeters)
    {
        var point = new Point(lng, lat) { SRID = 4326 };
        return await ExecuteBufferAnalysisAsync(
            point,
            $"Seçilen Nokta ({Math.Round(radiusMeters)} m)",
            "point",
            radiusMeters);
    }

    public async Task<BufferAnalysisResultDto?> GetHospitalsInDrawingBufferAsync(int drawingId, double radiusMeters)
    {
        var drawing = await _context.UserDrawings
            .AsNoTracking()
            .FirstOrDefaultAsync(d => d.Id == drawingId);

        if (drawing == null || drawing.Geom == null)
            return null;

        return await ExecuteBufferAnalysisAsync(
            drawing.Geom,
            $"{drawing.Name} ({Math.Round(radiusMeters)} m Tampon)",
            "drawing",
            radiusMeters);
    }

    public async Task<BufferAnalysisResultDto?> GetHospitalsInHospitalBufferAsync(int hospitalId, double radiusMeters)
    {
        var hospital = await _context.Hospitals
            .AsNoTracking()
            .FirstOrDefaultAsync(h => h.Id == hospitalId);

        if (hospital == null || hospital.Geom == null)
            return null;

        return await ExecuteBufferAnalysisAsync(
            hospital.Geom,
            $"{hospital.Name ?? "Seçilen Hastane"} ({Math.Round(radiusMeters)} m Tampon)",
            "hospital",
            radiusMeters);
    }

    private async Task<PolygonAnalysisResultDto> ExecutePolygonAnalysisAsync(
        Geometry polygon,
        string polygonName,
        string sourceType)
    {
        polygon.SRID = 4326;
        var wkt = polygon.AsText();

        var conn = _context.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
        {
            await conn.OpenAsync();
        }

        double areaSqMeters = 0;
        await using (var areaCmd = conn.CreateCommand())
        {
            areaCmd.CommandText = "SELECT ST_Area(ST_GeomFromText(@wkt, 4326)::geography);";
            areaCmd.Parameters.Add(new NpgsqlParameter("@wkt", wkt));
            var scalar = await areaCmd.ExecuteScalarAsync();
            if (scalar != null && scalar != DBNull.Value)
            {
                areaSqMeters = Convert.ToDouble(scalar);
            }
        }

        const string hospitalsSql = @"
            SELECT 
                h.ogc_fid AS id,
                COALESCE(h.name, 'İsimsiz Sağlık Tesisi') AS name,
                h.""addr:district"" AS district,
                h.""addr:street"" AS street,
                h.phone,
                h.website,
                h.emergency,
                ST_X(h.geom) AS hosp_lng,
                ST_Y(h.geom) AS hosp_lat,
                ST_Within(h.geom, ST_GeomFromText(@wkt, 4326)) AS is_within,
                h.operator,
                h.""operator:type"",
                h.""addr:neighbourhood"",
                h.""addr:postcode"",
                h.""healthcare:speciality"",
                h.wheelchair
            FROM hospitals h
            WHERE h.geom IS NOT NULL
              AND (
                  ST_Within(h.geom, ST_GeomFromText(@wkt, 4326))
                  OR ST_Intersects(h.geom, ST_GeomFromText(@wkt, 4326))
              )
            ORDER BY COALESCE(h.name, '') ASC;";

        var hospitals = new List<HospitalInPolygonDto>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = hospitalsSql;
            cmd.Parameters.Add(new NpgsqlParameter("@wkt", wkt));

            await using var reader = await cmd.ExecuteReaderAsync();
            int rank = 1;
            while (await reader.ReadAsync())
            {
                var id = reader.GetInt32(0);
                var name = reader.GetString(1);
                var district = reader.IsDBNull(2) ? null : reader.GetString(2);
                var street = reader.IsDBNull(3) ? null : reader.GetString(3);
                var phone = reader.IsDBNull(4) ? null : reader.GetString(4);
                var website = reader.IsDBNull(5) ? null : reader.GetString(5);
                var emergency = reader.IsDBNull(6) ? null : reader.GetString(6);
                var hospLng = reader.GetDouble(7);
                var hospLat = reader.GetDouble(8);
                var isWithin = !reader.IsDBNull(9) && reader.GetBoolean(9);
                var operatorName = reader.IsDBNull(10) ? null : reader.GetString(10);
                var operatorType = reader.IsDBNull(11) ? null : reader.GetString(11);
                var neighbourhood = reader.IsDBNull(12) ? null : reader.GetString(12);
                var postcode = reader.IsDBNull(13) ? null : reader.GetString(13);
                var speciality = reader.IsDBNull(14) ? null : reader.GetString(14);
                var wheelchair = reader.IsDBNull(15) ? null : reader.GetString(15);

                hospitals.Add(new HospitalInPolygonDto
                {
                    Rank = rank++,
                    Id = id,
                    Name = name,
                    District = district,
                    Street = street,
                    Phone = phone,
                    Website = website,
                    Emergency = emergency,
                    OperatorName = operatorName,
                    OperatorType = operatorType,
                    Neighbourhood = neighbourhood,
                    Postcode = postcode,
                    Speciality = speciality,
                    Wheelchair = wheelchair,
                    IsStrictlyWithin = isWithin,
                    Geometry = new Point(hospLng, hospLat) { SRID = 4326 }
                });
            }
        }

        var areaSqKm = Math.Round(areaSqMeters / 1_000_000.0, 2);
        var areaFormatted = areaSqMeters >= 1_000_000
            ? $"{areaSqKm:F2} km²"
            : $"{Math.Round(areaSqMeters):N0} m²";

        return new PolygonAnalysisResultDto
        {
            PolygonName = polygonName,
            SourceType = sourceType,
            AreaSquareMeters = Math.Round(areaSqMeters, 1),
            AreaSquareKilometers = areaSqKm,
            AreaFormatted = areaFormatted,
            TotalHospitalsCount = hospitals.Count,
            EmergencyHospitalsCount = hospitals.Count(h => h.Emergency == "yes"),
            PolygonGeometry = polygon,
            Hospitals = hospitals
        };
    }

    private async Task<BufferAnalysisResultDto> ExecuteBufferAnalysisAsync(
        Geometry sourceGeom,
        string sourceName,
        string sourceType,
        double radiusMeters)
    {
        sourceGeom.SRID = 4326;
        var wkt = sourceGeom.AsText();

        var conn = _context.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
        {
            await conn.OpenAsync();
        }

        // 1. PostGIS ST_Buffer(geom::geography, @radius)::geometry ile Dünya elipsoidi üzerinde
        // gerçek METRE birimli tampon poligonunu ve tampon alanın yüzölçümünü (ST_Area) üret
        Geometry bufferPolygon = sourceGeom;
        double bufferAreaSqMeters = 0;

        const string bufferSql = @"
            SELECT 
                ST_AsText(ST_Buffer(ST_GeomFromText(@wkt, 4326)::geography, @radius)::geometry) AS buffer_wkt,
                ST_Area(ST_Buffer(ST_GeomFromText(@wkt, 4326)::geography, @radius)) AS area_sqm;";

        await using (var bufCmd = conn.CreateCommand())
        {
            bufCmd.CommandText = bufferSql;
            bufCmd.Parameters.Add(new NpgsqlParameter("@wkt", wkt));
            bufCmd.Parameters.Add(new NpgsqlParameter("@radius", radiusMeters));

            await using var bufReader = await bufCmd.ExecuteReaderAsync();
            if (await bufReader.ReadAsync())
            {
                var bufferWkt = bufReader.GetString(0);
                bufferAreaSqMeters = bufReader.IsDBNull(1) ? 0 : bufReader.GetDouble(1);

                var wktReader = new WKTReader();
                bufferPolygon = wktReader.Read(bufferWkt);
                bufferPolygon.SRID = 4326;
            }
        }

        // 2. ST_DWithin(h.geom::geography, target::geography, @radius) ile GiST uzamsal indeksini
        // kullanarak tampon mesafe içinde kalan hastaneleri ve gerçek mesafelerini (ST_Distance) bul
        const string hospitalsSql = @"
            SELECT 
                h.ogc_fid AS id,
                COALESCE(h.name, 'İsimsiz Sağlık Tesisi') AS name,
                h.""addr:district"" AS district,
                h.""addr:street"" AS street,
                h.phone,
                h.website,
                h.emergency,
                ST_X(h.geom) AS hosp_lng,
                ST_Y(h.geom) AS hosp_lat,
                ST_Distance(
                    h.geom::geography,
                    ST_GeomFromText(@wkt, 4326)::geography
                ) AS distance_meters,
                h.operator,
                h.""operator:type"",
                h.""addr:neighbourhood"",
                h.""addr:postcode"",
                h.""healthcare:speciality"",
                h.wheelchair
            FROM hospitals h
            WHERE h.geom IS NOT NULL
              AND ST_DWithin(
                  h.geom::geography,
                  ST_GeomFromText(@wkt, 4326)::geography,
                  @radius
              )
            ORDER BY distance_meters ASC;";

        var hospitals = new List<NearestHospitalResultDto>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = hospitalsSql;
            cmd.Parameters.Add(new NpgsqlParameter("@wkt", wkt));
            cmd.Parameters.Add(new NpgsqlParameter("@radius", radiusMeters));

            await using var reader = await cmd.ExecuteReaderAsync();
            int rank = 1;
            while (await reader.ReadAsync())
            {
                var id = reader.GetInt32(0);
                var name = reader.GetString(1);
                var district = reader.IsDBNull(2) ? null : reader.GetString(2);
                var street = reader.IsDBNull(3) ? null : reader.GetString(3);
                var phone = reader.IsDBNull(4) ? null : reader.GetString(4);
                var website = reader.IsDBNull(5) ? null : reader.GetString(5);
                var emergency = reader.IsDBNull(6) ? null : reader.GetString(6);
                var hospLng = reader.GetDouble(7);
                var hospLat = reader.GetDouble(8);
                var distanceMeters = Math.Round(reader.GetDouble(9), 1);
                var operatorName = reader.IsDBNull(10) ? null : reader.GetString(10);
                var operatorType = reader.IsDBNull(11) ? null : reader.GetString(11);
                var neighbourhood = reader.IsDBNull(12) ? null : reader.GetString(12);
                var postcode = reader.IsDBNull(13) ? null : reader.GetString(13);
                var speciality = reader.IsDBNull(14) ? null : reader.GetString(14);
                var wheelchair = reader.IsDBNull(15) ? null : reader.GetString(15);

                var distanceFormatted = distanceMeters >= 1000
                    ? $"{(distanceMeters / 1000.0):F2} km"
                    : $"{Math.Round(distanceMeters)} m";

                hospitals.Add(new NearestHospitalResultDto
                {
                    Rank = rank++,
                    Id = id,
                    Name = name,
                    District = district,
                    Street = street,
                    Phone = phone,
                    Website = website,
                    Emergency = emergency,
                    OperatorName = operatorName,
                    OperatorType = operatorType,
                    Neighbourhood = neighbourhood,
                    Postcode = postcode,
                    Speciality = speciality,
                    Wheelchair = wheelchair,
                    DistanceMeters = distanceMeters,
                    DistanceFormatted = distanceFormatted,
                    Geometry = new Point(hospLng, hospLat) { SRID = 4326 }
                });
            }
        }

        var areaSqKm = Math.Round(bufferAreaSqMeters / 1_000_000.0, 2);
        var areaFormatted = bufferAreaSqMeters >= 1_000_000
            ? $"{areaSqKm:F2} km²"
            : $"{Math.Round(bufferAreaSqMeters):N0} m²";

        return new BufferAnalysisResultDto
        {
            SourceName = sourceName,
            SourceType = sourceType,
            RadiusMeters = radiusMeters,
            BufferAreaSquareKilometers = areaSqKm,
            BufferAreaFormatted = areaFormatted,
            TotalHospitalsCount = hospitals.Count,
            EmergencyHospitalsCount = hospitals.Count(h => h.Emergency == "yes"),
            SourceGeometry = sourceGeom,
            BufferPolygonGeometry = bufferPolygon,
            Hospitals = hospitals
        };
    }

    public async Task<MeasurementResultDto?> MeasureUserDrawingAsync(int drawingId)
    {
        var drawing = await _context.UserDrawings
            .AsNoTracking()
            .FirstOrDefaultAsync(d => d.Id == drawingId);

        if (drawing == null || drawing.Geom == null)
            return null;

        return await ExecuteMeasurementAsync(drawing.Geom, drawing.Name ?? "Kayıtlı Çizim", "drawing");
    }

    public async Task<MeasurementResultDto?> MeasureDistrictAsync(int districtId)
    {
        var district = await _context.Districts
            .AsNoTracking()
            .FirstOrDefaultAsync(d => d.Id == districtId);

        if (district == null || district.Geom == null)
            return null;

        return await ExecuteMeasurementAsync(district.Geom, $"{district.Name} İlçesi", "district");
    }

    public async Task<MeasurementResultDto> MeasureCustomGeometryAsync(Geometry geometry, string? name = null)
    {
        geometry.SRID = 4326;
        var defaultName = geometry is Polygon || geometry is MultiPolygon
            ? "Ölçülen Alan"
            : "Ölçülen Mesafe Hattı";

        return await ExecuteMeasurementAsync(
            geometry,
            string.IsNullOrWhiteSpace(name) ? defaultName : name.Trim(),
            "custom");
    }

    private async Task<MeasurementResultDto> ExecuteMeasurementAsync(
        Geometry geom,
        string name,
        string sourceType)
    {
        geom.SRID = 4326;
        var wkt = geom.AsText();

        var conn = _context.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
        {
            await conn.OpenAsync();
        }

        // SRID 4326 (Derece) verisini Bursa için uygun resmi metrik projeksiyon olan
        // EPSG:5254 (TUREF / TM30 - Metre) koordinat sistemine ST_Transform ile dönüştürerek
        // gerçek düzlemsel metrik uzunluk (ST_Length), alan (ST_Area) ve çevre (ST_Perimeter) hesaplar.
        const string sql = @"
            WITH src AS (
                SELECT ST_GeomFromText(@wkt, 4326) AS geom_4326
            ),
            metric AS (
                SELECT 
                    geom_4326,
                    ST_Transform(geom_4326, 5254) AS geom_5254
                FROM src
            )
            SELECT 
                ST_Length(geom_5254) AS length_5254_m,
                ST_Area(geom_5254) AS area_5254_m2,
                ST_Perimeter(geom_5254) AS perimeter_5254_m,
                ST_Length(geom_4326::geography) AS length_geog_m,
                ST_Area(geom_4326::geography) AS area_geog_m2,
                ST_NPoints(geom_4326) AS vertex_count
            FROM metric;";

        double lengthMeters = 0;
        double areaSqMeters = 0;
        double perimeterMeters = 0;
        double geogLength = 0;
        double geogArea = 0;
        int vertexCount = 0;

        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = sql;
            cmd.Parameters.Add(new NpgsqlParameter("@wkt", wkt));

            await using var reader = await cmd.ExecuteReaderAsync();
            if (await reader.ReadAsync())
            {
                lengthMeters = reader.IsDBNull(0) ? 0 : reader.GetDouble(0);
                areaSqMeters = reader.IsDBNull(1) ? 0 : reader.GetDouble(1);
                perimeterMeters = reader.IsDBNull(2) ? 0 : reader.GetDouble(2);
                geogLength = reader.IsDBNull(3) ? 0 : reader.GetDouble(3);
                geogArea = reader.IsDBNull(4) ? 0 : reader.GetDouble(4);
                vertexCount = reader.IsDBNull(5) ? 0 : reader.GetInt32(5);
            }
        }

        var isPolygon = geom is Polygon || geom is MultiPolygon;
        var lengthKm = Math.Round(lengthMeters / 1000.0, 2);
        var lengthFormatted = isPolygon
            ? string.Empty
            : lengthMeters >= 1000
                ? $"{lengthKm:F2} km ({Math.Round(lengthMeters):N0} m)"
                : $"{Math.Round(lengthMeters, 1)} m";

        var areaHectares = Math.Round(areaSqMeters / 10_000.0, 2);
        var areaSqKm = Math.Round(areaSqMeters / 1_000_000.0, 2);
        var areaFormatted = !isPolygon
            ? string.Empty
            : areaSqMeters >= 1_000_000
                ? $"{areaSqKm:F2} km² ({areaHectares:N1} ha)"
                : areaSqMeters >= 10_000
                    ? $"{areaHectares:F2} ha ({Math.Round(areaSqMeters):N0} m²)"
                    : $"{Math.Round(areaSqMeters, 1):N1} m²";

        var perimeterFormatted = !isPolygon
            ? string.Empty
            : perimeterMeters >= 1000
                ? $"{(perimeterMeters / 1000.0):F2} km"
                : $"{Math.Round(perimeterMeters, 1)} m";

        return new MeasurementResultDto
        {
            Name = name,
            SourceType = sourceType,
            GeometryType = geom.GeometryType,
            SourceSrid = 4326,
            MetricSrid = 5254,
            MetricSridName = "TUREF / TM30 (EPSG:5254)",
            LengthMeters = Math.Round(lengthMeters, 2),
            LengthKilometers = lengthKm,
            LengthFormatted = lengthFormatted,
            AreaSquareMeters = Math.Round(areaSqMeters, 2),
            AreaHectares = areaHectares,
            AreaSquareKilometers = areaSqKm,
            AreaFormatted = areaFormatted,
            PerimeterMeters = Math.Round(perimeterMeters, 2),
            PerimeterFormatted = perimeterFormatted,
            GeographyLengthOrArea = Math.Round(isPolygon ? geogArea : geogLength, 2),
            VertexCount = vertexCount,
            Geometry = geom
        };
    }

    // -------------------------------------------------------------------------
    // ANALİZ 5: MEKÂNSAL BİRLEŞTİRME (SPATIAL JOIN & CHOROPLETH HARİTA)
    // -------------------------------------------------------------------------
    public async Task<SpatialJoinSummaryResultDto> GetDistrictHospitalSpatialJoinAsync()
    {
        var conn = _context.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
        {
            await conn.OpenAsync();
        }

        // Metinsel ilçe adı eşleştirmesi yerine gerçek topolojik Mekânsal Birleştirme
        // (LEFT JOIN hospitals h ON ST_Intersects(d.geom, h.geom)) kullanılır.
        // Hiç hastanesi olmayan ilçelerin de 0 değeriyle gelmesi için LEFT JOIN tercih edilmiştir.
        // İlçelerin metrik yüzölçümü EPSG:5254 (TUREF / TM30) ile km² cinsinden hesaplanır.
        const string sql = @"
            SELECT 
                d.ogc_fid,
                d.name,
                COUNT(h.ogc_fid)::int AS hospital_count,
                COUNT(h.ogc_fid) FILTER (WHERE h.emergency = 'yes')::int AS emergency_count,
                (ST_Area(ST_Transform(d.geom, 5254)) / 1000000.0) AS area_km2,
                ST_AsText(d.geom) AS geom_wkt
            FROM districts d
            LEFT JOIN hospitals h ON ST_Intersects(d.geom, h.geom)
            GROUP BY d.ogc_fid, d.name, d.geom
            ORDER BY hospital_count DESC, d.name ASC;";

        var wktReader = new WKTReader();
        var items = new List<DistrictSpatialJoinItemDto>();
        int rank = 1;

        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = sql;
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                var id = reader.GetInt32(0);
                var name = reader.IsDBNull(1) ? "Bilinmeyen İlçe" : reader.GetString(1);
                var hospCount = reader.IsDBNull(2) ? 0 : reader.GetInt32(2);
                var emergCount = reader.IsDBNull(3) ? 0 : reader.GetInt32(3);
                var areaKm2 = reader.IsDBNull(4) ? 0 : reader.GetDouble(4);
                var wkt = reader.IsDBNull(5) ? null : reader.GetString(5);

                Geometry? geom = null;
                if (!string.IsNullOrEmpty(wkt))
                {
                    geom = wktReader.Read(wkt);
                    geom.SRID = 4326;
                }

                var densityPer100Km2 = areaKm2 > 0
                    ? Math.Round((hospCount / areaKm2) * 100.0, 2)
                    : 0;

                var (category, color) = GetChoroplethClass(hospCount);

                items.Add(new DistrictSpatialJoinItemDto
                {
                    Rank = rank++,
                    DistrictId = id,
                    DistrictName = name,
                    HospitalCount = hospCount,
                    EmergencyHospitalCount = emergCount,
                    AreaSquareKilometers = Math.Round(areaKm2, 2),
                    HospitalsPer100SqKm = densityPer100Km2,
                    DensityCategory = category,
                    FillColor = color,
                    Geometry = geom
                });
            }
        }

        return new SpatialJoinSummaryResultDto
        {
            TotalDistrictsCount = items.Count,
            TotalHospitalsJoined = items.Sum(x => x.HospitalCount),
            TotalEmergencyHospitalsJoined = items.Sum(x => x.EmergencyHospitalCount),
            MaxHospitalsInDistrict = items.Count > 0 ? items.Max(x => x.HospitalCount) : 0,
            Districts = items
        };
    }

    private static (string Category, string FillColor) GetChoroplethClass(int count)
    {
        if (count == 0) return ("Yok (0)", "#e2e8f0");
        if (count <= 2) return ("Düşük (1-2)", "#fde68a");
        if (count <= 5) return ("Orta (3-5)", "#fb923c");
        if (count <= 9) return ("Yüksek (6-9)", "#ef4444");
        return ("Çok Yüksek (10+)", "#991b1b");
    }
}


