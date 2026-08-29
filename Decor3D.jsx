import React from "react";

// Éléments décoratifs discrets en légère rotation 3D, thème comptabilité —
// pièces, graphique en barres, calculatrice. Purement visuel, en fond.
export default function Decor3D({ variant = "default" }) {
  return (
    <div style={styles.wrap} aria-hidden="true">
      <style>{CSS}</style>
      <div className="decor-item decor-coin" style={{ top: "6%", left: "8%" }}>
        <CoinIcon />
      </div>
      <div className="decor-item decor-chart" style={{ top: "14%", right: "10%" }}>
        <ChartIcon />
      </div>
      <div className="decor-item decor-coin decor-slow" style={{ bottom: "10%", left: "12%" }}>
        <CoinIcon small />
      </div>
      <div className="decor-item decor-calc" style={{ bottom: "8%", right: "8%" }}>
        <CalcIcon />
      </div>
    </div>
  );
}

function CoinIcon({ small }) {
  const s = small ? 34 : 46;
  return (
    <svg width={s} height={s} viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="20" fill="#D4A24C" opacity="0.85" />
      <circle cx="24" cy="24" r="20" stroke="#B4801F" strokeWidth="1.5" />
      <circle cx="24" cy="24" r="13" stroke="#FBF3E2" strokeWidth="1.5" opacity="0.7" />
      <path d="M20 20h6a3 3 0 0 1 0 6h-4a3 3 0 0 0 0 6h6" stroke="#FBF3E2" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.8" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
      <rect x="4" y="4" width="44" height="44" rx="10" fill="#16213E" opacity="0.9" />
      <rect x="13" y="28" width="6" height="12" rx="1.5" fill="#7FD4AC" />
      <rect x="23" y="20" width="6" height="20" rx="1.5" fill="#F3D9A0" />
      <rect x="33" y="14" width="6" height="26" rx="1.5" fill="#D4A24C" />
    </svg>
  );
}

function CalcIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
      <rect x="4" y="2" width="36" height="40" rx="6" fill="#186B4E" opacity="0.88" />
      <rect x="10" y="9" width="24" height="8" rx="2" fill="#E4F2EC" />
      <circle cx="13" cy="24" r="2.3" fill="#E4F2EC" />
      <circle cx="22" cy="24" r="2.3" fill="#E4F2EC" />
      <circle cx="31" cy="24" r="2.3" fill="#E4F2EC" />
      <circle cx="13" cy="32" r="2.3" fill="#E4F2EC" />
      <circle cx="22" cy="32" r="2.3" fill="#E4F2EC" />
      <circle cx="31" cy="32" r="2.3" fill="#E4F2EC" />
    </svg>
  );
}

const styles = {
  wrap: {
    position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0,
  },
};

const CSS = `
  .decor-item {
    position: absolute;
    animation: decorFloat3D 9s ease-in-out infinite;
    filter: drop-shadow(0 6px 10px rgba(22,33,62,0.12));
  }
  .decor-chart { animation-duration: 11s; animation-delay: 0.5s; }
  .decor-calc { animation-duration: 10s; animation-delay: 1.2s; }
  .decor-slow { animation-duration: 13s; animation-delay: 2s; }

  @keyframes decorFloat3D {
    0%   { transform: perspective(600px) rotateY(0deg) translateY(0px); }
    25%  { transform: perspective(600px) rotateY(15deg) translateY(-6px); }
    50%  { transform: perspective(600px) rotateY(0deg) translateY(0px); }
    75%  { transform: perspective(600px) rotateY(-15deg) translateY(6px); }
    100% { transform: perspective(600px) rotateY(0deg) translateY(0px); }
  }

  @media (max-width: 640px) {
    .decor-item { opacity: 0.5; transform: scale(0.8); }
  }
`;
