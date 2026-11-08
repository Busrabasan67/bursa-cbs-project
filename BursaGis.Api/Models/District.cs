using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using NetTopologySuite.Geometries;

namespace BursaGis.Api.Models;

[Table("districts")]
public class District
{
    [Key]
    [Column("ogc_fid")]
    public int Id { get; set; }

    [Column("name")]
    public string? Name { get; set; }

    [Column("admin_level")]
    public string? AdminLevel { get; set; }

    [Column("geom", TypeName = "geometry(Geometry, 4326)")]
    public Geometry Geom { get; set; } = null!;
}
