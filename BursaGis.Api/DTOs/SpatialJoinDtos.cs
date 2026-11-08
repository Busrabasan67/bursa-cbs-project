using NetTopologySuite.Geometries;

namespace BursaGis.Api.DTOs;

public class DistrictSpatialJoinItemDto
{
    public int Rank { get; set; }
    public int DistrictId { get; set; }
    public string DistrictName { get; set; } = string.Empty;
    public int HospitalCount { get; set; }
    public int EmergencyHospitalCount { get; set; }
    public double AreaSquareKilometers { get; set; }
    public double HospitalsPer100SqKm { get; set; }
    public string DensityCategory { get; set; } = string.Empty;
    public string FillColor { get; set; } = "#fee2e2";
    public Geometry? Geometry { get; set; }
}

public class SpatialJoinSummaryResultDto
{
    public int TotalDistrictsCount { get; set; }
    public int TotalHospitalsJoined { get; set; }
    public int TotalEmergencyHospitalsJoined { get; set; }
    public int MaxHospitalsInDistrict { get; set; }
    public List<DistrictSpatialJoinItemDto> Districts { get; set; } = new();
}
