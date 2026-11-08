// Native call expressions from CLI 3.71.4 in inert test wrappers.
async function otherNativeCaller0() {
await intel.recordTrajectory([{
                    type: 'action',
                    content: `Edit ${filePath}${agent ? ` by ${agent}` : ''}: ${success ? 'success' : 'failure'}`,
                    metadata: { hook: 'post-edit', filePath, agent, success },
                    timestamp: Date.now(),
                }], success ? 'success' : 'failure');
}

async function otherNativeCaller2() {
await intel.recordTrajectory(trajectory.steps.map((s) => ({
                    type: s.type ?? 'action',
                    content: String(s.content ?? `${s.action ?? ''} → ${s.result ?? ''}`).slice(0, 4096),
                    timestamp: Date.now(),
                })), success ? 'success' : 'failure');
}

async function otherNativeCaller3() {
await intel.recordTrajectory([{
                        type: 'result',
                        content,
                        metadata: { taskId, success, quality, teammateId },
                        timestamp: Date.now(),
                    }], success ? 'success' : 'failure');
}

function statsProjection() {
            ruvllmStats.trajectories = iStats._ruvllmTrajectories || 0;
}
