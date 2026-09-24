// Original vector silkscreen. Coordinates are board top-view coordinates; the
// bottom-side fabrication/viewer transforms them. No raster or copper artwork.
export const crestPaths: number[][][] = [
  // Fractured lightning spear.
  [[13.9,12.4],[10.7,7.3],[12.5,7.3],[10.9,2.6],[15.5,8.7],[13.3,8.7],[13.9,12.4]],
  // Angular wings, three feathers per side.
  [[10.6,8.5],[6.1,11.2],[7.1,8.8],[10.0,7.2]],
  [[7.1,8.8],[6.0,8.8],[7.6,6.8],[9.9,6.0]],
  [[7.6,6.8],[6.9,6.3],[8.8,4.8],[10.5,4.8]],
  [[15.6,9.2],[19.2,11.2],[18.3,8.8],[16.2,7.4]],
  [[18.3,8.8],[19.3,8.8],[17.8,6.8],[15.1,5.6]],
  [[17.8,6.8],[18.4,6.3],[16.5,4.8],[14.3,4.8]],
  // Orbit and lower chevrons.
  [[7.7,12.6],[10.0,14.0],[15.4,14.0],[17.7,12.6]],
  [[8.5,3.9],[10.8,2.0],[15.0,2.0],[17.1,3.9]],
  [[9.8,0.0],[12.8,-1.1],[15.8,0.0]],
  // Four-point star above the spear.
  [[12.8,15.6],[13.05,15.1],[13.55,14.85],[13.05,14.6],[12.8,14.1],[12.55,14.6],[12.05,14.85],[12.55,15.1],[12.8,15.6]],
];
export const StormCrest = () => <>
  {crestPaths.map((path,i)=><silkscreenpath layer="bottom"
    strokeWidth={i===0?0.3:0.2} route={path.map(([x,y])=>({x,y}))} />)}
  <silkscreentext text="LIGHTNING" pcbX={12.8} pcbY={-2.3} layer="bottom" fontSize={0.9} />
  <silkscreentext text="STRIKE" pcbX={12.8} pcbY={-3.7} layer="bottom" fontSize={1.35} />
  <silkscreentext text="STORM CORE / R2" pcbX={12.8} pcbY={-5.4} layer="bottom" fontSize={0.65} />
</>;
