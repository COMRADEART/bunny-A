/**
 * Visual Experience 2.0: the UI theme registry (pure). A theme is presentation configuration only. It decides typography,
 * colour, materials, geometry, layout composition, navigation treatment, motion language, the Notch's look, the Agent Studio
 * frame and the phone's chrome. It never decides what Bunny A or an Agent may do, what an Agent remembers, which models or
 * harnesses it may use, or who may approve anything: no function here reads or returns authority, and the Host stores the
 * preference apart from every execution table.
 *
 * Every manifest is plain data (strings and numbers). Theme data never carries code, URLs or markup, and the only
 * user-supplied value that reaches styling (an accent colour) is a strict #rrggbb string checked for contrast first.
 */

export const UI_THEME_SCHEMA = "bunny-a.ui-theme.v2";
/**
 * The previous preference schema, still readable (no user choice is lost); it is also the native Notch's exact-match
 * token string — the installed island validates that literal (install/Bunny-Island.Theme.ps1) and silently ignores unknown
 * keys, so the notch token channel keeps its spelling and its v1 semantics. E1 (Glass Intensity) splits the two constants.
 */
export const UI_THEME_SCHEMA_V1 = "bunny-a.ui-theme.v1";
export const NOTCH_THEME_SCHEMA = UI_THEME_SCHEMA_V1;
/** Every preference schema this build accepts: the writer stamps UI_THEME_SCHEMA, older v1 rows parse in unchanged. */
export const PREFERENCE_SCHEMAS = [UI_THEME_SCHEMA, UI_THEME_SCHEMA_V1] as const;

export const UI_THEME_IDS = [
  "clay", "cybercore", "brutalism", "scrapbook", "surreal", "y2k", "pixel", "synthwave", "glass", "neumorph", "bento",
  "editorial", "swiss", "minimal", "maximal", "luxury", "sketch", "ethereal", "bohemian", "victorian", "cyberpunk", "wabisabi",
] as const;
export type UiThemeId = (typeof UI_THEME_IDS)[number];
/** The accepted T13 glass workspace is the system default and the fallback for anything that cannot load. */
export const DEFAULT_UI_THEME: UiThemeId = "glass";

export type Variant = "light" | "dark";
export const VARIANT_CHOICES = ["system", "light", "dark"] as const;
export type VariantChoice = (typeof VARIANT_CHOICES)[number];
export const DENSITIES = ["theme", "compact", "comfortable", "spacious"] as const;
export type DensityChoice = (typeof DENSITIES)[number];
export const TRANSPARENCIES = ["low", "medium", "high"] as const;
export type Transparency = (typeof TRANSPARENCIES)[number];

/** The shell composition. Each is one CSS layout over the same components; none changes what a control does. */
export type Layout = "sidebar" | "rail" | "topnav" | "bento" | "floating" | "window";
/** The Chat landing composition. */
export type HomeComposition = "stack" | "bento" | "editorial" | "focus" | "collage" | "console" | "grid" | "window";
/** How the Agent Studio frames the four weapon characters. */
export type StudioFrame = "cards" | "gallery" | "list" | "frames" | "polaroid" | "sprites" | "hud";
export type NavTreatment = "pill" | "underline" | "block" | "glow" | "bracket" | "ink" | "ornament" | "pixel" | "tab" | "dot";
export type PhoneNav = "bar" | "floating" | "block" | "pill" | "window";
export type IconTreatment = "outline" | "bold" | "thin" | "pixel" | "hand" | "glow" | "engraved";
export type AgentFrame = "rounded" | "square" | "circle" | "pixel" | "polaroid" | "ornate" | "hex" | "blob" | "ticket";
export type NotchShape = "pill" | "capsule" | "block" | "frame" | "tab" | "blob" | "plate";
export type Material = "glass" | "solid" | "clay" | "neu" | "paper" | "brutal" | "neon" | "pixel" | "ornate" | "sketch" | "mist" | "chrome" | "linen";

/** Fonts the web build bundles locally (all SIL OFL 1.1 via @fontsource, no network at runtime). */
export const FONT_STACKS = {
  segoe: '"Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
  inter: '"Inter Variable", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
  nunito: '"Nunito", "Segoe UI", system-ui, sans-serif',
  comfortaa: '"Comfortaa", "Segoe UI", system-ui, sans-serif',
  grotesk: '"Space Grotesk", "Segoe UI", system-ui, sans-serif',
  mono: '"JetBrains Mono", "Cascadia Mono", Consolas, monospace',
  orbitron: '"Orbitron", "Bahnschrift", "Segoe UI", sans-serif',
  pixel: '"Pixelify Sans", "Lucida Console", Consolas, monospace',
  hand: '"Caveat", "Segoe Print", "Ink Free", cursive',
  chakra: '"Chakra Petch", "Bahnschrift", "Segoe UI", sans-serif',
  mincho: '"Shippori Mincho", "Yu Mincho", Georgia, serif',
  quicksand: '"Quicksand", "Segoe UI", system-ui, sans-serif',
  fraunces: '"Fraunces", Georgia, "Times New Roman", serif',
  cormorant: '"Cormorant Garamond", Garamond, Georgia, serif',
  playfair: '"Playfair Display", Georgia, "Times New Roman", serif',
} as const;
export type FontKey = keyof typeof FONT_STACKS;
export const FONT_PROVENANCE: Record<Exclude<FontKey, "segoe">, { family: string; package: string; license: "OFL-1.1" }> = {
  inter: { family: "Inter Variable", package: "@fontsource-variable/inter", license: "OFL-1.1" },
  nunito: { family: "Nunito", package: "@fontsource/nunito", license: "OFL-1.1" },
  comfortaa: { family: "Comfortaa", package: "@fontsource/comfortaa", license: "OFL-1.1" },
  grotesk: { family: "Space Grotesk", package: "@fontsource/space-grotesk", license: "OFL-1.1" },
  mono: { family: "JetBrains Mono", package: "@fontsource/jetbrains-mono", license: "OFL-1.1" },
  orbitron: { family: "Orbitron", package: "@fontsource/orbitron", license: "OFL-1.1" },
  pixel: { family: "Pixelify Sans", package: "@fontsource/pixelify-sans", license: "OFL-1.1" },
  hand: { family: "Caveat", package: "@fontsource/caveat", license: "OFL-1.1" },
  chakra: { family: "Chakra Petch", package: "@fontsource/chakra-petch", license: "OFL-1.1" },
  mincho: { family: "Shippori Mincho", package: "@fontsource/shippori-mincho", license: "OFL-1.1" },
  quicksand: { family: "Quicksand", package: "@fontsource/quicksand", license: "OFL-1.1" },
  fraunces: { family: "Fraunces", package: "@fontsource/fraunces", license: "OFL-1.1" },
  cormorant: { family: "Cormorant Garamond", package: "@fontsource/cormorant-garamond", license: "OFL-1.1" },
  playfair: { family: "Playfair Display", package: "@fontsource/playfair-display", license: "OFL-1.1" },
};
/** Windows system fonts the native Notch may use (WPF cannot see the bundled web fonts). */
export const NOTCH_FONTS = [
  "Segoe UI Variable Display", "Segoe UI", "Segoe UI Semibold", "Bahnschrift", "Cascadia Mono", "Consolas", "Georgia", "Cambria",
  "Palatino Linotype", "Constantia", "Segoe Print", "Ink Free", "Courier New", "Sitka Text", "Candara", "Corbel", "Lucida Console",
] as const;
export type NotchFont = (typeof NOTCH_FONTS)[number];

/** Colour roles. Text roles (fg, muted, positive, negative, warning, working) are checked for 4.5:1 on their surfaces. */
export type Palette = {
  page: string;
  washA: string;
  washB: string;
  fg: string;
  muted: string;
  /** The primary surface; may be translucent (it is composited over page and washes for every contrast check). */
  panel: string;
  /** The opaque fallback: reduced transparency, high contrast and no backdrop-filter support. */
  panelSolid: string;
  elevated: string;
  field: string;
  border: string;
  edge: string;
  hover: string;
  pressed: string;
  action: string;
  actionInk: string;
  focus: string;
  working: string;
  workingSoft: string;
  positive: string;
  negative: string;
  warning: string;
  /** A decorative colour for ornaments, never used for text. */
  decor: string;
  shadow: string;
  raisedShadow: string;
};

export type ThemeManifest = {
  id: UiThemeId;
  number: number;
  name: string;
  philosophy: string;
  description: string;
  variants: readonly Variant[];
  defaultVariant: Variant;
  layout: Layout;
  home: HomeComposition;
  studio: StudioFrame;
  nav: NavTreatment;
  phoneNav: PhoneNav;
  material: Material;
  /** Backdrop blur in px for translucent materials (0 = none). */
  blur: number;
  typography: {
    body: FontKey;
    display: FontKey;
    mono: FontKey;
    headingWeight: number;
    /** CSS letter-spacing for headings, e.g. "-0.02em". */
    headingTracking: string;
    headingCase: "none" | "uppercase";
    /** Multiplier on the display heading size. */
    displayScale: number;
    /** Multiplier on body text (before the viewer's own font scale). */
    bodyScale: number;
  };
  geometry: { rSm: number; rMd: number; rLg: number; rShell: number; border: number; density: Exclude<DensityChoice, "theme"> };
  motion: { language: string; quick: number; base: number; ease: string; enter: string; description: string };
  icons: { stroke: number; treatment: IconTreatment };
  agentFrame: AgentFrame;
  notch: { shape: NotchShape; radius: number; border: number; glow: boolean; font: NotchFont; description: string };
  palettes: Partial<Record<Variant, Palette>>;
  /** Effects that cost frames (blur, glow, continuous ambient motion) and what replaces them under low power or reduced motion. */
  performance: { heavy: readonly string[]; fallback: string };
  /** Original asset provenance: every theme is procedural CSS/SVG over the user's own board art. */
  assets: string;
};

const sh = (shadow: string, raised: string) => ({ shadow, raisedShadow: raised });

