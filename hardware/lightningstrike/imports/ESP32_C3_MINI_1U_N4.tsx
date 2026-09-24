// Pins 54-61 identify the extra solder islands of manufacturer ground pad 49.
import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["GND1"],
  pin2: ["GND2"],
  pin3: ["3V3"],
  pin4: ["NC1"],
  pin5: ["IO2"],
  pin6: ["IO3"],
  pin7: ["NC2"],
  pin8: ["EN"],
  pin9: ["NC3"],
  pin10: ["NC4"],
  pin11: ["GND3"],
  pin12: ["IO0"],
  pin13: ["IO1"],
  pin14: ["GND4"],
  pin15: ["NC5"],
  pin16: ["IO10"],
  pin17: ["NC6"],
  pin18: ["IO4"],
  pin19: ["IO5"],
  pin20: ["IO6"],
  pin21: ["IO7"],
  pin22: ["IO8"],
  pin23: ["IO9"],
  pin24: ["NC7"],
  pin25: ["NC8"],
  pin26: ["IO18"],
  pin27: ["IO19"],
  pin28: ["NC9"],
  pin29: ["NC10"],
  pin30: ["RXD0"],
  pin31: ["TXD0"],
  pin32: ["NC11"],
  pin33: ["NC12"],
  pin34: ["NC13"],
  pin35: ["NC14"],
  pin36: ["GND5"],
  pin37: ["GND6"],
  pin38: ["GND7"],
  pin39: ["GND8"],
  pin40: ["GND9"],
  pin41: ["GND10"],
  pin42: ["GND11"],
  pin43: ["GND12"],
  pin44: ["GND13"],
  pin45: ["GND14"],
  pin46: ["GND15"],
  pin47: ["GND16"],
  pin48: ["GND17"],
  pin49: ["GND22"],
  pin50: ["GND18"],
  pin51: ["GND19"],
  pin52: ["GND20"],
  pin53: ["GND21"],
  pin54: ["EP49_2"],
  pin55: ["EP49_3"],
  pin56: ["EP49_4"],
  pin57: ["EP49_5"],
  pin58: ["EP49_6"],
  pin59: ["EP49_7"],
  pin60: ["EP49_8"],
  pin61: ["EP49_9"]
} as const

const pinAttributes = {
	pin3: {requiresPower: true},
  pin1: {requiresGround: true},
  pin2: {requiresGround: true},
  pin4: {doNotConnect: true},
  pin7: {doNotConnect: true},
  pin9: {doNotConnect: true},
  pin10: {doNotConnect: true},
  pin11: {requiresGround: true},
  pin14: {requiresGround: true},
  pin15: {doNotConnect: true},
  pin17: {doNotConnect: true},
  pin24: {doNotConnect: true},
  pin25: {doNotConnect: true},
  pin28: {doNotConnect: true},
  pin29: {doNotConnect: true},
  pin32: {doNotConnect: true},
  pin33: {doNotConnect: true},
  pin34: {doNotConnect: true},
  pin35: {doNotConnect: true},
  pin36: {requiresGround: true},
  pin37: {requiresGround: true},
  pin38: {requiresGround: true},
  pin39: {requiresGround: true},
  pin40: {requiresGround: true},
  pin41: {requiresGround: true},
  pin42: {requiresGround: true},
  pin43: {requiresGround: true},
  pin44: {requiresGround: true},
  pin45: {requiresGround: true},
  pin46: {requiresGround: true},
  pin47: {requiresGround: true},
  pin48: {requiresGround: true},
  pin49: {requiresGround: true},
  pin50: {requiresGround: true},
  pin51: {requiresGround: true},
  pin52: {requiresGround: true},
  pin53: {requiresGround: true},
  pin54: {requiresGround: true},
  pin55: {requiresGround: true},
  pin56: {requiresGround: true},
  pin57: {requiresGround: true},
  pin58: {requiresGround: true},
  pin59: {requiresGround: true},
  pin60: {requiresGround: true},
  pin61: {requiresGround: true}
} as const

