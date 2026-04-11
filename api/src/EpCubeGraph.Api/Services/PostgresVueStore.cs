using EpCubeGraph.Api.Models;
using Npgsql;

namespace EpCubeGraph.Api.Services;

public class PostgresVueStore : IVueStore
{
    private readonly string _connectionString;
    private bool _tablesChecked;

    public PostgresVueStore(string connectionString)
    {
        _connectionString = connectionString;
    }

    private async Task EnsureSettingsTablesAsync(NpgsqlConnection conn, CancellationToken ct)
    {
        if (_tablesChecked) return;

        const string sql = """
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
        _tablesChecked = true;
    }

    // ── Helper: resolve display name ──

    private static string ResolveDisplayName(string? overrideName, string? channelName, string channelNum)
    {
        if (!string.IsNullOrEmpty(overrideName))
            return overrideName;
        if (channelNum == "Balance")
            return "Unmonitored loads";
        if (!string.IsNullOrEmpty(channelName))
            return channelName;
        return $"Channel {channelNum}";
    }

    private static string ResolveDeviceDisplayName(string? overrideName, string? deviceName, long deviceGid)
    {
        if (!string.IsNullOrEmpty(overrideName))
            return overrideName;
        if (!string.IsNullOrEmpty(deviceName))
            return deviceName;
        return $"Device {deviceGid}";
    }

    // ── Helper: auto-resolution step ──

    public static string AutoResolveStep(TimeSpan range)
    {
        if (range.TotalMinutes <= 30) return "1s";
        if (range.TotalHours <= 2) return "5s";
        if (range.TotalHours <= 8) return "15s";
        if (range.TotalHours <= 24) return "1m";
        if (range.TotalDays <= 7) return "5m";
        if (range.TotalDays <= 30) return "15m";
        if (range.TotalDays <= 90) return "1h";
        return "4h";
    }

    public static TimeSpan ParseStep(string step)
    {
        if (step.Length >= 2 && step.EndsWith("s") && int.TryParse(step[..^1], out var s) && s > 0)
            return TimeSpan.FromSeconds(s);
        if (step.Length >= 2 && step.EndsWith("m") && int.TryParse(step[..^1], out var m) && m > 0)
            return TimeSpan.FromMinutes(m);
        if (step.Length >= 2 && step.EndsWith("h") && int.TryParse(step[..^1], out var h) && h > 0)
            return TimeSpan.FromHours(h);
        throw new ArgumentException($"Invalid step format '{step}'. Use <number>s, <number>m, or <number>h.");
    }

    // ── Devices (US3 — skeleton) ──

    public async Task<IReadOnlyList<VueDeviceInfo>> GetDevicesAsync(CancellationToken ct = default)
    {
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        await EnsureSettingsTablesAsync(conn, ct);

        const string sql = """
            SELECT d.device_gid, d.device_name, d.model, d.connected,
                   EXTRACT(EPOCH FROM d.last_seen)::bigint AS last_seen_epoch,
                   dno_dev.display_name AS device_override
            FROM vue_devices d
            LEFT JOIN display_name_overrides dno_dev
                ON dno_dev.device_gid = d.device_gid AND dno_dev.channel_number IS NULL
            ORDER BY d.device_name
            """;

        await using var cmd = new NpgsqlCommand(sql, conn);
        await using var reader = await cmd.ExecuteReaderAsync(ct);

        // Read all device rows first (must close reader before querying channels)
        var deviceRows = new List<(long gid, string? name, string? model, bool connected, long? lastSeen, string? deviceOverride)>();
        while (await reader.ReadAsync(ct))
        {
            deviceRows.Add((
                reader.GetInt64(0),
                reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                !reader.IsDBNull(3) && reader.GetBoolean(3),
                reader.IsDBNull(4) ? (long?)null : reader.GetInt64(4),
                reader.IsDBNull(5) ? null : reader.GetString(5)
            ));
        }
        await reader.CloseAsync();

        var devices = new List<VueDeviceInfo>();
        foreach (var (gid, name, model, connected, lastSeen, deviceOverride) in deviceRows)
        {
            var channels = await GetChannelsForDeviceAsync(conn, gid, ct);

            devices.Add(new VueDeviceInfo(
                DeviceGid: gid,
                DeviceName: name,
                DisplayName: ResolveDeviceDisplayName(deviceOverride, name, gid),
                Model: model,
                Connected: connected,
                LastSeen: lastSeen,
                Channels: channels
            ));
        }

        return devices;
    }

    private async Task<IReadOnlyList<VueDeviceChannel>> GetChannelsForDeviceAsync(
        NpgsqlConnection conn, long deviceGid, CancellationToken ct)
    {
        const string sql = """
            SELECT c.channel_num, c.name, c.channel_type,
                   dno.display_name AS channel_override
            FROM vue_channels c
            LEFT JOIN display_name_overrides dno
                ON dno.device_gid = c.device_gid AND dno.channel_number = c.channel_num
            WHERE c.device_gid = @gid
            ORDER BY
                CASE c.channel_num
                    WHEN '1,2,3' THEN 0
                    WHEN 'Balance' THEN 2
                    ELSE 1
                END,
                CASE WHEN c.channel_num ~ '^\d+$' THEN c.channel_num::int ELSE 999 END,
                c.channel_num
            """;

        await using var cmd = new NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("gid", deviceGid);
        await using var reader = await cmd.ExecuteReaderAsync(ct);

        var channels = new List<VueDeviceChannel>();
        while (await reader.ReadAsync(ct))
        {
            var channelNum = reader.GetString(0);
            var name = reader.IsDBNull(1) ? null : reader.GetString(1);
            var channelType = reader.IsDBNull(2) ? null : reader.GetString(2);
            var channelOverride = reader.IsDBNull(3) ? null : reader.GetString(3);

            channels.Add(new VueDeviceChannel(
                ChannelNum: channelNum,
                Name: name,
                DisplayName: ResolveDisplayName(channelOverride, name, channelNum),
                ChannelType: channelType
            ));
        }

        return channels;
    }

    public async Task<VueDeviceInfo?> GetDeviceAsync(long deviceGid, CancellationToken ct = default)
    {
        var devices = await GetDevicesAsync(ct);
        return devices.FirstOrDefault(d => d.DeviceGid == deviceGid);
    }

    // ── Current Readings (US3 — skeleton) ──

    public async Task<VueCurrentReadingsResponse?> GetCurrentReadingsAsync(
        long deviceGid, CancellationToken ct = default)
    {
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        await EnsureSettingsTablesAsync(conn, ct);

        const string sql = """
            SELECT DISTINCT ON (vr.channel_num)
                   vr.channel_num,
                   EXTRACT(EPOCH FROM vr.timestamp)::bigint AS ts,
                   vr.value,
                   vc.name AS channel_name,
                   dno.display_name AS channel_override
            FROM vue_readings vr
            LEFT JOIN vue_channels vc ON vc.device_gid = vr.device_gid AND vc.channel_num = vr.channel_num
            LEFT JOIN display_name_overrides dno ON dno.device_gid = vr.device_gid AND dno.channel_number = vr.channel_num
            WHERE vr.device_gid = @gid
            ORDER BY vr.channel_num, vr.timestamp DESC
            """;

        await using var cmd = new NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("gid", deviceGid);
        await using var reader = await cmd.ExecuteReaderAsync(ct);

        var channels = new List<VueChannelReading>();
        long latestTs = 0;
        while (await reader.ReadAsync(ct))
        {
            var channelNum = reader.GetString(0);
            var ts = reader.GetInt64(1);
            var value = reader.GetDouble(2);
            var channelName = reader.IsDBNull(3) ? null : reader.GetString(3);
            var channelOverride = reader.IsDBNull(4) ? null : reader.GetString(4);

            if (ts > latestTs) latestTs = ts;

            channels.Add(new VueChannelReading(
                ChannelNum: channelNum,
                DisplayName: ResolveDisplayName(channelOverride, channelName, channelNum),
                Value: value
            ));
        }

        if (channels.Count == 0) return null;

        return new VueCurrentReadingsResponse(
            DeviceGid: deviceGid,
            Timestamp: latestTs,
            Channels: channels
        );
    }

    // ── Range Readings (US3 — skeleton) ──

    public async Task<VueRangeReadingsResponse?> GetRangeReadingsAsync(
        long deviceGid, DateTimeOffset start, DateTimeOffset end,
        string? step = null, string? channels = null, CancellationToken ct = default)
    {
        var range = end - start;
        var resolvedStep = step ?? AutoResolveStep(range);
        var stepInterval = ParseStep(resolvedStep);

        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        await EnsureSettingsTablesAsync(conn, ct);

        // Seamlessly join raw and 1-min tables across the 7-day retention boundary
        var sevenDaysAgo = DateTimeOffset.UtcNow.AddDays(-7);

        string sql;
        if (end <= sevenDaysAgo)
        {
            // Entire range is older than 7 days — use 1-min table only
            sql = """
                SELECT vr.channel_num,
                       date_trunc('second', date_bin(@interval, vr.timestamp, @start)) AS bucket,
                       SUM(vr.value * vr.sample_count) / NULLIF(SUM(vr.sample_count), 0) AS avg_value,
                       vc.name AS channel_name,
                       dno.display_name AS channel_override
                FROM vue_readings_1min vr
                LEFT JOIN vue_channels vc ON vc.device_gid = vr.device_gid AND vc.channel_num = vr.channel_num
                LEFT JOIN display_name_overrides dno ON dno.device_gid = vr.device_gid AND dno.channel_number = vr.channel_num
                WHERE vr.device_gid = @gid AND vr.timestamp >= @start AND vr.timestamp < @end
                GROUP BY vr.channel_num, bucket, vc.name, dno.display_name
                ORDER BY vr.channel_num, bucket
                """;
        }
        else if (start >= sevenDaysAgo)
        {
            // Entire range is within 7 days — use raw table only
            sql = """
                SELECT vr.channel_num,
                       date_trunc('second', date_bin(@interval, vr.timestamp, @start)) AS bucket,
                       avg(vr.value) AS avg_value,
                       vc.name AS channel_name,
                       dno.display_name AS channel_override
                FROM vue_readings vr
                LEFT JOIN vue_channels vc ON vc.device_gid = vr.device_gid AND vc.channel_num = vr.channel_num
                LEFT JOIN display_name_overrides dno ON dno.device_gid = vr.device_gid AND dno.channel_number = vr.channel_num
                WHERE vr.device_gid = @gid AND vr.timestamp >= @start AND vr.timestamp < @end
                GROUP BY vr.channel_num, bucket, vc.name, dno.display_name
                ORDER BY vr.channel_num, bucket
                """;
        }
        else
        {
            // Range spans boundary — union both tables
            sql = """
                WITH combined AS (
                    SELECT device_gid, channel_num, timestamp, value
                    FROM vue_readings_1min
                    WHERE device_gid = @gid AND timestamp >= @start AND timestamp < @boundary
                    UNION ALL
                    SELECT device_gid, channel_num, timestamp, value
                    FROM vue_readings
                    WHERE device_gid = @gid AND timestamp >= @boundary AND timestamp < @end
                )
                SELECT cr.channel_num,
                       date_trunc('second', date_bin(@interval, cr.timestamp, @start)) AS bucket,
                       avg(cr.value) AS avg_value,
                       vc.name AS channel_name,
                       dno.display_name AS channel_override
                FROM combined cr
                LEFT JOIN vue_channels vc ON vc.device_gid = cr.device_gid AND vc.channel_num = cr.channel_num
                LEFT JOIN display_name_overrides dno ON dno.device_gid = cr.device_gid AND dno.channel_number = cr.channel_num
                WHERE 1 = 1
                GROUP BY cr.channel_num, bucket, vc.name, dno.display_name
                ORDER BY cr.channel_num, bucket
                """;
        }

        if (!string.IsNullOrEmpty(channels))
        {
            sql = sql.Replace(
                start >= sevenDaysAgo || end <= sevenDaysAgo
                    ? "WHERE vr.device_gid = @gid"
                    : "WHERE 1 = 1",
                start >= sevenDaysAgo || end <= sevenDaysAgo
                    ? "WHERE vr.device_gid = @gid AND vr.channel_num = ANY(@channels)"
                    : "WHERE cr.channel_num = ANY(@channels)");
        }

        await using var cmd = new NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("gid", deviceGid);
        cmd.Parameters.AddWithValue("start", start);
        cmd.Parameters.AddWithValue("end", end);
        cmd.Parameters.AddWithValue("interval", stepInterval);
        if (start < sevenDaysAgo && end > sevenDaysAgo)
        {
            cmd.Parameters.AddWithValue("boundary", sevenDaysAgo);
        }
        if (!string.IsNullOrEmpty(channels))
        {
            cmd.Parameters.AddWithValue("channels", channels.Split(',').Select(c => c.Trim()).ToArray());
        }

        await using var reader = await cmd.ExecuteReaderAsync(ct);

        var seriesDict = new Dictionary<string, (string displayName, List<TimeSeriesPoint> points)>();
        while (await reader.ReadAsync(ct))
        {
            var channelNum = reader.GetString(0);
            var bucket = reader.GetDateTime(1);
            var value = reader.GetDouble(2);
            var channelName = reader.IsDBNull(3) ? null : reader.GetString(3);
            var channelOverride = reader.IsDBNull(4) ? null : reader.GetString(4);

            var ts = new DateTimeOffset(bucket, TimeSpan.Zero).ToUnixTimeSeconds();

            if (!seriesDict.ContainsKey(channelNum))
            {
                seriesDict[channelNum] = (
                    ResolveDisplayName(channelOverride, channelName, channelNum),
                    new List<TimeSeriesPoint>()
                );
            }
            seriesDict[channelNum].points.Add(new TimeSeriesPoint(ts, value));
        }

        if (seriesDict.Count == 0) return null;

        var series = seriesDict.Select(kvp => new VueChannelSeries(
            ChannelNum: kvp.Key,
            DisplayName: kvp.Value.displayName,
            Values: kvp.Value.points
        )).ToList();

        return new VueRangeReadingsResponse(
            DeviceGid: deviceGid,
            Start: start.ToString("o"),
            End: end.ToString("o"),
            Step: resolvedStep,
            Series: series
        );
    }

    // ── Panel Total (US2 — T035) ──

    public async Task<PanelTotalResponse?> GetPanelTotalAsync(long deviceGid, CancellationToken ct = default)
    {
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        await EnsureSettingsTablesAsync(conn, ct);

        // Get parent's mains reading
        var parentTotal = await GetLatestMainsAsync(conn, deviceGid, ct);
        if (parentTotal is null) return null;

        // Get display name
        var displayName = await GetDeviceDisplayNameAsync(conn, deviceGid, ct);

        // Get children from hierarchy
        var children = new List<PanelChild>();
        double childSum = 0;

        const string childrenSql = """
            SELECT h.child_device_gid
            FROM panel_hierarchy h
            WHERE h.parent_device_gid = @gid
            """;
        await using var childCmd = new NpgsqlCommand(childrenSql, conn);
        childCmd.Parameters.AddWithValue("gid", deviceGid);
        await using var childReader = await childCmd.ExecuteReaderAsync(ct);

        var childGids = new List<long>();
        while (await childReader.ReadAsync(ct))
            childGids.Add(childReader.GetInt64(0));
        await childReader.CloseAsync();

        foreach (var childGid in childGids)
        {
            var childTotal = await GetLatestMainsAsync(conn, childGid, ct);
            var childName = await GetDeviceDisplayNameAsync(conn, childGid, ct);
            var rawWatts = childTotal?.value ?? 0;
            children.Add(new PanelChild(childGid, childName, rawWatts));
            childSum += rawWatts;
        }

        return new PanelTotalResponse(
            DeviceGid: deviceGid,
            DisplayName: displayName,
            Timestamp: parentTotal.Value.timestamp,
            RawTotalWatts: parentTotal.Value.value,
            DeduplicatedTotalWatts: parentTotal.Value.value - childSum,
            Children: children
        );
    }

    private async Task<(double value, long timestamp)?> GetLatestMainsAsync(NpgsqlConnection conn, long deviceGid, CancellationToken ct)
    {
        const string sql = """
            SELECT value, EXTRACT(EPOCH FROM timestamp)::bigint AS ts FROM vue_readings
            WHERE device_gid = @gid AND channel_num = '1,2,3'
            ORDER BY timestamp DESC LIMIT 1
            """;
        await using var cmd = new NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("gid", deviceGid);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (await reader.ReadAsync(ct))
        {
            var value = reader.GetDouble(0);
            var ts = reader.GetInt64(1);
            return (value, ts);
        }
        return null;
    }

    private async Task<string> GetDeviceDisplayNameAsync(NpgsqlConnection conn, long deviceGid, CancellationToken ct)
    {
        const string sql = """
            SELECT dno.display_name, d.device_name
            FROM vue_devices d
            LEFT JOIN display_name_overrides dno
                ON dno.device_gid = d.device_gid AND dno.channel_number IS NULL
            WHERE d.device_gid = @gid
            """;
        await using var cmd = new NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("gid", deviceGid);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (await reader.ReadAsync(ct))
        {
            var overrideName = reader.IsDBNull(0) ? null : reader.GetString(0);
            var deviceName = reader.IsDBNull(1) ? null : reader.GetString(1);
            return ResolveDeviceDisplayName(overrideName, deviceName, deviceGid);
        }
        return $"Device {deviceGid}";
    }

    // ── Panel Total Range (US2 — T036) ──

    public async Task<PanelTotalRangeResponse?> GetPanelTotalRangeAsync(
        long deviceGid, DateTimeOffset start, DateTimeOffset end,
        string? step = null, CancellationToken ct = default)
    {
        var range = end - start;
        var resolvedStep = step ?? AutoResolveStep(range);
        var stepInterval = ParseStep(resolvedStep);

        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);

        var displayName = await GetDeviceDisplayNameAsync(conn, deviceGid, ct);

        // Get raw mains series
        var rawSeries = await GetMainsSeriesAsync(conn, deviceGid, start, end, stepInterval, ct);
        if (rawSeries.Count == 0) return null;

        // Get child GIDs
        var childGids = await GetChildGidsAsync(conn, deviceGid, ct);

        // Get child mains series and subtract
        var childSums = new Dictionary<long, double>(); // timestamp -> sum of children
        foreach (var childGid in childGids)
        {
            var childSeries = await GetMainsSeriesAsync(conn, childGid, start, end, stepInterval, ct);
            foreach (var pt in childSeries)
            {
                if (!childSums.ContainsKey(pt.Timestamp))
                    childSums[pt.Timestamp] = 0;
                childSums[pt.Timestamp] += pt.Value;
            }
        }

        var deduplicated = rawSeries.Select(pt =>
            new TimeSeriesPoint(pt.Timestamp, pt.Value - (childSums.GetValueOrDefault(pt.Timestamp, 0)))
        ).ToList();

        return new PanelTotalRangeResponse(
            DeviceGid: deviceGid,
            DisplayName: displayName,
            Start: start.ToString("o"),
            End: end.ToString("o"),
            Step: resolvedStep,
            RawTotal: rawSeries,
            DeduplicatedTotal: deduplicated
        );
    }

    private async Task<List<TimeSeriesPoint>> GetMainsSeriesAsync(
        NpgsqlConnection conn, long deviceGid,
        DateTimeOffset start, DateTimeOffset end, TimeSpan stepInterval,
        CancellationToken ct)
    {
        var sevenDaysAgo = DateTimeOffset.UtcNow.AddDays(-7);

        string sql;
        if (end <= sevenDaysAgo)
        {
            sql = """
                SELECT date_trunc('second', date_bin(@interval, timestamp, @start)) AS bucket,
                       SUM(value * sample_count) / NULLIF(SUM(sample_count), 0) AS avg_value
                FROM vue_readings_1min
                WHERE device_gid = @gid AND channel_num = '1,2,3'
                  AND timestamp >= @start AND timestamp < @end
                GROUP BY bucket
                ORDER BY bucket
                """;
        }
        else if (start >= sevenDaysAgo)
        {
            sql = """
                SELECT date_trunc('second', date_bin(@interval, timestamp, @start)) AS bucket,
                       avg(value) AS avg_value
                FROM vue_readings
                WHERE device_gid = @gid AND channel_num = '1,2,3'
                  AND timestamp >= @start AND timestamp < @end
                GROUP BY bucket
                ORDER BY bucket
                """;
        }
        else
        {
            sql = """
                WITH source_data AS (
                    SELECT timestamp, value
                    FROM vue_readings_1min
                    WHERE device_gid = @gid AND channel_num = '1,2,3'
                      AND timestamp >= @start AND timestamp < @boundary
                    UNION ALL
                    SELECT timestamp, value
                    FROM vue_readings
                    WHERE device_gid = @gid AND channel_num = '1,2,3'
                      AND timestamp >= @boundary AND timestamp < @end
                )
                SELECT date_trunc('second', date_bin(@interval, timestamp, @start)) AS bucket,
                       avg(value) AS avg_value
                FROM source_data
                GROUP BY bucket
                ORDER BY bucket
                """;
        }

        await using var cmd = new NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("gid", deviceGid);
        cmd.Parameters.AddWithValue("start", start);
        cmd.Parameters.AddWithValue("end", end);
        cmd.Parameters.AddWithValue("interval", stepInterval);
        if (start < sevenDaysAgo && end > sevenDaysAgo)
        {
            cmd.Parameters.AddWithValue("boundary", sevenDaysAgo);
        }
        await using var reader = await cmd.ExecuteReaderAsync(ct);

        var points = new List<TimeSeriesPoint>();
        while (await reader.ReadAsync(ct))
        {
            var bucket = reader.GetDateTime(0);
            var value = reader.GetDouble(1);
            var ts = new DateTimeOffset(bucket, TimeSpan.Zero).ToUnixTimeSeconds();
            points.Add(new TimeSeriesPoint(ts, value));
        }
        return points;
    }

    private async Task<List<long>> GetChildGidsAsync(NpgsqlConnection conn, long parentGid, CancellationToken ct)
    {
        const string sql = "SELECT child_device_gid FROM panel_hierarchy WHERE parent_device_gid = @gid";
        await using var cmd = new NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("gid", parentGid);
        await using var reader = await cmd.ExecuteReaderAsync(ct);

        var gids = new List<long>();
        while (await reader.ReadAsync(ct))
            gids.Add(reader.GetInt64(0));
        return gids;
    }

    // ── Home Total (US2 — T037) ──

    public async Task<HomeTotalResponse> GetHomeTotalAsync(CancellationToken ct = default)
    {
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        await EnsureSettingsTablesAsync(conn, ct);

        // Top-level panels = devices NOT listed as children in panel_hierarchy
        const string sql = """
            SELECT d.device_gid, d.device_name,
                   dno.display_name AS device_override
            FROM vue_devices d
            LEFT JOIN display_name_overrides dno
                ON dno.device_gid = d.device_gid AND dno.channel_number IS NULL
            WHERE d.device_gid NOT IN (
                SELECT child_device_gid FROM panel_hierarchy
            )
            ORDER BY d.device_name
            """;

        await using var cmd = new NpgsqlCommand(sql, conn);
        await using var reader = await cmd.ExecuteReaderAsync(ct);

        var panelRows = new List<(long gid, string displayName)>();
        while (await reader.ReadAsync(ct))
        {
            var gid = reader.GetInt64(0);
            var name = reader.IsDBNull(1) ? null : reader.GetString(1);
            var overrideName = reader.IsDBNull(2) ? null : reader.GetString(2);
            panelRows.Add((gid, ResolveDeviceDisplayName(overrideName, name, gid)));
        }
        await reader.CloseAsync();

        var panels = new List<PanelChild>();
        double totalWatts = 0;
        foreach (var (gid, displayName) in panelRows)
        {
            var mainsResult = await GetLatestMainsAsync(conn, gid, ct);
            var mains = mainsResult?.value ?? 0;
            panels.Add(new PanelChild(gid, displayName, mains));
            totalWatts += mains;
        }

        return new HomeTotalResponse(
            Timestamp: DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            TotalWatts: totalWatts,
            Panels: panels
        );
    }

    // ── Home Total Range (US2 — T038) ──

    public async Task<HomeTotalRangeResponse> GetHomeTotalRangeAsync(
        DateTimeOffset start, DateTimeOffset end,
        string? step = null, CancellationToken ct = default)
    {
        var range = end - start;
        var resolvedStep = step ?? AutoResolveStep(range);
        var stepInterval = ParseStep(resolvedStep);

        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);

        // Get top-level panel GIDs
        const string gidSql = """
            SELECT device_gid FROM vue_devices
            WHERE device_gid NOT IN (SELECT child_device_gid FROM panel_hierarchy)
            """;
        await using var gidCmd = new NpgsqlCommand(gidSql, conn);
        await using var gidReader = await gidCmd.ExecuteReaderAsync(ct);

        var topLevelGids = new List<long>();
        while (await gidReader.ReadAsync(ct))
            topLevelGids.Add(gidReader.GetInt64(0));
        await gidReader.CloseAsync();

        // Sum mains series for all top-level panels
        var totalByTimestamp = new SortedDictionary<long, double>();
        foreach (var gid in topLevelGids)
        {
            var series = await GetMainsSeriesAsync(conn, gid, start, end, stepInterval, ct);
            foreach (var pt in series)
            {
                if (!totalByTimestamp.ContainsKey(pt.Timestamp))
                    totalByTimestamp[pt.Timestamp] = 0;
                totalByTimestamp[pt.Timestamp] += pt.Value;
            }
        }

        var totalSeries = totalByTimestamp.Select(kvp =>
            new TimeSeriesPoint(kvp.Key, kvp.Value)
        ).ToList();

        return new HomeTotalRangeResponse(
            Start: start.ToString("o"),
            End: end.ToString("o"),
            Step: resolvedStep,
            Total: totalSeries
        );
    }

    // ── Bulk Current Readings ──

    public async Task<VueBulkCurrentReadingsResponse> GetBulkCurrentReadingsAsync(CancellationToken ct = default)
    {
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        await EnsureSettingsTablesAsync(conn, ct);

        // Get all devices
        const string deviceSql = "SELECT device_gid FROM vue_devices ORDER BY device_gid";
        await using var deviceCmd = new NpgsqlCommand(deviceSql, conn);
        await using var deviceReader = await deviceCmd.ExecuteReaderAsync(ct);
        var deviceGids = new List<long>();
        while (await deviceReader.ReadAsync(ct))
            deviceGids.Add(deviceReader.GetInt64(0));
        await deviceReader.CloseAsync();

        var devices = new List<VueDeviceCurrentReadings>();
        foreach (var gid in deviceGids)
        {
            const string sql = """
                SELECT DISTINCT ON (vr.channel_num)
                       vr.channel_num,
                       EXTRACT(EPOCH FROM vr.timestamp)::bigint AS ts,
                       vr.value,
                       vc.name AS channel_name,
                       dno.display_name AS channel_override
                FROM vue_readings vr
                LEFT JOIN vue_channels vc ON vc.device_gid = vr.device_gid AND vc.channel_num = vr.channel_num
                LEFT JOIN display_name_overrides dno ON dno.device_gid = vr.device_gid AND dno.channel_number = vr.channel_num
                WHERE vr.device_gid = @gid
                ORDER BY vr.channel_num, vr.timestamp DESC
                """;

            await using var cmd = new NpgsqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("gid", gid);
            await using var reader = await cmd.ExecuteReaderAsync(ct);

            var channels = new List<VueChannelReading>();
            long latestTs = 0;
            while (await reader.ReadAsync(ct))
            {
                var channelNum = reader.GetString(0);
                var ts = reader.GetInt64(1);
                var value = reader.GetDouble(2);
                var channelName = reader.IsDBNull(3) ? null : reader.GetString(3);
                var channelOverride = reader.IsDBNull(4) ? null : reader.GetString(4);

                if (ts > latestTs) latestTs = ts;
                channels.Add(new VueChannelReading(
                    ChannelNum: channelNum,
                    DisplayName: ResolveDisplayName(channelOverride, channelName, channelNum),
                    Value: value
                ));
            }

            devices.Add(new VueDeviceCurrentReadings(gid, latestTs, channels));
        }

        return new VueBulkCurrentReadingsResponse(devices);
    }

    // ── Daily Readings ──

    public async Task<VueBulkDailyReadingsResponse> GetDailyReadingsAsync(DateOnly date, CancellationToken ct = default)
    {
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        await EnsureSettingsTablesAsync(conn, ct);

        const string sql = """
            SELECT vrd.device_gid, vrd.channel_num, vrd.kwh,
                   vc.name AS channel_name,
                   dno.display_name AS channel_override
            FROM vue_readings_daily vrd
            LEFT JOIN vue_channels vc ON vc.device_gid = vrd.device_gid AND vc.channel_num = vrd.channel_num
            LEFT JOIN display_name_overrides dno ON dno.device_gid = vrd.device_gid AND dno.channel_number = vrd.channel_num
            WHERE vrd.date = @date
            ORDER BY vrd.device_gid, vrd.channel_num
            """;

        await using var cmd = new NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("date", date);
        await using var reader = await cmd.ExecuteReaderAsync(ct);

        var deviceMap = new Dictionary<long, List<VueDailyChannelReading>>();
        while (await reader.ReadAsync(ct))
        {
            var deviceGid = reader.GetInt64(0);
            var channelNum = reader.GetString(1);
            var kwh = reader.GetDouble(2);
            var channelName = reader.IsDBNull(3) ? null : reader.GetString(3);
            var channelOverride = reader.IsDBNull(4) ? null : reader.GetString(4);

            if (!deviceMap.ContainsKey(deviceGid))
                deviceMap[deviceGid] = new List<VueDailyChannelReading>();

            deviceMap[deviceGid].Add(new VueDailyChannelReading(
                ChannelNum: channelNum,
                DisplayName: ResolveDisplayName(channelOverride, channelName, channelNum),
                Kwh: kwh
            ));
        }

        var devices = deviceMap.Select(kvp => new VueDeviceDailyReadings(kvp.Key, kvp.Value)).ToList();

        return new VueBulkDailyReadingsResponse(date.ToString("yyyy-MM-dd"), devices);
    }
}