// --------------------------------------------------------------------------------------------------------------- manifests
const T: ThemeManifest[] = [
  {
    id: "clay", number: 1, name: "Claymorphism",
    philosophy: "Soft, sculpted and tactile: every surface feels pressed from pastel clay.",
    description: "Pastel clay cards with diffused light, generous rounding and squishy spring motion. Controls look sculpted and press in when used.",
    variants: ["light", "dark"], defaultVariant: "light", layout: "floating", home: "bento", studio: "gallery", nav: "pill", phoneNav: "floating",
    material: "clay", blur: 0,
    typography: { body: "nunito", display: "nunito", mono: "mono", headingWeight: 800, headingTracking: "-0.01em", headingCase: "none", displayScale: 1.08, bodyScale: 1.02 },
    geometry: { rSm: 14, rMd: 22, rLg: 28, rShell: 36, border: 0, density: "spacious" },
    motion: { language: "Soft spring", quick: 180, base: 360, ease: "cubic-bezier(0.34, 1.56, 0.64, 1)", enter: "squish", description: "Surfaces settle with a gentle overshoot; pressed controls squash a little and spring back." },
    icons: { stroke: 2.4, treatment: "bold" }, agentFrame: "blob",
    notch: { shape: "blob", radius: 26, border: 0, glow: false, font: "Segoe UI Semibold", description: "A soft pastel clay capsule with an inner highlight and a contact shadow." },
    palettes: {
      light: {
        page: "#efe8fb", washA: "#ffd9ea", washB: "#d4effc", fg: "#2a2140", muted: "#5b5170", panel: "#fbf8ff", panelSolid: "#fbf8ff",
        elevated: "#ffffff", field: "#f1ebfb", border: "rgba(80, 60, 140, 0.10)", edge: "rgba(255, 255, 255, 0.9)", hover: "rgba(106, 79, 216, 0.08)",
        pressed: "rgba(106, 79, 216, 0.16)", action: "#6a4fd8", actionInk: "#ffffff", focus: "#5b3fd0", working: "#5238c4", workingSoft: "#e8e0ff",
        positive: "#1d7550", negative: "#ad2e48", warning: "#835100", decor: "#ff9ec7",
        ...sh("10px 12px 26px rgba(93, 72, 160, 0.18), -8px -8px 20px rgba(255, 255, 255, 0.85), inset 2px 2px 4px rgba(255, 255, 255, 0.9), inset -3px -4px 8px rgba(93, 72, 160, 0.10)",
          "16px 20px 40px rgba(93, 72, 160, 0.24), -10px -10px 24px rgba(255, 255, 255, 0.9), inset 2px 2px 5px rgba(255, 255, 255, 0.95), inset -4px -5px 10px rgba(93, 72, 160, 0.12)"),
      },
      dark: {
        page: "#211b31", washA: "#3a2850", washB: "#1f3348", fg: "#f4effc", muted: "#c0b6d6", panel: "#2e2644", panelSolid: "#2e2644",
        elevated: "#382f52", field: "#28213c", border: "rgba(255, 255, 255, 0.08)", edge: "rgba(255, 255, 255, 0.10)", hover: "rgba(185, 166, 255, 0.10)",
        pressed: "rgba(185, 166, 255, 0.18)", action: "#b9a6ff", actionInk: "#1d1530", focus: "#d2c5ff", working: "#cdbfff", workingSoft: "#3d3260",
        positive: "#92e2b8", negative: "#ffb3c2", warning: "#f3d08a", decor: "#ff9ec7",
        ...sh("10px 12px 24px rgba(0, 0, 0, 0.45), -6px -6px 16px rgba(255, 255, 255, 0.04), inset 2px 2px 4px rgba(255, 255, 255, 0.08), inset -3px -4px 8px rgba(0, 0, 0, 0.35)",
          "16px 20px 40px rgba(0, 0, 0, 0.55), -8px -8px 20px rgba(255, 255, 255, 0.05), inset 2px 2px 5px rgba(255, 255, 255, 0.10), inset -4px -5px 10px rgba(0, 0, 0, 0.4)"),
      },
    },
    performance: { heavy: ["layered clay shadows"], fallback: "One soft shadow per surface; springs become short fades." },
    assets: "Procedural CSS shadows and radial highlights only.",
  },
  {
    id: "cybercore", number: 2, name: "Cybercore",
    philosophy: "A precise computational instrument: status first, decoration last.",
    description: "Deep navy consoles, hairline cyan borders, circuit corners and technical monospace labels. Calm scanning indicators show real activity only.",
    variants: ["dark"], defaultVariant: "dark", layout: "rail", home: "console", studio: "hud", nav: "bracket", phoneNav: "bar",
    material: "neon", blur: 0,
    typography: { body: "inter", display: "grotesk", mono: "mono", headingWeight: 600, headingTracking: "0.01em", headingCase: "none", displayScale: 0.94, bodyScale: 0.98 },
    geometry: { rSm: 2, rMd: 4, rLg: 6, rShell: 8, border: 1, density: "compact" },
    motion: { language: "Precise scan", quick: 120, base: 200, ease: "cubic-bezier(0.2, 0, 0, 1)", enter: "scan", description: "Panels draw in along a single scan line; indicators tick, never pulse decoratively." },
    icons: { stroke: 1.5, treatment: "thin" }, agentFrame: "hex",
    notch: { shape: "plate", radius: 4, border: 1, glow: true, font: "Cascadia Mono", description: "A navy instrument plate with a hairline cyan rim and corner ticks." },
    palettes: {
      dark: {
        page: "#050a14", washA: "#0b2a4a", washB: "#06213a", fg: "#e2f3ff", muted: "#8fb3cc", panel: "rgba(8, 20, 38, 0.92)", panelSolid: "#081426",
        elevated: "#0c1d36", field: "#06111f", border: "rgba(76, 201, 255, 0.28)", edge: "rgba(76, 201, 255, 0.18)", hover: "rgba(76, 201, 255, 0.08)",
        pressed: "rgba(76, 201, 255, 0.16)", action: "#3fd0ff", actionInk: "#031020", focus: "#7fe3ff", working: "#5fd6ff", workingSoft: "#0a2a44",
        positive: "#5fe3a8", negative: "#ff8f9c", warning: "#ffd27a", decor: "#1ea7ff",
        ...sh("0 0 0 1px rgba(76, 201, 255, 0.10), 0 8px 24px rgba(0, 0, 0, 0.5)", "0 0 0 1px rgba(76, 201, 255, 0.22), 0 0 24px rgba(30, 167, 255, 0.18), 0 16px 40px rgba(0, 0, 0, 0.6)"),
      },
    },
    performance: { heavy: ["scan sweeps", "border glow"], fallback: "Static hairlines; activity shows as a text state and a still tick." },
    assets: "Procedural CSS gradients (circuit corners, grid) only.",
  },
  {
    id: "brutalism", number: 3, name: "Neo-Brutalism",
    philosophy: "Bold, honest and graphic: thick lines, hard shadows, nothing hidden.",
    description: "Thick black borders, offset hard shadows, saturated blocks and big grotesk type in a deliberately asymmetric grid.",
    variants: ["light", "dark"], defaultVariant: "light", layout: "sidebar", home: "grid", studio: "cards", nav: "block", phoneNav: "block",
    material: "brutal", blur: 0,
    typography: { body: "grotesk", display: "grotesk", mono: "mono", headingWeight: 700, headingTracking: "-0.03em", headingCase: "none", displayScale: 1.25, bodyScale: 1.0 },
    geometry: { rSm: 0, rMd: 0, rLg: 0, rShell: 0, border: 3, density: "comfortable" },
    motion: { language: "Graphic snap", quick: 90, base: 160, ease: "steps(3, end)", enter: "slam", description: "Blocks slam into place and buttons press flat into their shadow." },
    icons: { stroke: 2.75, treatment: "bold" }, agentFrame: "square",
    notch: { shape: "block", radius: 0, border: 3, glow: false, font: "Bahnschrift", description: "A yellow slab with a thick black outline and a hard offset shadow." },
    palettes: {
      light: {
        page: "#fff4d6", washA: "#fff4d6", washB: "#fff4d6", fg: "#0a0a0a", muted: "#3b3b3b", panel: "#ffffff", panelSolid: "#ffffff",
        elevated: "#ffffff", field: "#ffffff", border: "#0a0a0a", edge: "transparent", hover: "#ffe14d", pressed: "#ffd000",
        action: "#ff5ca8", actionInk: "#0a0a0a", focus: "#0047ff", working: "#0038cc", workingSoft: "#c8f0ff",
        positive: "#006b2e", negative: "#c1002f", warning: "#7a4a00", decor: "#ffd000",
        ...sh("5px 5px 0 #0a0a0a", "8px 8px 0 #0a0a0a"),
      },
      dark: {
        page: "#141414", washA: "#141414", washB: "#141414", fg: "#fafafa", muted: "#d0d0d0", panel: "#1f1f1f", panelSolid: "#1f1f1f",
        elevated: "#262626", field: "#0f0f0f", border: "#fafafa", edge: "transparent", hover: "#3a3300", pressed: "#4d4400",
        action: "#ffd000", actionInk: "#0a0a0a", focus: "#7aa2ff", working: "#8fd3ff", workingSoft: "#0b2f45",
        positive: "#7dff9e", negative: "#ff8aa6", warning: "#ffd76a", decor: "#ff5ca8",
        ...sh("5px 5px 0 #fafafa", "8px 8px 0 #fafafa"),
      },
    },
    performance: { heavy: [], fallback: "Already flat; motion becomes instant." },
    assets: "Flat CSS blocks only.",
  },
  {
    id: "scrapbook", number: 4, name: "Scrapbook",
    philosophy: "Handmade and personal: work pinned to paper with tape and notes.",
    description: "Warm paper surfaces, taped cards, sticky-note labels, cut-paper shadows and a handwritten display face on a collage layout.",
    variants: ["light"], defaultVariant: "light", layout: "sidebar", home: "collage", studio: "polaroid", nav: "tab", phoneNav: "block",
    material: "paper", blur: 0,
    typography: { body: "inter", display: "hand", mono: "mono", headingWeight: 700, headingTracking: "0", headingCase: "none", displayScale: 1.45, bodyScale: 1.0 },
    geometry: { rSm: 3, rMd: 4, rLg: 6, rShell: 8, border: 1, density: "comfortable" },
    motion: { language: "Paper movement", quick: 160, base: 320, ease: "cubic-bezier(0.3, 0.7, 0.4, 1)", enter: "paper", description: "Cards drop in with a slight tilt, like paper settling on a desk." },
    icons: { stroke: 2, treatment: "hand" }, agentFrame: "polaroid",
    notch: { shape: "tab", radius: 4, border: 1, glow: false, font: "Ink Free", description: "A kraft-paper tab with a strip of washi tape across one corner." },
    palettes: {
      light: {
        page: "#efe5d3", washA: "#e6d6bb", washB: "#f3ead9", fg: "#2b241b", muted: "#5d5243", panel: "#fffaf0", panelSolid: "#fffaf0",
        elevated: "#fffdf7", field: "#fffdf7", border: "rgba(80, 60, 30, 0.22)", edge: "transparent", hover: "rgba(196, 92, 60, 0.08)",
        pressed: "rgba(196, 92, 60, 0.16)", action: "#b4472b", actionInk: "#ffffff", focus: "#2e5aac", working: "#2e5aac", workingSoft: "#dce7f7",
        positive: "#2f6b33", negative: "#a32a2a", warning: "#7d4f00", decor: "#f2c94c",
        ...sh("2px 3px 0 rgba(80, 60, 30, 0.18), 6px 10px 16px rgba(80, 60, 30, 0.14)", "3px 4px 0 rgba(80, 60, 30, 0.2), 10px 16px 26px rgba(80, 60, 30, 0.2)"),
      },
    },
    performance: { heavy: ["paper grain"], fallback: "Plain paper colour; cards stop tilting." },
    assets: "Procedural CSS paper grain, tape and note shapes only.",
  },
  {
    id: "surreal", number: 5, name: "Surrealism",
    philosophy: "A lucid dream: impossible space, but every door is labelled.",
    description: "Atmospheric gradients, floating panels with soft dimensional shadows, abstract orbs and a drifting horizon. Controls stay where you expect them.",
    variants: ["dark", "light"], defaultVariant: "dark", layout: "floating", home: "collage", studio: "gallery", nav: "dot", phoneNav: "floating",
    material: "mist", blur: 18,
    typography: { body: "inter", display: "fraunces", mono: "mono", headingWeight: 600, headingTracking: "-0.02em", headingCase: "none", displayScale: 1.2, bodyScale: 1.0 },
    geometry: { rSm: 12, rMd: 20, rLg: 28, rShell: 40, border: 1, density: "spacious" },
    motion: { language: "Dream float", quick: 220, base: 520, ease: "cubic-bezier(0.45, 0, 0.2, 1)", enter: "float", description: "Panels rise from below the horizon and hang weightless; ambient orbs drift slowly when visible." },
    icons: { stroke: 1.75, treatment: "outline" }, agentFrame: "circle",
    notch: { shape: "capsule", radius: 28, border: 1, glow: true, font: "Constantia", description: "A dusk-coloured capsule that seems to hover above its own shadow." },
    palettes: {
      dark: {
        page: "#140f2b", washA: "#4a1f5c", washB: "#0f3f5a", fg: "#f6f0ff", muted: "#c3b8de", panel: "rgba(36, 26, 66, 0.72)", panelSolid: "#241a42",
        elevated: "rgba(52, 38, 92, 0.86)", field: "rgba(16, 10, 36, 0.6)", border: "rgba(255, 220, 245, 0.16)", edge: "rgba(255, 220, 245, 0.18)",
        hover: "rgba(255, 170, 120, 0.10)", pressed: "rgba(255, 170, 120, 0.18)", action: "#ffb48a", actionInk: "#2a1230", focus: "#ffd0a8",
        working: "#a9d8ff", workingSoft: "#22305a", positive: "#9ff0c4", negative: "#ffb3c6", warning: "#ffe19a", decor: "#ff7eb6",
        ...sh("0 24px 60px rgba(8, 4, 24, 0.55), 0 2px 0 rgba(255, 220, 245, 0.06)", "0 40px 90px rgba(8, 4, 24, 0.65), 0 0 40px rgba(255, 126, 182, 0.12)"),
      },
      light: {
        page: "#f4ecf6", washA: "#ffd5c2", washB: "#c9e6ff", fg: "#271a3a", muted: "#5a4b6e", panel: "rgba(255, 252, 255, 0.72)", panelSolid: "#fdf8ff",
        elevated: "rgba(255, 255, 255, 0.86)", field: "rgba(255, 255, 255, 0.8)", border: "rgba(80, 40, 120, 0.14)", edge: "rgba(255, 255, 255, 0.8)",
        hover: "rgba(196, 80, 120, 0.08)", pressed: "rgba(196, 80, 120, 0.16)", action: "#a8336b", actionInk: "#ffffff", focus: "#7a2bbf",
        working: "#5a35b8", workingSoft: "#ece3ff", positive: "#1d6e4a", negative: "#a32a4a", warning: "#7d4f00", decor: "#ff9a6b",
        ...sh("0 24px 60px rgba(80, 40, 120, 0.16)", "0 40px 90px rgba(80, 40, 120, 0.22)"),
      },
    },
    performance: { heavy: ["backdrop blur", "drifting orbs"], fallback: "Opaque panels and a still gradient; no drift." },
    assets: "Procedural CSS gradients and orbs only.",
  },
  {
    id: "y2k", number: 6, name: "Y2K",
    philosophy: "Millennium optimism: glossy plastic, chrome and bubbly windows.",
    description: "Aqua and lavender gel buttons, chrome title bars, translucent bubble panels and holographic gradients in retro OS windows.",
    variants: ["light", "dark"], defaultVariant: "light", layout: "window", home: "window", studio: "gallery", nav: "pill", phoneNav: "pill",
    material: "chrome", blur: 10,
    typography: { body: "inter", display: "comfortaa", mono: "mono", headingWeight: 700, headingTracking: "-0.01em", headingCase: "none", displayScale: 1.05, bodyScale: 1.0 },
    geometry: { rSm: 999, rMd: 14, rLg: 18, rShell: 22, border: 1, density: "comfortable" },
    motion: { language: "Glossy bounce", quick: 160, base: 300, ease: "cubic-bezier(0.68, -0.4, 0.27, 1.4)", enter: "bubble", description: "Windows pop open like bubbles; gel buttons wobble once when pressed." },
    icons: { stroke: 2, treatment: "bold" }, agentFrame: "circle",
    notch: { shape: "pill", radius: 22, border: 1, glow: true, font: "Segoe UI Semibold", description: "A glossy aqua gel pill with a chrome rim and a specular highlight." },
    palettes: {
      light: {
        page: "#e9ecf8", washA: "#ffc8f0", washB: "#b7f2ff", fg: "#1c1838", muted: "#4f4a6e", panel: "rgba(255, 255, 255, 0.78)", panelSolid: "#f7f7ff",
        elevated: "rgba(255, 255, 255, 0.9)", field: "#ffffff", border: "rgba(120, 130, 190, 0.45)", edge: "rgba(255, 255, 255, 0.95)",
        hover: "rgba(0, 170, 220, 0.10)", pressed: "rgba(0, 170, 220, 0.2)", action: "#0f6fb5", actionInk: "#ffffff", focus: "#c2187a",
        working: "#0b62a3", workingSoft: "#dff4ff", positive: "#16704a", negative: "#b0204e", warning: "#7d4f00", decor: "#ff7ad9",
        ...sh("0 2px 0 rgba(255, 255, 255, 0.9) inset, 0 -8px 16px rgba(120, 130, 190, 0.18) inset, 0 8px 20px rgba(60, 70, 140, 0.18)", "0 2px 0 rgba(255, 255, 255, 0.95) inset, 0 16px 36px rgba(60, 70, 140, 0.26)"),
      },
      dark: {
        page: "#120f2a", washA: "#4b1d5e", washB: "#0d4559", fg: "#f3f0ff", muted: "#c0bade", panel: "rgba(40, 34, 82, 0.78)", panelSolid: "#28224f",
        elevated: "rgba(56, 48, 108, 0.9)", field: "rgba(14, 12, 34, 0.7)", border: "rgba(190, 200, 255, 0.35)", edge: "rgba(255, 255, 255, 0.25)",
        hover: "rgba(110, 230, 255, 0.10)", pressed: "rgba(110, 230, 255, 0.2)", action: "#7ce8ff", actionInk: "#101030", focus: "#ff9be6",
        working: "#8fe4ff", workingSoft: "#183a5a", positive: "#8ff0c0", negative: "#ffabc8", warning: "#ffe08a", decor: "#ff7ad9",
        ...sh("0 1px 0 rgba(255, 255, 255, 0.25) inset, 0 8px 22px rgba(0, 0, 0, 0.5)", "0 1px 0 rgba(255, 255, 255, 0.3) inset, 0 16px 40px rgba(0, 0, 0, 0.6)"),
      },
    },
    performance: { heavy: ["gloss gradients", "backdrop blur"], fallback: "Flat chrome and opaque windows; no wobble." },
    assets: "Procedural CSS gloss, chrome and holographic gradients only.",
  },
  {
    id: "pixel", number: 7, name: "Pixel Art",
    philosophy: "A 16-bit adventure menu: crisp pixels, limited palette, frame-stepped life.",
    description: "SNES-style window frames, a pixel display face, stepped borders, segmented progress and nearest-neighbour Agent sprites from the original art.",
    variants: ["dark", "light"], defaultVariant: "dark", layout: "window", home: "window", studio: "sprites", nav: "pixel", phoneNav: "window",
    material: "pixel", blur: 0,
    typography: { body: "inter", display: "pixel", mono: "pixel", headingWeight: 700, headingTracking: "0.02em", headingCase: "none", displayScale: 1.1, bodyScale: 1.0 },
    geometry: { rSm: 0, rMd: 0, rLg: 0, rShell: 0, border: 4, density: "comfortable" },
    motion: { language: "Sprite frames", quick: 100, base: 200, ease: "steps(4, end)", enter: "pixel", description: "Everything moves in discrete frames; windows open in four steps." },
    icons: { stroke: 2.5, treatment: "pixel" }, agentFrame: "pixel",
    notch: { shape: "frame", radius: 0, border: 3, glow: false, font: "Lucida Console", description: "A blue RPG dialog frame with a double pixel border." },
    palettes: {
      dark: {
        page: "#1a1c3a", washA: "#1a1c3a", washB: "#1a1c3a", fg: "#f8f8f0", muted: "#c8c8e0", panel: "#22307a", panelSolid: "#22307a",
        elevated: "#2b3a8c", field: "#101848", border: "#f8f8f0", edge: "#6878e8", hover: "#3448a8", pressed: "#4058c0",
        action: "#f8d030", actionInk: "#181820", focus: "#f8d030", working: "#a8e0ff", workingSoft: "#1c2868",
        positive: "#80f0a0", negative: "#ffa8a8", warning: "#ffe080", decor: "#e05080",
        ...sh("4px 4px 0 #0c0e20", "6px 6px 0 #0c0e20"),
      },
      light: {
        page: "#d8e8c8", washA: "#d8e8c8", washB: "#d8e8c8", fg: "#182018", muted: "#3c4a3c", panel: "#f8f8e8", panelSolid: "#f8f8e8",
        elevated: "#ffffff", field: "#ffffff", border: "#182018", edge: "#88a878", hover: "#e8f0c0", pressed: "#d0e098",
        action: "#2848a8", actionInk: "#ffffff", focus: "#c02848", working: "#2848a8", workingSoft: "#d8e0f8",
        positive: "#1e6a2e", negative: "#a82030", warning: "#704800", decor: "#e05080",
        ...sh("4px 4px 0 #182018", "6px 6px 0 #182018"),
      },
    },
    performance: { heavy: [], fallback: "Frames hold still; sprites show their first frame." },
    assets: "Original board art rendered with nearest-neighbour scaling; procedural CSS pixel borders.",
  },
  {
    id: "synthwave", number: 8, name: "Synthwave",
    philosophy: "Night drive, 1984: neon horizon over a glowing grid.",
    description: "Violet night skies, a magenta-to-cyan horizon, neon linework, chrome display type and a perspective grid under the content.",
    variants: ["dark"], defaultVariant: "dark", layout: "topnav", home: "console", studio: "gallery", nav: "glow", phoneNav: "bar",
    material: "neon", blur: 6,
    typography: { body: "inter", display: "orbitron", mono: "mono", headingWeight: 700, headingTracking: "0.06em", headingCase: "uppercase", displayScale: 0.92, bodyScale: 1.0 },
    geometry: { rSm: 4, rMd: 8, rLg: 10, rShell: 14, border: 1, density: "comfortable" },
    motion: { language: "Neon illumination", quick: 160, base: 420, ease: "cubic-bezier(0.25, 0.1, 0.25, 1)", enter: "neon", description: "Light rises along the linework like a tube warming up; the grid scrolls only while visible." },
    icons: { stroke: 1.75, treatment: "glow" }, agentFrame: "rounded",
    notch: { shape: "capsule", radius: 14, border: 2, glow: true, font: "Bahnschrift", description: "A violet capsule with a magenta-to-cyan neon tube outline." },
    palettes: {
      dark: {
        page: "#0d0221", washA: "#3b0a57", washB: "#0a2a5e", fg: "#fbefff", muted: "#d0b8e8", panel: "rgba(26, 8, 52, 0.84)", panelSolid: "#1a0834",
        elevated: "rgba(40, 14, 78, 0.92)", field: "rgba(10, 2, 26, 0.7)", border: "rgba(255, 74, 205, 0.45)", edge: "rgba(46, 230, 255, 0.25)",
        hover: "rgba(255, 74, 205, 0.12)", pressed: "rgba(255, 74, 205, 0.22)", action: "#ff4acd", actionInk: "#1a0420", focus: "#2ee6ff",
        working: "#5ef0ff", workingSoft: "#1d1a5a", positive: "#7dffc0", negative: "#ff9cb8", warning: "#ffd86b", decor: "#ff8a3d",
        ...sh("0 0 0 1px rgba(255, 74, 205, 0.2), 0 0 22px rgba(255, 74, 205, 0.18), 0 12px 30px rgba(0, 0, 0, 0.55)", "0 0 0 1px rgba(46, 230, 255, 0.35), 0 0 32px rgba(46, 230, 255, 0.25), 0 18px 44px rgba(0, 0, 0, 0.6)"),
      },
    },
    performance: { heavy: ["neon glow", "scrolling grid"], fallback: "Static grid and a single-pixel outline glow." },
    assets: "Procedural CSS sunset, horizon and grid only.",
  },
  {
    id: "glass", number: 9, name: "Glassmorphism",
    philosophy: "The accepted Bunny A glass: translucent, spatial and calm.",
    description: "Frosted panels over a soft aurora, thin luminous edges and subtle spatial depth. The system default and the fallback for every theme.",
    variants: ["light", "dark"], defaultVariant: "light", layout: "sidebar", home: "stack", studio: "cards", nav: "pill", phoneNav: "bar",
    material: "glass", blur: 24,
    typography: { body: "segoe", display: "segoe", mono: "mono", headingWeight: 650, headingTracking: "-0.01em", headingCase: "none", displayScale: 1, bodyScale: 1 },
    geometry: { rSm: 8, rMd: 12, rLg: 16, rShell: 24, border: 1, density: "comfortable" },
    motion: { language: "Spatial ease", quick: 150, base: 220, ease: "cubic-bezier(0.22, 1, 0.36, 1)", enter: "rise", description: "Panels rise a few pixels and fade in; depth follows focus." },
    icons: { stroke: 2, treatment: "outline" }, agentFrame: "rounded",
    notch: { shape: "pill", radius: 22, border: 1, glow: false, font: "Segoe UI Variable Display", description: "The accepted black glossy glass capsule." },
    palettes: {
      light: {
        page: "#eef2fb", washA: "#c9c2ff", washB: "#bfd8ff", fg: "#121726", muted: "#4b5468", panel: "rgba(255, 255, 255, 0.64)", panelSolid: "#f6f7fb",
        elevated: "rgba(255, 255, 255, 0.82)", field: "rgba(255, 255, 255, 0.78)", border: "rgba(30, 40, 80, 0.14)", edge: "rgba(255, 255, 255, 0.75)",
        hover: "rgba(91, 108, 255, 0.08)", pressed: "rgba(91, 108, 255, 0.16)", action: "#4a5be0", actionInk: "#ffffff", focus: "#3550d6",
        working: "#3550d6", workingSoft: "#e6ebff", positive: "#1a6e44", negative: "#b42335", warning: "#8a5a00", decor: "#9c7bff",
        ...sh("0 8px 30px rgba(30, 40, 80, 0.1)", "0 16px 48px rgba(30, 40, 80, 0.16)"),
      },
      dark: {
        page: "#0a0d16", washA: "#2a2f7a", washB: "#1b3a6b", fg: "#eef1fa", muted: "#a6afc3", panel: "rgba(20, 24, 38, 0.66)", panelSolid: "#141824",
        elevated: "rgba(34, 39, 58, 0.86)", field: "rgba(10, 13, 22, 0.6)", border: "rgba(160, 175, 230, 0.16)", edge: "rgba(255, 255, 255, 0.1)",
        hover: "rgba(142, 162, 255, 0.1)", pressed: "rgba(142, 162, 255, 0.2)", action: "#8ea2ff", actionInk: "#0a0d16", focus: "#b7c4ff",
        working: "#a9bcff", workingSoft: "#1f2a4d", positive: "#8fd7b0", negative: "#ffb4b0", warning: "#f0cf8f", decor: "#9c7bff",
        ...sh("0 8px 30px rgba(0, 0, 0, 0.4)", "0 16px 48px rgba(0, 0, 0, 0.5)"),
      },
    },
    performance: { heavy: ["backdrop blur"], fallback: "Opaque glass-solid surfaces (the T13 accessibility fallback)." },
    assets: "The accepted T13 glass tokens; procedural aurora gradients.",
  },
  {
    id: "neumorph", number: 10, name: "Neumorphism",
    philosophy: "Controls extruded from one soft material, lit from the top left.",
    description: "Low-profile surfaces pressed out of the background with paired light and shade. Selection and focus also use colour and outline, never depth alone.",
    variants: ["light", "dark"], defaultVariant: "light", layout: "sidebar", home: "stack", studio: "cards", nav: "pill", phoneNav: "floating",
    material: "neu", blur: 0,
    typography: { body: "inter", display: "inter", mono: "mono", headingWeight: 600, headingTracking: "-0.015em", headingCase: "none", displayScale: 1, bodyScale: 1 },
    geometry: { rSm: 12, rMd: 16, rLg: 22, rShell: 28, border: 0, density: "spacious" },
    motion: { language: "Soft material", quick: 160, base: 260, ease: "cubic-bezier(0.4, 0, 0.2, 1)", enter: "press", description: "Pressing flips a surface from raised to inset; nothing flies around." },
    icons: { stroke: 1.75, treatment: "outline" }, agentFrame: "circle",
    notch: { shape: "pill", radius: 24, border: 0, glow: false, font: "Segoe UI", description: "A raised capsule of the same soft grey, with a light top-left and shaded bottom-right edge." },
    palettes: {
      light: {
        page: "#e4e9f0", washA: "#e4e9f0", washB: "#e4e9f0", fg: "#1f2633", muted: "#4f5a6c", panel: "#e4e9f0", panelSolid: "#e4e9f0",
        elevated: "#e8edf4", field: "#e4e9f0", border: "rgba(31, 38, 51, 0.06)", edge: "rgba(255, 255, 255, 0.7)", hover: "rgba(43, 90, 200, 0.06)",
        pressed: "rgba(43, 90, 200, 0.12)", action: "#2b5ac8", actionInk: "#ffffff", focus: "#1f49b0", working: "#1f49b0", workingSoft: "#d6e0f5",
        positive: "#1d6b47", negative: "#a5283c", warning: "#7a4c00", decor: "#8aa4d6",
        ...sh("8px 8px 16px rgba(163, 177, 198, 0.75), -8px -8px 16px rgba(255, 255, 255, 0.9)", "12px 12px 24px rgba(163, 177, 198, 0.85), -12px -12px 24px rgba(255, 255, 255, 0.95)"),
      },
      dark: {
        page: "#262b34", washA: "#262b34", washB: "#262b34", fg: "#e8ecf2", muted: "#adb6c4", panel: "#262b34", panelSolid: "#262b34",
        elevated: "#2a3039", field: "#262b34", border: "rgba(255, 255, 255, 0.05)", edge: "rgba(255, 255, 255, 0.06)", hover: "rgba(127, 167, 255, 0.08)",
        pressed: "rgba(127, 167, 255, 0.14)", action: "#7fa7ff", actionInk: "#0e1320", focus: "#a9c3ff", working: "#a9c3ff", workingSoft: "#2f3a52",
        positive: "#8fdcb2", negative: "#ffadb8", warning: "#f0d08a", decor: "#7fa7ff",
        ...sh("8px 8px 16px rgba(10, 12, 16, 0.6), -8px -8px 16px rgba(60, 68, 82, 0.45)", "12px 12px 24px rgba(10, 12, 16, 0.7), -12px -12px 24px rgba(60, 68, 82, 0.5)"),
      },
    },
    performance: { heavy: ["dual soft shadows"], fallback: "A single outline per surface with the same colour cues." },
    assets: "Procedural CSS shadows only.",
  },
  {
    id: "bento", number: 11, name: "Bento Grid",
    philosophy: "Everything in its compartment: a modular dashboard you can read at a glance.",
    description: "Distinct rounded tiles in an adaptive grid. The dashboard itself recomposes into summary tiles for Agents, Missions, reviews and the composer.",
    variants: ["light", "dark"], defaultVariant: "light", layout: "bento", home: "bento", studio: "gallery", nav: "pill", phoneNav: "bar",
    material: "solid", blur: 0,
    typography: { body: "inter", display: "inter", mono: "mono", headingWeight: 700, headingTracking: "-0.025em", headingCase: "none", displayScale: 1.05, bodyScale: 1 },
    geometry: { rSm: 10, rMd: 16, rLg: 22, rShell: 28, border: 1, density: "comfortable" },
    motion: { language: "Modular rearrangement", quick: 140, base: 260, ease: "cubic-bezier(0.2, 0.8, 0.2, 1)", enter: "tile", description: "Tiles fade and scale into their cells in reading order." },
    icons: { stroke: 2, treatment: "outline" }, agentFrame: "rounded",
    notch: { shape: "pill", radius: 18, border: 1, glow: false, font: "Segoe UI Semibold", description: "A neat white tile capsule with compartments for each Agent." },
    palettes: {
      light: {
        page: "#f1f1f4", washA: "#f1f1f4", washB: "#f1f1f4", fg: "#16161d", muted: "#55586a", panel: "#ffffff", panelSolid: "#ffffff",
        elevated: "#fafafc", field: "#f5f5f8", border: "rgba(22, 22, 29, 0.08)", edge: "transparent", hover: "rgba(255, 106, 61, 0.08)",
        pressed: "rgba(255, 106, 61, 0.16)", action: "#c63c10", actionInk: "#ffffff", focus: "#2952cc", working: "#2952cc", workingSoft: "#e3eaff",
        positive: "#16714a", negative: "#b3261e", warning: "#7d4e00", decor: "#ffcf4a",
        ...sh("0 1px 2px rgba(22, 22, 29, 0.06), 0 6px 18px rgba(22, 22, 29, 0.05)", "0 2px 4px rgba(22, 22, 29, 0.08), 0 14px 32px rgba(22, 22, 29, 0.1)"),
      },
      dark: {
        page: "#0f1014", washA: "#0f1014", washB: "#0f1014", fg: "#f2f2f5", muted: "#a2a5b4", panel: "#1a1b21", panelSolid: "#1a1b21",
        elevated: "#22232b", field: "#15161b", border: "rgba(255, 255, 255, 0.07)", edge: "transparent", hover: "rgba(255, 140, 100, 0.08)",
        pressed: "rgba(255, 140, 100, 0.16)", action: "#ff8c64", actionInk: "#1a0d07", focus: "#8eaaff", working: "#9fb6ff", workingSoft: "#232b45",
        positive: "#8fdcb2", negative: "#ffaba4", warning: "#f2cf86", decor: "#ffcf4a",
        ...sh("0 1px 2px rgba(0, 0, 0, 0.3), 0 6px 18px rgba(0, 0, 0, 0.25)", "0 2px 4px rgba(0, 0, 0, 0.35), 0 14px 32px rgba(0, 0, 0, 0.4)"),
      },
    },
    performance: { heavy: [], fallback: "Tiles appear without the staggered entrance." },
    assets: "Flat CSS tiles only.",
  },
  {
    id: "editorial", number: 12, name: "Editorial",
    philosophy: "A considered digital magazine: work presented as curated stories.",
    description: "Serif display headlines over clean sans text, generous margins, column rules, drop-cap section numbers and an asymmetric magazine spread.",
    variants: ["light", "dark"], defaultVariant: "light", layout: "topnav", home: "editorial", studio: "list", nav: "underline", phoneNav: "bar",
    material: "solid", blur: 0,
    typography: { body: "inter", display: "fraunces", mono: "mono", headingWeight: 600, headingTracking: "-0.025em", headingCase: "none", displayScale: 1.45, bodyScale: 1.02 },
    geometry: { rSm: 2, rMd: 2, rLg: 2, rShell: 2, border: 1, density: "spacious" },
    motion: { language: "Page turn", quick: 160, base: 380, ease: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", enter: "page", description: "Sections fade up like a turned page; headlines settle last." },
    icons: { stroke: 1.5, treatment: "thin" }, agentFrame: "square",
    notch: { shape: "plate", radius: 2, border: 1, glow: false, font: "Georgia", description: "A paper-white masthead strip with a serif status line and a fine rule." },
    palettes: {
      light: {
        page: "#faf8f3", washA: "#faf8f3", washB: "#faf8f3", fg: "#141414", muted: "#545048", panel: "#faf8f3", panelSolid: "#faf8f3",
        elevated: "#ffffff", field: "#ffffff", border: "rgba(20, 20, 20, 0.18)", edge: "transparent", hover: "rgba(180, 40, 30, 0.06)",
        pressed: "rgba(180, 40, 30, 0.12)", action: "#141414", actionInk: "#faf8f3", focus: "#b4281e", working: "#9a2219", workingSoft: "#f6e3df",
        positive: "#2a6a3a", negative: "#a3221a", warning: "#7a4e00", decor: "#b4281e",
        ...sh("none", "0 18px 40px rgba(20, 20, 20, 0.08)"),
      },
      dark: {
        page: "#151412", washA: "#151412", washB: "#151412", fg: "#f2efe8", muted: "#b5b0a4", panel: "#151412", panelSolid: "#151412",
        elevated: "#1d1c19", field: "#1b1a17", border: "rgba(242, 239, 232, 0.2)", edge: "transparent", hover: "rgba(255, 120, 100, 0.08)",
        pressed: "rgba(255, 120, 100, 0.14)", action: "#f2efe8", actionInk: "#151412", focus: "#ff8b7a", working: "#ff9d8f", workingSoft: "#3a2420",
        positive: "#94d6a6", negative: "#ffab9f", warning: "#f0cf86", decor: "#ff8b7a",
        ...sh("none", "0 18px 40px rgba(0, 0, 0, 0.4)"),
      },
    },
    performance: { heavy: [], fallback: "Sections appear without the page-turn fade." },
    assets: "Typographic CSS only.",
  },
  {
    id: "swiss", number: 13, name: "Swiss Design",
    philosophy: "The grid is the idea: objective, aligned, unmistakably clear.",
    description: "A strict twelve-column grid, flush-left grotesk type, heavy rules, one functional red and generous negative space.",
    variants: ["light", "dark"], defaultVariant: "light", layout: "topnav", home: "grid", studio: "list", nav: "underline", phoneNav: "bar",
    material: "solid", blur: 0,
    typography: { body: "inter", display: "inter", mono: "mono", headingWeight: 800, headingTracking: "-0.04em", headingCase: "none", displayScale: 1.35, bodyScale: 1 },
    geometry: { rSm: 0, rMd: 0, rLg: 0, rShell: 0, border: 2, density: "comfortable" },
    motion: { language: "Precise minimal", quick: 100, base: 180, ease: "cubic-bezier(0.4, 0, 0.2, 1)", enter: "slide", description: "Elements slide a few pixels along the grid axis; nothing bounces." },
    icons: { stroke: 2, treatment: "outline" }, agentFrame: "square",
    notch: { shape: "block", radius: 0, border: 0, glow: false, font: "Segoe UI Semibold", description: "A flat white bar with a red index square and flush-left status." },
    palettes: {
      light: {
        page: "#ffffff", washA: "#ffffff", washB: "#ffffff", fg: "#0d0d0d", muted: "#4a4a4a", panel: "#ffffff", panelSolid: "#ffffff",
        elevated: "#f4f4f4", field: "#f4f4f4", border: "#0d0d0d", edge: "transparent", hover: "#f0f0f0", pressed: "#e2e2e2",
        action: "#e30613", actionInk: "#ffffff", focus: "#0d0d0d", working: "#0d0d0d", workingSoft: "#f0f0f0",
        positive: "#0b6b35", negative: "#c3000f", warning: "#7a4b00", decor: "#e30613",
        ...sh("none", "none"),
      },
      dark: {
        page: "#0d0d0d", washA: "#0d0d0d", washB: "#0d0d0d", fg: "#ffffff", muted: "#bdbdbd", panel: "#0d0d0d", panelSolid: "#0d0d0d",
        elevated: "#1a1a1a", field: "#1a1a1a", border: "#ffffff", edge: "transparent", hover: "#1f1f1f", pressed: "#2c2c2c",
        action: "#ff2a35", actionInk: "#0d0d0d", focus: "#ffffff", working: "#ffffff", workingSoft: "#262626",
        positive: "#7ddc9f", negative: "#ff8a90", warning: "#f0cf86", decor: "#ff2a35",
        ...sh("none", "none"),
      },
    },
    performance: { heavy: [], fallback: "No change needed." },
    assets: "Typographic CSS only.",
  },
  {
    id: "minimal", number: 14, name: "Minimalism",
    philosophy: "Only what matters: quiet, focused, nearly silent.",
    description: "A slim icon rail, a single quiet column, hairline separators, one accent and near-instant transitions. Every capability stays one step away.",
    variants: ["light", "dark"], defaultVariant: "light", layout: "rail", home: "focus", studio: "list", nav: "dot", phoneNav: "bar",
    material: "solid", blur: 0,
    typography: { body: "inter", display: "inter", mono: "mono", headingWeight: 500, headingTracking: "-0.02em", headingCase: "none", displayScale: 0.95, bodyScale: 1 },
    geometry: { rSm: 6, rMd: 8, rLg: 10, rShell: 12, border: 1, density: "spacious" },
    motion: { language: "Near-instant", quick: 80, base: 120, ease: "linear", enter: "fade", description: "Opacity only, and quickly." },
    icons: { stroke: 1.5, treatment: "thin" }, agentFrame: "circle",
    notch: { shape: "pill", radius: 18, border: 1, glow: false, font: "Segoe UI", description: "A plain hairline capsule with a single status word." },
    palettes: {
      light: {
        page: "#fbfbfa", washA: "#fbfbfa", washB: "#fbfbfa", fg: "#1a1a1a", muted: "#5c5c5c", panel: "#fbfbfa", panelSolid: "#fbfbfa",
        elevated: "#ffffff", field: "#f3f3f1", border: "rgba(26, 26, 26, 0.1)", edge: "transparent", hover: "rgba(26, 26, 26, 0.04)",
        pressed: "rgba(26, 26, 26, 0.08)", action: "#1a1a1a", actionInk: "#ffffff", focus: "#2563eb", working: "#1d4ed8", workingSoft: "#eef2fb",
        positive: "#1f6b46", negative: "#a6262b", warning: "#7a4e00", decor: "#2563eb",
        ...sh("none", "0 10px 30px rgba(26, 26, 26, 0.06)"),
      },
      dark: {
        page: "#111111", washA: "#111111", washB: "#111111", fg: "#ededed", muted: "#a3a3a3", panel: "#111111", panelSolid: "#111111",
        elevated: "#191919", field: "#191919", border: "rgba(237, 237, 237, 0.1)", edge: "transparent", hover: "rgba(237, 237, 237, 0.05)",
        pressed: "rgba(237, 237, 237, 0.1)", action: "#ededed", actionInk: "#111111", focus: "#7aa2ff", working: "#9db9ff", workingSoft: "#1c2233",
        positive: "#8fd4ac", negative: "#ffa6a6", warning: "#eecd88", decor: "#7aa2ff",
        ...sh("none", "0 10px 30px rgba(0, 0, 0, 0.4)"),
      },
    },
    performance: { heavy: [], fallback: "No change needed." },
    assets: "None beyond typography.",
  },
  {
    id: "maximal", number: 15, name: "Maximalism",
    philosophy: "More is more, but the path is always clear.",
    description: "Clashing jewel colours, patterned layers, sticker-like labels, mixed type and a dense, energetic bento with clear primary content.",
    variants: ["light", "dark"], defaultVariant: "light", layout: "bento", home: "collage", studio: "gallery", nav: "block", phoneNav: "pill",
    material: "solid", blur: 0,
    typography: { body: "inter", display: "playfair", mono: "mono", headingWeight: 800, headingTracking: "-0.02em", headingCase: "none", displayScale: 1.3, bodyScale: 1 },
    geometry: { rSm: 10, rMd: 18, rLg: 26, rShell: 32, border: 2, density: "compact" },
    motion: { language: "Layered expression", quick: 160, base: 380, ease: "cubic-bezier(0.34, 1.3, 0.64, 1)", enter: "layers", description: "Layers arrive one after another with a little overshoot; pattern bands slide." },
    icons: { stroke: 2.25, treatment: "bold" }, agentFrame: "ticket",
    notch: { shape: "capsule", radius: 20, border: 2, glow: false, font: "Georgia", description: "A jewel-toned capsule edged in a second contrasting colour with a pattern band." },
    palettes: {
      light: {
        page: "#fff0e1", washA: "#ffc4dd", washB: "#b8f0d8", fg: "#1d0b2b", muted: "#4f3a5c", panel: "#fffaf3", panelSolid: "#fffaf3",
        elevated: "#ffffff", field: "#ffffff", border: "#1d0b2b", edge: "transparent", hover: "rgba(214, 40, 120, 0.1)",
        pressed: "rgba(214, 40, 120, 0.18)", action: "#7a1fd1", actionInk: "#ffffff", focus: "#d62878", working: "#5a18a8", workingSoft: "#efe0ff",
        positive: "#0f6b45", negative: "#b0173f", warning: "#7a4a00", decor: "#ff7a1a",
        ...sh("4px 4px 0 #1d0b2b", "8px 8px 0 #d62878"),
      },
      dark: {
        page: "#1a0a22", washA: "#4a0f3a", washB: "#0c3a33", fg: "#fff2e6", muted: "#e0c8d8", panel: "#2a1236", panelSolid: "#2a1236",
        elevated: "#341845", field: "#22102c", border: "#ffb8d8", edge: "transparent", hover: "rgba(255, 184, 216, 0.1)",
        pressed: "rgba(255, 184, 216, 0.18)", action: "#ffcc4d", actionInk: "#1a0a22", focus: "#5fffd0", working: "#8ff2ff", workingSoft: "#1d3046",
        positive: "#8dffc6", negative: "#ffabc0", warning: "#ffe08a", decor: "#ff7a1a",
        ...sh("4px 4px 0 #ffb8d8", "8px 8px 0 #5fffd0"),
      },
    },
    performance: { heavy: ["pattern layers", "staggered entrances"], fallback: "Patterns flatten to their base colour; entrances become fades." },
    assets: "Procedural CSS patterns and sticker shapes only.",
  },
  {
    id: "luxury", number: 16, name: "Luxury Typography",
    philosophy: "Quiet confidence: type carries the luxury, not gold leaf.",
    description: "Large refined serif headlines, widely tracked small caps, deep navy and ivory, hairline separators and slow, elegant text reveals.",
    variants: ["dark", "light"], defaultVariant: "dark", layout: "topnav", home: "editorial", studio: "frames", nav: "underline", phoneNav: "bar",
    material: "solid", blur: 0,
    typography: { body: "inter", display: "cormorant", mono: "mono", headingWeight: 500, headingTracking: "0.01em", headingCase: "none", displayScale: 1.6, bodyScale: 1 },
    geometry: { rSm: 0, rMd: 0, rLg: 0, rShell: 0, border: 1, density: "spacious" },
    motion: { language: "Elegant reveal", quick: 200, base: 600, ease: "cubic-bezier(0.19, 1, 0.22, 1)", enter: "reveal", description: "Headlines unveil from a mask; everything else fades slowly." },
    icons: { stroke: 1.25, treatment: "thin" }, agentFrame: "square",
    notch: { shape: "plate", radius: 2, border: 1, glow: false, font: "Palatino Linotype", description: "A midnight-navy plate with an ivory serif line and a fine champagne rule." },
    palettes: {
      dark: {
        page: "#0c1424", washA: "#0c1424", washB: "#0c1424", fg: "#f4efe4", muted: "#bfb7a6", panel: "#101a2e", panelSolid: "#101a2e",
        elevated: "#152038", field: "#0e1729", border: "rgba(201, 176, 128, 0.32)", edge: "transparent", hover: "rgba(201, 176, 128, 0.07)",
        pressed: "rgba(201, 176, 128, 0.14)", action: "#d9c08f", actionInk: "#0c1424", focus: "#e8d4a8", working: "#e2cfa4", workingSoft: "#1f2a40",
        positive: "#a8d8b6", negative: "#f0a8a2", warning: "#ecd08f", decor: "#c9b080",
        ...sh("none", "0 30px 60px rgba(0, 0, 0, 0.5)"),
      },
      light: {
        page: "#f6f1e7", washA: "#f6f1e7", washB: "#f6f1e7", fg: "#16181f", muted: "#525049", panel: "#f6f1e7", panelSolid: "#f6f1e7",
        elevated: "#fbf8f1", field: "#fbf8f1", border: "rgba(22, 24, 31, 0.2)", edge: "transparent", hover: "rgba(120, 96, 50, 0.06)",
        pressed: "rgba(120, 96, 50, 0.12)", action: "#1a2540", actionInk: "#f6f1e7", focus: "#7a5f2a", working: "#1a2540", workingSoft: "#e6e2d6",
        positive: "#2a6a40", negative: "#9a2a28", warning: "#6e4a00", decor: "#a88a50",
        ...sh("none", "0 30px 60px rgba(22, 24, 31, 0.1)"),
      },
    },
    performance: { heavy: [], fallback: "Reveals become fades." },
    assets: "Typographic CSS only.",
  },
  {
    id: "sketch", number: 17, name: "Conceptual Sketch",
    philosophy: "An industrial designer's notebook: ideas drawn, annotated and dimensioned.",
    description: "Grid paper, pencil-weight outlines with a hand-drawn wobble, annotation labels, dimension lines and blueprint task diagrams.",
    variants: ["light", "dark"], defaultVariant: "light", layout: "sidebar", home: "grid", studio: "frames", nav: "ink", phoneNav: "block",
    material: "sketch", blur: 0,
    typography: { body: "inter", display: "hand", mono: "mono", headingWeight: 700, headingTracking: "0", headingCase: "none", displayScale: 1.4, bodyScale: 1 },
    geometry: { rSm: 4, rMd: 6, rLg: 8, rShell: 10, border: 2, density: "comfortable" },
    motion: { language: "Line drawing", quick: 140, base: 480, ease: "cubic-bezier(0.65, 0, 0.35, 1)", enter: "draw", description: "Outlines draw themselves in; annotations appear after the line." },
    icons: { stroke: 1.75, treatment: "hand" }, agentFrame: "square",
    notch: { shape: "frame", radius: 6, border: 2, glow: false, font: "Segoe Print", description: "A graph-paper card outlined in pencil with a dimension tick." },
    palettes: {
      light: {
        page: "#f7f6f1", washA: "#f7f6f1", washB: "#f7f6f1", fg: "#1f2328", muted: "#4f555c", panel: "#fdfdfa", panelSolid: "#fdfdfa",
        elevated: "#ffffff", field: "#ffffff", border: "#3a3f45", edge: "transparent", hover: "rgba(38, 92, 160, 0.06)",
        pressed: "rgba(38, 92, 160, 0.12)", action: "#265ca0", actionInk: "#ffffff", focus: "#c2410c", working: "#1f4f8c", workingSoft: "#e3ecf7",
        positive: "#246b3c", negative: "#a32a20", warning: "#7a4c00", decor: "#9fb7d6",
        ...sh("2px 2px 0 rgba(31, 35, 40, 0.18)", "4px 4px 0 rgba(31, 35, 40, 0.2)"),
      },
      dark: {
        page: "#0f2a4a", washA: "#0f2a4a", washB: "#0f2a4a", fg: "#eef5ff", muted: "#b6cbe6", panel: "#12325a", panelSolid: "#12325a",
        elevated: "#163a66", field: "#0d2544", border: "#cfe0f5", edge: "transparent", hover: "rgba(207, 224, 245, 0.08)",
        pressed: "rgba(207, 224, 245, 0.14)", action: "#ffd27a", actionInk: "#0f2a4a", focus: "#ffd27a", working: "#ffffff", workingSoft: "#1d4676",
        positive: "#9ff0bf", negative: "#ffb3ab", warning: "#ffe09a", decor: "#6f9fd8",
        ...sh("2px 2px 0 rgba(0, 0, 0, 0.3)", "4px 4px 0 rgba(0, 0, 0, 0.35)"),
      },
    },
    performance: { heavy: ["line-drawing entrances"], fallback: "Outlines appear complete." },
    assets: "Procedural CSS grid paper, SVG-free outlines and annotation marks.",
  },
  {
    id: "ethereal", number: 18, name: "Ethereal",
    philosophy: "Light and air: a calm morning sky that never hides the words.",
    description: "Pale blue and lavender mist, luminous floating cards, soft particle light and slow atmospheric motion with firm text contrast.",
    variants: ["light", "dark"], defaultVariant: "light", layout: "floating", home: "focus", studio: "gallery", nav: "dot", phoneNav: "floating",
    material: "mist", blur: 20,
    typography: { body: "inter", display: "quicksand", mono: "mono", headingWeight: 600, headingTracking: "-0.01em", headingCase: "none", displayScale: 1.1, bodyScale: 1.02 },
    geometry: { rSm: 14, rMd: 20, rLg: 26, rShell: 34, border: 1, density: "spacious" },
    motion: { language: "Atmospheric drift", quick: 200, base: 640, ease: "cubic-bezier(0.37, 0, 0.63, 1)", enter: "mist", description: "Surfaces condense out of the mist; particles drift slowly and stop when hidden." },
    icons: { stroke: 1.5, treatment: "thin" }, agentFrame: "circle",
    notch: { shape: "capsule", radius: 26, border: 1, glow: true, font: "Segoe UI", description: "A pale luminous capsule with a soft halo." },
    palettes: {
      light: {
        page: "#eef3fb", washA: "#dcd6ff", washB: "#cfeaff", fg: "#1b2240", muted: "#4d5574", panel: "rgba(255, 255, 255, 0.7)", panelSolid: "#f8faff",
        elevated: "rgba(255, 255, 255, 0.85)", field: "rgba(255, 255, 255, 0.85)", border: "rgba(120, 130, 200, 0.2)", edge: "rgba(255, 255, 255, 0.95)",
        hover: "rgba(110, 110, 230, 0.07)", pressed: "rgba(110, 110, 230, 0.14)", action: "#5546c8", actionInk: "#ffffff", focus: "#4338b8",
        working: "#3f37b0", workingSoft: "#e6e6ff", positive: "#1f6e4c", negative: "#a42a3c", warning: "#7a4e00", decor: "#b9b0ff",
        ...sh("0 10px 40px rgba(120, 130, 220, 0.18), 0 0 0 1px rgba(255, 255, 255, 0.6) inset", "0 24px 60px rgba(120, 130, 220, 0.24), 0 0 40px rgba(185, 176, 255, 0.25)"),
      },
      dark: {
        page: "#141a33", washA: "#2c2a63", washB: "#163a5e", fg: "#f1f3ff", muted: "#bcc3e2", panel: "rgba(34, 40, 78, 0.7)", panelSolid: "#22284e",
        elevated: "rgba(44, 52, 96, 0.85)", field: "rgba(20, 26, 51, 0.7)", border: "rgba(200, 205, 255, 0.18)", edge: "rgba(255, 255, 255, 0.14)",
        hover: "rgba(185, 176, 255, 0.1)", pressed: "rgba(185, 176, 255, 0.18)", action: "#c8c0ff", actionInk: "#1b1a40", focus: "#d9d3ff",
        working: "#c8d6ff", workingSoft: "#2c3566", positive: "#9fe6c2", negative: "#ffb6c4", warning: "#f4d896", decor: "#b9b0ff",
        ...sh("0 10px 40px rgba(0, 0, 0, 0.4)", "0 24px 60px rgba(0, 0, 0, 0.5), 0 0 40px rgba(185, 176, 255, 0.15)"),
      },
    },
    performance: { heavy: ["backdrop blur", "drifting particles"], fallback: "Opaque misty panels; particles hidden." },
    assets: "Procedural CSS gradients and particles only.",
  },
  {
    id: "bohemian", number: 19, name: "Bohemian",
    philosophy: "Warm, collected and lived-in: an artist's studio with good light.",
    description: "Terracotta, ochre and sage on linen, organic blob shapes, woven borders, warm serif headings and a relaxed, slightly irregular layout.",
    variants: ["light", "dark"], defaultVariant: "light", layout: "sidebar", home: "collage", studio: "gallery", nav: "tab", phoneNav: "pill",
    material: "linen", blur: 0,
    typography: { body: "inter", display: "fraunces", mono: "mono", headingWeight: 600, headingTracking: "-0.01em", headingCase: "none", displayScale: 1.25, bodyScale: 1.02 },
    geometry: { rSm: 12, rMd: 22, rLg: 30, rShell: 40, border: 1, density: "comfortable" },
    motion: { language: "Organic sway", quick: 180, base: 420, ease: "cubic-bezier(0.45, 0.05, 0.35, 1)", enter: "sway", description: "Cards drift in with a slight rotation, like a hanging textile settling." },
    icons: { stroke: 1.9, treatment: "hand" }, agentFrame: "blob",
    notch: { shape: "blob", radius: 24, border: 1, glow: false, font: "Constantia", description: "A terracotta capsule with a woven stitch border." },
    palettes: {
      light: {
        page: "#f3e7d7", washA: "#ecc9a8", washB: "#d4dcc0", fg: "#2e1d14", muted: "#5e4a3c", panel: "#fbf4ea", panelSolid: "#fbf4ea",
        elevated: "#fffaf3", field: "#fffaf3", border: "rgba(120, 70, 40, 0.22)", edge: "transparent", hover: "rgba(178, 82, 46, 0.08)",
        pressed: "rgba(178, 82, 46, 0.16)", action: "#a4472a", actionInk: "#ffffff", focus: "#3f6b4a", working: "#3d6448", workingSoft: "#dfe8d8",
        positive: "#33683c", negative: "#9e2f22", warning: "#7a4800", decor: "#d99a3e",
        ...sh("0 6px 18px rgba(120, 70, 40, 0.14)", "0 14px 34px rgba(120, 70, 40, 0.2)"),
      },
      dark: {
        page: "#22170f", washA: "#4a2716", washB: "#26301e", fg: "#f6eadb", muted: "#d2bea8", panel: "#2f2117", panelSolid: "#2f2117",
        elevated: "#3a291d", field: "#281b12", border: "rgba(232, 180, 130, 0.22)", edge: "transparent", hover: "rgba(232, 150, 100, 0.1)",
        pressed: "rgba(232, 150, 100, 0.18)", action: "#e8996b", actionInk: "#22170f", focus: "#b6d3a0", working: "#c2dbb0", workingSoft: "#33402a",
        positive: "#a9dca8", negative: "#ffb09f", warning: "#f0c97a", decor: "#d99a3e",
        ...sh("0 6px 18px rgba(0, 0, 0, 0.4)", "0 14px 34px rgba(0, 0, 0, 0.5)"),
      },
    },
    performance: { heavy: ["linen texture"], fallback: "Plain linen colour; no sway." },
    assets: "Procedural CSS weave and blob shapes only.",
  },
  {
    id: "victorian", number: 20, name: "Victorian",
    philosophy: "Ornamental elegance with contemporary manners.",
    description: "Engraved double-rule frames, corner ornaments, deep burgundy and forest with brass accents, classic serif type and restrained transitions.",
    variants: ["dark", "light"], defaultVariant: "dark", layout: "topnav", home: "editorial", studio: "frames", nav: "ornament", phoneNav: "bar",
    material: "ornate", blur: 0,
    typography: { body: "inter", display: "playfair", mono: "mono", headingWeight: 700, headingTracking: "0.01em", headingCase: "none", displayScale: 1.25, bodyScale: 1 },
    geometry: { rSm: 2, rMd: 3, rLg: 4, rShell: 6, border: 1, density: "comfortable" },
    motion: { language: "Ornamental", quick: 180, base: 440, ease: "cubic-bezier(0.33, 0, 0.2, 1)", enter: "curtain", description: "Frames open like a curtain from the centre; ornaments fade in after." },
    icons: { stroke: 1.6, treatment: "engraved" }, agentFrame: "ornate",
    notch: { shape: "frame", radius: 3, border: 2, glow: false, font: "Palatino Linotype", description: "A burgundy plate framed by a brass double rule." },
    palettes: {
      dark: {
        page: "#1b0d10", washA: "#3a1218", washB: "#14261c", fg: "#f5e9d6", muted: "#d4c0a3", panel: "#2a1317", panelSolid: "#2a1317",
        elevated: "#33181d", field: "#220f12", border: "rgba(201, 162, 90, 0.55)", edge: "rgba(201, 162, 90, 0.2)", hover: "rgba(201, 162, 90, 0.08)",
        pressed: "rgba(201, 162, 90, 0.16)", action: "#c9a25a", actionInk: "#1b0d10", focus: "#e9cf8f", working: "#e3d0a6", workingSoft: "#3a2a1c",
        positive: "#a6d6aa", negative: "#ffab9e", warning: "#efcd85", decor: "#c9a25a",
        ...sh("0 0 0 3px #2a1317, 0 0 0 4px rgba(201, 162, 90, 0.35), 0 14px 30px rgba(0, 0, 0, 0.5)", "0 0 0 3px #2a1317, 0 0 0 4px rgba(201, 162, 90, 0.5), 0 22px 46px rgba(0, 0, 0, 0.6)"),
      },
      light: {
        page: "#f1e6d2", washA: "#e8d5b5", washB: "#dfe3cf", fg: "#2a1414", muted: "#5a4232", panel: "#faf2e3", panelSolid: "#faf2e3",
        elevated: "#fffaf0", field: "#fffaf0", border: "rgba(110, 30, 40, 0.45)", edge: "transparent", hover: "rgba(110, 30, 40, 0.06)",
        pressed: "rgba(110, 30, 40, 0.12)", action: "#6e1e28", actionInk: "#faf2e3", focus: "#24563a", working: "#24563a", workingSoft: "#dfe8d8",
        positive: "#24563a", negative: "#8e1e24", warning: "#6e4600", decor: "#9a7330",
        ...sh("0 0 0 3px #faf2e3, 0 0 0 4px rgba(110, 30, 40, 0.3), 0 10px 24px rgba(60, 20, 20, 0.12)", "0 0 0 3px #faf2e3, 0 0 0 4px rgba(110, 30, 40, 0.45), 0 18px 40px rgba(60, 20, 20, 0.18)"),
      },
    },
    performance: { heavy: ["ornament layers"], fallback: "A single double rule; no curtain." },
    assets: "Procedural CSS double rules and corner ornaments only.",
  },
  {
    id: "cyberpunk", number: 21, name: "Cyberpunk",
    philosophy: "High-voltage street tech: loud, angular and alive.",
    description: "Black and hazard yellow with neon magenta and violet, clipped angular panels, holographic overlays and switchable glitch accents.",
    variants: ["dark"], defaultVariant: "dark", layout: "rail", home: "console", studio: "hud", nav: "bracket", phoneNav: "block",
    material: "neon", blur: 0,
    typography: { body: "inter", display: "chakra", mono: "mono", headingWeight: 700, headingTracking: "0.02em", headingCase: "uppercase", displayScale: 1.05, bodyScale: 1 },
    geometry: { rSm: 0, rMd: 0, rLg: 0, rShell: 0, border: 2, density: "compact" },
    motion: { language: "Controlled glitch", quick: 90, base: 240, ease: "steps(6, end)", enter: "glitch", description: "Panels slice in with a brief RGB offset; glitches never touch text you must read and switch off with reduced motion." },
    icons: { stroke: 2, treatment: "glow" }, agentFrame: "hex",
    notch: { shape: "plate", radius: 0, border: 2, glow: true, font: "Bahnschrift", description: "A clipped black plate with a hazard-yellow edge and a magenta glow." },
    palettes: {
      dark: {
        page: "#07060b", washA: "#2a0638", washB: "#06252e", fg: "#f4f1ff", muted: "#bdb6d2", panel: "#110f19", panelSolid: "#110f19",
        elevated: "#191623", field: "#0b0a10", border: "#fcee0a", edge: "rgba(255, 46, 136, 0.35)", hover: "rgba(252, 238, 10, 0.08)",
        pressed: "rgba(252, 238, 10, 0.16)", action: "#fcee0a", actionInk: "#07060b", focus: "#ff2e88", working: "#38f6ff", workingSoft: "#0e2a33",
        positive: "#5dffb0", negative: "#ff7aa8", warning: "#fcee0a", decor: "#ff2e88",
        ...sh("0 0 0 1px rgba(255, 46, 136, 0.25), 6px 6px 0 rgba(255, 46, 136, 0.35)", "0 0 0 1px rgba(56, 246, 255, 0.4), 8px 8px 0 rgba(56, 246, 255, 0.35), 0 0 30px rgba(255, 46, 136, 0.25)"),
      },
    },
    performance: { heavy: ["glitch overlays", "holographic shimmer"], fallback: "Glitch and shimmer disabled; colour and shape carry the identity." },
    assets: "Procedural CSS clip-paths and gradients only.",
  },
  {
    id: "wabisabi", number: 22, name: "Wabi-sabi",
    philosophy: "Beauty in the imperfect, the quiet and the natural.",
    description: "Earthy clay and stone neutrals, rice-paper texture, organic asymmetry, restrained mincho headings and quiet, unhurried transitions.",
    variants: ["light", "dark"], defaultVariant: "light", layout: "sidebar", home: "focus", studio: "list", nav: "ink", phoneNav: "bar",
    material: "paper", blur: 0,
    typography: { body: "inter", display: "mincho", mono: "mono", headingWeight: 500, headingTracking: "0.02em", headingCase: "none", displayScale: 1.15, bodyScale: 1.02 },
    geometry: { rSm: 4, rMd: 8, rLg: 14, rShell: 20, border: 1, density: "spacious" },
    motion: { language: "Quiet natural", quick: 200, base: 560, ease: "cubic-bezier(0.4, 0, 0.6, 1)", enter: "settle", description: "Things settle slowly into stillness, like ink spreading in water." },
    icons: { stroke: 1.5, treatment: "thin" }, agentFrame: "blob",
    notch: { shape: "capsule", radius: 16, border: 1, glow: false, font: "Georgia", description: "A stone-grey capsule with a single ink stroke underline." },
    palettes: {
      light: {
        page: "#e5e3d9", washA: "#dbd8c8", washB: "#e1e4da", fg: "#2b2722", muted: "#5b544a", panel: "#f5f1e8", panelSolid: "#f5f1e8",
        elevated: "#faf7f0", field: "#faf7f0", border: "rgba(60, 50, 40, 0.16)", edge: "transparent", hover: "rgba(110, 90, 60, 0.06)",
        pressed: "rgba(110, 90, 60, 0.12)", action: "#5d4b36", actionInk: "#f5f1e8", focus: "#7a3f22", working: "#4b5a43", workingSoft: "#e2e5d9",
        positive: "#3c5f3a", negative: "#8e3424", warning: "#6e4a00", decor: "#a18b6b",
        ...sh("0 4px 14px rgba(60, 50, 40, 0.08)", "0 12px 30px rgba(60, 50, 40, 0.12)"),
      },
      dark: {
        page: "#1c1a17", washA: "#25211c", washB: "#1f2220", fg: "#ece6db", muted: "#b9b0a2", panel: "#25221e", panelSolid: "#25221e",
        elevated: "#2c2824", field: "#201d1a", border: "rgba(236, 230, 219, 0.12)", edge: "transparent", hover: "rgba(236, 230, 219, 0.05)",
        pressed: "rgba(236, 230, 219, 0.1)", action: "#cdbb9c", actionInk: "#1c1a17", focus: "#e0a882", working: "#c4d0b6", workingSoft: "#2d332a",
        positive: "#a9cfa4", negative: "#f0a896", warning: "#e6c98a", decor: "#a18b6b",
        ...sh("0 4px 14px rgba(0, 0, 0, 0.3)", "0 12px 30px rgba(0, 0, 0, 0.4)"),
      },
    },
    performance: { heavy: ["paper texture"], fallback: "Plain paper colour." },
    assets: "Procedural CSS paper grain and ink strokes only.",
  },
];

export const UI_THEMES: Readonly<Record<UiThemeId, ThemeManifest>> = Object.freeze(
  Object.fromEntries(T.map((theme) => [theme.id, Object.freeze(theme)])) as Record<UiThemeId, ThemeManifest>,
);
export const isUiThemeId = (value: unknown): value is UiThemeId =>
  typeof value === "string" && (UI_THEME_IDS as readonly string[]).includes(value);

// ---------------------------------------------------------------------------------------------------------- preference
export type UiThemePreference = {
  theme: UiThemeId;
  variant: VariantChoice;
  /** null keeps the theme's own accent. */
  accent: string | null;
  density: DensityChoice;
  transparency: Transparency;
  highContrast: boolean;
  /**
   * Glass Intensity 0–100 (default 85): rim, sheen, refraction and depth decoration for glass materials, by fixed
   * deterministic formulas. It is never a blur control — blur stays owned by `transparency` — and no value here is
   * read by an authorization path.
   */
  glassIntensity: number;
};
export const DEFAULT_UI_PREFERENCE: UiThemePreference = Object.freeze({
  theme: DEFAULT_UI_THEME,
  variant: "light",
  accent: null,
  density: "theme",
  transparency: "medium",
  highContrast: false,
  glassIntensity: 85,
}) as UiThemePreference;

const PREFERENCE_KEYS = new Set(["theme", "variant", "accent", "density", "transparency", "highContrast", "glassIntensity"]);
const HEX = /^#[0-9a-f]{6}$/i;

/** Strict: unknown keys or values are refused, never coerced. Missing keys keep the current value. */
export function validateUiPreference(input: unknown, current: UiThemePreference = DEFAULT_UI_PREFERENCE): UiThemePreference {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Theme settings must be an object.");
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!PREFERENCE_KEYS.has(key)) throw new Error(`Unsupported theme setting: ${key}.`);
  const next: UiThemePreference = { ...current };
  if ("theme" in record) {
    if (!isUiThemeId(record.theme)) throw new Error("Unsupported theme.");
    next.theme = record.theme;
  }
  if ("variant" in record) {
    if (!(VARIANT_CHOICES as readonly unknown[]).includes(record.variant)) throw new Error("Unsupported appearance.");
    next.variant = record.variant as VariantChoice;
  }
  if ("accent" in record) {
    if (record.accent !== null && (typeof record.accent !== "string" || !HEX.test(record.accent))) throw new Error("Accent must be a #rrggbb colour or null.");
    if (typeof record.accent === "string" && !accentUsable(record.accent)) throw new Error("That accent cannot reach readable contrast with any label colour.");
    next.accent = typeof record.accent === "string" ? record.accent.toLowerCase() : null;
  }
  if ("density" in record) {
    if (!(DENSITIES as readonly unknown[]).includes(record.density)) throw new Error("Unsupported density.");
    next.density = record.density as DensityChoice;
  }
  if ("transparency" in record) {
    if (!(TRANSPARENCIES as readonly unknown[]).includes(record.transparency)) throw new Error("Unsupported transparency.");
    next.transparency = record.transparency as Transparency;
  }
  if ("glassIntensity" in record) {
    if (typeof record.glassIntensity !== "number" || !Number.isInteger(record.glassIntensity) || record.glassIntensity < 0 || record.glassIntensity > 100)
      throw new Error("Glass intensity must be a whole number from 0 to 100.");
    next.glassIntensity = record.glassIntensity;
  }
  if ("highContrast" in record) {
    if (typeof record.highContrast !== "boolean") throw new Error("High contrast must be true or false.");
    next.highContrast = record.highContrast;
  }
  return next;
}

