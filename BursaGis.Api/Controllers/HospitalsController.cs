using BursaGis.Api.Data;
using BursaGis.Api.DTOs;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;

namespace BursaGis.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class HospitalsController : ControllerBase
{
    private readonly AppDbContext _context;

    public HospitalsController(AppDbContext context)
    {
        _context = context;
    }

    // GET /api/hospitals?search=devlet&district=Nilüfer&onlyEmergency=true&bbox=28.8,40.1,29.3,40.3&page=1&pageSize=20
    // Hem öznitelik filtreleme hem de büyük veri performansı için Bounding Box (bbox) ve Sayfalama (pagination) destekler
    [HttpGet]
    public async Task<IActionResult> GetAll(
        [FromQuery] string? search,
        [FromQuery] string? district,
        [FromQuery] bool? onlyEmergency,
        [FromQuery] string? bbox,
        [FromQuery] int? page,
        [FromQuery] int? pageSize)
    {
        var query = _context.Hospitals.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim().ToLower();
            query = query.Where(h => (h.Name != null && h.Name.ToLower().Contains(s)) ||
                                     (h.Street != null && h.Street.ToLower().Contains(s)));
        }

        if (!string.IsNullOrWhiteSpace(district))
        {
            var d = district.Trim().ToLower();
            query = query.Where(h => h.District != null && h.District.ToLower().Contains(d));
        }

        if (onlyEmergency == true)
        {
            query = query.Where(h => h.Emergency != null && h.Emergency.ToLower() == "yes");
        }

        // Performans Önlemi 1: Bounding Box (BBox) ile Mekânsal Filtreleme (GiST Index kullanır)
        // Format: bbox=minLng,minLat,maxLng,maxLat
        if (!string.IsNullOrWhiteSpace(bbox))
        {
            var parts = bbox.Split(',');
            if (parts.Length == 4 &&
                double.TryParse(parts[0], System.Globalization.CultureInfo.InvariantCulture, out var minLng) &&
                double.TryParse(parts[1], System.Globalization.CultureInfo.InvariantCulture, out var minLat) &&
                double.TryParse(parts[2], System.Globalization.CultureInfo.InvariantCulture, out var maxLng) &&
                double.TryParse(parts[3], System.Globalization.CultureInfo.InvariantCulture, out var maxLat))
            {
                var geometryFactory = NetTopologySuite.NtsGeometryServices.Instance.CreateGeometryFactory(srid: 4326);
                var envelope = new Envelope(minLng, maxLng, minLat, maxLat);
                var bboxPolygon = geometryFactory.ToGeometry(envelope);
                query = query.Where(h => h.Geom.Intersects(bboxPolygon));
            }
        }

        var totalCount = await query.CountAsync();

        // Performans Önlemi 2: Opsiyonel Sayfalama (Pagination)
        if (page.HasValue && pageSize.HasValue && page.Value > 0 && pageSize.Value > 0)
        {
            var skip = (page.Value - 1) * pageSize.Value;
            query = query.OrderBy(h => h.Id).Skip(skip).Take(pageSize.Value);
        }

        var hospitals = await query.ToListAsync();

        var featureCollection = new
        {
            type = "FeatureCollection",
            totalCount,
            page,
            pageSize,
            features = hospitals.Select(h => new
            {
                type = "Feature",
                id = h.Id,
                geometry = h.Geom,
                properties = new
                {
                    id = h.Id,
                    name = h.Name ?? "İsimsiz Hastane/Sağlık Tesisi",
                    amenity = h.Amenity,
                    district = h.District,
                    street = h.Street,
                    phone = h.Phone,
                    website = h.Website,
                    emergency = h.Emergency,
                    operatorName = h.Operator,
                    operatorType = h.OperatorType,
                    neighbourhood = h.Neighbourhood,
                    postcode = h.Postcode,
                    speciality = h.Speciality,
                    wheelchair = h.Wheelchair
                }
            })
        };

        return Ok(featureCollection);
    }

    // GET /api/hospitals/{id}
    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(int id)
    {
        var hospital = await _context.Hospitals.FindAsync(id);
        if (hospital == null) return NotFound("Hastane bulunamadı.");

        return Ok(hospital);
    }

    // PUT /api/hospitals/{id} -> Sözel bilgileri düzenleme (Madde 3)
    [HttpPut("{id}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateHospitalDto dto)
    {
        var hospital = await _context.Hospitals.FindAsync(id);
        if (hospital == null) return NotFound("Hastane bulunamadı.");

        if (dto.Name != null) hospital.Name = dto.Name;
        if (dto.Amenity != null) hospital.Amenity = dto.Amenity;
        if (dto.District != null) hospital.District = dto.District;
        if (dto.Street != null) hospital.Street = dto.Street;
        if (dto.Phone != null) hospital.Phone = dto.Phone;
        if (dto.Website != null) hospital.Website = dto.Website;
        if (dto.Emergency != null) hospital.Emergency = dto.Emergency;

        await _context.SaveChangesAsync();

        return Ok(new { message = "Hastane bilgileri başarıyla güncellendi.", hospital });
    }
}
