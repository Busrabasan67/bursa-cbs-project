using NetTopologySuite.Geometries;

namespace BursaGis.Api.DTOs;

public class CustomPolygonAnalysisRequestDto
{
    public string? Name { get; set; }
    public Geometry? Geometry { get; set; }
}

public class HospitalInPolygonDto
{
    public int Rank { get; set; }
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? District { get; set; }
    public string? Street { get; set; }
    public string? Phone { get; set; }
    public string? Website { get; set; }
    public string? Emergency { get; set; }
    public string? OperatorName { get; set; }
    public string? OperatorType { get; set; }
    public string? Neighbourhood { get; set; }
    public string? Postcode { get; set; }
    public string? Speciality { get; set; }
    public string? Wheelchair { get; set; }
    public bool IsStrictlyWithin { get; set; }
    public Point Geometry { get; set; } = null!;
}

public class PolygonAnalysisResultDto
{
    public string PolygonName { get; set; } = string.Empty;
    public string SourceType { get; set; } = string.Empty;
    public double AreaSquareMeters { get; set; }
    public double AreaSquareKilometers { get; set; }
    public string AreaFormatted { get; set; } = string.Empty;
    public int TotalHospitalsCount { get; set; }
    public int EmergencyHospitalsCount { get; set; }
    public Geometry PolygonGeometry { get; set; } = null!;
    public List<HospitalInPolygonDto> Hospitals { get; set; } = new();
}