/** A stored or cached value read back: anything damaged or from an unknown schema falls back to the system default. */
export function parseUiPreference(input: unknown): UiThemePreference {
  try {
    const record = input as Record<string, unknown> | null;
    if (record && typeof record === "object" && "schema" in record) {
      if (!(PREFERENCE_SCHEMAS as readonly unknown[]).includes(record.schema)) return { ...DEFAULT_UI_PREFERENCE };
      const { schema: _schema, ...rest } = record;
      return validateUiPreference(rest);
    }
    return validateUiPreference(input);
  } catch {
    return { ...DEFAULT_UI_PREFERENCE };
  }
}

// ------------------------------------------------------------------------------------------------------------- colour
type RGB = [number, number, number];
type RGBA = { rgb: RGB; alpha: number };
export function parseColor(value: string): RGBA | null {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return { rgb: [0, 2, 4].map((i) => parseInt(v.slice(1 + i, 3 + i), 16)) as RGB, alpha: 1 };
  const m = /^rgba?\(([^)]+)\)$/.exec(v);
  if (!m) return null;
  const parts = m[1].split(",").map((part) => Number(part.trim()));
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return { rgb: [parts[0], parts[1], parts[2]], alpha: parts.length > 3 ? parts[3] : 1 };
}
export const over = (top: RGBA, below: RGB): RGB => top.rgb.map((c, i) => Math.round(c * top.alpha + below[i] * (1 - top.alpha))) as RGB;
function luminance([r, g, b]: RGB): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
export function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const solid = (value: string, below: RGB = [255, 255, 255]): RGB => {
  const parsed = parseColor(value);
  return parsed ? over(parsed, below) : below;
};
export const toHex = ([r, g, b]: RGB) => `#${[r, g, b].map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0")).join("")}`;
/** The label colour for an accent fill: whichever of near-black or white reads, or null when neither reaches 4.5:1. */
export function accentInk(accent: string): string | null {
  const rgb = solid(accent);
  const dark: RGB = [16, 16, 24], light: RGB = [255, 255, 255];
  const best = contrast(rgb, light) >= contrast(rgb, dark) ? light : dark;
  return contrast(rgb, best) >= 4.5 ? toHex(best) : null;
}
export const accentUsable = (accent: string) => HEX.test(accent) && accentInk(accent) !== null;

