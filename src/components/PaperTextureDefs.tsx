export default function PaperTextureDefs() {
  // Keep this SVG in the DOM (even at 0x0) so CSS `filter: url(#...)` can reference it.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      style={{
        position: "absolute",
        width: 0,
        height: 0,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      <defs>
        {/* Filter 1: NOISE FILTER (Base Grain Layer) */}
        <filter id="noiseFilter">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="1.45"
            numOctaves="3"
            stitchTiles="stitch"
          />
        </filter>

        {/* Filter 2: PAPER FILTER (Main Paper Texture) */}
        <filter id="paperFilter" x="0%" y="0%" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.8"
            result="noise"
            numOctaves="5"
          />
          <feDiffuseLighting
            in="noise"
            lightingColor="white"
            surfaceScale="2"
          >
            {/* Required light source for feDiffuseLighting to render */}
            <feDistantLight azimuth="45" elevation="60" />
          </feDiffuseLighting>
        </filter>

        {/* Filter 3: GRAINY DISTORT FILTER (Organic Distortion) */}
        <filter id="grainyDistortFilter" filterUnits="userSpaceOnUse">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.75"
            numOctaves="2"
            stitchTiles="stitch"
            result="noise"
          />
          <feColorMatrix
            in="SourceGraphic"
            type="saturate"
            values="0"
            result="desat"
          />
          <feDisplacementMap
            in="desat"
            in2="noise"
            scale="7"
            xChannelSelector="R"
            yChannelSelector="G"
            result="distort"
          />
          <feBlend in="distort" in2="noise" mode="multiply" />
        </filter>

        {/* Filter 4: SQUIGGLE FILTER (Subtle Movement) */}
        <filter id="squiggle">
          <feTurbulence baseFrequency="0.01" numOctaves="4" seed="1" />
          <feDisplacementMap in="SourceGraphic" scale="10" />
        </filter>
      </defs>
    </svg>
  );
}


