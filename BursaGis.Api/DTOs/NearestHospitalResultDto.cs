using NetTopologySuite.Geometries;

namespace BursaGis.Api.DTOs;

public class NearestHospitalResultDto
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
    public double DistanceMeters { get; set; }
    public string DistanceFormatted { get; set; } = string.Empty;
    public Point Geometry { get; set; } = null!;
}
