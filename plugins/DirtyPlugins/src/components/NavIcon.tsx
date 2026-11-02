import { React } from "../runtime";
import { theme } from "../theme";
import type * as R from "react";

export type NavIconName = "hub" | "stats" | "multiscreen" | "battles" | "leaderboards";
type IconSet = Record<NavIconName, () => R.JSX.Element>;

function Art(props: { view?: string; children: R.ReactNode }) {
  return <svg viewBox={props.view || "0 0 24 24"}>{props.children}</svg>;
}

function line(d: string, color: string, width = 2) {
  return <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />;
}

function solid(d: string, color: string) {
  return <path d={d} fill={color} />;
}

function dot(x: number, y: number, r: number, color: string) {
  return <circle cx={x} cy={y} r={r} fill={color} />;
}

function block(x: number, y: number, width: number, height: number, color: string, rx?: number) {
  return <rect x={x} y={y} width={width} height={height} rx={rx} fill={color} />;
}

function mirrored(children: R.ReactNode) {
  return <g transform="translate(24 0) scale(-1 1)">{children}</g>;
}

function sparkle(x: number, y: number, r: number, color: string) {
  const k = r * 0.15;
  return solid(
    `M${x} ${y - r}Q${x + k} ${y - k} ${x + r} ${y}Q${x + k} ${y + k} ${x} ${y + r}` +
      `Q${x - k} ${y + k} ${x - r} ${y}Q${x - k} ${y - k} ${x} ${y - r}Z`,
    color,
  );
}

/** Midnight and Tropical Punch share these shapes; Tropical gives each part its own colour. */
function lineSet(first: string, second: string, third: string, star: string): IconSet {
  const ring = (x: number, y: number, color: string) => (
    <circle cx={x} cy={y} r={2.7} fill="none" stroke={color} strokeWidth={2} />
  );
  const windowFrame = (x: number, y: number, color: string, fill = "none") => (
    <rect x={x} y={y} width={8} height={8} rx={2} fill={fill} stroke={color} strokeWidth={2} />
  );
  return {
    hub: () => (
      <Art>
        {line("M6 3v9.8M6 18.2v2.8", first)}
        {line("M12 3v18", second)}
        {line("M18 3v7.3M18 15.7v5.3", third)}
        {ring(6, 15.5, third)}
        {dot(12, 8, 3, star)}
        {ring(18, 13, first)}
      </Art>
    ),
    stats: () => (
      <Art>
        {line("M3.5 20L9 11.5", first, 1.7)}
        {line("M9 11.5l5.5 4", third, 1.7)}
        {line("M14.5 15.5L19.5 5", second, 1.7)}
        {dot(3.5, 20, 2, first)}
        {dot(9, 11.5, 2, third)}
        {dot(14.5, 15.5, 2, second)}
        {sparkle(19.5, 5, 4.4, star)}
      </Art>
    ),
    multiscreen: () => (
      <Art>
        {windowFrame(3, 3, first)}
        {windowFrame(13, 3, star, star)}
        {windowFrame(3, 13, third)}
        {windowFrame(13, 13, second)}
      </Art>
    ),
    battles: () => (
      <Art>
        {line("M3.5 3.5L17 17M14.2 19.8l5.6-5.6M17 17l4 4", first)}
        {line("M20.5 3.5L7 17M9.8 19.8l-5.6-5.6M7 17l-4 4", third)}
        {sparkle(12, 5.2, 3.6, star)}
      </Art>
    ),
    leaderboards: () => (
      <Art>
        {line("M7 3.5h10v6.5a5 5 0 0 1-10 0z", third)}
        {line("M7 5.5H3.8v1a4 4 0 0 0 3.7 4M17 5.5h3.2v1a4 4 0 0 1-3.7 4", first)}
        {line("M12 15v4.5M8 20.5h8", second)}
        {sparkle(12, 8.6, 3.2, star)}
      </Art>
    ),
  };
}

const PINK = "#ff82cb",
  AQUA = "#7ee7e7",
  LEMON = "#ffd166",
  LILAC = "#b894ff",
  SUGAR = "#fff5fc";

function glossy(x: number, y: number, r: number, color: string) {
  return (
    <g>
      {dot(x, y, r, color)}
      {dot(x - r * 0.34, y - r * 0.36, r * 0.24, "#fff")}
    </g>
  );
}

function candySquare(x: number, y: number, color: string) {
  return (
    <g>
      {block(x, y, 9, 9, color, 3.4)}
      {block(x + 1.8, y + 1.6, 2.6, 1.3, "#fff", 0.65)}
    </g>
  );
}

