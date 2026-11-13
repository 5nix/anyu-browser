// Lucide icons (https://lucide.dev), ISC License, Copyright (c) Lucide Contributors.
// Only the icons Cave uses, inlined: no runtime dependency and nothing loaded from the network.

const PATHS: Record<string, string> = {
  'circle-check': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  'circle-pause': '<circle cx="12" cy="12" r="10"/><path d="M10 9v6m4-6v6"/>',
  'circle-x': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
  'power': '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
  'cpu': '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M9 2v2m6-2v2M9 20v2m6-2v2M2 9h2m-2 6h2m16-6h2m-2 6h2"/>',
  'map-pin': '<path d="M20 10c0 5-5.5 10.2-7.4 11.8a1 1 0 0 1-1.2 0C9.5 20.2 4 15 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>', 
  'monitor': '<rect width="20" height="14" x="2" y="3" rx="2"/> <path d="M12 17v4M8 21h8"/>',
  'sun': '<circle cx="12" cy="12" r="4"/> <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/>',
  'moon': '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>',
  'folder': '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9l-.81-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  'folder-plus': '<path d="M12 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v4"/> <path d="M16 19h6"/> <path d="M19 16v6"/>',
  'pencil': '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.986L3.842 16.174a2 2 0 0 0-.5.82L2.03 21.37a.5.5 0 0 0 .6.6l4.376-1.312a2 2 0 0 0 .82-.5z"/> <path d="m15 5 4 4"/>',
  'arrow-up': '<path d="m5 12 7-7 7 7"/> <path d="M12 19V5"/>',
  'arrow-down': '<path d="M12 5v14"/> <path d="m19 12-7 7-7-7"/>',
  'folder-input': '<path d="M12 10v6"/> <path d="m9 13 3 3 3-3"/> <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9l-.81-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  'upload': '<path d="M12 3v12"/> <path d="m17 8-5-5-5 5"/> <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
  'history': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/> <path d="M3 3v5h5"/> <path d="M12 7v5l4 2"/>',
  'bookmark': '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  'zoom-in': '<circle cx="11" cy="11" r="8"/> <path d="m21 21-4.35-4.35"/> <path d="M11 8v6"/> <path d="M8 11h6"/>',
  'zoom-out': '<circle cx="11" cy="11" r="8"/> <path d="m21 21-4.35-4.35"/> <path d="M8 11h6"/>',
  'printer': '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/> <path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/> <rect x="6" y="14" width="12" height="8" rx="1"/>',
  'app-window': '<rect x="2" y="4" width="20" height="16" rx="2"/> <path d="M10 4v4"/> <path d="M2 8h20"/> <path d="M6 4v4"/>',
  'file': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/> <path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  'star': '<path d="M11.05 2.927c.3-.921 1.603-.921 1.902 0l1.9 5.846a1 1 0 0 0 .95.69h6.147c.969 0 1.371 1.24.588 1.81l-4.973 3.613a1 1 0 0 0-.364 1.118l1.9 5.846c.3.921-.755 1.688-1.539 1.118l-4.973-3.613a1 1 0 0 0-1.176 0l-4.973 3.613c-.783.57-1.838-.197-1.539-1.118l1.9-5.846a1 1 0 0 0-.363-1.118L1.463 11.27c-.783-.57-.38-1.81.588-1.81h6.146a1 1 0 0 0 .951-.69z"/>',
  'arrow-left': '<path d="m12 19-7-7 7-7"/> <path d="M19 12H5"/>',
  'arrow-right': '<path d="M5 12h14"/> <path d="m12 5 7 7-7 7"/>',
  'rotate-cw': '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/> <path d="M21 3v5h-5"/>',
  'x': '<path d="M18 6 6 18"/> <path d="m6 6 12 12"/>',
  'plus': '<path d="M5 12h14"/> <path d="M12 5v14"/>',
  'download': '<path d="M12 15V3"/> <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/> <path d="m7 10 5 5 5-5"/>',
  'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/> <path d="m9 12 2 2 4-4"/>',
  'shield': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  'shield-off': '<path d="m2 2 20 20"/> <path d="M5 5a1 1 0 0 0-1 1v7c0 5 3.5 7.5 7.67 8.94a1 1 0 0 0 .67.01c2.35-.82 4.48-1.97 5.9-3.71"/> <path d="M9.309 3.652A12.252 12.252 0 0 0 11.24 2.28a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1v7a9.784 9.784 0 0 1-.08 1.264"/>',
  'shield-alert': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/> <path d="M12 8v4"/> <path d="M12 16h.01"/>',
  'settings': '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/> <circle cx="12" cy="12" r="3"/>',
  'volume-2': '<path d="M11 5 6 9H3v6h3l5 4z"/> <path d="M15.5 8.5a5 5 0 0 1 0 7"/> <path d="M19 5a10 10 0 0 1 0 14"/>',
  'volume-x': '<path d="M11 5 6 9H3v6h3l5 4z"/> <path d="m22 9-6 6"/> <path d="m16 9 6 6"/>',
  'globe': '<circle cx="12" cy="12" r="10"/> <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/> <path d="M2 12h20"/>',
  'pause': '<rect x="14" y="3" width="5" height="18" rx="1"/> <rect x="5" y="3" width="5" height="18" rx="1"/>',
  'play': '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>',
  'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/> <path d="M21 3v5h-5"/> <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/> <path d="M8 16H3v5"/>',
  'zap': '<path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"/>',
  'file-up': '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/> <path d="M14 2v5a1 1 0 0 0 1 1h5"/> <path d="M12 12v6"/> <path d="m15 15-3-3-3 3"/>',
  'clipboard-paste': '<path d="M11 14h10"/> <path d="M16 4h2a2 2 0 0 1 2 2v1.344"/> <path d="m17 18 4-4-4-4"/> <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 1.793-1.113"/> <rect x="8" y="2" width="8" height="4" rx="1"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-up': '<path d="m18 15-6-6-6 6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'network': '<rect x="16" y="16" width="6" height="6" rx="1"/> <rect x="2" y="16" width="6" height="6" rx="1"/> <rect x="9" y="2" width="6" height="6" rx="1"/> <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/> <path d="M12 12V8"/>',
  'fingerprint': '<path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/> <path d="M14 13.12c0 2.38 0 6.38-1 8.88"/> <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/> <path d="M2 12a10 10 0 0 1 18-6"/> <path d="M2 16h.01"/> <path d="M21.8 16c.2-2 .131-5.354 0-6"/> <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/> <path d="M8.65 22c.21-.66.45-1.32.57-2"/> <path d="M9 6.8a6 6 0 0 1 9 5.2v2"/>',
  'database': '<ellipse cx="12" cy="5" rx="9" ry="3"/> <path d="M3 5V19A9 3 0 0 0 21 19V5"/> <path d="M3 12A9 3 0 0 0 21 12"/>',
  'wrench': '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/>',
  'palette': '<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/> <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/> <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/> <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/> <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>',
  'panel-top': '<rect width="18" height="18" x="3" y="3" rx="2"/> <path d="M3 9h18"/>',
  'panel-left': '<rect width="18" height="18" x="3" y="3" rx="2"/> <path d="M9 3v18"/>',
  'folder-open': '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
  'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/> <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  'external-link': '<path d="M15 3h6v6"/> <path d="M10 14 21 3"/> <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  'triangle-alert': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/> <path d="M12 9v4"/> <path d="M12 17h.01"/>',
  'info': '<circle cx="12" cy="12" r="10"/> <path d="M12 16v-4"/> <path d="M12 8h.01"/>',
  'trash-2': '<path d="M10 11v6"/> <path d="M14 11v6"/> <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/> <path d="M3 6h18"/> <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  'loader-circle': '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  'ellipsis': '<circle cx="12" cy="12" r="1"/> <circle cx="19" cy="12" r="1"/> <circle cx="5" cy="12" r="1"/>',
  'pin': '<path d="M12 17v5"/><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z"/>',
  'scissors': '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8 8 13 13M8 16 21 3"/>',
  'list-checks': '<path d="m3 6 2 2 3-3M11 7h10M3 17l2 2 3-3M11 18h10"/>',
  'undo-2': '<path d="M9 14 4 9l5-5"/><path d="M4 9h9a7 7 0 0 1 0 14"/>',
  'redo-2': '<path d="m15 14 5-5-5-5"/><path d="M20 9h-9a7 7 0 0 0 0 14"/>',
  'image': '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4-4L5 21"/>',
  'scan-search': '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="11" cy="11" r="3"/><path d="m16 16-2.5-2.5"/>',
  'search': '<path d="m21 21-4.34-4.34"/> <circle cx="11" cy="11" r="8"/>',
  'check': '<path d="M20 6 9 17l-5-5"/>',
  'rss': '<path d="M4 11a9 9 0 0 1 9 9"/> <path d="M4 4a16 16 0 0 1 16 16"/> <circle cx="5" cy="19" r="1"/>',
  'circle-dashed': '<path d="M10.1 2.182a10 10 0 0 1 3.8 0"/><path d="M13.9 21.818a10 10 0 0 1-3.8 0"/><path d="M17.609 3.721a10 10 0 0 1 2.69 2.7"/><path d="M2.182 13.9a10 10 0 0 1 0-3.8"/><path d="M20.279 17.609a10 10 0 0 1-2.7 2.69"/><path d="M21.818 10.1a10 10 0 0 1 0 3.8"/><path d="M3.721 6.391a10 10 0 0 1 2.7-2.69"/><path d="M6.391 20.279a10 10 0 0 1-2.69-2.7"/>',
  'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  'plug': '<path d="M12 22v-5"/><path d="M15 8V2"/><path d="M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z"/><path d="M9 8V2"/>',
  'clock': '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  'languages': '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
};

export type IconName = keyof typeof PATHS;

/** A 1.5px-stroke Lucide icon; its size comes from CSS (16px by default). */
export function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  svg.innerHTML = PATHS[name] ?? '';
  return svg;
}

/** Fills every `<… data-icon="name">` in the page with its icon, before any other content. */
export function paintIcons(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-icon]')) el.prepend(icon(el.dataset.icon!));
}