export const ESP32_C3_MINI_1U_N4 = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      pinAttributes={pinAttributes}
      supplierPartNumbers={{
  "jlcpcb": [
    "C2911374"
  ]
}}
      manufacturerPartNumber="ESP32-C3-MINI-1U-N4"
      footprint={<footprint>
        <smtpad portHints={["pin1"]} pcbX="-5.899912mm" pcbY="3.999865mm" width="0.999998mm" height="0.499999mm" shape="rect" />
<smtpad portHints={["pin2"]} pcbX="-5.899912mm" pcbY="3.200019mm" width="0.999998mm" height="0.499999mm" shape="rect" />
<smtpad portHints={["pin3"]} pcbX="-5.899912mm" pcbY="2.399919mm" width="0.999998mm" height="0.499999mm" shape="rect" />
<smtpad portHints={["pin4"]} pcbX="-5.899912mm" pcbY="1.600073mm" width="0.999998mm" height="0.499999mm" shape="rect" />
<smtpad portHints={["pin5"]} pcbX="-5.899912mm" pcbY="0.799973mm" width="0.999998mm" height="0.499999mm" shape="rect" />
<smtpad portHints={["pin6"]} pcbX="-5.899912mm" pcbY="-0.000127mm" width="0.999998mm" height="0.499999mm" shape="rect" />
<smtpad portHints={["pin7"]} pcbX="-5.899912mm" pcbY="-0.799973mm" width="0.999998mm" height="0.499999mm" shape="rect" />
<smtpad portHints={["pin8"]} pcbX="-5.899912mm" pcbY="-1.600073mm" width="0.999998mm" height="0.499999mm" shape="rect" />
<smtpad portHints={["pin9"]} pcbX="-5.899912mm" pcbY="-2.399919mm" width="0.999998mm" height="0.499999mm" shape="rect" />
<smtpad portHints={["pin10"]} pcbX="-5.899912mm" pcbY="-3.200019mm" width="0.999998mm" height="0.499999mm" shape="rect" />
<smtpad portHints={["pin11"]} pcbX="-5.899912mm" pcbY="-4.000119mm" width="0.999998mm" height="0.499999mm" shape="rect" />
<smtpad portHints={["pin12"]} pcbX="-4.800092mm" pcbY="-5.000117mm" width="0.499999mm" height="0.999998mm" shape="rect" />
<smtpad portHints={["pin13"]} pcbX="-3.999992mm" pcbY="-5.000117mm" width="0.499999mm" height="0.999998mm" shape="rect" />
<smtpad portHints={["pin14"]} pcbX="-3.199892mm" pcbY="-5.000117mm" width="0.499999mm" height="0.999998mm" shape="rect" />
<smtpad portHints={["pin15"]} pcbX="-2.400046mm" pcbY="-5.000117mm" width="0.499999mm" height="0.999998mm" shape="rect" />
<smtpad portHints={["pin16"]} pcbX="-1.599946mm" pcbY="-5.000117mm" width="0.499999mm" height="0.999998mm" shape="rect" />
<smtpad portHints={["pin17"]} pcbX="-0.8001mm" pcbY="-5.000117mm" width="0.499999mm" height="0.999998mm" shape="rect" />
<smtpad portHints={["pin18"]} pcbX="0mm" pcbY="-5.000117mm" width="0.499999mm" height="0.999998mm" shape="rect" />
<smtpad portHints={["pin19"]} pcbX="0.8001mm" pcbY="-5.000117mm" width="0.499999mm" height="0.999998mm" shape="rect" />
<smtpad portHints={["pin20"]} pcbX="1.599946mm" pcbY="-5.000117mm" width="0.499999mm" height="0.999998mm" shape="rect" />
<smtpad portHints={["pin21"]} pcbX="2.400046mm" pcbY="-5.000117mm" width="0.499999mm" height="0.999998mm" shape="rect" />
<smtpad portHints={["pin22"]} pcbX="3.200146mm" pcbY="-5.000117mm" width="0.499999mm" height="0.999998mm" shape="rect" />
<smtpad portHints={["pin23"]} pcbX="3.999992mm" pcbY="-5.000117mm" width="0.499999mm" height="0.999998mm" shape="rect" />
<smtpad portHints={["pin24"]} pcbX="4.800092mm" pcbY="-5.000117mm" width="0.499999mm" height="0.999998mm" shape="rect" />
<smtpad portHints={["pin25"]} pcbX="5.899912mm" pcbY="-4.000119mm" width="0.999998mm" height="0.499999mm" shape="rect" />
<smtpad portHints={["pin26"]} pcbX="5.899912mm" pcbY="-3.200019mm" width="0.999998mm" height="0.499999mm" shape="rect" />
<smtpad portHints={["pin27"]} pcbX="5.899912mm" pcbY="-2.399919mm" width="0.999998mm" height="0.499999mm" shape="rect" />
<smtpad portHints={["pin28"]} pcbX="5.899912mm" pcbY="-1.600073mm" width="0.999998mm" height="0.499999mm" shape="rect" />
<smtpad portHints={["pin29"]} pcbX="5.899912mm" pcbY="-0.799973mm" width="0.999998mm" height="0.499999mm" shape="rect" />
<smtpad portHints={["pin30"]} pcbX="5.899912mm" pcbY="-0.000127mm" width="0.999998mm" height="0.499999mm" shape="rect" />
<smtpad portHints={["pin31"]} pcbX="5.899912mm" pcbY="0.799973mm" width="0.999998mm" height="0.499999mm" shape="rect" />
<smtpad portHints={["pin32"]} pcbX="5.899912mm" pcbY="1.600073mm" width="0.999998mm" height="0.499999mm" shape="rect" />
<smtpad portHints={["pin33"]} pcbX="5.899912mm" pcbY="2.399919mm" width="0.999998mm" height="0.499999mm" shape="rect" />
<smtpad portHints={["pin34"]} pcbX="5.899912mm" pcbY="3.200019mm" width="0.999998mm" height="0.499999mm" shape="rect" />
<smtpad portHints={["pin35"]} pcbX="5.899912mm" pcbY="3.999865mm" width="0.999998mm" height="0.499999mm" shape="rect" />
<smtpad portHints={["pin36"]} pcbX="4.800092mm" pcbY="5.000117mm" width="0.499999mm" height="0.999998mm" shape="rect" />
<smtpad portHints={["pin37"]} pcbX="3.999992mm" pcbY="5.000117mm" width="0.499999mm" height="0.999998mm" shape="rect" />
<smtpad portHints={["pin38"]} pcbX="3.200146mm" pcbY="5.000117mm" width="0.499999mm" height="0.999998mm" shape="rect" />
<smtpad portHints={["pin39"]} pcbX="2.400046mm" pcbY="5.000117mm" width="0.499999mm" height="0.999998mm" shape="rect" />
<smtpad portHints={["pin40"]} pcbX="1.599946mm" pcbY="5.000117mm" width="0.499999mm" height="0.999998mm" shape="rect" />
<smtpad portHints={["pin41"]} pcbX="0.8001mm" pcbY="5.000117mm" width="0.499999mm" height="0.999998mm" shape="rect" />
<smtpad portHints={["pin42"]} pcbX="0mm" pcbY="5.000117mm" width="0.499999mm" height="0.999998mm" shape="rect" />
<smtpad portHints={["pin43"]} pcbX="-0.8001mm" pcbY="5.000117mm" width="0.499999mm" height="0.999998mm" shape="rect" />
<smtpad portHints={["pin44"]} pcbX="-1.599946mm" pcbY="5.000117mm" width="0.499999mm" height="0.999998mm" shape="rect" />
<smtpad portHints={["pin45"]} pcbX="-2.400046mm" pcbY="5.000117mm" width="0.499999mm" height="0.999998mm" shape="rect" />
<smtpad portHints={["pin46"]} pcbX="-3.199892mm" pcbY="5.000117mm" width="0.499999mm" height="0.999998mm" shape="rect" />
<smtpad portHints={["pin47"]} pcbX="-3.999992mm" pcbY="5.000117mm" width="0.499999mm" height="0.999998mm" shape="rect" />
<smtpad portHints={["pin48"]} pcbX="-4.800092mm" pcbY="5.000117mm" width="0.499999mm" height="0.999998mm" shape="rect" />
<smtpad portHints={["pin50"]} pcbX="5.94995mm" pcbY="4.950079mm" width="0.6999986mm" height="0.6999986mm" shape="rect" />
<smtpad portHints={["pin51"]} pcbX="5.94995mm" pcbY="-4.949825mm" width="0.6999986mm" height="0.6999986mm" shape="rect" />
<smtpad portHints={["pin52"]} pcbX="-5.94995mm" pcbY="-4.949825mm" width="0.6999986mm" height="0.6999986mm" shape="rect" />
<smtpad portHints={["pin53"]} pcbX="-5.94995mm" pcbY="4.950079mm" width="0.6999986mm" height="0.6999986mm" shape="rect" />
<smtpad portHints={["pin49"]} pcbX="0mm" pcbY="0.000127mm" width="1.4500098mm" height="1.4500098mm" shape="rect" />
<smtpad portHints={["pin54"]} pcbX="-1.975104mm" pcbY="1.974977mm" width="1.4500098mm" height="1.4500098mm" shape="rect" />
<smtpad portHints={["pin55"]} pcbX="0mm" pcbY="1.974977mm" width="1.4500098mm" height="1.4500098mm" shape="rect" />
<smtpad portHints={["pin56"]} pcbX="1.975104mm" pcbY="1.974977mm" width="1.4500098mm" height="1.4500098mm" shape="rect" />
<smtpad portHints={["pin57"]} pcbX="1.975104mm" pcbY="0.000127mm" width="1.4500098mm" height="1.4500098mm" shape="rect" />
<smtpad portHints={["pin58"]} pcbX="1.975104mm" pcbY="-1.974977mm" width="1.4500098mm" height="1.4500098mm" shape="rect" />
<smtpad portHints={["pin59"]} pcbX="0mm" pcbY="-1.974977mm" width="1.4500098mm" height="1.4500098mm" shape="rect" />
<smtpad portHints={["pin60"]} pcbX="-1.97485mm" pcbY="-1.974977mm" width="1.4500098mm" height="1.4500098mm" shape="rect" />
<smtpad portHints={["pin61"]} pcbX="-1.97485mm" pcbY="0.000127mm" width="1.4500098mm" height="1.4500098mm" shape="rect" />
<silkscreenpath route={[{"x":-6.700012000000015,"y":6.900011599999971},{"x":-6.700012000000015,"y":-5.70001400000001},{"x":6.700012000000015,"y":-5.70001400000001},{"x":6.700012000000015,"y":6.7000119999999015},{"x":6.700012000000015,"y":6.900011599999971},{"x":6.500012399999832,"y":6.900011599999971},{"x":-6.700012000000015,"y":6.900011599999971}]} />
<silkscreencircle pcbX="-7.2009mm" pcbY="4.213987mm" radius="0.197612mm" />

<fabricationnotepath route={[{"x":-6.674992999999972,"y":-5.650001400000065},{"x":-6.674992999999972,"y":6.849973599999885},{"x":-6.599986800000011,"y":6.924979790121029},{"x":-6.524980600000163,"y":6.849973599999885},{"x":-6.524980600000163,"y":-5.650001400000065},{"x":-6.599986800000011,"y":-5.725007590121322},{"x":-6.674992999999972,"y":-5.650001400000065}]} strokeWidth="0.254mm" />
<fabricationnotepath route={[{"x":-6.599986800000011,"y":6.924979799999846},{"x":6.599986799999897,"y":6.924979799999846},{"x":6.653024192650946,"y":6.903010992650934},{"x":6.6749929999998585,"y":6.849973599999885},{"x":6.6749929999998585,"y":-5.650001400000065},{"x":6.6530241926511735,"y":-5.703038792651228},{"x":6.599986799999897,"y":-5.725007600000254},{"x":-6.599986800000011,"y":-5.725007600000254},{"x":-6.674992990121154,"y":-5.650001400000178},{"x":-6.599986800000011,"y":-5.57499520000033},{"x":6.524980600000049,"y":-5.574995200000103},{"x":6.524980600000049,"y":6.774967399999923},{"x":-6.599986800000011,"y":6.774967399999923},{"x":-6.674992990121154,"y":6.849973599999885},{"x":-6.599986800000011,"y":6.924979799999846}]} strokeWidth="0.254mm" />
<courtyardoutline outline={[{"x":-7.641399999999976,"y":7.170610999999894},{"x":6.955600000000004,"y":7.170610999999894},{"x":6.955600000000004,"y":-5.978589000000056},{"x":-7.641399999999976,"y":-5.978589000000056},{"x":-7.641399999999976,"y":7.170610999999894}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C2911374.obj?uuid=a2237b1a1f824d38a81224dbb725128d",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C2911374.step?uuid=a2237b1a1f824d38a81224dbb725128d",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: 0, y: -0.6500494999997954, z: -0.02 },
      }}
      {...props}
    />
  )
}
