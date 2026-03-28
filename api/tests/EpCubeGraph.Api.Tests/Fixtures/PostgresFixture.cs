using Testcontainers.PostgreSql;

namespace EpCubeGraph.Api.Tests.Fixtures;

public class PostgresFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _container;

    public PostgresFixture()
    {
        _container = new PostgreSqlBuilder()
            .WithImage("postgres:17-alpine")
            .WithDatabase("epcubegraph_test")
            .WithUsername("test")
            .WithPassword("test")
            .Build();
    }

    public string ConnectionString => _container.GetConnectionString();

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        await SeedSchemaAsync();
    }

    public async Task DisposeAsync()
    {
        await _container.DisposeAsync();
    }

    private async Task SeedSchemaAsync()
    {
        using var conn = new Npgsql.NpgsqlConnection(ConnectionString);
        await conn.OpenAsync();

        const string schema = """
            CREATE TABLE IF NOT EXISTS devices (
                id SERIAL PRIMARY KEY,
                device_id TEXT NOT NULL UNIQUE,
                device_class TEXT NOT NULL,
                alias TEXT,
                manufacturer TEXT,
                product_code TEXT,
                uid TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS readings (
                id BIGSERIAL PRIMARY KEY,
                device_id TEXT NOT NULL,
                metric_name TEXT NOT NULL,
                timestamp TIMESTAMPTZ NOT NULL,
                value DOUBLE PRECISION NOT NULL,
                UNIQUE (device_id, metric_name, timestamp)
            );

            CREATE INDEX IF NOT EXISTS idx_readings_device_metric_time
                ON readings (device_id, metric_name, timestamp DESC);
            """;

        using var cmd = new Npgsql.NpgsqlCommand(schema, conn);
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task SeedDeviceAsync(string deviceId, string deviceClass, string? alias = null,
        string? manufacturer = null, string? productCode = null, string? uid = null)
    {
        using var conn = new Npgsql.NpgsqlConnection(ConnectionString);
        await conn.OpenAsync();

        const string sql = """
            INSERT INTO devices (device_id, device_class, alias, manufacturer, product_code, uid)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (device_id) DO NOTHING
            """;

        using var cmd = new Npgsql.NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue(deviceId);
        cmd.Parameters.AddWithValue(deviceClass);
        cmd.Parameters.AddWithValue((object?)alias ?? DBNull.Value);
        cmd.Parameters.AddWithValue((object?)manufacturer ?? DBNull.Value);
        cmd.Parameters.AddWithValue((object?)productCode ?? DBNull.Value);
        cmd.Parameters.AddWithValue((object?)uid ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task SeedReadingAsync(string deviceId, string metricName, DateTimeOffset timestamp, double value)
    {
        using var conn = new Npgsql.NpgsqlConnection(ConnectionString);
        await conn.OpenAsync();

        const string sql = """
            INSERT INTO readings (device_id, metric_name, timestamp, value)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (device_id, metric_name, timestamp) DO NOTHING
            """;

        using var cmd = new Npgsql.NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue(deviceId);
        cmd.Parameters.AddWithValue(metricName);
        cmd.Parameters.AddWithValue(timestamp);
        cmd.Parameters.AddWithValue(value);
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task ClearDataAsync()
    {
        using var conn = new Npgsql.NpgsqlConnection(ConnectionString);
        await conn.OpenAsync();

        using var cmd = new Npgsql.NpgsqlCommand("DELETE FROM readings; DELETE FROM devices;", conn);
        await cmd.ExecuteNonQueryAsync();
    }
}
