using System;
using System.IO;
using System.Text.Json;

namespace BunnyA.Services;

public sealed record AppConfiguration
{
    public string NotchEdge { get; init; } = "Top";
    public double NotchOffsetRatio { get; init; } = 0.5;
    // Older builds wrote an unused NotchExpanded=false; a new name keeps their notch expanded.
    public bool NotchCollapsed { get; init; } = false;
    // Physical pixels of the notch's last top-left corner; it picks the monitor to restore to.
    public double? NotchLeft { get; init; }
    public double? NotchTop { get; init; }
    public bool ReducedMotion { get; init; } = false;
    public string PinnedModel { get; init; } = "auto";
    public bool StartupLaunch { get; init; } = false;
}

public static class ConfigService
{
    // BUNNY_CONFIG_DIRECTORY isolates acceptance runs from the owner's real settings.
    private static readonly string ConfigDir = Environment.GetEnvironmentVariable("BUNNY_CONFIG_DIRECTORY") is { Length: > 0 } dir
        ? dir
        : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BunnyA");
    private static readonly string ConfigPath = Path.Combine(ConfigDir, "config.json");

    public static AppConfiguration Load()
    {
        try
        {
            if (File.Exists(ConfigPath))
            {
                var text = File.ReadAllText(ConfigPath);
                var config = JsonSerializer.Deserialize<AppConfiguration>(text);
                if (config != null) return config;
            }
        }
        catch { }
        return new AppConfiguration();
    }

    public static void Save(AppConfiguration config)
    {
        try
        {
            Directory.CreateDirectory(ConfigDir);
            var json = JsonSerializer.Serialize(config, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(ConfigPath, json);
        }
        catch { }
    }
}
