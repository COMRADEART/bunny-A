using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

namespace BunnyA.Services;

/// <summary>
/// E2b: one personal slot's character skin from the Host (snapshot.characterAppearance), with the installed PS island's
/// fallback rules (install/Bunny-Island.Characters.ps1 Get-BunnyCharacterSlotSkin): an unknown style value falls back to
/// the weapon's signature, an unknown intensity to full, and a damaged row only drops that row. Presentation only.
/// </summary>
public sealed record SlotAppearance(string? Style, string Intensity, bool HighContrast)
{
    /// <summary>The PS island's Animate flag: intensity off holds the character still.</summary>
    public bool Animate => Intensity != "off";
    /// <summary>Motion amplitude: full 1.0, subtle 0.5 — applied to every loop's travel (never its easing).</summary>
    public double Amplitude => Intensity == "subtle" ? 0.5 : 1.0;
    /// <summary>The PS island's subtle runs loops at 1.6x the base period.</summary>
    public double PeriodScale => Intensity == "subtle" ? 1.6 : 1.0;
}

/// <summary>
/// E2b: the canonical character-art mapping, ported from the web engine (src/components/island/character-model.ts
/// STATE_POSE / POSES / weaponArtId) and the PS island's style table (BunnyStyleEffect). Pure data — no WPF types, no
/// side effects — so BunnyA.Tests can pin it without NuGet sources. A weapon's identity is never changed by any style,
/// and a non-weapon identity ("task", providers) never resolves to character art.
/// </summary>
public static class CharacterArt
{
    /// <summary>The pose tiles' names as the web engine defines them (POSE_SLOTS in notch-state-map.ts, same order).</summary>
    public static readonly string[] PoseSlots = ["idle", "research", "coding", "testing", "complete"];

    /// <summary>Signed styles; a resolved style equal to the weapon's means the Host sent no override (or an unknown one).</summary>
    public static readonly string[] Styles = ["glossy", "cel", "arcade", "comic", "pixel"];
    public static readonly string[] Intensities = ["full", "subtle", "off"];
    public static string Signature(string weapon) => weapon switch
    {
        "gada" => "glossy",
        "spear" => "cel",
        "chakra" => "arcade",
        "sword" => "comic",
        _ => "glossy",
    };

    /// <summary>The PS island's BunnyStyleEffect as a WPF DropShadowEffect spec: color, blur radius, shadow depth, opacity.</summary>
    public static (string Color, double Blur, double Depth, double Opacity)? StyleEffect(string? style) => style switch
    {
        "glossy" => ("#FFD27A", 8, 0, 0.55),
        "cel" => ("#05060A", 0, 1.2, 1.0),
        "arcade" => ("#2EF2FF", 10, 0, 0.8),
        "comic" => ("#000000", 2.5, 0, 1.0),
        _ => null, // pixel renders nearest-neighbour instead of with an effect; unknown/null stay plain.
    };

    /// <summary>Chakra and Sword have no fifth pose on the board: their complete tile is the hero art.</summary>
    private static readonly Dictionary<string, Dictionary<string, string>> Poses = new()
    {
        ["gada"] = new() { ["idle"] = "gada.pose1", ["research"] = "gada.pose2", ["coding"] = "gada.pose3", ["testing"] = "gada.pose4", ["complete"] = "gada.pose5" },
        ["spear"] = new() { ["idle"] = "spear.pose1", ["research"] = "spear.pose2", ["coding"] = "spear.pose3", ["testing"] = "spear.pose4", ["complete"] = "spear.pose5" },
        ["chakra"] = new() { ["idle"] = "chakra.pose1", ["research"] = "chakra.pose2", ["coding"] = "chakra.pose3", ["testing"] = "chakra.pose4", ["complete"] = "chakra.hero" },
        ["sword"] = new() { ["idle"] = "sword.pose1", ["research"] = "sword.pose2", ["coding"] = "sword.pose3", ["testing"] = "sword.pose4", ["complete"] = "sword.hero" },
    };

    /// <summary>The board interpretation (character-model.ts STATE_POSE): researching tiles, coding (and file work) tiles,
    /// testing and verifying tiles, completed outcomes; everything else, including failed and waiting, stays idle.</summary>
    public static string PoseSlotFor(string presentationState) => presentationState switch
    {
        "RESEARCHING" => "research",
        "CODING" or "FILE_WORK" => "coding",
        "TESTING" or "VERIFYING" => "testing",
        "COMPLETED" or "VERIFIED" => "complete",
        _ => "idle",
    };

    /// <summary>
    /// The art id for a weapon, mirroring the web's weaponArtId. compact is the chip art, hero the identity well and
    /// chakra/sword's complete tile; pose resolves through STATE_POSE. Returns null (refuses) for anything that is not
    /// one of the four weapons, so a provider or a task chip can never be drawn as a character.
    /// </summary>
    public static string? WeaponArtId(string identity, string presentationState, string size) =>
        identity is not ("gada" or "spear" or "chakra" or "sword") ? null
        : size switch
        {
            "hero" => $"{identity}.hero",
            "pose" => Poses[identity][PoseSlotFor(presentationState)],
            _ => $"{identity}.compact",
        };

    /// <summary>
    /// The per-slot appearances in this snapshot, keyed by slot (1-4 only), with the PS island's per-row fallbacks: a
    /// row whose style is unknown keeps its signature (no entry), an unknown intensity reads as full, and a malformed
    /// or absent view simply yields no entries. Never throws; never touches anything but this optional block.
    /// </summary>
    public static Dictionary<int, SlotAppearance> Appearances(JsonElement root)
    {
        var map = new Dictionary<int, SlotAppearance>();
        if (root.ValueKind != JsonValueKind.Object) return map;
        var view = root.JsonObj("characterAppearance");
        if (view.ValueKind != JsonValueKind.Object) return map;
        foreach (var row in view.JsonArr("slots"))
        {
            if (row.ValueKind != JsonValueKind.Object) continue;
            var slot = row.JsonLong("slot");
            if (slot is < 1 or > 4) continue;
            var appearance = row.JsonObj("appearance");
            if (appearance.ValueKind != JsonValueKind.Object) continue;
            var style = appearance.Json("style") is { } s && Styles.Contains(s) ? s : null;
            var intensity = appearance.Json("intensity") is { } i && Intensities.Contains(i) ? i : "full";
            map[(int)slot] = new SlotAppearance(style, intensity, appearance.JsonBool("highContrast"));
        }
        return map;
    }
}