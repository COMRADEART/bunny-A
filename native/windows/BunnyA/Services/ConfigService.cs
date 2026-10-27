using System;
using System.IO;
using System.Text.Json;

namespace BunnyA.Services;

public sealed record AppConfiguration
{
    public string NotchEdge { get; init; } = "Top";
    public double NotchOffsetRatio { get; init; } = 0.5;
    public bool NotchExpanded { get; init; } = false;
    public bool ReducedMotion { get; init; } = false;
    public string PinnedModel { get; init; } = "auto";
    public bool StartupLaunch { get; init; } = false;
}

public static class ConfigService
{
    private static readonly string ConfigDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "BunnyA"
    );
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
