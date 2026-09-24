import type { ChipProps } from '@tscircuit/props';

// AOS AO3400A SOT-23: 1 gate, 2 source, 3 drain. Rds(on) specified at Vgs=2.5 V.
// The pin-numbered symbol is intentional: avoids misrepresenting a P-channel import.
const pinLabels = { pin1: ['G'], pin2: ['S'], pin3: ['D'] } as const;
export const AO3400A = (props: ChipProps<typeof pinLabels>) => <chip
  pinLabels={pinLabels} manufacturerPartNumber="AO3400A" supplierPartNumbers={{}}
  schPinArrangement={{ leftSide: { pins: ['pin1'], direction: 'top-to-bottom' },
    rightSide: { pins: ['pin3', 'pin2'], direction: 'top-to-bottom' } }}
  footprint={<footprint>
    <smtpad portHints={['pin1']} pcbX={1.15} pcbY={-0.95} width={1} height={0.8} shape="rect" />
    <smtpad portHints={['pin2']} pcbX={1.15} pcbY={0.95} width={1} height={0.8} shape="rect" />
    <smtpad portHints={['pin3']} pcbX={-1.15} pcbY={0} width={1} height={0.8} shape="rect" />
    <silkscreenpath route={[{x:-0.65,y:1.5},{x:0.3,y:1.5}]} strokeWidth={0.15} />
    <silkscreenpath route={[{x:-0.65,y:-1.5},{x:0.3,y:-1.5}]} strokeWidth={0.15} />
    <courtyardoutline outline={[{x:-1.9,y:-1.75},{x:1.9,y:-1.75},{x:1.9,y:1.75},{x:-1.9,y:1.75},{x:-1.9,y:-1.75}]} />
  </footprint>}
  cadModel={{objUrl:'https://modelcdn.tscircuit.com/easyeda_models/assets/C15127.obj?uuid=d777607a152f4f3aac9bb0d0c14ed6fd',
    pcbRotationOffset:180, modelOriginPosition:{x:0,y:0,z:0.050795}}}
  {...props} />;
