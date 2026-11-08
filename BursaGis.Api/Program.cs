using BursaGis.Api.Data;
using BursaGis.Api.Services;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// 1. Veritabanı ve PostGIS (NetTopologySuite) Bağlantısı
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(connectionString, o => o.UseNetTopologySuite()));

// Mekânsal Analiz Servisi (Katmanlı Mimari - Dependency Injection)
builder.Services.AddScoped<ISpatialAnalysisService, SpatialAnalysisService>();

// 2. Controller'lar ve Standart GeoJSON JSON Dönüştürücüsü
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        // NetTopologySuite geometrilerini doğrudan GeoJSON standardında serileştirir
        options.JsonSerializerOptions.Converters.Add(new NetTopologySuite.IO.Converters.GeoJsonConverterFactory());
    });

// 3. Frontend Harita Arayüzü için CORS İzni
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyMethod()
              .AllowAnyHeader();
    });
});

// Swagger / OpenAPI
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors("AllowAll");

app.UseAuthorization();

app.MapControllers();

app.Run();