// -------------------------------------------------------------------------------------------------- Glass Intensity
/**
 * The approved Glass Intensity mapping (E1): one bounded integer (0–100, default 85) drives rim, specular sheen,
 * edge refraction and shadow depth for the glass material, by fixed linear formulas — clear glass, restrained blur.
 * The ideal values are published in docs/ux/BUNNY_A_MASTER_UX_DESIGN.md §4.3; the clear term is the only one a clamp
 * may reduce, and it never renders a surface under the 4.5:1 rule.
 */
export type GlassTokens = {
  /** The clamped, whole intensity that produced the rest of the tokens. */
  intensity: number;
  rim: string;
  sheen: string;
  refraction: string;
  depth: number;
  /** The panel-alpha reduction actually applied after the contrast clamp: 0..0.06, 0 when decoration is limited. */
  clear: number;
  /** The rim/sheen glint colour for the resolved appearance. */
  rimColor: string;
  /** High contrast or reduced transparency renders glass solid; the stored preference is retained and explained. */
  limited: boolean;
};
/** Rim/sheen glints for the two Liquid Glass appearances (Silver = light, Graphite = dark; cool white glints graphite). */
export const GLASS_RIM_COLORS: Record<Variant, string> = { light: "#ffffff", dark: "#dfe6f5" };
/** The stored value, clamped defensively (validation already bounds it, tests and fixtures may not). */
export const glassIntensityOf = (preference: UiThemePreference): number =>
  Math.max(0, Math.min(100, Math.round(preference.glassIntensity)));

