import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["pin1"],
  pin2: ["GND1"],
  pin3: ["pin3"],
  pin4: ["GND2"]
} as const

const pinAttributes = {
  pin2: {requiresGround: true},
  pin4: {requiresGround: true}
} as const

export const ABM8_272_T3 = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      pinAttributes={pinAttributes}
      symbol={
        <symbol>
          <schematictext text={props.name} schY={1.5} fontSize={0.3} />
          <port name="pin1" pinNumber={1} aliases={["1"]} direction="left" schX={-0.6} schY={-0.2} schStemLength={0.2} />
          <port name="pin3" pinNumber={3} aliases={["3"]} direction="right" schX={0.6} schY={0.2} schStemLength={0.2} />
          <port name="pin4" pinNumber={4} aliases={["GND2","GND"]} direction="left" schX={-0.6} schY={0.2} schStemLength={0.2} />
          <port name="pin2" pinNumber={2} aliases={["GND1","GND"]} direction="right" schX={0.6} schY={-0.2} schStemLength={0.2} />
          <schematicrect schX={0} schY={0} width={0.8} height={0.8} strokeWidth={0.02} color="#880000" />
          <schematiccircle center={{ x: -0.3, y: -0.3 }} radius={0.03} strokeWidth={0.02} color="#880000" isFilled fillColor="#880000" />
          <schematicpath points={[{"x":-0.1,"y":-0.14},{"x":-0.1,"y":0.14}]} strokeColor="#881100" />
          <schematicpath points={[{"x":0.1,"y":-0.14},{"x":0.1,"y":0.14}]} strokeColor="#881100" />
          <schematicpath points={[{"x":-0.4,"y":-0.2},{"x":-0.2,"y":-0.2},{"x":-0.2,"y":0},{"x":-0.1,"y":0}]} strokeColor="#880000" />
          <schematicpath points={[{"x":0.4,"y":0.2},{"x":0.2,"y":0.2},{"x":0.2,"y":0},{"x":0.1,"y":0}]} strokeColor="#880000" />
          <schematicrect schX={0} schY={0} width={0.08} height={0.28} strokeWidth={0.02} color="#880000" />
        </symbol>
      }
      supplierPartNumbers={{
  "jlcpcb": [
    "C20625731"
  ]
}}
      manufacturerPartNumber="ABM8-272-T3"
      footprint={<footprint>
        <smtpad portHints={["pin1"]} pcbX="-1.100074mm" pcbY="-0.850011mm" width="1.3999972mm" height="1.1999976mm" shape="rect" />
<smtpad portHints={["pin2"]} pcbX="1.100074mm" pcbY="-0.850011mm" width="1.3999972mm" height="1.1999976mm" shape="rect" />
<smtpad portHints={["pin3"]} pcbX="1.100074mm" pcbY="0.850011mm" width="1.3999972mm" height="1.1999976mm" shape="rect" />
<smtpad portHints={["pin4"]} pcbX="-1.100074mm" pcbY="0.850011mm" width="1.3999972mm" height="1.1999976mm" shape="rect" />
<silkscreenpath route={[{"x":-2.028596400000083,"y":-1.6784827999999834},{"x":-2.028596400000083,"y":1.678736800000138},{"x":2.0285963999999694,"y":1.678736800000138},{"x":2.0285963999999694,"y":-1.6784827999999834},{"x":-2.028596400000083,"y":-1.6784827999999834}]} />
<silkscreenpath route={[{"x":-2.257196399999998,"y":-0.24988519999988057},{"x":-2.257196399999998,"y":-1.9070827999998983},{"x":-0.39999920000002476,"y":-1.9070827999998983}]} />

<courtyardoutline outline={[{x:-2.05,y:-1.7},{x:2.05,y:-1.7},{x:2.05,y:1.7},{x:-2.05,y:1.7},{x:-2.05,y:-1.7}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C20625731.obj?uuid=02485e56ba8d4732a26526d2983fc729",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C20625731.step?uuid=02485e56ba8d4732a26526d2983fc729",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: 0, y: -0.000012700000070253736, z: 0 },
      }}
      {...props}
    />
  )
}