function lollipop(x: number, y: number, color: string) {
  return (
    <g>
      {dot(x, y, 5.2, color)}
      {line(`M${x - 2.7} ${y}a2.7 2.7 0 1 1 2.7 2.7a1.5 1.5 0 0 1-1.5-1.5`, "#fff", 1.2)}
    </g>
  );
}

const candySet: IconSet = {
  hub: () => (
    <Art>
      {line("M2 5.5h20M2 12h20M2 18.5h20", SUGAR, 1.6)}
      {glossy(15, 5.5, 3.8, PINK)}
      {glossy(7, 12, 3.8, AQUA)}
      {glossy(16.5, 18.5, 3.8, LEMON)}
    </Art>
  ),
  stats: () => (
    <Art>
      {glossy(9.5, 14.5, 7, PINK)}
      {glossy(18, 7.5, 4.6, AQUA)}
      {glossy(19.2, 18.8, 3.3, LEMON)}
      {glossy(6.5, 4.5, 2.7, LILAC)}
    </Art>
  ),
  multiscreen: () => (
    <Art>
      {candySquare(2.2, 2.2, PINK)}
      {candySquare(12.8, 2.2, AQUA)}
      {candySquare(2.2, 12.8, LEMON)}
      {candySquare(12.8, 12.8, LILAC)}
    </Art>
  ),
  battles: () => (
    <Art>
      {line("M10 10.5L21 21.5M14 10.5L3 21.5", SUGAR)}
      {lollipop(6.5, 7, PINK)}
      {lollipop(17.5, 7, AQUA)}
    </Art>
  ),
  leaderboards: () => (
    <Art>
      {line("M6 12.2H3.4v.6a3.5 3.5 0 0 0 3.5 3.5M18 12.2h2.6v.6a3.5 3.5 0 0 1-3.5 3.5", LEMON, 1.8)}
      {solid("M6.5 11a5.5 5.5 0 0 1 11 0z", PINK)}
      {dot(10.1, 8, 0.9, "#fff")}
      {line("M12 3.6c.3-1 1-1.7 2.1-2", AQUA, 1.1)}
      {dot(12, 4.6, 1.9, "#ff4f74")}
      {solid("M6 11h12v2.6a6 6 0 0 1-12 0z", LEMON)}
      {block(10.9, 18.8, 2.2, 2, LEMON)}
      {block(7.5, 20.3, 9, 2.4, LILAC, 1.2)}
    </Art>
  ),
};

const SPRITE_COLORS: Record<string, string> = {
  C: "#2de2e6",
  Y: "#f9f871",
  R: "#ff3864",
  W: "#f7f0ff",
  K: "#171128",
};

/** Sixteen rows of sixteen colour letters. Each colour becomes one path of whole-pixel runs. */
function sprite(rows: string[]) {
  const runs: Record<string, string> = {};
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const color = row[x];
      let width = 1;
      while (row[x + width] === color) width++;
      if (color !== ".") runs[color] = (runs[color] || "") + `M${x} ${y}h${width}v1h-${width}z`;
      x += width;
    }
  });
  return (
    <svg className="dirty-ui-nav-sprite" viewBox="0 0 16 16" shapeRendering="crispEdges">
      {Object.keys(runs).map(color => (
        <path key={color} d={runs[color]} fill={SPRITE_COLORS[color]} />
      ))}
    </svg>
  );
}

