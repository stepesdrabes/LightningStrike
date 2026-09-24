# LightningStrike R2 PCB

**Unbuilt prototype; digital checks pass.** See [R2-REVIEW.md](R2-REVIEW.md)
and [release-status.json](release-status.json) for verification and remaining supplier/bench checks.
R1 is obsolete. [MANUFACTURING.md](MANUFACTURING.md) retains the historical review and cost budget.

The editable tscircuit source is `index.circuit.tsx`. Read [HARDWARE.md](../../HARDWARE.md)
for wiring, the board pin map, manufacturing notes and the future firmware migration.

```powershell
npm ci
npm run dev
```

To reproduce the saved routed board and prototype package:

```powershell
npm run typecheck
npm run netlist
npm run placement
npm run schematic *> dist/schematic-review.log
npm run build
npm run shorts
npm run check:routes
node scripts/review-electrical.mjs
node scripts/audit-layout.mjs
npm run export
```

The independent route check requires Java 25 or later. Export scripts use PowerShell.
The package is `dist/lightningstrike-r2-prototype.zip`; previews include `dist/preview-3d.png`
and `dist/pcb-bottom.png`. Export verifies the ground-plane antipads and via tenting, then packages
the checked circuit. Packaging requires matching reviewed hashes in `release-status.json` and
the check reports. Re-review changed geometry before updating that release hash.

Geometry changes require updating protected critical paths as necessary, rerouting with
`npm run route`, and all checks above. Automatic routing may require manual refinement.
Firmware has deliberately not been adapted. See HARDWARE.md for the future migration.