const round3 = (value: number) => Math.round(value * 1000) / 1000;

export function glassMaterialTokens(preference: UiThemePreference, palette: Palette, variant: Variant, solidMaterial: boolean): GlassTokens {
  const i = glassIntensityOf(preference) / 100;
  const tokens: GlassTokens = {
    intensity: Math.round(i * 100),
    rim: `${round3((0.3 + 0.7 * i) * 100)}%`,
    sheen: `${round3((0.18 + 0.62 * i) * 100)}%`,
    refraction: `${round3(1 + 3 * i)}px`,
    depth: Math.round((0.55 + 0.65 * i) * 10000) / 10000,
    clear: 0,
    rimColor: GLASS_RIM_COLORS[variant],
    limited: solidMaterial,
  };
  if (solidMaterial) return tokens;
  // The clear term lightens the main panel; it must keep fg and muted at 4.5:1 composited over page and both washes.
  const page = solid(palette.page);
  const panel = parseColor(palette.panel);
  if (!panel) return tokens;
  const backdrops = [
    page,
    over(parseColor(palette.washA)!, page),
    over(parseColor(palette.washB)!, page),
  ];
  let clear = round3(0.06 * i);
  while (clear > 0.0005) {
    const surface = over({ rgb: panel.rgb, alpha: panel.alpha - clear }, page);
    const overWash = backdrops.map((base) => over({ rgb: panel.rgb, alpha: panel.alpha - clear }, base));
    const surfaces = [surface, ...overWash];
    const readable = surfaces.every((s) =>
      contrast(parseColor(palette.fg)!.rgb, s) >= 4.5 && contrast(parseColor(palette.muted)!.rgb, s) >= 4.5,
    );
    if (readable) break;
    clear = round3(clear - 0.01);
  }
  tokens.clear = clear;
  return tokens;
}

