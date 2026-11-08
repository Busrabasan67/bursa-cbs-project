using BursaGis.Api.Data;
using BursaGis.Api.DTOs;
using BursaGis.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BursaGis.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class UserDrawingsController : ControllerBase
{
    private readonly AppDbContext _context;

    public UserDrawingsController(AppDbContext context)
    {
        _context = context;
    }

    // GET /api/userdrawings -> Çizimleri GeoJSON FeatureCollection formatında döner
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var drawings = await _context.UserDrawings
            .AsNoTracking()
            .OrderByDescending(d => d.CreatedAt)
            .ToListAsync();

        var featureCollection = new
        {
            type = "FeatureCollection",
            features = drawings.Select(d => new
            {
                type = "Feature",
                id = d.Id,
                geometry = d.Geom,
                properties = new
                {
                    id = d.Id,
                    name = d.Name,
                    description = d.Description,
                    createdAt = d.CreatedAt,
                    geometryType = d.Geom.GeometryType
                }
            })
        };

        return Ok(featureCollection);
    }

    // GET /api/userdrawings/{id}
    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(int id)
    {
        var drawing = await _context.UserDrawings.FindAsync(id);
        if (drawing == null) return NotFound("Çizim bulunamadı.");

        return Ok(drawing);
    }

    // POST /api/userdrawings -> Yeni geometri kaydetme
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateUserDrawingDto dto)
    {
        if (dto.Geometry == null)
            return BadRequest("Geometri boş olamaz.");

        if (!dto.Geometry.IsValid)
            return BadRequest("Çizilen geometri topolojik olarak geçersizdir (poligon kenarları birbirini kesemez).");

        // SRID 4326 zorunluluğunu garantiye al
        dto.Geometry.SRID = 4326;

        var drawing = new UserDrawing
        {
            Name = dto.Name,
            Description = dto.Description,
            Geom = dto.Geometry,
            CreatedAt = DateTime.UtcNow
        };

        _context.UserDrawings.Add(drawing);
        await _context.SaveChangesAsync();

        return CreatedAtAction(nameof(GetById), new { id = drawing.Id }, drawing);
    }

    // PUT /api/userdrawings/{id} -> Çizimi güncelleme
    [HttpPut("{id}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateUserDrawingDto dto)
    {
        var drawing = await _context.UserDrawings.FindAsync(id);
        if (drawing == null) return NotFound("Çizim bulunamadı.");

        if (dto.Name != null) drawing.Name = dto.Name;
        if (dto.Description != null) drawing.Description = dto.Description;
        if (dto.Geometry != null)
        {
            if (!dto.Geometry.IsValid)
                return BadRequest("Güncellenen geometri topolojik olarak geçersizdir (poligon kenarları birbirini kesemez).");

            dto.Geometry.SRID = 4326;
            drawing.Geom = dto.Geometry;
        }

        await _context.SaveChangesAsync();
        return Ok(new { message = "Çizim başarıyla güncellendi.", drawing });
    }

    // DELETE /api/userdrawings/{id} -> Çizimi silme
    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(int id)
    {
        var drawing = await _context.UserDrawings.FindAsync(id);
        if (drawing == null) return NotFound("Çizim bulunamadı.");

        _context.UserDrawings.Remove(drawing);
        await _context.SaveChangesAsync();

        return Ok(new { message = "Çizim başarıyla silindi." });
    }
}
