import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["pin1"],
  pin2: ["pin2"],
  pin3: ["pin3"],
  pin4: ["pin4"],
  pin5: ["pin5"]
} as const

export const BM03B_GHS_TBT_LF__SN_ = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      supplierPartNumbers={{
  "jlcpcb": [
    "C161691"
  ]
}}
      manufacturerPartNumber="BM03B-GHS-TBT(LF)(SN)"
      footprint={<footprint>
        <smtpad portHints={["pin1"]} pcbX="1.250188mm" pcbY="1.99365235mm" width="0.5999988mm" height="1.6999966mm" shape="rect" />
<smtpad portHints={["pin2"]} pcbX="0mm" pcbY="1.99365235mm" width="0.5999988mm" height="1.6999966mm" shape="rect" />
<smtpad portHints={["pin3"]} pcbX="-1.249934mm" pcbY="1.99365235mm" width="0.5999988mm" height="1.6999966mm" shape="rect" />
<smtpad portHints={["pin4"]} pcbX="3.10007mm" pcbY="-1.34365365mm" width="1.1999976mm" height="2.999994mm" shape="rect" />
<smtpad portHints={["pin5"]} pcbX="-3.10007mm" pcbY="-1.34365365mm" width="1.1999976mm" height="2.999994mm" shape="rect" />
<silkscreenpath route={[{"x":-3.4999930000001314,"y":2.2687343499999315},{"x":-1.7811750000000757,"y":2.2687343499999315}]} />
<silkscreenpath route={[{"x":-0.7188962000001311,"y":2.2687343499999315},{"x":-0.5311394000000291,"y":2.2687343499999315}]} />
<silkscreenpath route={[{"x":0.5311394000000291,"y":2.2687343499999315},{"x":0.7189469999999574,"y":2.2687343499999315}]} />
<silkscreenpath route={[{"x":1.7812258000000156,"y":2.2687343499999315},{"x":3.4999930000000177,"y":2.2687343499999315}]} />
<silkscreenpath route={[{"x":3.4999930000000177,"y":2.2687343499999315},{"x":3.4999930000000177,"y":0.3873817499999177}]} />
<silkscreenpath route={[{"x":-2.2688550000000305,"y":-2.674994649999917},{"x":2.268854999999917,"y":-2.674994649999917}]} />
<silkscreenpath route={[{"x":-3.4999930000001314,"y":2.2687343499999315},{"x":-3.4999930000001314,"y":0.3873817499999177}]} />

<courtyardoutline outline={[{"x":-3.958400000000097,"y":3.102934350000055},{"x":3.9329999999999927,"y":3.102934350000055},{"x":3.9329999999999927,"y":-3.0866656499999863},{"x":-3.958400000000097,"y":-3.0866656499999863},{"x":-3.958400000000097,"y":3.102934350000055}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C161691.obj?uuid=e3ef543147e44f9db8666548eb351bf9",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C161691.step?uuid=e3ef543147e44f9db8666548eb351bf9",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: 1.25, y: -0.7144964499998695, z: -0.01 },
      }}
      {...props}
    />
  )
}
