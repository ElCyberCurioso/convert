// Iconos SVG en línea (trazos de 24 px). Se construyen con createElementNS:
// sin innerHTML, compatible con la CSP.

const P = {
  image: ['R3,3,18,18,2', 'C9,9,2', 'M21 15l-5-5L5 21'],
  audio: ['M9 18V5l12-2v13', 'C6,18,3', 'C18,16,3'],
  video: ['R2,6,14,12,2', 'M16 10l6-4v12l-6-4z'],
  doc: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5', 'M9 13h6M9 17h6'],
  sheet: ['R3,3,18,18,2', 'M3 9h18M3 15h18M9 3v18'],
  data: ['M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1', 'M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1'],
  archive: ['R3,3,18,5,1', 'M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8', 'M10 12h4'],
  font: ['M4 20 10.5 4h3L20 20', 'M7 14h10'],
  subtitle: ['R2,5,20,14,2', 'M6 12h4M13 12h5M6 15.5h9'],
  other: ['M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14'],
  upload: ['M12 15V3M7 8l5-5 5 5', 'M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4'],
  download: ['M12 3v12M7 10l5 5 5-5', 'M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2'],
  x: ['M6 6l12 12M18 6 6 18'],
  check: ['M5 12.5l4.5 4.5L19 7'],
  alert: ['C12,12,9', 'M12 7.5v5.5M12 16.4v.2'],
  arrow: ['M5 12h14M13 6l6 6-6 6'],
  sliders: ['M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1', 'C15,6,2', 'C9,12,2', 'C17,18,2'],
  lock: ['R5,11,14,10,2', 'M8 11V7a4 4 0 0 1 8 0v4'],
  play: ['M7 4.5v15l12.5-7.5z'],
  stop: ['R6,6,12,12,1.5'],
  merge: ['M6 3v6a6 6 0 0 0 6 6h0a6 6 0 0 1 6 6', 'M18 3v6a6 6 0 0 1-6 6', 'M12 15v6'],
  trash: ['M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13'],
  moon: ['M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7z'],
  sun: ['C12,12,4', 'M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8'],
  search: ['C11,11,7', 'M20 20l-4-4'],
  logo: ['C12,12,9.5', 'M12 3.2 20 17H4z', 'M6.6 12.5h10.8'],
  copy: ['R9,9,11,11,2', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'],
  type: ['M4 7V5h16v2', 'M12 5v14', 'M9 19h6'],
  hash: ['M5 9h14M5 15h14M10 3 8 21M16 3l-2 18'],
  retry: ['M4 12a8 8 0 0 1 14-5.3L20 9', 'M20 4v5h-5', 'M20 12a8 8 0 0 1-14 5.3L4 15', 'M4 20v-5h5'],
};

const NS = 'http://www.w3.org/2000/svg';

export function icon(name, cls = 'icon') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of P[name] || P.other) {
    let el;
    if (d[0] === 'C') {
      const [cx, cy, r] = d.slice(1).split(',');
      el = document.createElementNS(NS, 'circle');
      el.setAttribute('cx', cx); el.setAttribute('cy', cy); el.setAttribute('r', r);
    } else if (d[0] === 'R') {
      const [x, y, w, h, rx] = d.slice(1).split(',');
      el = document.createElementNS(NS, 'rect');
      el.setAttribute('x', x); el.setAttribute('y', y); el.setAttribute('width', w); el.setAttribute('height', h); el.setAttribute('rx', rx);
    } else {
      el = document.createElementNS(NS, 'path');
      el.setAttribute('d', d);
    }
    svg.append(el);
  }
  return svg;
}
