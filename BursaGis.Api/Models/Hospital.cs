using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using NetTopologySuite.Geometries;

namespace BursaGis.Api.Models;

[Table("hospitals")]
public class Hospital
{
    [Key]
    [Column("ogc_fid")]
    public int Id { get; set; }

    [Column("name")]
    public string? Name { get; set; }

    [Column("amenity")]
    public string? Amenity { get; set; }

    [Column("addr:district")]
    public string? District { get; set; }

    [Column("addr:street")]
    public string? Street { get; set; }

    [Column("phone")]
    public string? Phone { get; set; }

    [Column("website")]
    public string? Website { get; set; }

    [Column("emergency")]
    public string? Emergency { get; set; }

    [Column("operator")]
    public string? Operator { get; set; }

    [Column("operator:type")]
    public string? OperatorType { get; set; }

    [Column("addr:neighbourhood")]
    public string? Neighbourhood { get; set; }

    [Column("addr:postcode")]
    public string? Postcode { get; set; }

    [Column("healthcare:speciality")]
    public string? Speciality { get; set; }

    [Column("wheelchair")]
    public string? Wheelchair { get; set; }

    [Column("geom", TypeName = "geometry(Point, 4326)")]
    public Point Geom { get; set; } = null!;
}
