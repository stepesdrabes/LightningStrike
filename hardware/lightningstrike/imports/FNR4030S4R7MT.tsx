import type { InductorProps } from "@tscircuit/props"

export const FNR4030S4R7MT = (props: Omit<InductorProps, "inductance">) => {
  return (
    <inductor
      inductance="4.7uH"
      supplierPartNumbers={{
  "jlcpcb": [
    "C167874"
  ]
}}
      manufacturerPartNumber="FNR4030S4R7MT"
      footprint={<footprint>
        <smtpad portHints={["pin1"]} pcbX="-1.500124mm" pcbY="0mm" width="1.5999968mm" height="3.8999922mm" shape="rect" />
<smtpad portHints={["pin2"]} pcbX="1.500124mm" pcbY="0mm" width="1.5999968mm" height="3.8999922mm" shape="rect" />
<silkscreenpath route={[{"x":-2.0000214000002643,"y":2.099970399999961},{"x":1.9999959999997827,"y":2.099995799999988}]} />
<silkscreenpath route={[{"x":-2.0000214000002643,"y":-2.099970399999961},{"x":1.9999959999997827,"y":-2.099995799999874}]} />

<courtyardoutline outline={[{"x":-2.5487000000000535,"y":2.3582000000001244},{"x":2.54869999999994,"y":2.3582000000001244},{"x":2.54869999999994,"y":-2.3327999999999065},{"x":-2.5487000000000535,"y":-2.3327999999999065},{"x":-2.5487000000000535,"y":2.3582000000001244}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C167874.obj?uuid=f10f9856fbf34a8a9250995f07743de3",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C167874.step?uuid=f10f9856fbf34a8a9250995f07743de3",
        pcbRotationOffset: 270,
        modelOriginPosition: { x: 0, y: 0, z: -0.01 },
      }}
      {...props}
    />
  )
}
