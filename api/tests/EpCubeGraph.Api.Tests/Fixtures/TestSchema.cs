using Testcontainers.PostgreSql;

namespace EpCubeGraph.Api.Tests.Fixtures;

/// <summary>
/// Canonical DDL for the epcubegraph test database schema.
/// Used by PostgresFixture and by each self-contained integration test
/// that starts its own container.
/// </summary>
public static class TestSchema
{
    /// <summary>
    /// Creates a fresh PostgreSQL Testcontainer, starts it, and applies the schema.
    /// Caller must dispose the returned container via <c>await using</c>.
    /// </summary>
    public static async Task<PostgreSqlContainer> CreateContainerAsync()
    {
        var container = new PostgreSqlBuilder("postgres:17-alpine")
            .WithDatabase("epcubegraph_test")
            .WithUsername("test")
            .WithPassword("test")
            .Build();
        await container.StartAsync();

        using var conn = new Npgsql.NpgsqlConnection(container.GetConnectionString());
        await conn.OpenAsync();
        using var cmd = new Npgsql.NpgsqlCommand(Ddl, conn);
        await cmd.ExecuteNonQueryAsync();

        return container;
    }

    public const string Ddl = """
        CREATE TABLE IF NOT EXISTS devices (
            id SERIAL PRIMARY KEY,
            device_id TEXT NOT NULL UNIQUE,
            device_class TEXT NOT NULL,
            alias TEXT,
            manufacturer TEXT,
            product_code TEXT,
            uid TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS pending_replacements (
            id SERIAL PRIMARY KEY,
            old_device_id TEXT NOT NULL,
            new_device_id TEXT NOT NULL,
            detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (old_device_id, new_device_id)
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value JSONB NOT NULL,
            last_modified TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

        CREATE TABLE IF NOT EXISTS vue_devices (
            device_gid BIGINT PRIMARY KEY,
            device_name TEXT,
            model TEXT,
            connected BOOLEAN DEFAULT TRUE,
            last_seen TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS vue_channels (
            id SERIAL PRIMARY KEY,
            device_gid BIGINT NOT NULL REFERENCES vue_devices(device_gid),
            channel_num TEXT NOT NULL,
            name TEXT,
            channel_type TEXT,
            UNIQUE (device_gid, channel_num)
        );

        CREATE TABLE IF NOT EXISTS vue_readings (
            id BIGSERIAL PRIMARY KEY,
            device_gid BIGINT NOT NULL,
            channel_num TEXT NOT NULL,
            timestamp TIMESTAMPTZ NOT NULL,
            value DOUBLE PRECISION NOT NULL,
            UNIQUE (device_gid, channel_num, timestamp)
        );

        CREATE INDEX IF NOT EXISTS idx_vue_readings_device_channel_time
            ON vue_readings (device_gid, channel_num, timestamp DESC);

        CREATE TABLE IF NOT EXISTS vue_readings_1min (
            id BIGSERIAL PRIMARY KEY,
            device_gid BIGINT NOT NULL,
            channel_num TEXT NOT NULL,
            timestamp TIMESTAMPTZ NOT NULL,
            value DOUBLE PRECISION NOT NULL,
            sample_count INTEGER DEFAULT 1,
            UNIQUE (device_gid, channel_num, timestamp)
        );

        CREATE TABLE IF NOT EXISTS panel_hierarchy (
            id SERIAL PRIMARY KEY,
            parent_device_gid BIGINT NOT NULL,
            child_device_gid BIGINT NOT NULL,
            UNIQUE (parent_device_gid, child_device_gid)
        );

        CREATE TABLE IF NOT EXISTS display_name_overrides (
            id SERIAL PRIMARY KEY,
            device_gid BIGINT NOT NULL,
            channel_number TEXT,
            display_name TEXT NOT NULL,
            UNIQUE (device_gid, channel_number)
        );

        CREATE TABLE IF NOT EXISTS vue_readings_daily (
            device_gid BIGINT NOT NULL,
            channel_num TEXT NOT NULL,
            date DATE NOT NULL,
            kwh DOUBLE PRECISION NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (device_gid, channel_num, date)
        );

        CREATE INDEX IF NOT EXISTS idx_vue_readings_daily_device_date
            ON vue_readings_daily (device_gid, date);
        """;
}
