using NetTopologySuite.Geometries;

namespace BursaGis.Api.DTOs;

public class CustomMeasurementRequestDto
{
    public string? Name { get; set; }
    public Geometry? Geometry { get; set; }
}

public class MeasurementResultDto
{
    public string Name { get; set; } = string.Empty;
    public string SourceType { get; set; } = string.Empty; // "drawing" | "district" | "custom"
    public string GeometryType { get; set; } = string.Empty; // "LineString" | "Polygon" | "MultiPolygon" | "Point"
    public int SourceSrid { get; set; } = 4326;
    public int MetricSrid { get; set; } = 5254;
    public string MetricSridName { get; set; } = "TUREF / TM30 (EPSG:5254)";

    // Çizgi (LineString) ölçümleri
    public double LengthMeters { get; set; }
    public double LengthKilometers { get; set; }
    public string LengthFormatted { get; set; } = string.Empty;

    // Poligon (Polygon / MultiPolygon) ölçümleri
    public double AreaSquareMeters { get; set; }
    public double AreaHectares { get; set; }
    public double AreaSquareKilometers { get; set; }
    public string AreaFormatted { get; set; } = string.Empty;

    public double PerimeterMeters { get; set; }
    public string PerimeterFormatted { get; set; } = string.Empty;

    // Elipsoid (WGS84 Geography) karşılaştırma değerleri
    public double GeographyLengthOrArea { get; set; }
    public int VertexCount { get; set; }

    public Geometry Geometry { get; set; } = null!;
}
