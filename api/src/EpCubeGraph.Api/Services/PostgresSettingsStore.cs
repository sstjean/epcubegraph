using EpCubeGraph.Api.Models;
using Npgsql;

namespace EpCubeGraph.Api.Services;

public class PostgresSettingsStore : ISettingsStore
{
    private readonly string _connectionString;
    private bool _tablesCreated;

    public PostgresSettingsStore(string connectionString)
    {
        _connectionString = connectionString;
    }

    private async Task EnsureTablesAsync(CancellationToken ct)
    {
        if (_tablesCreated) return;

        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);

        const string sql = """
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value JSONB NOT NULL,
                last_modified TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
            """;

        await using var cmd = new NpgsqlCommand(sql, conn);
        await cmd.ExecuteNonQueryAsync(ct);
        _tablesCreated = true;
    }

    // ── Settings ──

    public async Task<IReadOnlyList<SettingEntry>> GetAllSettingsAsync(CancellationToken ct = default)
    {
        await EnsureTablesAsync(ct);
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);

        const string sql = "SELECT key, value, last_modified FROM settings ORDER BY key";
        await using var cmd = new NpgsqlCommand(sql, conn);
        await using var reader = await cmd.ExecuteReaderAsync(ct);

        var results = new List<SettingEntry>();
        while (await reader.ReadAsync(ct))
        {
            results.Add(new SettingEntry(
                reader.GetString(0),
                reader.GetString(1),
                reader.GetFieldValue<DateTimeOffset>(2)));
        }
        return results;
    }

    public async Task<SettingEntry?> GetSettingAsync(string key, CancellationToken ct = default)
    {
        await EnsureTablesAsync(ct);
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);

        const string sql = "SELECT key, value, last_modified FROM settings WHERE key = $1";
        await using var cmd = new NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue(key);
        await using var reader = await cmd.ExecuteReaderAsync(ct);

        if (await reader.ReadAsync(ct))
        {
            return new SettingEntry(
                reader.GetString(0),
                reader.GetString(1),
                reader.GetFieldValue<DateTimeOffset>(2));
        }
        return null;
    }

    public async Task<SettingEntry> UpdateSettingAsync(string key, string value, CancellationToken ct = default)
    {
        await EnsureTablesAsync(ct);
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);

        const string sql = """
            INSERT INTO settings (key, value, last_modified)
            VALUES ($1, $2::jsonb, NOW())
            ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, last_modified = NOW()
            RETURNING key, value, last_modified
            """;

        await using var cmd = new NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue(key);
        cmd.Parameters.AddWithValue(value);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        await reader.ReadAsync(ct);

        return new SettingEntry(
            reader.GetString(0),
            reader.GetString(1),
            reader.GetFieldValue<DateTimeOffset>(2));
    }

    // ── Panel Hierarchy ──

    public async Task<IReadOnlyList<PanelHierarchyEntry>> GetHierarchyAsync(CancellationToken ct = default)
    {
        await EnsureTablesAsync(ct);
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);

        const string sql = "SELECT id, parent_device_gid, child_device_gid FROM panel_hierarchy ORDER BY id";
        await using var cmd = new NpgsqlCommand(sql, conn);
        await using var reader = await cmd.ExecuteReaderAsync(ct);

        var results = new List<PanelHierarchyEntry>();
        while (await reader.ReadAsync(ct))
        {
            results.Add(new PanelHierarchyEntry(
                reader.GetInt32(0),
                reader.GetInt64(1),
                reader.GetInt64(2)));
        }
        return results;
    }

    public async Task<IReadOnlyList<PanelHierarchyEntry>> UpdateHierarchyAsync(
        IReadOnlyList<PanelHierarchyInputEntry> entries, CancellationToken ct = default)
    {
        await EnsureTablesAsync(ct);
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);

        await using var tx = await conn.BeginTransactionAsync(ct);

        await using (var del = new NpgsqlCommand("DELETE FROM panel_hierarchy", conn, tx))
            await del.ExecuteNonQueryAsync(ct);

        foreach (var e in entries)
        {
            const string sql = """
                INSERT INTO panel_hierarchy (parent_device_gid, child_device_gid)
                VALUES ($1, $2)
                """;
            await using var cmd = new NpgsqlCommand(sql, conn, tx);
            cmd.Parameters.AddWithValue(e.ParentDeviceGid);
            cmd.Parameters.AddWithValue(e.ChildDeviceGid);
            await cmd.ExecuteNonQueryAsync(ct);
        }

        await tx.CommitAsync(ct);
        return await GetHierarchyAsync(ct);
    }

    // ── Display Name Overrides ──

    public async Task<IReadOnlyList<DisplayNameOverride>> GetDisplayNamesAsync(CancellationToken ct = default)
    {
        await EnsureTablesAsync(ct);
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);

        const string sql = "SELECT id, device_gid, channel_number, display_name FROM display_name_overrides ORDER BY device_gid, channel_number";
        await using var cmd = new NpgsqlCommand(sql, conn);
        await using var reader = await cmd.ExecuteReaderAsync(ct);

        var results = new List<DisplayNameOverride>();
        while (await reader.ReadAsync(ct))
        {
            results.Add(new DisplayNameOverride(
                reader.GetInt32(0),
                reader.GetInt64(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.GetString(3)));
        }
        return results;
    }

    public async Task<IReadOnlyList<DisplayNameOverride>> UpdateDisplayNamesForDeviceAsync(
        long deviceGid, IReadOnlyList<DisplayNameInputEntry> overrides, CancellationToken ct = default)
    {
        await EnsureTablesAsync(ct);
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);

        await using var tx = await conn.BeginTransactionAsync(ct);

        await using (var del = new NpgsqlCommand("DELETE FROM display_name_overrides WHERE device_gid = $1", conn, tx))
        {
            del.Parameters.AddWithValue(deviceGid);
            await del.ExecuteNonQueryAsync(ct);
        }

        foreach (var o in overrides)
        {
            const string sql = """
                INSERT INTO display_name_overrides (device_gid, channel_number, display_name)
                VALUES ($1, $2, $3)
                """;
            await using var cmd = new NpgsqlCommand(sql, conn, tx);
            cmd.Parameters.AddWithValue(deviceGid);
            cmd.Parameters.AddWithValue((object?)o.ChannelNumber ?? DBNull.Value);
            cmd.Parameters.AddWithValue(o.DisplayName);
            await cmd.ExecuteNonQueryAsync(ct);
        }

        await tx.CommitAsync(ct);

        // Return just the overrides for this device
        await using var conn2 = new NpgsqlConnection(_connectionString);
        await conn2.OpenAsync(ct);
        const string selectSql = "SELECT id, device_gid, channel_number, display_name FROM display_name_overrides WHERE device_gid = $1 ORDER BY channel_number";
        await using var selectCmd = new NpgsqlCommand(selectSql, conn2);
        selectCmd.Parameters.AddWithValue(deviceGid);
        await using var reader = await selectCmd.ExecuteReaderAsync(ct);

        var results = new List<DisplayNameOverride>();
        while (await reader.ReadAsync(ct))
        {
            results.Add(new DisplayNameOverride(
                reader.GetInt32(0),
                reader.GetInt64(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.GetString(3)));
        }
        return results;
    }

    public async Task<bool> DeleteDisplayNameAsync(long deviceGid, string channelNumber, CancellationToken ct = default)
    {
        await EnsureTablesAsync(ct);
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);

        const string sql = "DELETE FROM display_name_overrides WHERE device_gid = $1 AND channel_number = $2";
        await using var cmd = new NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue(deviceGid);
        cmd.Parameters.AddWithValue(channelNumber);
        var rows = await cmd.ExecuteNonQueryAsync(ct);
        return rows > 0;
    }
}
