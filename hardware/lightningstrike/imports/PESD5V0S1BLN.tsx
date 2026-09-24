import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["pin1"],
  pin2: ["pin2"]
} as const

export const PESD5V0S1BLN = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      symbol={
        <symbol>
          <schematictext text={props.name} schY={1.5} fontSize={0.3} />
          <port name="pin2" pinNumber={2} aliases={["2"]} direction="right" schX={0.4} schY={0} schStemLength={0.2} />
          <port name="pin1" pinNumber={1} aliases={["1"]} direction="left" schX={-0.4} schY={0} schStemLength={0.2} />
          <schematicpath points={[{"x":-0.2,"y":0.1},{"x":0,"y":0},{"x":-0.2,"y":-0.1},{"x":-0.2,"y":0.1}]} strokeColor="#880000" isFilled fillColor="#880000" />
          <schematicpath points={[{"x":0.2,"y":0.1},{"x":0,"y":0},{"x":0.2,"y":-0.1},{"x":0.2,"y":0.1}]} strokeColor="#880000" isFilled fillColor="#880000" />
          <schematicpath points={[{"x":-0.03,"y":-0.1},{"x":0.03,"y":-0.16},{"x":-0.01,"y":-0.12},{"x":-0.03,"y":-0.1},{"x":-0.03,"y":0.16},{"x":-0.05,"y":0.18},{"x":-0.07,"y":0.2}]} strokeColor="#880000" />
          <schematicpath points={[{"x":0.07,"y":-0.2},{"x":0.05,"y":-0.18},{"x":0.03,"y":-0.16},{"x":0.03,"y":0.1},{"x":0.03,"y":0.1},{"x":0.01,"y":0.12},{"x":-0.03,"y":0.16}]} strokeColor="#880000" />
        </symbol>
      }
      supplierPartNumbers={{
  "jlcpcb": [
    "C314269"
  ]
}}
      manufacturerPartNumber="PESD5V0S1BLN"
      footprint={<footprint>
        <smtpad portHints={["pin1"]} pcbX="-0.424942mm" pcbY="0mm" width="0.4500118mm" height="0.5500116mm" shape="rect" />
<smtpad portHints={["pin2"]} pcbX="0.424942mm" pcbY="0mm" width="0.4500118mm" height="0.5500116mm" shape="rect" />
<silkscreenpath route={[{"x":-0.7999984000000495,"y":0.39999919999991107},{"x":-0.7999984000000495,"y":0.19999960000006922}]} />
<silkscreenpath route={[{"x":-0.7999984000000495,"y":-0.39999919999991107},{"x":-0.7999984000000495,"y":-0.19999959999995554}]} />
<silkscreenpath route={[{"x":0.7999984000000495,"y":-0.39999919999991107},{"x":0.7999984000000495,"y":-0.19999959999995554}]} />
<silkscreenpath route={[{"x":0.7999984000000495,"y":0.39999919999991107},{"x":0.7999984000000495,"y":0.19999960000006922}]} />
<silkscreenpath route={[{"x":0.19999959999995554,"y":-0.39999919999991107},{"x":0.7999984000000495,"y":-0.39999919999991107}]} />
<silkscreenpath route={[{"x":-0.7999984000000495,"y":-0.39999919999991107},{"x":-0.1999996000001829,"y":-0.39999919999991107}]} />
<silkscreenpath route={[{"x":-0.1999996000001829,"y":0.39999919999991107},{"x":-0.7999984000000495,"y":0.39999919999991107}]} />
<silkscreenpath route={[{"x":0.19999959999995554,"y":0.39999919999991107},{"x":0.7999984000000495,"y":0.39999919999991107}]} />

<courtyardoutline outline={[{"x":-1.0374000000000478,"y":0.656400000000076},{"x":1.0628000000000384,"y":0.656400000000076},{"x":1.0628000000000384,"y":-0.6310000000000855},{"x":-1.0374000000000478,"y":-0.6310000000000855},{"x":-1.0374000000000478,"y":0.656400000000076}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C314269.obj?uuid=9c805dabf26842999d981f2745203d13",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C314269.step?uuid=9c805dabf26842999d981f2745203d13",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: 0, y: 0, z: -0.01 },
      }}
      {...props}
    />
  )
}
