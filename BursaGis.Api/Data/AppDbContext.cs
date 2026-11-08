using BursaGis.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace BursaGis.Api.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    public DbSet<Hospital> Hospitals => Set<Hospital>();
    public DbSet<District> Districts => Set<District>();
    public DbSet<UserDrawing> UserDrawings => Set<UserDrawing>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // PostGIS eklentisinin varlığını EF Core'a bildir
        modelBuilder.HasPostgresExtension("postgis");
    }
}
