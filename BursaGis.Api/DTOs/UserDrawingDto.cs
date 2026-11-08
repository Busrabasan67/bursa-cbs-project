using NetTopologySuite.Geometries;

namespace BursaGis.Api.DTOs;

public class CreateUserDrawingDto
{
    public string Name { get; set; } = "Yeni Çizim";
    public string? Description { get; set; }
    public Geometry Geometry { get; set; } = null!;
}

public class UpdateUserDrawingDto
{
    public string? Name { get; set; }
    public string? Description { get; set; }
    public Geometry? Geometry { get; set; }
}