/** The cleared panel colour for the resolved intensity: --panel and --glass take it; fields and elevated values keep theirs. */
function panelWithClear(palette: Palette, clear: number): Palette {
  if (clear <= 0) return palette;
  const parsed = parseColor(palette.panel);
  if (!parsed) return palette;
  const alpha = Math.max(0, parsed.alpha - clear);
  const panel = `rgba(${parsed.rgb[0]}, ${parsed.rgb[1]}, ${parsed.rgb[2]}, ${round3(alpha)})`;
  return { ...palette, panel };
}

/** Scales each layer's px lengths of one CSS box-shadow by the glass depth — glass themes only; anything unparseable passes through. */
export function scaledGlassShadow(shadow: string, depth: number): string {
  if (shadow === "none" || depth === 1) return shadow;
  const layers: string[] = [];
  let buffer = "";
  let parens = 0;
  for (const character of shadow) {
    if (character === "(") parens += 1;
    if (character === ")") parens -= 1;
    if (character === "," && parens === 0) {
      layers.push(buffer);
      buffer = "";
    } else buffer += character;
  }
  if (buffer.trim()) layers.push(buffer);
  return layers
    .map((layer) => layer.trim().replace(/(-?\d+(?:\.\d+)?)px/g, (match, value) => `${Math.round(parseFloat(value) * depth * 10) / 10}px`))
    .join(", ");
}