const arcadeSet: IconSet = {
  hub: () =>
    sprite([
      "................",
      "......RRRR......",
      ".....RWWRRR.....",
      ".....RWRRRR.....",
      ".....RRRRRR.....",
      "......RRRR......",
      ".......WW.......",
      ".......WW.......",
      ".......WW.......",
      ".......WW.......",
      "..CCCCCCCCCCCC..",
      ".CCCCCCCCCCCCCC.",
      ".CCYYCCCCCCRRCC.",
      ".CCYYCCCCCCRRCC.",
      ".CCCCCCCCCCCCCC.",
      "................",
    ]),
  stats: () =>
    sprite([
      ".........YY.....",
      ".....CCC.YYYY...",
      "...CCCCC.YYYYY..",
      "..CCCCCC.YYYYYY.",
      ".CCCCCCC.YYYYYY.",
      ".CCCCCCC.YYYYYYY",
      "CCCCCCCC.YYYYYYY",
      "CCCCCCCC........",
      "CCCCCCCRRRRRRRR.",
      "CCCCCCCRRRRRRRR.",
      "CCCCCCCRRRRRRRR.",
      ".CCCCCRRRRRRRR..",
      ".CCCCCRRRRRRRR..",
      "..CCCRRRRRRRR...",
      "...CCRRRRRRR....",
      ".....RRRRR......",
    ]),
  multiscreen: () =>
    sprite([
      "CCCCCCC..RRRRRRR",
      "CKKKKKC..RKKKKKR",
      "CKKKKKC..RKKKKKR",
      "CKKKKKC..RKKKKKR",
      "CKKKKKC..RKKKKKR",
      "CKKKKKC..RKKKKKR",
      "CCCCCCC..RRRRRRR",
      "................",
      "................",
      "YYYYYYY..WWWWWWW",
      "YKKKKKY..WKKKKKW",
      "YKKKKKY..WKKKKKW",
      "YKKKKKY..WKKKKKW",
      "YKKKKKY..WKKKKKW",
      "YKKKKKY..WKKKKKW",
      "YYYYYYY..WWWWWWW",
    ]),
  battles: () =>
    sprite([
      "CC............RR",
      "CCC..........RRR",
      ".CCC........RRR.",
      "..CCC......RRR..",
      "...CCC....RRR...",
      "....CCC..RRR....",
      ".....CCCRRR.....",
      "......CCCR......",
      "......RCCC......",
      ".YY..RRRCCC..YY.",
      "..YYRRR..CCCYY..",
      "...YYR....CYY...",
      "..WWYY....YYWW..",
      "..WW.YY..YY.WW..",
      "YY............YY",
      "YY............YY",
    ]),
  leaderboards: () =>
    sprite([
      "................",
      "...YYYYYYYYYY...",
      ".YYYYYYYYYYYYYY.",
      ".Y.YWWYYYYYYY.Y.",
      ".Y.YWYYYYYYYY.Y.",
      ".Y.YYYYYYYYYY.Y.",
      ".YYYYYYYYYYYYYY.",
      "...YYYYYYYYYY...",
      "....YYYYYYYY....",
      ".....YYYYYY.....",
      "......YYYY......",
      ".......YY.......",
      ".......YY.......",
      ".....CCCCCC.....",
      "....CCCCCCCC....",
      "................",
    ]),
};

const INK = "#3b3440",
  CREAM = "#fffaf0",
  TEAL = "#0b7274",
  AMBER = "#f2b134",
  CORAL = "#e76f51",
  DENIM = "#5c7cba";

function inked(d: string, color: string, width = 1.1) {
  return <path d={d} fill={color} stroke={INK} strokeWidth={width} strokeLinejoin="round" />;
}

function polaroid(x: number, y: number, angle: number, color: string) {
  return (
    <g transform={`rotate(${angle} ${x + 4.6} ${y + 4.6})`}>
      <rect x={x} y={y} width={9.2} height={9.2} fill={CREAM} stroke={INK} strokeWidth={0.9} />
      {block(x + 1.2, y + 1.2, 6.8, 5.4, color)}
    </g>
  );
}

/** A Bic Cristal, point up: clear barrel, visible ink and the cap posted on the end. */
function bicPen(ink: string, angle: number) {
  return (
    <g transform={`rotate(${angle} 12 12)`}>
      {solid("M12 -1.4l.5 1.7h-1z", INK)}
      {inked("M11.5 .3h1L14 4.6h-4z", CREAM, 0.7)}
      {inked("M10 4.6h4V19h-4z", "#e4f1f4", 0.8)}
      {block(11.4, 4.6, 1.2, 14.4, ink)}
      {inked("M9.8 19h4.4v6h-4.4z", ink, 0.8)}
      <rect x={14.2} y={19.6} width={1.1} height={4.4} fill={CREAM} stroke={INK} strokeWidth={0.55} />
    </g>
  );
}

function scallopedDisc(x: number, y: number) {
  let points = "";
  for (let i = 0; i < 144; i++) {
    const angle = (i * Math.PI) / 72;
    const radius = 7.7 + 0.8 * Math.cos(12 * angle);
    points += `${i ? "L" : "M"}${(x + radius * Math.cos(angle)).toFixed(2)} ${(y + radius * Math.sin(angle)).toFixed(2)}`;
  }
  return points + "Z";
}

