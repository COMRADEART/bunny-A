using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

namespace BunnyA.Services;

/// <summary>
/// E2b: the Host's notch theme tokens (snapshot.uiTheme.notch), validated to the same rules the installed island
/// enforces (install/Bunny-Island.Theme.ps1): the schema literal "bunny-a.ui-theme.v1", a theme id pattern, the shape
/// and font allowlists, radius 0-40, border 0-4, the variant set, and both palettes' eight flat #rrggbb colors. The
/// E1 glass block (intensity 0-100 + rim/sheen alphas 0..1) rides additively; a malformed decoration block drops only
/// itself. Any other invalid value makes the whole set null, and the notch keeps its local config theme (unchanged
/// fallback). Theme data is never evaluated or executed, and nothing here reads or changes what Bunny A may do.
/// </summary>
public sealed record NotchGlassTokens(int Intensity, double RimAlpha, double SheenAlpha);

public sealed record NotchTokens(
    string Theme, string Name, string Shape, string Font, int Radius, int Border, bool Glow, bool HighContrast,
    string Variant, int Revision, IReadOnlyDictionary<string, string> Colors, NotchGlassTokens? Glass)
{
    public static readonly string[] Shapes = ["pill", "capsule", "block", "frame", "tab", "blob", "plate"];
    public static readonly string[] Fonts =
    [
        "Segoe UI Variable Display", "Segoe UI", "Segoe UI Semibold", "Bahnschrift", "Cascadia Mono", "Consolas",
        "Georgia", "Cambria", "Palatino Linotype", "Constantia", "Segoe Print", "Ink Free", "Courier New",
        "Sitka Text", "Candara", "Corbel", "Lucida Console",
    ];
    private static readonly string[] ColorKeys = ["fill", "fillEnd", "stroke", "ink", "muted", "accent", "accentInk", "glow"];
    private static readonly string[] Variants = ["system", "light", "dark"];

    /// <summary>One side's flat color (light or dark) as saved, upper-case, without rewriting anything.</summary>
    public string Color(bool light, string key) =>
        Colors.TryGetValue($"{(light ? "light" : "dark")}:{key}", out var value) ? value : "";

    /// <summary>The appearance shown: a saved workstation variant (revision &gt; 0, not "system") wins; then the notch's
    /// own setting ("Light"/"Dark"/"System"); then Windows' — the island's Get-BunnyThemeLight rule, byte for byte.</summary>
    public bool Light(string notchTheme, bool windowsLight) =>
        Revision > 0 && Variant != "system" ? Variant == "light"
        : notchTheme == "Light" ? true
        : notchTheme == "Dark" ? false
        : windowsLight;

    /// <summary>A stable restyle key (the island's exact shape, plus the E1 glass values): restyle only when this differs.</summary>
    public string Key =>
        $"{Theme}|{Revision}|{Variant}|{HighContrast}" + (Glass is { } glass ? $"|{glass.Intensity}|{glass.RimAlpha:0.###}|{glass.SheenAlpha:0.###}" : "");

    public static NotchTokens? From(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object) return null;
        var notch = root.JsonObj("uiTheme").JsonObj("notch");
        if (notch.ValueKind != JsonValueKind.Object) return null;
        if (notch.Json("schema") != "bunny-a.ui-theme.v1") return null;

        var theme = notch.Json("theme");
        if (theme is not { Length: >= 2 and <= 16 } || !theme.All(c => c is (>= 'a' and <= 'z') or (>= '0' and <= '9'))) return null;
        var shape = notch.Json("shape");
        var font = notch.Json("font");
        var variant = notch.Json("variant");
        if (shape is null || !Shapes.Contains(shape) || font is null || !Fonts.Contains(font) || variant is null || !Variants.Contains(variant)) return null;
        var radius = Bounded(notch, "radius", 0, 40);
        var border = Bounded(notch, "border", 0, 4);
        if (radius is null || border is null) return null;

        var colors = new Dictionary<string, string>();
        foreach (var side in new[] { "light", "dark" })
        {
            var palette = notch.JsonObj(side);
            if (palette.ValueKind != JsonValueKind.Object) return null;
            foreach (var key in ColorKeys)
            {
                var value = palette.Json(key);
                if (value is not { Length: 7 } || value[0] != '#' || !value[1..].All(c => c is (>= '0' and <= '9') or (>= 'a' and <= 'f') or (>= 'A' and <= 'F'))) return null;
                colors[$"{side}:{key}"] = value.ToUpperInvariant();
            }
        }

        // The optional E1 glass block: present only when every value is valid; malformed values drop only the block.
        NotchGlassTokens? glass = null;
        var rawGlass = notch.JsonObj("glass");
        if (rawGlass.ValueKind == JsonValueKind.Object)
        {
            var intensity = Bounded(rawGlass, "intensity", 0, 100);
            var rim = Unit(rawGlass, "rimAlpha");
            var sheen = Unit(rawGlass, "sheenAlpha");
            if (intensity is { } i && rim is { } r && sheen is { } s) glass = new NotchGlassTokens((int)i, r, s);
        }

        var rawName = notch.Json("name") ?? "Bunny A";
        return new NotchTokens(theme, rawName[..Math.Min(40, rawName.Length)], shape, font, (int)radius.Value, (int)border.Value,
            notch.JsonBool("glow"), notch.JsonBool("highContrast"), variant, (int)(root.JsonLong("revision")), colors, glass);

        static long? Bounded(JsonElement element, string name, long min, long max)
        {
            if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Number || !value.TryGetInt64(out var number)) return null;
            return number >= min && number <= max ? number : null;
        }

        static double? Unit(JsonElement element, string name)
        {
            if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Number) return null;
            var number = value.GetDouble();
            return double.IsFinite(number) && number >= 0 && number <= 1 ? number : null;
        }
    }
}