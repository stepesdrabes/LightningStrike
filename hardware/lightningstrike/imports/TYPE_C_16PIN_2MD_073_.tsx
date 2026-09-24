import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin13: ["SHELL1"],
  pin14: ["SHELL2"],
  pin27: ["SHELL3"],
  pin28: ["SHELL4"],
  pin15: ["A1B12","GND1"],
  pin16: ["A4B9","VBUS1"],
  pin17: ["B8","SBU2"],
  pin18: ["A5","CC1"],
  pin19: ["B7","DM2"],
  pin20: ["A6","DP1"],
  pin21: ["A7","DM1"],
  pin22: ["B6","DP2"],
  pin23: ["A8","SBU1"],
  pin24: ["B5","CC2"],
  pin25: ["B4A9","VBUS2"],
  pin26: ["B1A12","GND2"]
} as const

export const TYPE_C_16PIN_2MD_073_ = (props: ChipProps<typeof pinLabels>) => {
  return (
    <connector
      pinLabels={pinLabels}
	  pinAttributes={{ pin17: {doNotConnect: true}, pin23: {doNotConnect: true} }}
      supplierPartNumbers={{
  "jlcpcb": [
    "C2765186"
  ]
}}
      manufacturerPartNumber="TYPE-C 16PIN 2MD(073)"
      footprint={<footprint>
        <hole pcbX="-2.889885mm" pcbY="1.05492555mm" diameter="0.700024mm" />
<hole pcbX="2.890139mm" pcbY="1.05492555mm" diameter="0.700024mm" />
<platedhole  portHints={["pin13"]} pcbX="-4.324985mm" pcbY="1.57511755mm" holeWidth="0.5999988mm" holeHeight="1.3999972mm" outerWidth="1.0999978mm" outerHeight="1.8999962mm" shape="pill" />
<platedhole  portHints={["pin14"]} pcbX="4.324985mm" pcbY="1.57511755mm" holeWidth="0.5999988mm" holeHeight="1.3999972mm" outerWidth="1.0999978mm" outerHeight="1.8999962mm" shape="pill" />
<platedhole  portHints={["pin27"]} pcbX="-4.324985mm" pcbY="-2.62502645mm" holeWidth="0.5999988mm" holeHeight="0.999998mm" outerWidth="1.1999976mm" outerHeight="1.5999968mm" shape="pill" />
<platedhole  portHints={["pin28"]} pcbX="4.324985mm" pcbY="-2.62502645mm" holeWidth="0.5999988mm" holeHeight="0.999998mm" outerWidth="1.1999976mm" outerHeight="1.5999968mm" shape="pill" />
<smtpad portHints={["pin15"]} pcbX="-3.200019mm" pcbY="2.12502755mm" width="0.5500116mm" height="1.0999978mm" shape="rect" />
<smtpad portHints={["pin16"]} pcbX="-2.399919mm" pcbY="2.12502755mm" width="0.5500116mm" height="1.0999978mm" shape="rect" />
<smtpad portHints={["pin17"]} pcbX="-1.749933mm" pcbY="2.12502755mm" width="0.2999994mm" height="1.0999978mm" shape="rect" />
<smtpad portHints={["pin18"]} pcbX="-1.249807mm" pcbY="2.12502755mm" width="0.2999994mm" height="1.0999978mm" shape="rect" />
<smtpad portHints={["pin19"]} pcbX="-0.749935mm" pcbY="2.12502755mm" width="0.2999994mm" height="1.0999978mm" shape="rect" />
<smtpad portHints={["pin20"]} pcbX="-0.250063mm" pcbY="2.12502755mm" width="0.2999994mm" height="1.0999978mm" shape="rect" />
<smtpad portHints={["pin21"]} pcbX="0.250063mm" pcbY="2.12502755mm" width="0.2999994mm" height="1.0999978mm" shape="rect" />
<smtpad portHints={["pin22"]} pcbX="0.749935mm" pcbY="2.12502755mm" width="0.2999994mm" height="1.0999978mm" shape="rect" />
<smtpad portHints={["pin23"]} pcbX="1.250061mm" pcbY="2.12502755mm" width="0.2999994mm" height="1.0999978mm" shape="rect" />
<smtpad portHints={["pin24"]} pcbX="1.750187mm" pcbY="2.12502755mm" width="0.2999994mm" height="1.0999978mm" shape="rect" />
<smtpad portHints={["pin25"]} pcbX="2.400173mm" pcbY="2.12502755mm" width="0.5500116mm" height="1.0999978mm" shape="rect" />
<smtpad portHints={["pin26"]} pcbX="3.200019mm" pcbY="2.12502755mm" width="0.5500116mm" height="1.0999978mm" shape="rect" />
<silkscreenpath route={[{"x":4.5720761999999695,"y":-1.646948650000013},{"x":4.5720761999999695,"y":0.34700214999986656}]} />
<silkscreenpath route={[{"x":4.5720761999999695,"y":-5.0759740500000134},{"x":4.5720761999999695,"y":-3.6030026500000076}]} />
<silkscreenpath route={[{"x":-4.499914800000056,"y":-1.6438244500001247},{"x":-4.499914800000056,"y":0.34390335000000505}]} />
<silkscreenpath route={[{"x":-4.499914800000056,"y":-5.224970450000114},{"x":-4.499914800000056,"y":-3.6061268500000097}]} />
<silkscreenpath route={[{"x":4.5000671999999895,"y":-5.224970450000114},{"x":-4.499914800000056,"y":-5.224970450000114}]} />

<courtyardoutline outline={[{"x":-4.752530999999976,"y":2.9338275499999327},{"x":4.81526899999983,"y":2.9338275499999327},{"x":4.81526899999983,"y":-5.490972450000072},{"x":-4.752530999999976,"y":-5.490972450000072},{"x":-4.752530999999976,"y":2.9338275499999327}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C2765186.obj?uuid=4ee8413127e64716b804db03d4b340ae",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C2765186.step?uuid=4ee8413127e64716b804db03d4b340ae",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: -0.000012699999956566899, y: 1.5749970500000927, z: -1.6800018 },
      }}
      {...props}
    />
  )
}
