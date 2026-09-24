import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["pin1"],
  pin2: ["pin2"],
  pin3: ["pin3"],
  pin4: ["pin4"]
} as const

export const BM02B_GHS_TBT_LF__SN_ = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      supplierPartNumbers={{
  "jlcpcb": [
    "C161690"
  ]
}}
      manufacturerPartNumber="BM02B-GHS-TBT(LF)(SN)"
      footprint={<footprint>
        <smtpad portHints={["pin3"]} pcbX="2.474976mm" pcbY="-1.40013055mm" width="0.999998mm" height="2.7999944mm" shape="rect" />
<smtpad portHints={["pin4"]} pcbX="-2.474976mm" pcbY="-1.39987655mm" width="0.999998mm" height="2.7999944mm" shape="rect" />
<smtpad portHints={["pin2"]} pcbX="-0.624586mm" pcbY="1.95012945mm" width="0.5999988mm" height="1.6999966mm" shape="rect" />
<smtpad portHints={["pin1"]} pcbX="0.625094mm" pcbY="1.95012945mm" width="0.5999988mm" height="1.6999966mm" shape="rect" />
<silkscreenpath route={[{"x":-0.09367520000000695,"y":1.6719994499999302},{"x":0.09428479999996853,"y":1.6719994499999302}]} />
<silkscreenpath route={[{"x":-2.9209999999998217,"y":0.1479994499999293},{"x":-2.9209999999998217,"y":1.6719994499999302},{"x":-1.143000000000029,"y":1.6719994499999302}]} />
<silkscreenpath route={[{"x":-1.7438624000000118,"y":-2.6460005500000534},{"x":1.77800000000002,"y":-2.6460005500000534}]} />
<silkscreenpath route={[{"x":1.1560048000000052,"y":1.6719994499999302},{"x":2.921000000000049,"y":1.6719994499999302},{"x":2.921000000000049,"y":0.23054945000001226}]} />
<silkscreencircle pcbX="2.032mm" pcbY="1.54499945mm" radius="0.127mm" />

<courtyardoutline outline={[{"x":-3.232976000000008,"y":3.038583450000033},{"x":3.2106240000000525,"y":3.038583450000033},{"x":3.2106240000000525,"y":-3.074816550000037},{"x":-3.232976000000008,"y":-3.074816550000037},{"x":-3.232976000000008,"y":3.038583450000033}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C161690.obj?uuid=cc755f1f53ff46c9898e25afaac05be1",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C161690.step?uuid=cc755f1f53ff46c9898e25afaac05be1",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: 0.6249491999999464, y: -0.6024951500000088, z: -0.01 },
      }}
      {...props}
    />
  )
}
