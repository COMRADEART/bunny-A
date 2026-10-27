// Exact shim matching install/Bunny-Island.Placement.ps1 logic

export const bunnyEdges = ["top", "bottom", "left", "right"];

export function ConvertToBunnyEdge(val) {
  const edge = String(val);
  if (bunnyEdges.includes(edge)) return edge;
  return "top";
}

export function ConvertToBunnyOffset(val) {
  if (val === null || val === undefined) return 0.5;
  const num = Number(val);
  if (Number.isNaN(num) || !Number.isFinite(num)) return 0.5;
  return Math.min(1.0, Math.max(0.0, num));
}

export function GetBunnyPlacement(params) {
  const edge = ConvertToBunnyEdge(params.Edge || "top");
  const position = ConvertToBunnyOffset(params.Offset ?? 0.5);
  const areaLeft = Number(params.WorkArea.Left);
  const areaTop = Number(params.WorkArea.Top);
  const areaWidth = Math.max(0.0, Number(params.WorkArea.Width));
  const areaHeight = Math.max(0.0, Number(params.WorkArea.Height));
  const margin = params.Margin ?? 4;

  const gap = Math.min(Math.max(0.0, margin), Math.min(areaWidth, areaHeight) / 4);
  const innerWidth = areaWidth - 2 * gap;
  const innerHeight = areaHeight - 2 * gap;

  let requestedWidth = Number(params.Size.Width);
  let requestedHeight = Number(params.Size.Height);
  if (Number.isNaN(requestedWidth)) requestedWidth = 1;
  if (Number.isNaN(requestedHeight)) requestedHeight = 1;

  let left, top, width, height, orientation, indicatorSide;

  if (edge === "top" || edge === "bottom") {
    width = Math.min(Math.max(1.0, requestedWidth), innerWidth);
    height = Math.min(Math.max(1.0, requestedHeight), innerHeight);
    left = areaLeft + gap + (innerWidth - width) * position;
    top = edge === "top" ? areaTop + gap : areaTop + areaHeight - gap - height;
    orientation = "horizontal";
    indicatorSide = "left";
  } else {
    width = Math.min(Math.max(1.0, requestedHeight), innerWidth);
    height = Math.min(Math.max(1.0, requestedWidth), innerHeight);
    top = areaTop + gap + (innerHeight - height) * position;
    left = edge === "left" ? areaLeft + gap : areaLeft + areaWidth - gap - width;
    orientation = "vertical";
    indicatorSide = "top";
  }

  return { Edge: edge, Left: left, Top: top, Width: width, Height: height, Orientation: orientation, IndicatorSide: indicatorSide };
}

export function GetBunnyIndicatorLayout(params) {
  const maxVisible = params.MaxVisible ?? 4;
  const cap = Math.min(5, Math.max(1, maxVisible));
  const count = params.AgentCount ?? 0;
  const visible = Math.min(count, cap);
  const overflow = Math.max(0, count - cap);
  const axis = params.Placement.Orientation === "horizontal" ? "row" : "column";

  return { VisibleCount: visible, OverflowCount: overflow, Axis: axis, Side: params.Placement.IndicatorSide };
}
