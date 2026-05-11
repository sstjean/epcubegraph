using Testcontainers.PostgreSql;

namespace EpCubeGraph.Api.Tests.Fixtures;

public class PostgresFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _container;

    public PostgresFixture()
    {
        _container = new PostgreSqlBuilder("postgres:17-alpine")
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

        using var cmd = new Npgsql.NpgsqlCommand(TestSchema.Ddl, conn);
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

        using var cmd = new Npgsql.NpgsqlCommand(
            """
            DO $$ BEGIN
                DELETE FROM settings;
            EXCEPTION WHEN undefined_table THEN NULL;
            END $$;
            DO $$ BEGIN
                DELETE FROM pending_replacements;
            EXCEPTION WHEN undefined_table THEN NULL;
            END $$;
            DELETE FROM readings; DELETE FROM devices;
            DELETE FROM vue_readings_daily; DELETE FROM vue_readings_1min;
            DELETE FROM vue_readings; DELETE FROM vue_channels; DELETE FROM vue_devices;
            DO $$ BEGIN
                DELETE FROM panel_hierarchy;
                DELETE FROM display_name_overrides;
            EXCEPTION WHEN undefined_table THEN NULL;
            END $$;
            """,
            conn);
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task SeedVueDeviceAsync(long deviceGid, string deviceName, bool connected = true, string? model = null)
    {
        using var conn = new Npgsql.NpgsqlConnection(ConnectionString);
        await conn.OpenAsync();

        const string sql = """
            INSERT INTO vue_devices (device_gid, device_name, model, connected)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (device_gid) DO UPDATE SET device_name = $2, model = $3, connected = $4
            """;

        using var cmd = new Npgsql.NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue(deviceGid);
        cmd.Parameters.AddWithValue(deviceName);
        cmd.Parameters.AddWithValue((object?)model ?? DBNull.Value);
        cmd.Parameters.AddWithValue(connected);
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task SeedVueChannelAsync(long deviceGid, string channelNum, string? name = null, string? channelType = null)
    {
        using var conn = new Npgsql.NpgsqlConnection(ConnectionString);
        await conn.OpenAsync();

        const string sql = """
            INSERT INTO vue_channels (device_gid, channel_num, name, channel_type)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (device_gid, channel_num) DO UPDATE SET name = $3, channel_type = $4
            """;

        using var cmd = new Npgsql.NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue(deviceGid);
        cmd.Parameters.AddWithValue(channelNum);
        cmd.Parameters.AddWithValue((object?)name ?? DBNull.Value);
        cmd.Parameters.AddWithValue((object?)channelType ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task SeedVueReadingAsync(long deviceGid, string channelNum, DateTimeOffset timestamp, double value)
    {
        using var conn = new Npgsql.NpgsqlConnection(ConnectionString);
        await conn.OpenAsync();

        const string sql = """
            INSERT INTO vue_readings (device_gid, channel_num, timestamp, value)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (device_gid, channel_num, timestamp) DO NOTHING
            """;

        using var cmd = new Npgsql.NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue(deviceGid);
        cmd.Parameters.AddWithValue(channelNum);
        cmd.Parameters.AddWithValue(timestamp);
        cmd.Parameters.AddWithValue(value);
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task SeedVueReading1MinAsync(long deviceGid, string channelNum, DateTimeOffset timestamp, double value, int sampleCount = 60)
    {
        using var conn = new Npgsql.NpgsqlConnection(ConnectionString);
        await conn.OpenAsync();

        const string sql = """
            INSERT INTO vue_readings_1min (device_gid, channel_num, timestamp, value, sample_count)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (device_gid, channel_num, timestamp) DO NOTHING
            """;

        using var cmd = new Npgsql.NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue(deviceGid);
        cmd.Parameters.AddWithValue(channelNum);
        cmd.Parameters.AddWithValue(timestamp);
        cmd.Parameters.AddWithValue(value);
        cmd.Parameters.AddWithValue(sampleCount);
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task SeedPanelHierarchyAsync(long parentGid, long childGid)
    {
        using var conn = new Npgsql.NpgsqlConnection(ConnectionString);
        await conn.OpenAsync();

        const string sql = """
            INSERT INTO panel_hierarchy (parent_device_gid, child_device_gid)
            VALUES ($1, $2)
            ON CONFLICT (parent_device_gid, child_device_gid) DO NOTHING
            """;

        using var cmd = new Npgsql.NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue(parentGid);
        cmd.Parameters.AddWithValue(childGid);
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task SeedDisplayNameOverrideAsync(long deviceGid, string? channelNumber, string displayName)
    {
        using var conn = new Npgsql.NpgsqlConnection(ConnectionString);
        await conn.OpenAsync();

        const string sql = """
            INSERT INTO display_name_overrides (device_gid, channel_number, display_name)
            VALUES ($1, $2, $3)
            ON CONFLICT (device_gid, channel_number) DO UPDATE SET display_name = $3
            """;

        using var cmd = new Npgsql.NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue(deviceGid);
        cmd.Parameters.AddWithValue((object?)channelNumber ?? DBNull.Value);
        cmd.Parameters.AddWithValue(displayName);
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task SeedVueDailyReadingAsync(long deviceGid, string channelNum, DateOnly date, double kwh)
    {
        using var conn = new Npgsql.NpgsqlConnection(ConnectionString);
        await conn.OpenAsync();

        const string sql = """
            INSERT INTO vue_readings_daily (device_gid, channel_num, date, kwh)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (device_gid, channel_num, date) DO UPDATE SET kwh = $4, updated_at = NOW()
            """;

        using var cmd = new Npgsql.NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue(deviceGid);
        cmd.Parameters.AddWithValue(channelNum);
        cmd.Parameters.AddWithValue(date);
        cmd.Parameters.AddWithValue(kwh);
        await cmd.ExecuteNonQueryAsync();
    }
}
