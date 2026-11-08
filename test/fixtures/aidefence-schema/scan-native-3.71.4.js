const aidefenceScanTool = {
    name: 'aidefence_scan',
    description: 'Scan input text for AI manipulation threats (prompt injection, jailbreaks, PII). Returns threat assessment with <10ms latency. Use when nothing native exists — Claude Code does not have a PII / prompt-injection / adversarial-text scanner. Pair with any tool that ingests untrusted input (browser scrape, federation envelope, memory_import_claude).',
    inputSchema: {
        type: 'object',
        properties: {
            input: {
                type: 'string',
                description: 'Text to scan for threats',
            },
            quick: {
                type: 'boolean',
                description: 'Quick scan mode (faster, less detailed)',
                default: false,
            },
        },
        required: ['input'],
    },
    handler: async (args) => {
        {
            const v = validateText(args.input, 'input');
            if (!v.valid)
                return { content: [{ type: 'text', text: JSON.stringify({ error: v.error }) }], isError: true };
        }
        const input = args.input;
        const quick = args.quick;
        try {
            const defender = await getAIDefence();
            if (quick) {
                const result = defender.quickScan(input);
                // Audit-flagged: quickScan focuses on prompt-injection/jailbreak
                // patterns and missed obvious PII (email + API key). Layer a fast
                // PII check so quick mode catches both threat classes.
                let piiPresent = false;
                try {
                    piiPresent = !!defender.hasPII(input);
                }
                catch { /* hasPII unavailable */ }
                const knownMiss = findKnownMiss(input);
                const threatDetected = result.threat || piiPresent || !!knownMiss;
                wrapperStats.quickScanCalls++;
                if (threatDetected)
                    wrapperStats.quickScanThreats++;
                return {
                    content: [{
                            type: 'text',
                            text: JSON.stringify({
                                safe: !threatDetected,
                                threatDetected,
                                confidence: result.confidence,
                                piiDetected: piiPresent,
                                promptInjectionDetected: result.threat || !!knownMiss,
                                ...(knownMiss ? { knownMiss: { threatType: knownMiss.threatType, reportedAt: knownMiss.reportedAt } } : {}),
                                mode: 'quick',
                            }, null, 2),
                        }],
                };
            }
            const result = await defender.detect(input);
            const knownMiss = findKnownMiss(input);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            safe: result.safe && !knownMiss,
                            threats: [
                                ...result.threats.map(t => ({
                                    type: t.type,
                                    severity: t.severity,
                                    confidence: t.confidence,
                                    description: t.description,
                                })),
                                ...(knownMiss ? [{ type: knownMiss.threatType, severity: 'high', confidence: 1, description: 'Matches an input previously reported as a missed threat (aidefence_learn)' }] : []),
                            ],
                            piiFound: result.piiFound,
                            detectionTimeMs: result.detectionTimeMs,
                        }, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({ error: String(error) }),
                    }],
                isError: true,
            };
        }
    },
};
const aidefenceAnalyzeTool = {};