const paperSet: IconSet = {
  hub: () => (
    <Art>
      {inked("M5 2.2h10.6l4 4V21.8H5z", CREAM)}
      {inked("M15.6 2.2v4h4z", "#f7e7c1", 0.9)}
      {line("M7.3 9.8l1.3 1.3 2.2-2.6M7.3 15.3l1.3 1.3 2.2-2.6", TEAL, 1.6)}
      {line("M12.6 10.2h4.8M12.6 15.7h4.8", INK, 1.3)}
    </Art>
  ),
  stats: () => (
    <Art>
      <circle cx={12} cy={12} r={10.7} fill={CREAM} stroke={INK} strokeWidth={1.1} />
      {inked("M11 12.6V5.4a7.2 7.2 0 1 0 7.2 7.2z", AMBER)}
      {inked("M13.2 10.6V3.6a7 7 0 0 1 7 7z", CORAL)}
    </Art>
  ),
  multiscreen: () => (
    <Art>
      {polaroid(2.2, 2.2, -4, TEAL)}
      {polaroid(12.6, 2.2, 3, CORAL)}
      {polaroid(2.2, 12.6, 3, AMBER)}
      {polaroid(12.6, 12.6, -3, DENIM)}
    </Art>
  ),
  battles: () => (
    <Art>
      {bicPen(CORAL, -45)}
      {bicPen(DENIM, 45)}
    </Art>
  ),
  leaderboards: () => (
    <Art>
      {inked("M8.5 13.5L6 22.6l3.6-1.9L12 14Z", AMBER, 0.9)}
      {inked("M15.5 13.5L18 22.6l-3.6-1.9L12 14Z", AMBER, 0.9)}
      {inked(scallopedDisc(12, 9.3), CORAL, 0.9)}
      <circle cx={12} cy={9.3} r={4.6} fill={CREAM} stroke={INK} strokeWidth={0.9} />
    </Art>
  ),
};

const STIJL_RED = "#dc5e5f",
  STIJL_BLUE = "#5b9acf",
  STIJL_GREY = "#dcdcdc",
  STIJL_CHARCOAL = "#282828";

interface StijlColors {
  /** Frame and rules of the square icons. */
  frame: string;
  ground: string;
  /** The neutral block among the red and blue ones. */
  neutral: string;
  /** Outline of the swords and cup, which have no ground of their own. */
  outline: string;
  red: string;
  blue: string;
}

function stijlSword(blade: string) {
  return (
    <React.Fragment>
      <path d="M2.5 2.5l4 1L17 14l-3 3L3.5 6.5z" fill={blade} strokeWidth={0.7} />
      <path d="M16.5 16.5l4 4" strokeWidth={3.2} />
      <path d="M16.5 16.5l4 4" stroke={STIJL_BLUE} strokeWidth={1.6} />
      <path d="M12.5 18.5l6-6M19 22l3-3" />
    </React.Fragment>
  );
}

function stijlSet(colors: StijlColors): IconSet {
  const { frame, ground, neutral, outline, red, blue } = colors;
  const square = (children: R.ReactNode) => (
    <Art view="2 2 20 20">
      {block(2, 2, 20, 20, frame, 0.3)}
      {block(3, 3, 18, 18, ground)}
      {children}
    </Art>
  );
  return {
    hub: () =>
      square(
        <React.Fragment>
          {block(5, 6.6, 14, 0.9, frame)}
          {block(5, 11.55, 14, 0.9, frame)}
          {block(5, 16.5, 14, 0.9, frame)}
          {block(7, 5.25, 3.6, 3.6, STIJL_RED)}
          {block(13.2, 10.2, 3.6, 3.6, STIJL_BLUE)}
          {block(9.4, 15.15, 3.6, 3.6, neutral)}
        </React.Fragment>,
      ),
    stats: () =>
      square(
        <React.Fragment>
          {block(5, 5, 0.9, 14.5, frame)}
          {block(5, 18.6, 14.5, 0.9, frame)}
          {dot(10, 13, 3.6, STIJL_RED)}
          {dot(16, 8.2, 2.6, STIJL_BLUE)}
          {dot(16.5, 15, 1.8, neutral)}
        </React.Fragment>,
      ),
    multiscreen: () => (
      <Art view="0 0 18.24 18.24">
        {block(0, 0, 18.24, 18.24, frame)}
        {block(1, 1, 16.24, 16.24, ground)}
        {block(2.4, 2.4, 5.88, 5.88, STIJL_RED)}
        {block(9.96, 2.4, 5.88, 5.88, neutral)}
        {block(2.4, 9.96, 5.88, 5.88, neutral)}
        {block(9.96, 9.96, 5.88, 5.88, STIJL_BLUE)}
      </Art>
    ),
    battles: () => (
      <Art>
        <g fill="none" stroke={outline} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round">
          {stijlSword(red)}
          {mirrored(stijlSword(blue))}
        </g>
      </Art>
    ),
    leaderboards: () => (
      <Art>
        <g fill="none" stroke={outline} strokeWidth={1.8}>
          <path d="M7 5H4v2c0 2 1 3 4 4" stroke={red} />
          <path d="M17 5h3v2c0 2-1 3-4 4" stroke={blue} />
          <path d="M7 3h10v6c0 3-2 5-5 5s-5-2-5-5V3z" fill={blue} />
          <path d="M12 14v5M8 21h8M10 19h4" />
        </g>
      </Art>
    ),
  };
}

