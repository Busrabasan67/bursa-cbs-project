using BursaGis.Api.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BursaGis.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class DistrictsController : ControllerBase
{
    private readonly AppDbContext _context;

    public DistrictsController(AppDbContext context)
    {
        _context = context;
    }

    // GET /api/districts -> Tüm ilçeleri GeoJSON FeatureCollection formatında döner
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var districts = await _context.Districts.AsNoTracking().ToListAsync();

        var featureCollection = new
        {
            type = "FeatureCollection",
            features = districts.Select(d => new
            {
                type = "Feature",
                id = d.Id,
                geometry = d.Geom,
                properties = new
                {
                    id = d.Id,
                    name = d.Name ?? "İsimsiz İlçe",
                    admin_level = d.AdminLevel
                }
            })
        };

        return Ok(featureCollection);
    }

    // GET /api/districts/{id}
    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(int id)
    {
        var district = await _context.Districts.FindAsync(id);
        if (district == null) return NotFound("İlçe bulunamadı.");

        return Ok(district);
    }
}
