import routing from './routing.json';

// Preserve reviewed copper while still running tscircuit's connectivity checks.
// A changed pad location invalidates the saved routing instead of silently reusing it.
export async function savedRouter(input: any) {
	const callbacks: Record<string, (event: any) => void> = {};
	return {
		stop() {},
		on(event: string, callback: (event: any) => void) { callbacks[event] = callback; },
		start() {
			try {
				if (input.layerCount !== routing.layerCount) throw Error('Saved routing uses a different layer stack. Reroute the board.');
				for (const connection of input.connections) {
					const net = routing.nets.find(n => n.id === connection.name)?.name;
					for (const point of connection.pointsToConnect) {
						if (!routing.pads.some(p => p.net === net && Math.hypot(p.x - point.x, p.y - point.y) < 0.001)) {
							throw Error(`Saved routing is stale at ${connection.name}: ${point.x}, ${point.y}. Regenerate DSN and SES.`);
						}
					}
				}
				const traces = routing.traces.map((trace, i) => {
					const net = routing.nets.find(n => n.name === trace.net);
					const id = net?.id;
					const connection = input.connections.find((c: any) => c.name === id);
					if (!connection) throw Error(`Saved net ${trace.net} is missing from the board`);
					return {
						type: 'pcb_trace', pcb_trace_id: `saved_route_${i}`,
						source_trace_id: net?.traceId, subcircuit_connectivity_map_key: net?.key,
						connection_name: connection.name, route: trace.route,
						connectsTo: [connection.source_trace_id, ...connection.pointsToConnect.map((p: any) => p.pcb_port_id)].filter(Boolean),
					};
				});
				callbacks.complete({ traces });
			} catch (error) { callbacks.error({ error }); }
		},
	};
}