const STOCK_WHITE = "#f5f8fa",
  STOCK_BLADE = "M2.5 2.5l2.6.5L16.6 14.7l-1.9 1.9L3 5.1z",
  STOCK_MASK = "dirty-ui-nav-stock-cross";

function stockSword() {
  return (
    <React.Fragment>
      {solid(STOCK_BLADE, STOCK_WHITE)}
      {line("M13.9 18.5l4.6-4.6M16.2 16.2l4.4 4.4", STOCK_WHITE, 1.8)}
    </React.Fragment>
  );
}

const stockSet: IconSet = {
  hub: () => (
    <Art>
      {solid(
        "M2 7h5.2a3 3 0 1 1 5.6 0H18v5.2a3 3 0 1 1 0 5.6V21H12.8a3 3 0 1 0-5.6 0H2v-5.2a3 3 0 1 0 0-5.6z",
        STOCK_WHITE,
      )}
    </Art>
  ),
  stats: () => (
    <Art>
      {solid("M11 3a10 10 0 1 0 10 10H11z", STOCK_WHITE)}
      {solid("M14 1.5V10h8.5A8.5 8.5 0 0 0 14 1.5z", STOCK_WHITE)}
    </Art>
  ),
  multiscreen: () => (
    <Art>
      {block(2.5, 2.5, 9, 9, STOCK_WHITE, 2)}
      {block(12.5, 2.5, 9, 9, STOCK_WHITE, 2)}
      {block(2.5, 12.5, 9, 9, STOCK_WHITE, 2)}
      {block(12.5, 12.5, 9, 9, STOCK_WHITE, 2)}
    </Art>
  ),
  battles: () => (
    <Art>
      {/* The mask leaves a real gap where one blade passes over the other, whatever the navbar colour. */}
      <mask id={STOCK_MASK}>
        {block(0, 0, 24, 24, "#fff")}
        <path d={STOCK_BLADE} fill="#000" stroke="#000" strokeWidth={1.7} />
      </mask>
      <g mask={`url(#${STOCK_MASK})`}>{mirrored(stockSword())}</g>
      {stockSword()}
    </Art>
  ),
  leaderboards: () => (
    <Art>
      {solid("M6.5 2.5h11V10a5.5 5.5 0 0 1-11 0z", STOCK_WHITE)}
      {line("M6.5 5H3v1.5a4 4 0 0 0 4 4M17.5 5H21v1.5a4 4 0 0 1-4 4", STOCK_WHITE)}
      {block(10.7, 15, 2.6, 4.4, STOCK_WHITE)}
      {block(7, 19, 10, 2.8, STOCK_WHITE, 1)}
    </Art>
  ),
};

/** Keyed by suite theme. Colours are literal because Stash's navbar keeps the host theme. */
const ICON_SETS: Record<string, IconSet> = {
  classic: lineSet("#54d5ca", "#54d5ca", "#54d5ca", "#f3c779"),
  candy: candySet,
  tropical: lineSet("#65e8ca", "#5fbdea", "#ff7f6e", "#ffd166"),
  arcade: arcadeSet,
  paper: paperSet,
  destijl: stijlSet({
    frame: STIJL_CHARCOAL,
    ground: "#f2f2f2",
    neutral: "#c8c8c8",
    outline: "#f2f2f2",
    red: "#ee9293",
    blue: "#a4c8e4",
  }),
  "destijl-dark": stijlSet({
    frame: STIJL_GREY,
    ground: STIJL_CHARCOAL,
    neutral: STIJL_GREY,
    outline: STIJL_GREY,
    red: STIJL_RED,
    blue: STIJL_BLUE,
  }),
  stockstash: stockSet,
};

/** Rendered in <i> rather than <span> so Stash themes that hide navbar spans keep the icon. */
export function NavIcon(props: { name: NavIconName }) {
  const [key, setKey] = React.useState(theme.currentKey);
  React.useEffect(() => {
    setKey(theme.currentKey);
    return theme.subscribe(setKey);
  }, []);
  return (
    <i aria-hidden="true" className="dirty-ui-nav-icon">
      {ICON_SETS[key][props.name]()}
    </i>
  );
}
