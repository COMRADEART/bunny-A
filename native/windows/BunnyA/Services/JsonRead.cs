using System.Collections.Generic;
using System.Text.Json;

namespace BunnyA.Services;

public static class JsonRead
{
    /// <summary>A string property, or null when absent or of another kind. Never throws on Host data.</summary>
    public static string? Json(this JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    public static long JsonLong(this JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var n) ? n : 0;
    public static bool JsonBool(this JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;
    public static JsonElement JsonObj(this JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Object ? v : default;
    public static IEnumerable<JsonElement> JsonArr(this JsonElement e, string name)
    {
        if (e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array)
            foreach (var item in v.EnumerateArray()) if (item.ValueKind == JsonValueKind.Object || item.ValueKind == JsonValueKind.String) yield return item;
    }
}
