using NetTopologySuite.Geometries;

namespace BursaGis.Api.DTOs;

public class BufferAnalysisResultDto
{
    public string SourceName { get; set; } = string.Empty;
    public string SourceType { get; set; } = string.Empty; // "point" | "drawing"
    public double RadiusMeters { get; set; }
    public double BufferAreaSquareKilometers { get; set; }
    public string BufferAreaFormatted { get; set; } = string.Empty;
    public int TotalHospitalsCount { get; set; }
    public int EmergencyHospitalsCount { get; set; }
    public Geometry SourceGeometry { get; set; } = null!;
    public Geometry BufferPolygonGeometry { get; set; } = null!;
    public List<NearestHospitalResultDto> Hospitals { get; set; } = new();
}
