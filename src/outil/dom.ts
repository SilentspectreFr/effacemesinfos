type Child = Node | string | null | undefined | false;

type Props = Record<string, string | boolean | number | ((event: Event) => void) | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (typeof value === "function") element.addEventListener(name, value);
    else if (name === "class") element.className = String(value);
    else if (name in element && typeof value === "boolean") (element as unknown as Record<string, boolean>)[name] = value;
    else element.setAttribute(name, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return element;
}

export function replaceChildren(target: HTMLElement, ...children: Child[]) {
  target.replaceChildren(...children.filter((child): child is Node | string => child !== null && child !== undefined && child !== false));
}

export function plural(count: number, singular: string, pluralForm = singular + "s"): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

const iconPaths = {
  cadenas: "M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5z",
  depot: "M12 16V4m0 0L7 9m5-5 5 5M4 16v4h16v-4",
  annuler: "M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
  retablir: "m15 14 5-5-5-5m5 5H9a5 5 0 0 0 0 10h3",
  valide: "M20 6 9 17l-5-5",
  alerte: "M12 3 2 21h20L12 3zm0 7v5m0 3v.5",
  cible: "M12 3v3m0 12v3M3 12h3m12 0h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  texte: "M5 5h14M5 10h14M5 15h9M5 20h6",
  fleche: "m9 18 6-6-6-6",
  retour: "m15 18-6-6 6-6",
  copier: "M8 8h12v12H8zM4 16V4h12",
  telecharger: "M12 4v12m0 0-5-5m5 5 5-5M4 20h16",
  curseur: "M9 4h6M9 20h6M12 4v16",
  rectangle: "M4 6h16v12H4z",
  page: "M6 3h9l4 4v14H6zm9 0v4h4",
  oeil: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  gomme: "M4 16 14 6l4 4-10 10H6l-2-2zm5-5 4 4m-2 5h9",
  loupe: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm5 12 4 4",
  image: "M4 5h16v14H4zm3 10 4-4 3 3 2-2 4 4M15 9h.5",
};

export type IconName = keyof typeof iconPaths;

export function icon(name: IconName): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "icone");
  const path = document.createElementNS(namespace, "path");
  path.setAttribute("d", iconPaths[name]);
  svg.append(path);
  return svg;
}

export function prefersCalm(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