// ------------------------------------------------------------------------------------------------------------ resolve
export type ResolvedTheme = {
  manifest: ThemeManifest;
  variant: Variant;
  palette: Palette;
  preference: UiThemePreference;
  density: Exclude<DensityChoice, "theme">;
  /** Glass Intensity decoration for the glass material; null for every other material. */
  glass: GlassTokens | null;
  /** Notes when part of the preference was not applied (for example an accent that fails on this theme's page). */
  notes: string[];
};

export function themeManifest(id: unknown): ThemeManifest {
  return isUiThemeId(id) ? UI_THEMES[id] : UI_THEMES[DEFAULT_UI_THEME];
}

/** The variant shown: the requested one when the theme has it, otherwise the theme's own. */
export function resolveVariant(manifest: ThemeManifest, choice: VariantChoice, systemDark: boolean): Variant {
  const wanted: Variant = choice === "system" ? (systemDark ? "dark" : "light") : choice;
  return manifest.variants.includes(wanted) ? wanted : manifest.defaultVariant;
}

/** High contrast: opaque surfaces, full-strength separators and text, no translucency or soft shadows to rely on. */
function highContrastPalette(p: Palette): Palette {
  const page = solid(p.page);
  const dark = luminance(page) < 0.2;
  const fg = dark ? "#ffffff" : "#000000";
  return {
    ...p,
    washA: p.page, washB: p.page, fg, muted: fg, panel: p.panelSolid, elevated: p.panelSolid, field: p.panelSolid,
    border: fg, edge: "transparent", shadow: "none", raisedShadow: "none",
    focus: dark ? "#ffff00" : "#0000c0",
    hover: dark ? "rgba(255, 255, 255, 0.14)" : "rgba(0, 0, 0, 0.1)",
    pressed: dark ? "rgba(255, 255, 255, 0.24)" : "rgba(0, 0, 0, 0.18)",
  };
}

