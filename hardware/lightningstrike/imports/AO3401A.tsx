import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["G"],
  pin2: ["S"],
  pin3: ["D"]
} as const

export const AO3401A = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      symbol={
        <symbol>
          <schematictext text={props.name} schY={1.5} fontSize={0.3} />
          <schematicpath points={[{"x":0.2,"y":0},{"x":0.08,"y":0.04},{"x":0.08,"y":-0.04},{"x":0.2,"y":0}]} strokeColor="#880000" isFilled fillColor="#880000" />
          <schematicpath points={[{"x":0.4,"y":-0.04},{"x":0.46,"y":0.06},{"x":0.34,"y":0.06},{"x":0.4,"y":-0.04}]} strokeColor="#880000" isFilled fillColor="#880000" />
          <schematicpath points={[{"x":0.2,"y":-0.2},{"x":0.4,"y":-0.2},{"x":0.4,"y":-0.04}]} strokeColor="#880000" />
          <schematicpath points={[{"x":0.2,"y":0.14},{"x":0.2,"y":0.2},{"x":0.4,"y":0.2},{"x":0.4,"y":0.06}]} strokeColor="#880000" />
          <schematicpath points={[{"x":0.2,"y":0.14},{"x":0,"y":0.14}]} strokeColor="#880000" />
          <schematicpath points={[{"x":0,"y":0},{"x":0.2,"y":0},{"x":0.2,"y":-0.2}]} strokeColor="#880000" />
          <schematicpath points={[{"x":0.2,"y":-0.14},{"x":0,"y":-0.14}]} strokeColor="#880000" />
          <schematicpath points={[{"x":-0.04,"y":0.18},{"x":-0.04,"y":-0.18}]} strokeColor="#880000" />
          <schematicpath points={[{"x":0,"y":0.1},{"x":0,"y":0.18}]} strokeColor="#880000" />
          <schematicpath points={[{"x":0,"y":-0.04},{"x":0,"y":0.04}]} strokeColor="#880000" />
          <schematicpath points={[{"x":0,"y":-0.18},{"x":0,"y":-0.1}]} strokeColor="#880000" />
          <schematicpath points={[{"x":-0.2,"y":0},{"x":-0.04,"y":0}]} strokeColor="#880000" />
          <schematicpath points={[{"x":0.46,"y":-0.04},{"x":0.44,"y":-0.04},{"x":0.36,"y":-0.04},{"x":0.34,"y":-0.04}]} strokeColor="#880000" />
          <port name="pin3" pinNumber={3} aliases={["D"]} direction="up" schX={0.2} schY={0.4} schStemLength={0.2} />
          <port name="pin1" pinNumber={1} aliases={["G"]} direction="left" schX={-0.4} schY={0} schStemLength={0.2} />
          <port name="pin2" pinNumber={2} aliases={["S"]} direction="down" schX={0.2} schY={-0.4} schStemLength={0.2} />
        </symbol>
      }
      supplierPartNumbers={{
  "jlcpcb": [
    "C15127"
  ]
}}
      manufacturerPartNumber="AO3401A"
      footprint={<footprint>
        <smtpad portHints={["pin2"]} pcbX="1.149985mm" pcbY="0.94996mm" width="0.999998mm" height="0.7999984mm" shape="rect" />
<smtpad portHints={["pin3"]} pcbX="-1.149985mm" pcbY="0mm" width="0.999998mm" height="0.7999984mm" shape="rect" />
<smtpad portHints={["pin1"]} pcbX="1.149985mm" pcbY="-0.94996mm" width="0.999998mm" height="0.7999984mm" shape="rect" />
<silkscreenpath route={[{"x":-0.6999731999999881,"y":0.6359398000000027},{"x":-0.6999731999999881,"y":1.4999461999999966}]} />
<silkscreenpath route={[{"x":-0.6999731999999881,"y":1.4999461999999966},{"x":0.30005020000000115,"y":1.4999461999999966}]} />
<silkscreenpath route={[{"x":0.7000239999999991,"y":-0.31402020000000164},{"x":0.7000239999999991,"y":0.31391859999999383}]} />
<silkscreenpath route={[{"x":-0.6999731999999881,"y":-1.5000478000000044},{"x":-0.6999731999999881,"y":-0.6360414000000105}]} />
<silkscreenpath route={[{"x":-0.6999731999999881,"y":-1.5000478000000044},{"x":0.30005020000000115,"y":-1.5000478000000044}]} />

<courtyardoutline outline={[{"x":-1.8947769999999906,"y":1.74606},{"x":2.161223000000021,"y":1.74606},{"x":2.161223000000021,"y":-1.7511400000000066},{"x":-1.8947769999999906,"y":-1.7511400000000066},{"x":-1.8947769999999906,"y":1.74606}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C15127.obj?uuid=d777607a152f4f3aac9bb0d0c14ed6fd",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C15127.step?uuid=d777607a152f4f3aac9bb0d0c14ed6fd",
        pcbRotationOffset: 180,
        modelOriginPosition: { x: 0.00003809999999759839, y: -0.00003810000001180924, z: 0.050795 },
      }}
      {...props}
    />
  )
}
