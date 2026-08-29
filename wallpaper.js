// Fond d'écran façon WhatsApp : un motif d'icônes comptables qui se
// répète et s'entrelace sur toute la surface, en filigrane statique
// (aucune animation), dans un ton discret cohérent avec la charte.

const TUILE_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260" viewBox="0 0 260 260">
  <g fill="#16213E" fill-opacity="0.05">

    <!-- pièce -->
    <g transform="translate(18,20) rotate(-8)">
      <circle cx="12" cy="12" r="12"/>
      <circle cx="12" cy="12" r="7" fill="#FBF7F0" fill-opacity="1"/>
    </g>

    <!-- calculatrice -->
    <g transform="translate(150,10) rotate(6)">
      <rect x="0" y="0" width="30" height="38" rx="4"/>
      <rect x="5" y="5" width="20" height="8" rx="1.5" fill="#FBF7F0" fill-opacity="1"/>
      <circle cx="8" cy="21" r="2"/><circle cx="15" cy="21" r="2"/><circle cx="22" cy="21" r="2"/>
      <circle cx="8" cy="29" r="2"/><circle cx="15" cy="29" r="2"/><circle cx="22" cy="29" r="2"/>
    </g>

    <!-- graphique en barres -->
    <g transform="translate(55,70) rotate(-4)">
      <rect x="0" y="18" width="8" height="14" rx="1.5"/>
      <rect x="12" y="8" width="8" height="24" rx="1.5"/>
      <rect x="24" y="0" width="8" height="32" rx="1.5"/>
    </g>

    <!-- reçu -->
    <g transform="translate(190,90) rotate(10)">
      <path d="M0 0h26v34l-3-3-3 3-3-3-3 3-3-3-3 3-3-3-3 3-2-3z"/>
      <rect x="5" y="7" width="16" height="2.4" fill="#FBF7F0" fill-opacity="1"/>
      <rect x="5" y="14" width="16" height="2.4" fill="#FBF7F0" fill-opacity="1"/>
      <rect x="5" y="21" width="10" height="2.4" fill="#FBF7F0" fill-opacity="1"/>
    </g>

    <!-- portefeuille -->
    <g transform="translate(15,140) rotate(-6)">
      <rect x="0" y="6" width="34" height="24" rx="4"/>
      <path d="M0 12h34v6a6 6 0 0 1-6 6H6a6 6 0 0 1-6-6z" fill="#FBF7F0" fill-opacity="0.35"/>
      <circle cx="26" cy="18" r="3"/>
    </g>

    <!-- pourcentage -->
    <g transform="translate(110,150) rotate(12)">
      <circle cx="4" cy="4" r="4"/>
      <circle cx="24" cy="24" r="4"/>
      <rect x="2" y="12" width="24" height="4" rx="2" transform="rotate(-35 14 14)"/>
    </g>

    <!-- mallette -->
    <g transform="translate(185,180) rotate(-10)">
      <rect x="0" y="8" width="32" height="22" rx="3"/>
      <path d="M10 8V5a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3" fill="none" stroke="#16213E" stroke-opacity="0.05" stroke-width="3"/>
      <rect x="0" y="16" width="32" height="4" fill="#FBF7F0" fill-opacity="0.35"/>
    </g>

    <!-- petite pièce -->
    <g transform="translate(85,210) rotate(4)">
      <circle cx="9" cy="9" r="9"/>
      <circle cx="9" cy="9" r="5" fill="#FBF7F0" fill-opacity="1"/>
    </g>

    <!-- camembert -->
    <g transform="translate(230,230) rotate(-15)">
      <circle cx="12" cy="12" r="12"/>
      <path d="M12 12 L12 0 A12 12 0 0 1 22 18 Z" fill="#FBF7F0" fill-opacity="0.4"/>
    </g>

  </g>
</svg>
`.trim();

export const WALLPAPER_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(TUILE_SVG)}`;

export const wallpaperStyle = {
  backgroundImage: `url("${WALLPAPER_DATA_URI}")`,
  backgroundRepeat: "repeat",
  backgroundSize: "260px 260px",
  backgroundColor: "#FBF7F0",
};

export const WALLPAPER_RAW_SVG = TUILE_SVG;