export function resolveTheme(preference: UiThemePreference, systemDark = false): ResolvedTheme {
  const manifest = themeManifest(preference.theme);
  const variant = resolveVariant(manifest, preference.variant, systemDark);
  let palette = manifest.palettes[variant] ?? manifest.palettes[manifest.defaultVariant]!;
  const notes: string[] = [];
  const solidMaterial = preference.highContrast || preference.transparency === "low";
  if (preference.transparency === "low") palette = { ...palette, panel: palette.panelSolid };
  const glass = manifest.material === "glass" ? glassMaterialTokens(preference, palette, variant, solidMaterial) : null;
  if (glass && glass.clear > 0) palette = panelWithClear(palette, glass.clear);
  if (preference.accent) {
    const ink = accentInk(preference.accent);
    const page = solid(palette.page);
    // An accent replaces the theme's action colour, which several themes also set as label text (luxury, pixel, swiss,
    // victorian, bohemian), so it must read as text on the page and on a solid panel (4.5:1, WCAG 1.4.3).
    const accent = solid(preference.accent);
    if (ink && contrast(accent, page) >= 4.5 && contrast(accent, solid(palette.panelSolid)) >= 4.5) palette = { ...palette, action: preference.accent, actionInk: ink };
    else notes.push("The custom accent does not stand out enough on this theme's background, so the theme's own accent is used.");
  }
  if (preference.highContrast) palette = highContrastPalette(palette);
  const density = preference.density === "theme" ? manifest.geometry.density : preference.density;
  return { manifest, variant, palette, preference, density, glass, notes };
}

// Glass keeps its accepted uppercase context labels; the others are styles built on tracked capitals.
const UPPERCASE_LABELS = new Set<UiThemeId>(["cybercore", "synthwave", "cyberpunk", "luxury", "glass"]);
const DENSITY_SCALE = { compact: 0.82, comfortable: 1, spacious: 1.16 } as const;
const px = (n: number) => `${Math.round(n * 100) / 100}px`;

/** The CSS custom properties for one resolved theme: shell tokens, the phone's tokens and the engine's material tokens. */
export function themeCssVars(resolved: ResolvedTheme): Record<string, string> {
  const { manifest: m, palette: p, preference, density } = resolved;
  const g = m.geometry, t = m.typography;
  const space = DENSITY_SCALE[density];
  const solidMaterial = preference.highContrast || preference.transparency === "low";
  const blur = solidMaterial ? 0 : preference.transparency === "high" ? Math.round(m.blur * 1.5) : m.blur;
  const vars: Record<string, string> = {
    "--font-bunny": FONT_STACKS[t.body],
    "--font-display": FONT_STACKS[t.display],
    "--font-mono": FONT_STACKS[t.mono],
    "--heading-weight": String(t.headingWeight),
    "--heading-tracking": t.headingTracking,
    "--heading-case": t.headingCase,
    "--display-scale": String(t.displayScale),
    // Tracked capitals only where the style itself is built on them; every other theme labels in sentence case.
    "--eyebrow-case": UPPERCASE_LABELS.has(m.id) ? "uppercase" : "none",
    "--eyebrow-tracking": UPPERCASE_LABELS.has(m.id) ? "0.12em" : "0",
    "--text-xs": `${0.75 * t.bodyScale}rem`,
    "--text-sm": `${0.8125 * t.bodyScale}rem`,
    "--text-body": `${0.9375 * t.bodyScale}rem`,
    "--text-title": `${1.0625 * t.bodyScale}rem`,
    "--text-heading": `calc(clamp(1.6rem, 2.2vw, 2rem) * ${t.displayScale})`,
    "--r-sm": px(g.rSm),
    "--r-md": px(g.rMd),
    "--r-lg": px(g.rLg),
    "--r-shell": px(g.rShell),
    // Pills follow the geometry: square-cornered styles get square chips and tags too.
    "--r-pill": g.rSm === 0 ? "0px" : "999px",
    "--radius-workspace-control": px(g.rSm),
    "--radius-workspace-panel": px(g.rLg),
    "--radius-workspace-dialog": px(g.rShell),
    "--bw": px(g.border),
    "--bw-strong": px(Math.max(g.border, 1) + (preference.highContrast ? 1 : 0)),
    "--s1": px(4 * space),
    "--s2": px(8 * space),
    "--s3": px(12 * space),
    "--s4": px(16 * space),
    "--s5": px(24 * space),
    "--s6": px(32 * space),
    "--s7": px(48 * space),
    "--s8": px(64 * space),
    "--quick": `${m.motion.quick}ms`,
    "--motion": `${m.motion.base}ms`,
    "--ease": m.motion.ease,
    "--icon-stroke": String(m.icons.stroke),
    "--page": p.page,
    "--page-end": p.page,
    "--page-wash-a": p.washA,
    "--page-wash-b": p.washB,
    "--fg": p.fg,
    "--muted": p.muted,
    "--subtle": p.muted,
    "--panel": p.panel,
    "--glass": p.panel,
    "--glass-solid": p.panelSolid,
    "--glass-edge": p.edge,
    "--elevated": p.elevated,
    "--field": p.field,
    "--border": p.border,
    "--luminous": "transparent",
    "--hover": p.hover,
    "--pressed": p.pressed,
    "--working": p.working,
    "--working-soft": p.workingSoft,
    "--thinking": p.working,
    "--claude": p.muted,
    "--positive": p.positive,
    "--negative": p.negative,
    "--warning": p.warning,
    "--stopped": p.muted,
    "--action": p.action,
    "--action-ink": p.actionInk,
    "--accent": p.action,
    "--accent-ink": p.actionInk,
    "--focus": p.focus,
    "--disabled": p.muted,
    "--decor": p.decor,
    "--shadow": resolved.glass && resolved.glass.depth !== 1 ? scaledGlassShadow(p.shadow, resolved.glass.depth) : p.shadow,
    "--raised-shadow": resolved.glass && resolved.glass.depth !== 1 ? scaledGlassShadow(p.raisedShadow, resolved.glass.depth) : p.raisedShadow,
    "--blur": px(blur),
    "--glass-saturate": blur ? "150%" : "100%",
    // Glass Intensity (E1): decoration tokens for the glass material. Blur stays owned by transparency — no var here touches it.
    ...(resolved.glass
      ? {
          "--glass-intensity": String(resolved.glass.intensity),
          "--glass-rim": resolved.glass.rim,
          "--glass-rim-color": resolved.glass.rimColor,
          "--glass-sheen": resolved.glass.sheen,
          "--glass-refract": resolved.glass.refraction,
          "--glass-depth": String(resolved.glass.depth),
        }
      : {}),
    // The phone companion's own token names (phone.css), from the same palette.
    "--pc-bg": p.page,
    "--pc-wash": `radial-gradient(120% 60% at 12% -8%, ${p.washA}, transparent 60%), radial-gradient(90% 50% at 100% 0%, ${p.washB}, transparent 60%)`,
    "--pc-card": p.panel,
    "--pc-card-solid": p.panelSolid,
    "--pc-chip": p.hover,
    "--pc-input": p.field,
    "--pc-line": p.border,
    "--pc-line-strong": p.border,
    "--pc-ink": p.fg,
    "--pc-muted": p.muted,
    "--pc-accent": p.working,
    "--pc-primary": p.action,
    "--pc-primary-ink": p.actionInk,
    "--pc-ok": p.positive,
    "--pc-warn": p.warning,
    "--pc-bad": p.negative,
    "--pc-track": p.hover,
    "--pc-focus": p.focus,
    "--pc-tabbar": p.panelSolid,
    "--pc-shadow": p.shadow,
  };
  return vars;
}

/** The attributes the web shell carries so per-theme CSS can select a composition without any component conditional. */
export function themeAttributes(resolved: ResolvedTheme): Record<string, string> {
  const m = resolved.manifest;
  return {
    "data-ui-theme": m.id,
    "data-theme": resolved.variant,
    "data-layout": m.layout,
    "data-home": m.home,
    "data-studio": m.studio,
    "data-nav": m.nav,
    "data-phone-nav": m.phoneNav,
    "data-material": resolved.preference.highContrast ? "solid" : m.material,
    "data-agent-frame": m.agentFrame,
    "data-density": resolved.density,
    "data-hc": String(resolved.preference.highContrast),
    "data-transparency": resolved.preference.transparency,
    "data-glass-intensity": String(glassIntensityOf(resolved.preference)),
    ...(resolved.glass?.limited ? { "data-glass-limited": "true" } : {}),
  };
}

// -------------------------------------------------------------------------------------------------------------- Notch
export type NotchColors = { fill: string; fillEnd: string; stroke: string; ink: string; muted: string; accent: string; accentInk: string; glow: string };
export type NotchTheme = {
  /** The island validates this literal (install/Bunny-Island.Theme.ps1) — the notch token channel stays v1-keyed. */
  schema: typeof NOTCH_THEME_SCHEMA;
  theme: UiThemeId;
  name: string;
  shape: NotchShape;
  radius: number;
  border: number;
  glow: boolean;
  font: NotchFont;
  highContrast: boolean;
  /** Glass Intensity (E1), additive and informational: v1-key-tolerant island readers simply ignore it until E2 adopts it. */
  glass: { intensity: number; rimAlpha: number; sheenAlpha: number };
  /** Both appearances, so the Notch can follow Windows' own light/dark choice when the user picked "system". */
  light: NotchColors;
  dark: NotchColors;
  variant: VariantChoice;
};

const notchColors = (p: Palette): NotchColors => {
  const page = solid(p.page);
  const fill = toHex(solid(p.panelSolid, page));
  return {
    fill,
    fillEnd: toHex(solid(p.elevated, page)),
    stroke: toHex(solid(p.border, solid(p.panelSolid, page))),
    ink: toHex(solid(p.fg)),
    muted: toHex(solid(p.muted)),
    accent: toHex(solid(p.action)),
    accentInk: toHex(solid(p.actionInk)),
    glow: toHex(solid(p.decor)),
  };
};

/** Flat, opaque #rrggbb tokens for the WPF Notch. It validates every value again before use. */
export function notchTheme(preference: UiThemePreference): NotchTheme {
  const m = themeManifest(preference.theme);
  const pick = (variant: Variant) => resolveTheme({ ...preference, variant }, variant === "dark").palette;
  const i = glassIntensityOf(preference) / 100;
  return {
    schema: NOTCH_THEME_SCHEMA,
    theme: m.id,
    name: m.name,
    shape: m.notch.shape,
    radius: m.notch.radius,
    border: Math.max(m.notch.border, preference.highContrast ? 2 : 0),
    glow: m.notch.glow && !preference.highContrast,
    font: m.notch.font,
    highContrast: preference.highContrast,
    glass: { intensity: Math.round(i * 100), rimAlpha: round3(0.3 + 0.7 * i), sheenAlpha: round3(0.18 + 0.62 * i) },
    light: notchColors(pick("light")),
    dark: notchColors(pick("dark")),
    variant: preference.variant,
  };
}

export type UiThemeView = {
  schema: typeof UI_THEME_SCHEMA;
  revision: number;
  preference: UiThemePreference;
  notch: NotchTheme;
};
export function uiThemeView(preference: UiThemePreference, revision: number): UiThemeView {
  return { schema: UI_THEME_SCHEMA, revision, preference, notch: notchTheme(preference) };
}
