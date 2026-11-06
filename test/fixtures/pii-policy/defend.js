const defendCommand = {
    name: 'defend',
    description: 'AI manipulation defense - detect prompt injection, jailbreaks, and PII',
    options: [
        { name: 'input', short: 'i', type: 'string', description: 'Input text to scan for threats' },
        { name: 'file', short: 'f', type: 'string', description: 'File to scan for threats' },
        { name: 'quick', short: 'Q', type: 'boolean', description: 'Quick scan (faster, less detailed)' },
        { name: 'learn', short: 'l', type: 'boolean', description: 'Enable learning mode', default: 'true' },
        { name: 'stats', short: 's', type: 'boolean', description: 'Show detection statistics' },
        { name: 'output', short: 'o', type: 'string', description: 'Output format: text, json', default: 'text' },
    ],
    examples: [
        { command: 'claude-flow security defend -i "ignore previous instructions"', description: 'Scan text for threats' },
        { command: 'claude-flow security defend -f ./prompts.txt', description: 'Scan file for threats' },
        { command: 'claude-flow security defend --stats', description: 'Show detection statistics' },
    ],
    action: async (ctx) => {
        const inputText = ctx.flags.input;
        const filePath = ctx.flags.file;
        const quickMode = ctx.flags.quick;
        const showStats = ctx.flags.stats;
        const outputFormat = ctx.flags.output || 'text';
        const enableLearning = ctx.flags.learn !== false;
        output.writeln();
        output.writeln(output.bold('🛡️ AIDefence - AI Manipulation Defense System'));
        output.writeln(output.dim('─'.repeat(55)));
        // Dynamic import of aidefence (allows package to be optional)
        let defender;
        try {
            const aidefence = await import('@claude-flow/aidefence');
            defender = aidefence.createAIDefence({ enableLearning });
        }
        catch {
            // Keep cold npx startup lean (#2561): the full learning engine remains
            // user-installable, while the CLI always ships a deterministic scanner.
            defender = createBuiltinAIDefence();
            output.writeln(output.dim('Using built-in defense engine (install @claude-flow/aidefence for adaptive learning)'));
        }
        // Show stats mode
        if (showStats) {
            const stats = await defender.getStats();
            output.writeln();
            output.printBox([
                `Detection Count: ${stats.detectionCount}`,
                `Avg Detection Time: ${stats.avgDetectionTimeMs.toFixed(3)}ms`,
                `Learned Patterns: ${stats.learnedPatterns}`,
                `Mitigation Strategies: ${stats.mitigationStrategies}`,
                `Avg Mitigation Effectiveness: ${(stats.avgMitigationEffectiveness * 100).toFixed(1)}%`,
            ].join('\n'), 'Detection Statistics');
            return { success: true };
        }
        // Get input to scan
        let textToScan = inputText;
        if (filePath) {
            try {
                const fs = await import('fs/promises');
                textToScan = await fs.readFile(filePath, 'utf-8');
                output.writeln(output.dim(`Reading file: ${filePath}`));
            }
            catch (err) {
                output.printError(`Failed to read file: ${filePath}`);
                return { success: false, exitCode: 2, message: 'File not found' };
            }
        }
        if (!textToScan) {
            output.writeln('Usage: claude-flow security defend -i "<text>" or -f <file>');
            output.writeln();
            output.writeln('Options:');
            output.printList([
                '-i, --input   Text to scan for AI manipulation attempts',
                '-f, --file    File path to scan',
                '-q, --quick   Quick scan mode (faster)',
                '-s, --stats   Show detection statistics',
                '--learn       Enable pattern learning (default: true)',
            ]);
            return { success: true };
        }
        const spinner = output.createSpinner({ text: 'Scanning for threats...', spinner: 'dots' });
        spinner.start();
        // Perform scan
        const startTime = performance.now();
        const quickResult = quickMode ? defender.quickScan(textToScan) : undefined;
        const result = quickResult
            ? { ...quickResult, threats: [], piiFound: false, detectionTimeMs: 0, inputHash: '', safe: !quickResult.threat }
            : await defender.detect(textToScan);
        const scanTime = performance.now() - startTime;
        spinner.stop();
        // JSON output
        if (outputFormat === 'json') {
            output.writeln(JSON.stringify({
                safe: result.safe,
                threats: result.threats || [],
                piiFound: result.piiFound,
                detectionTimeMs: scanTime,
            }, null, 2));
            const safe = result.safe && !result.piiFound;
            return { success: safe, exitCode: safe ? 0 : 1 };
        }
        // Text output
        output.writeln();
        if (result.safe && !result.piiFound) {
            output.writeln(output.success('✅ No threats detected'));
        }
        else {
            if (!result.safe && result.threats) {
                output.writeln(output.error(`⚠️ ${result.threats.length} threat(s) detected:`));
                output.writeln();
                for (const threat of result.threats) {
                    const severityColor = {
                        critical: output.error,
                        high: output.warning,
                        medium: output.info,
                        low: output.dim,
                    }[threat.severity] || output.dim;
                    output.writeln(`  ${severityColor.call(output, `[${threat.severity.toUpperCase()}]`)} ${threat.type}`);
                    output.writeln(`    ${output.dim(threat.description)}`);
                    output.writeln(`    Confidence: ${(threat.confidence * 100).toFixed(1)}%`);
                    output.writeln();
                }
                // Show mitigation recommendations
                const criticalThreats = result.threats.filter(t => t.severity === 'critical');
                if (criticalThreats.length > 0 && enableLearning) {
                    output.writeln(output.bold('Recommended Mitigations:'));
                    for (const threat of criticalThreats) {
                        const mitigation = await defender.getBestMitigation(threat.type);
                        if (mitigation) {
                            output.writeln(`  ${threat.type}: ${output.bold(mitigation.strategy)} (${(mitigation.effectiveness * 100).toFixed(0)}% effective)`);
                        }
                    }
                    output.writeln();
                }
            }
            if (result.piiFound) {
                output.writeln(output.warning('⚠️ PII detected (emails, SSNs, API keys, etc.)'));
                output.writeln();
            }
        }
        output.writeln(output.dim(`Detection time: ${scanTime.toFixed(3)}ms`));
        const safe = result.safe && !result.piiFound;
        return { success: safe, exitCode: safe ? 0 : 1 };
    },
};
