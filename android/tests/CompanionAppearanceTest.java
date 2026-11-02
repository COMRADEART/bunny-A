package com.routeragent.jev;

/** JVM checks for the E3-A device-local appearance model: strict schema reads, the published Glass Intensity mapping,
 *  and the fixed material palettes. Pure JDK (the Context-facing parts are exercised by review and device rounds). */
public final class CompanionAppearanceTest {
    private static int checked = 0;

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
        checked++;
    }

    private static void refuse(String variant, int intensity, String message) {
        check(CompanionAppearance.of(variant, intensity) == null, message);
    }

    private static void defaultOf(String raw, String message) {
        check(CompanionAppearance.DEFAULT.equals(CompanionAppearance.parse(raw)), message);
    }

    public static void main(String[] args) {
        // Validation: canonical variants and bounded whole intensities; anything else refused (never coerced).
        check("system".equals(CompanionAppearance.of("system", 85).variant()), "system accepted");
        check(CompanionAppearance.of("light", 0) != null, "light at 0 accepted");
        check(CompanionAppearance.of("dark", 100) != null, "dark at 100 accepted");
        refuse("sepia", 85, "unknown variant refused");
        refuse("SYSTEM", 85, "canonical set is case-sensitive");
        refuse(null, 85, "a null variant is refused");
        refuse("dark", -1, "negative intensity refused");
        refuse("dark", 101, "over-100 intensity refused");
        defaultOf("{\"schema\":\"bunny.native.appearance.v1\",\"variant\":\"dark\",\"glassIntensity\":-3}", "out-of-range intensity reads as default");
        defaultOf("{\"schema\":\"bunny.native.appearance.v1\",\"variant\":\"dark\",\"glassIntensity\":1.5}", "a fractional intensity reads as default");

        // The stored row: exactly schema+variant+glassIntensity; unknown keys, foreign schemas, damage and
        // missing fields all read back as DEFAULT, never as a partial look.
        CompanionAppearance parsed = CompanionAppearance.parse("{\"schema\":\"bunny.native.appearance.v1\",\"variant\":\"dark\",\"glassIntensity\":42}");
        check("dark".equals(parsed.variant()) && parsed.glassIntensity() == 42, "the stored row round-trips");
        defaultOf(null, "a null row reads as default");
        defaultOf("", "an empty row reads as default");
        defaultOf("{oops", "damaged JSON reads as default");
        defaultOf("{\"schema\":\"bunny.a.other.v9\",\"variant\":\"dark\",\"glassIntensity\":42}", "a foreign schema reads as default");
        defaultOf("{\"schema\":\"bunny.native.appearance.v1\",\"variant\":\"sepia\",\"glassIntensity\":42}", "an invalid variant reads as default");
        defaultOf("{\"schema\":\"bunny.native.appearance.v1\",\"variant\":\"dark\",\"glassIntensity\":42,\"theme\":\"pixel\"}", "an unknown key on the row is refused");
        defaultOf("{\"schema\":\"bunny.native.appearance.v1\",\"glassIntensity\":42}", "a missing variant reads as default");

        // The published mapping (identical formulas to the workstation): exact anchors.
        check(CompanionAppearance.rimAlpha(0) == 0.30, "rim 0.30 at 0");
        check(CompanionAppearance.rimAlpha(50) == 0.65, "rim 0.65 at 50");
        check(CompanionAppearance.rimAlpha(85) == 0.895, "rim 0.895 at the default 85");
        check(CompanionAppearance.rimAlpha(100) == 1.0, "rim 1.0 at 100");
        check(CompanionAppearance.clearAlpha255(0) == 0, "clear 0 at 0");
        check(CompanionAppearance.clearAlpha255(85) == 13, "clear 13/255 at the default 85");
        check(CompanionAppearance.clearAlpha255(100) == 15, "clear 15/255 at 100");

        // Panels: the glass base carries the clear term, floored at 0.45 alpha; never opaque-milky, never invisible.
        int graphite = CompanionAppearance.panelWithClear(CompanionAppearance.Palette.GRAPHITE.panel, 85);
        check((graphite >>> 24) == 155, "graphite panel at default 85: 168 base minus 13 clear = 155 (glass, disclosed in the PR)");
        check((CompanionAppearance.panelWithClear(CompanionAppearance.Palette.GRAPHITE.panel, 0) >>> 24) == 168, "intensity 0 keeps the base panel");
        int silver = CompanionAppearance.panelWithClear(CompanionAppearance.Palette.SILVER.panel, 100);
        check((silver >>> 24) == 148, "silver panel at 100: 163 minus 15 = 148");
        check((CompanionAppearance.panelWithClear(0x22FFFFFF, 100) >>> 24) == 115, "the 0.45 floor holds");
        int clamped = CompanionAppearance.panelWithClear(0x40FFFFFF, 50);
        check((clamped >>> 24) == 115 && (clamped & 0xFFFFFF) == 0xFFFFFF, "the floor keeps the panel color untouched");

        // The rim stroke: the palette's own glint at the mapped strength.
        check((CompanionAppearance.rimStroke(85, CompanionAppearance.Palette.GRAPHITE.rim) >>> 24) == 228, "rim stroke at 85 uses alpha 228");
        check((CompanionAppearance.rimStroke(0, CompanionAppearance.Palette.GRAPHITE.rim) & 0xFFFFFF) == (CompanionAppearance.Palette.GRAPHITE.rim & 0xFFFFFF), "the rim color rides the stroke");

        // The palettes: the accepted bytes, pinned (the T13/workstation glass values).
        check(CompanionAppearance.Palette.SILVER.page == 0xFFEEF2FB, "silver page");
        check(CompanionAppearance.Palette.SILVER.panel == 0xA3FFFFFF, "silver panel base alpha 0.64");
        check(CompanionAppearance.Palette.SILVER.accent == 0xFF4A5BE0, "silver accent");
        check(CompanionAppearance.Palette.GRAPHITE.page == 0xFF0A0D16, "graphite page");
        check(CompanionAppearance.Palette.GRAPHITE.panel == 0xA8141826, "graphite panel base alpha 0.66");
        check(CompanionAppearance.Palette.GRAPHITE.accent == 0xFF8EA2FF, "graphite accent");
        check(CompanionAppearance.Palette.GRAPHITE.rim == 0xFFDFE6F5, "graphite rim is a cool white glint");

        check(CompanionAppearance.DEFAULT.glassIntensity() == 85, "factory default intensity 85");

        System.out.println("CompanionAppearanceTest: " + checked + " checks passed");
        if (checked < 30) throw new AssertionError("suspiciously few checks ran: " + checked);
    }
}